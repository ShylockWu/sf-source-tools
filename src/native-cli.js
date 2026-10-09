const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { stripVTControlCharacters } = require("node:util");
const { CliError, cliEnvironment } = require("./cli");

function shellCommand(executable, args, platform = process.platform) {
  const quote =
    platform === "win32"
      ? (value) => `'${value.replaceAll("'", "''")}'`
      : (value) => `'${value.replaceAll("'", "'\\''")}'`;
  return `${platform === "win32" ? '$env:ELECTRON_RUN_AS_NODE="1"; & ' : "ELECTRON_RUN_AS_NODE=1 "}${[executable, ...args].map(quote).join(" ")}`;
}

function captureOutput(capture, chunk) {
  const raw = capture.raw + chunk;
  const plain = stripVTControlCharacters(raw);
  for (const match of plain.matchAll(
    /(?:Deploy|Retrieve) ID:\s*([a-zA-Z0-9]{15,18})\b/g,
  ))
    capture.ids.add(match[1]);
  const errors = [
    ...plain.matchAll(/(?:^|[\r\n])\s*Error(?: \(([\w.]+)\))?:\s*([^\r\n]+)/g),
  ];
  if (errors.length)
    capture.error = { name: errors.at(-1)[1], message: errors.at(-1)[2] };
  capture.raw = raw.slice(-65536);
}

function nativeResult(result, capture) {
  if (result.error) throw new CliError(result.error);
  if (result.exitCode === 0)
    return { success: true, done: true, status: "Succeeded" };
  if (
    capture.ids.size === 1 &&
    (result.exitCode === 69 ||
      /timeout|timed out|did not complete/i.test(
        `${capture.error?.name} ${capture.error?.message}`,
      ))
  ) {
    return { id: [...capture.ids][0], done: false, status: "InProgress" };
  }
  throw new CliError(
    capture.error?.message ||
      `Salesforce CLI exited with ${result.exitCode ?? result.signal ?? "an unknown status"}. See the SF Source Tools terminal. No success is assumed.`,
    { name: capture.error?.name },
  );
}

function waitForIntegration(api, terminal, timeout) {
  if (terminal.shellIntegration)
    return Promise.resolve(terminal.shellIntegration);
  return new Promise((resolve, reject) => {
    const disposables = [];
    const finish = (error, integration) => {
      clearTimeout(timer);
      for (const disposable of disposables) disposable.dispose();
      if (error) reject(error);
      else resolve(integration);
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "Terminal shell integration is unavailable. Enable terminal.integrated.shellIntegration.enabled and run the command again. No Salesforce command was started.",
          ),
        ),
      timeout,
    );
    disposables.push(
      api.window.onDidChangeTerminalShellIntegration((event) => {
        if (event.terminal === terminal)
          finish(undefined, event.shellIntegration);
      }),
    );
    disposables.push(
      api.window.onDidCloseTerminal((closed) => {
        if (closed === terminal)
          finish(
            new Error("The terminal was closed before Salesforce CLI started."),
          );
      }),
    );
  });
}

async function executeInTerminal(api, terminal, integration, command, capture) {
  let execution;
  const disposables = [];
  const ended = new Promise((resolve, reject) => {
    disposables.push(
      api.window.onDidEndTerminalShellExecution((event) => {
        if (event.execution === execution) resolve(event.exitCode);
      }),
    );
    disposables.push(
      api.window.onDidCloseTerminal((closed) => {
        if (closed === terminal)
          reject(
            new Error(
              "The terminal was closed. The remote Salesforce operation may still be running; check its status before retrying.",
            ),
          );
      }),
    );
  });
  try {
    execution = integration.executeCommand(command);
    const read = (async () => {
      for await (const chunk of execution.read()) captureOutput(capture, chunk);
    })();
    await Promise.all([ended, read]);
  } finally {
    for (const disposable of disposables) disposable.dispose();
  }
}

function createTerminalCli(api, operation, options = {}) {
  let terminal;
  const root =
    options.temporaryRoot || process.env.PI_SCRATCH_DIR || os.tmpdir();
  const platform = options.platform || process.platform;
  return async function invoke(executable, args, context, log = () => {}) {
    const nativeArgs = args.filter((arg) => arg !== "--json");
    log(
      `sf ${nativeArgs.map((arg) => JSON.stringify(arg)).join(" ")}\nProject: ${context.root}\nOrg: ${context.org}`,
    );
    const directory = await fs.mkdtemp(path.join(root, "n-"));
    const nonce = randomUUID();
    const specPath = path.join(directory, "command.json");
    const resultPath = path.join(directory, "result.json");
    try {
      await fs.writeFile(
        specPath,
        JSON.stringify({
          executable,
          args: nativeArgs,
          root: context.root,
          org: context.org,
          resultPath,
          nonce,
        }),
        { mode: 0o600 },
      );
      if (!terminal) {
        terminal = api.window.createTerminal({
          name: `SF Source Tools: ${operation} — ${path.basename(context.root)}`,
          cwd: context.root,
          env: {
            ...cliEnvironment(context.org),
            TERM: "xterm-256color",
            SF_USE_PROGRESS_BAR: "true",
            ELECTRON_RUN_AS_NODE: "1",
          },
          shellPath: platform === "win32" ? "pwsh.exe" : "/bin/bash",
          shellArgs: [],
        });
      }
      terminal.show(true);
      const integration = await waitForIntegration(
        api,
        terminal,
        options.integrationTimeout || 20000,
      );
      const capture = { raw: "", ids: new Set(), error: undefined };
      const command = shellCommand(
        process.execPath,
        [path.join(__dirname, "native-runner.js"), specPath],
        platform,
      );
      await executeInTerminal(api, terminal, integration, command, capture);
      let result;
      const deadline = Date.now() + (options.confirmationTimeout ?? 5000);
      while (!result) {
        try {
          result = JSON.parse(await fs.readFile(resultPath, "utf8"));
        } catch (error) {
          if (error.code !== "ENOENT" || Date.now() >= deadline) {
            log(stripVTControlCharacters(capture.raw));
            throw new Error(
              "The terminal command did not return a confirmed CLI result. No success is assumed. See the SF Source Tools terminal.",
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      if (result.nonce !== nonce)
        throw new Error(
          "The terminal returned an unexpected command result. No success is assumed.",
        );
      return nativeResult(result, capture);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  };
}

module.exports = {
  createTerminalCli,
  shellCommand,
  captureOutput,
  nativeResult,
};
