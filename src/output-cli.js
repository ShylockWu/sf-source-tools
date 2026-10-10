const spawn = require("cross-spawn");
const { stripVTControlCharacters } = require("node:util");
const { CliError, cliEnvironment } = require("./cli");

function captureLine(capture, line) {
  for (const match of line.matchAll(
    /(?:Deploy|Retrieve) ID:\s*([a-zA-Z0-9]{15,18})\b/g,
  ))
    capture.ids.add(match[1]);
  const error = line.match(/^\s*Error(?: \(([\w.]+)\))?:\s*(.+)/);
  if (error) capture.error = { name: error[1], message: error[2] };
}

function cliResult(exitCode, signal, capture) {
  if (exitCode === 0) return { success: true, done: true, status: "Succeeded" };
  if (
    capture.ids.size === 1 &&
    (exitCode === 69 ||
      /timeout|timed out|did not complete/i.test(
        `${capture.error?.name} ${capture.error?.message}`,
      ))
  ) {
    return { id: [...capture.ids][0], done: false, status: "InProgress" };
  }
  throw new CliError(
    capture.error?.message ||
      `Salesforce CLI exited with ${exitCode ?? signal ?? "an unknown status"}. See SF Source Tools output. No success is assumed.`,
    { name: capture.error?.name },
  );
}

function lineWriter(emit) {
  let pending = "";
  return (chunk, end = false) => {
    pending += chunk;
    const trailingCR = !end && pending.endsWith("\r");
    const text = trailingCR ? pending.slice(0, -1) : pending;
    const lines = text.split(/\r\n|\r|\n/);
    pending = lines.pop() + (trailingCR ? "\r" : "");
    for (const line of lines) emit(stripVTControlCharacters(line));
    if (end && pending) {
      emit(stripVTControlCharacters(pending));
      pending = "";
    }
  };
}

function runOutputCli(executable, args, context, log = () => {}) {
  const nativeArgs = args.filter((arg) => arg !== "--json");
  log(
    `sf ${nativeArgs.map((arg) => JSON.stringify(arg)).join(" ")}\nProject: ${context.root}\nOrg: ${context.org}`,
  );
  return new Promise((resolve, reject) => {
    const child = spawn(executable, nativeArgs, {
      cwd: context.root,
      env: {
        ...cliEnvironment(context.org),
        CI: "true",
        MSO_DISABLE_CI_MODE: "false",
        OCLIF_CI_UPDATE_FREQUENCY_MS: "1000",
        FORCE_COLOR: "0",
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const capture = { ids: new Set() };
    const emit = (line) => {
      captureLine(capture, line);
      log(line);
    };
    const stdout = lineWriter(emit);
    const stderr = lineWriter(emit);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", stdout);
    child.stderr.on("data", stderr);
    child.on("error", (error) =>
      reject(
        new CliError(
          `Cannot start Salesforce CLI (${executable}): ${error.message}. Install sf or configure sfSourceTools.sfPath.`,
        ),
      ),
    );
    child.on("close", (exitCode, signal) => {
      stdout("", true);
      stderr("", true);
      try {
        resolve(cliResult(exitCode, signal, capture));
      } catch (error) {
        reject(error);
      }
    });
  });
}

module.exports = { runOutputCli, lineWriter, captureLine, cliResult };
