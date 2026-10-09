const vscode = require("vscode");
const { createController } = require("./controller");

function activate(context) {
  const output = vscode.window.createOutputChannel("SF Source Tools");
  const run = createController(vscode, output);
  context.subscriptions.push(output);
  for (const operation of ["retrieve", "deploy", "deleteOrg", "deleteBoth"]) {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        `sfSourceTools.${operation}`,
        (uri, selections) => run(operation, uri, selections),
      ),
    );
  }
}

module.exports = { activate };
