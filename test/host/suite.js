const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

async function run() {
  const extension = vscode.extensions.getExtension("shylockwu.sf-source-tools");
  assert.ok(extension, "extension discovered");
  await extension.activate();
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
  const nativeOutput = [];
  const reading = [];
  const listener = vscode.window.onDidStartTerminalShellExecution((event) => {
    if (event.terminal.name.startsWith("SF Source Tools:")) {
      reading.push(
        (async () => {
          for await (const chunk of event.execution.read())
            nativeOutput.push(chunk);
        })(),
      );
    }
  });
  const first = await vscode.commands.executeCommand("sfSourceTools.deploy", a);
  if (!first.success) {
    await Promise.all(reading);
    listener.dispose();
    console.error("Native terminal diagnostic output:", nativeOutput.join(""));
  }
  assert.equal(first.success, true, JSON.stringify(first));
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
  assert.equal(log[0].tty, true);
  assert.equal(log[1].tty, true);
  await Promise.all(reading);
  listener.dispose();
  assert.match(nativeOutput.join(""), /Preparing/);
  assert.match(nativeOutput.join(""), /Deployed Source/);
  console.log(
    "Extension host passed: activation, four commands, selected-resource priority, two project/org contexts, cross-project rejection, missing-org rejection, literal CLI argv, real TTY progress and result table.",
  );
}

module.exports = { run };
