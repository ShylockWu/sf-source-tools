const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const testApi = require("vscode");

async function run() {
  const extension = testApi.extensions.getExtension(
    "shylockwu.sf-source-tools",
  );
  assert.ok(extension, "extension discovered");
  const vscode = createRequire(
    path.join(extension.extensionPath, "package.json"),
  )("vscode");
  const outputLines = [];
  let outputShown = 0;
  let createdName;
  const createOutputChannel = vscode.window.createOutputChannel;
  vscode.window.createOutputChannel = (...args) => {
    createdName = args[0];
    const channel = createOutputChannel(...args);
    return new Proxy(channel, {
      get(target, property) {
        if (property === "appendLine")
          return (line) => {
            outputLines.push(line);
            target.appendLine(line);
          };
        if (property === "show")
          return (...showArgs) => {
            outputShown++;
            target.show(...showArgs);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  try {
    await extension.activate();
  } finally {
    vscode.window.createOutputChannel = createOutputChannel;
  }
  assert.equal(createdName, "SF Source Tools");
  assert.equal(extension.isActive, true);
  const commands = await vscode.commands.getCommands(true);
  for (const operation of ["retrieve", "deploy", "deleteOrg", "deleteBoth"])
    assert.ok(commands.includes(`sfSourceTools.${operation}`));
  const root = fs.realpathSync(process.env.SF_SOURCE_TEST_ROOT);
  const relative = "force-app/main/default/lwc/greeting/greeting.html";
  const a = vscode.Uri.file(path.join(root, "a", relative));
  const b = vscode.Uri.file(path.join(root, "b", relative));
  await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(b),
  );
  let openedTerminals = 0;
  const listener = vscode.window.onDidOpenTerminal(() => {
    openedTerminals++;
  });
  try {
    let completed = false;
    const firstRun = vscode.commands
      .executeCommand("sfSourceTools.deploy", a)
      .then((result) => {
        completed = true;
        return result;
      });
    const deadline = Date.now() + 10000;
    while (
      !outputLines.some((line) => line.includes("✔ Preparing")) &&
      !completed &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    const live = outputLines.some((line) => line.includes("✔ Preparing"));
    const completedEarly = completed;
    fs.writeFileSync(process.env.SF_SOURCE_TEST_GATE, "continue");
    const first = await firstRun;
    assert.equal(first.success, true, JSON.stringify(first));
    assert.equal(live, true, "live progress reached the actual OutputChannel");
    assert.equal(
      completedEarly,
      false,
      "progress was streamed before CLI completion",
    );
    assert.equal(outputShown, 1, "Output panel opened automatically");
    assert.match(outputLines.join("\n"), /Deployed Source/);
    assert.match(outputLines.join("\n"), /Components: 1\/1/);
    const second = await vscode.commands.executeCommand(
      "sfSourceTools.deploy",
      b,
    );
    assert.equal(second.success, true, JSON.stringify(second));
    const cross = await vscode.commands.executeCommand(
      "sfSourceTools.deploy",
      a,
      [a, b],
    );
    assert.match(cross.error, /multiple Salesforce projects/);
    fs.rmSync(path.join(root, "a/.sf/config.json"));
    const missing = await vscode.commands.executeCommand(
      "sfSourceTools.deploy",
      a,
    );
    assert.match(missing.error, /No project-local default org/);
    const log = fs
      .readFileSync(process.env.SF_SOURCE_TEST_LOG, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(log.length, 2);
    assert.equal(path.relative(path.join(root, "a"), log[0].cwd), "");
    assert.equal(log[0].org, "host-org-a");
    assert.equal(path.relative(path.join(root, "b"), log[1].cwd), "");
    assert.equal(log[1].org, "host-org-b");
    assert.deepEqual(log[0].args.slice(0, 3), ["project", "deploy", "start"]);
    assert.equal(log[0].args.includes(a.fsPath), true);
    assert.equal(log[0].args.includes("--ignore-conflicts"), false);
    assert.equal(log[0].args.includes("--json"), false);
    assert.equal(log[0].tty, false);
    assert.equal(log[1].tty, false);
    assert.equal(openedTerminals, 0, "no integrated terminal was created");
    assert.equal(outputShown, 4, "Output is shown for executions and errors");
    console.log(
      "Extension host passed: activation, four commands, selected-resource priority, two project/org contexts, rejected selections, live OutputChannel progress and result table with shell integration disabled, no terminals.",
    );
  } finally {
    listener.dispose();
  }
}

module.exports = { run };
