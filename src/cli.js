const spawn = require("cross-spawn");

function cliEnvironment(org, inherited = process.env) {
  return {
    ...inherited,
    SF_TARGET_ORG: org,
    SFDX_DEFAULTUSERNAME: org,
    TERM: "dumb",
    PAGER: "cat",
    SF_PAGER: "cat",
    SF_USE_PROGRESS_BAR: "false",
    SF_DISABLE_AUTOUPDATE: "true",
  };
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        /token|password|secret|authorization/i.test(key)
          ? "[REDACTED]"
          : redact(entry),
      ]),
    );
  }
  return value;
}

class CliError extends Error {
  constructor(message, payload) {
    super(message);
    this.payload = payload;
  }
}

function runCli(executable, args, context, log = () => {}) {
  log(
    `sf ${args.map((arg) => JSON.stringify(arg)).join(" ")}\nProject: ${context.root}\nOrg: ${context.org}`,
  );
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: context.root,
      env: cliEnvironment(context.org),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) =>
      reject(
        new CliError(
          `Cannot start Salesforce CLI (${executable}): ${error.message}. Install sf or configure sfSourceTools.sfPath.`,
        ),
      ),
    );
    child.on("close", (code) => {
      let payload;
      try {
        payload = JSON.parse(stdout);
      } catch {
        reject(
          new CliError(
            `Salesforce CLI did not return valid JSON (exit ${code}). ${stderr.trim() || stdout.slice(0, 2000)}`,
          ),
        );
        return;
      }
      log(JSON.stringify(redact(payload), null, 2));
      if (stderr.trim()) log(stderr.trim());
      if (code !== 0 || payload.status !== 0) {
        reject(
          new CliError(
            payload.message ||
              `Salesforce CLI failed (exit ${code}, status ${payload.status}). See SF Source Tools output.`,
            payload,
          ),
        );
      } else resolve(payload.result);
    });
  });
}

function jobId(value) {
  const id = value?.id || value?.jobId;
  return typeof id === "string" && /^[a-zA-Z0-9]{15,18}$/.test(id)
    ? id
    : undefined;
}

function pending(result) {
  return (
    result?.done === false ||
    ["Pending", "InProgress", "Queued", "Canceling"].includes(result?.status)
  );
}

async function runJob(invoke, args, operation, wait, log = () => {}) {
  let command = args;
  let followingId;
  while (true) {
    let result;
    try {
      result = await invoke(command);
    } catch (error) {
      const payload = error.payload;
      if (jobId(payload?.result) && pending(payload.result)) {
        result = payload.result;
      } else if (
        jobId(payload?.data) &&
        (payload.status === 69 ||
          /timeout|timed out|did not complete/i.test(
            `${payload?.name} ${error.message}`,
          ))
      ) {
        result = { id: jobId(payload.data), done: false };
      } else throw error;
    }
    if (pending(result)) {
      const id = jobId(result);
      if (!id)
        throw new Error(
          "Salesforce returned an unfinished operation without a job ID. No success is assumed.",
        );
      if (operation === "retrieve") {
        throw new Error(
          `Retrieve has not completed (job ${id}). Salesforce CLI has no retrieve resume command. Increase sfSourceTools.waitMinutes and verify the remote job and local source before starting another retrieve. No successful retrieval is assumed.`,
        );
      }
      if (operation === "deleteBoth") {
        throw new Error(
          `Deletion has not completed (job ${id}). Local source is retained by the CLI. Check the remote job with "sf project deploy report --job-id ${id}" from this project before any further deletion; do not blindly retry.`,
        );
      }
      if (followingId && followingId !== id)
        throw new Error(
          "Salesforce returned a different job ID while following the operation. No success is assumed.",
        );
      followingId = id;
      log(`Following unfinished job ${id}.`);
      command = [
        "project",
        "deploy",
        "resume",
        "--job-id",
        id,
        "--wait",
        String(wait),
        "--json",
      ];
      continue;
    }
    if (
      !result ||
      result.success === false ||
      ["Failed", "Canceled", "SucceededPartial"].includes(result.status)
    ) {
      throw new Error(
        `Salesforce operation did not succeed (${result?.status || "no result"}). See SF Source Tools output.`,
      );
    }
    if (result.success !== true && result.status !== "Succeeded") {
      throw new Error(
        "Salesforce did not confirm a successful operation. No success is assumed.",
      );
    }
    return result;
  }
}

function isConflict(error) {
  return (
    /conflict/i.test(error.payload?.name || "") ||
    /conflict/i.test(error.message)
  );
}

module.exports = {
  CliError,
  cliEnvironment,
  runCli,
  runJob,
  redact,
  isConflict,
};
