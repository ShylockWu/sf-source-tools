const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { spawn } = require("cross-spawn");
const {
  createTerminalCli,
  shellCommand,
  captureOutput,
  nativeResult,
} = require("../src/native-cli");
const { fixture, temporary, write } = require("./helpers");

function terminalApi(onExecution) {
  const events = new EventEmitter();
  const register = (name) => (callback) => {
    events.on(name, callback);
    return { dispose: () => events.off(name, callback) };
  };
  const terminals = [];
  const api = {
    window: {
      onDidEndTerminalShellExecution: register("end"),
      onDidCloseTerminal: register("close"),
      onDidChangeTerminalShellIntegration: register("integration"),
      createTerminal: (options) => {
        const terminal = {
          options,
          show: () => {},
          shellIntegration: {
            executeCommand: (command) => {
              const execution = {
                read: async function* () {
                  yield "✔ Preparing\r\n";
                },
              };
              queueMicrotask(async () => {
                try {
                  await onExecution(command, terminal);
                  events.emit("end", { execution, exitCode: 0 });
                } catch (error) {
                  events.emit("close", terminal);
                }
              });
              return execution;
            },
          },
        };
        terminals.push(terminal);
        return terminal;
      },
    },
  };
  return { api, events, terminals };
}

function getSpec(command) {
  const match =
    command.match(/'([^']*command\.json)'$/) ||
    command.match(/"([^"]*command\.json)"/);
  assert.ok(match, command);
  return JSON.parse(fs.readFileSync(match[1], "utf8"));
}

test("shell launcher quotes literal arguments including apostrophes and substitutions", async (t) => {
  const root = temporary(t);
  const script = write(
    root,
    "args.cjs",
    "console.log(JSON.stringify(process.argv.slice(2)))",
  );
  const args = [script, "a' b;$()\"`&|", "--json"];
  const command = shellCommand(process.execPath, args, "darwin");
  if (process.platform !== "win32") {
    const result = await new Promise((resolve, reject) => {
      const child = spawn("/bin/bash", ["-c", command]);
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolve(JSON.parse(output))
          : reject(new Error(`exit ${code}`)),
      );
    });
    assert.deepEqual(result, args.slice(1));
  }
  const windows = shellCommand("node.exe", ["a'b;$()\"`&|"], "win32");
  assert.match(windows, /Start-Process -FilePath 'node.exe'/);
  assert.match(windows, /-NoNewWindow -PassThru -Wait/);
  assert.match(windows, /ELECTRON_RUN_AS_NODE/);
});

test("native terminal strips JSON only, keeps source args literal, and binds project and org", async (t) => {
  const root = temporary(t);
  const a = fixture(root);
  let spec;
  const h = terminalApi(async (command) => {
    spec = getSpec(command);
    fs.writeFileSync(
      spec.resultPath,
      JSON.stringify({ nonce: spec.nonce, exitCode: 0 }),
    );
  });
  const invoke = createTerminalCli(h.api, "deploy", {
    platform: "darwin",
    temporaryRoot: root,
  });
  const result = await invoke(
    "sf",
    ["project", "deploy", "start", "--source-dir", a.html, "--json"],
    { root: a.root, org: "local-org" },
  );
  assert.equal(result.success, true);
  assert.deepEqual(spec.args, [
    "project",
    "deploy",
    "start",
    "--source-dir",
    a.html,
  ]);
  assert.equal(spec.root, a.root);
  assert.equal(spec.org, "local-org");
  assert.equal(h.terminals[0].options.cwd, a.root);
  assert.equal(h.terminals[0].options.env.SF_TARGET_ORG, "local-org");
  assert.equal(h.terminals[0].options.env.SF_USE_PROGRESS_BAR, "true");
  assert.equal(h.terminals[0].options.env.TERM, "xterm-256color");
  assert.equal(fs.existsSync(spec.resultPath), false);
});

test("one terminal is reused for retries and each command gets a fresh private result", async (t) => {
  const root = temporary(t);
  const a = fixture(root);
  const nonces = [];
  const h = terminalApi(async (command) => {
    const spec = getSpec(command);
    nonces.push(spec.nonce);
    fs.writeFileSync(
      spec.resultPath,
      JSON.stringify({ nonce: spec.nonce, exitCode: 0 }),
    );
  });
  const invoke = createTerminalCli(h.api, "deploy", {
    platform: "darwin",
    temporaryRoot: root,
  });
  for (let i = 0; i < 2; i++)
    await invoke("sf", ["project", "deploy", "start", "--json"], {
      root: a.root,
      org: "org",
    });
  assert.equal(h.terminals.length, 1);
  assert.notEqual(nonces[0], nonces[1]);
});

test("missing shell integration starts no CLI and cleans temporary spec", async (t) => {
  const root = temporary(t);
  const a = fixture(root);
  const h = terminalApi(async () => {
    assert.fail("must not execute");
  });
  const create = h.api.window.createTerminal;
  h.api.window.createTerminal = (options) => {
    const terminal = create(options);
    terminal.shellIntegration = undefined;
    return terminal;
  };
  const invoke = createTerminalCli(h.api, "deploy", {
    integrationTimeout: 10,
    temporaryRoot: root,
  });
  await assert.rejects(
    invoke("sf", ["start"], { root: a.root, org: "org" }),
    /shell integration is unavailable/,
  );
  assert.equal(
    fs.readdirSync(root).some((file) => file.startsWith("n-")),
    false,
  );
});

test("missing or mismatched result cannot produce success", async (t) => {
  const root = temporary(t);
  const a = fixture(root);
  for (const mismatch of [false, true]) {
    const h = terminalApi(async (command) => {
      const spec = getSpec(command);
      if (mismatch)
        fs.writeFileSync(
          spec.resultPath,
          JSON.stringify({ nonce: "other", exitCode: 0 }),
        );
    });
    await assert.rejects(
      createTerminalCli(h.api, "deploy", {
        platform: "darwin",
        temporaryRoot: root,
        confirmationTimeout: 10,
      })("sf", [], { root: a.root, org: "org" }),
      /No success is assumed/,
    );
  }
});

test("terminal closure is an error, not a canceled or successful remote job", async (t) => {
  const root = temporary(t);
  const a = fixture(root);
  const h = terminalApi(async () => {
    throw new Error("closed");
  });
  await assert.rejects(
    createTerminalCli(h.api, "deploy", {
      platform: "darwin",
      temporaryRoot: root,
    })("sf", [], { root: a.root, org: "org" }),
    /may still be running/,
  );
});

test("native ANSI progress with split IDs preserves timeout following and named conflicts", () => {
  const capture = { raw: "", ids: new Set() };
  captureOutput(
    capture,
    "\u001b[32m✔ Preparing\u001b[0m\r\nDeploy ID: 0Af000000",
  );
  captureOutput(capture, "000001AAA\r\nStatus: In Progress\r\n");
  assert.deepEqual(nativeResult({ exitCode: 69 }, capture), {
    id: "0Af000000000001AAA",
    done: false,
    status: "InProgress",
  });
  captureOutput(
    capture,
    "Error (SourceConflictError): There are conflicts in this source\r\n",
  );
  assert.throws(
    () => nativeResult({ exitCode: 1 }, capture),
    (error) => error.payload.name === "SourceConflictError",
  );
  assert.throws(
    () =>
      nativeResult({ exitCode: null, signal: "SIGTERM" }, { ids: new Set() }),
    /No success is assumed/,
  );
});

test("native runner uses array arguments, reports failures, and never relies on terminal defaults", async (t) => {
  const root = temporary(t);
  const a = fixture(root);
  const fake = write(
    root,
    "fake.cjs",
    'const fs=require("node:fs");fs.writeFileSync("observed.json",JSON.stringify({org:process.env.SF_TARGET_ORG,args:process.argv.slice(2)}));process.exitCode=1;',
  );
  const resultPath = path.join(root, "result.json");
  const spec = write(
    root,
    "spec.json",
    JSON.stringify({
      executable: process.execPath,
      args: [fake, "literal;$()"],
      root: a.root,
      org: "bound-org",
      nonce: "expected",
      resultPath,
    }),
  );
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.resolve(__dirname, "../src/native-runner.js"), spec],
      { env: { ...process.env, SF_TARGET_ORG: "wrong" } },
    );
    child.on("error", reject);
    child.on("close", resolve);
  });
  assert.equal(code, 1);
  assert.equal(
    JSON.parse(fs.readFileSync(resultPath, "utf8")).nonce,
    "expected",
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(a.root, "observed.json"), "utf8")),
    { org: "bound-org", args: ["literal;$()"] },
  );
});

test("Deploy is first in both context menus and command contributions", () => {
  const pkg = require("../package.json");
  assert.equal(pkg.contributes.commands[0].command, "sfSourceTools.deploy");
  for (const menu of ["explorer/context", "editor/context"]) {
    assert.equal(
      pkg.contributes.menus[menu][0].command,
      "sfSourceTools.deploy",
    );
    assert.equal(pkg.contributes.menus[menu][0].group, "sf_source_tools@1");
  }
});

test("Windows terminal uses supported PowerShell 7 shell integration", async (t) => {
  const root = temporary(t);
  const a = fixture(root);
  const h = terminalApi(async (command) => {
    const spec = getSpec(command);
    fs.writeFileSync(
      spec.resultPath,
      JSON.stringify({ nonce: spec.nonce, exitCode: 0 }),
    );
  });
  await createTerminalCli(h.api, "deploy", {
    platform: "win32",
    temporaryRoot: root,
  })("sf", ["project", "deploy", "start", "--json"], {
    root: a.root,
    org: "org",
  });
  assert.equal(h.terminals[0].options.shellPath, "pwsh.exe");
  assert.deepEqual(h.terminals[0].options.shellArgs, []);
});

test("early shell completion waits for nonce-confirmed runner result without resubmission", async (t) => {
  const root = temporary(t);
  const a = fixture(root);
  let calls = 0;
  const h = terminalApi(async (command) => {
    calls++;
    const spec = getSpec(command);
    setTimeout(
      () =>
        fs.writeFileSync(
          spec.resultPath,
          JSON.stringify({ nonce: spec.nonce, exitCode: 0 }),
        ),
      100,
    );
  });
  const result = await createTerminalCli(h.api, "deploy", {
    platform: "darwin",
    temporaryRoot: root,
  })("sf", [], { root: a.root, org: "org" });
  assert.equal(result.success, true);
  assert.equal(calls, 1);
});
