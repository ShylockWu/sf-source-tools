const path = require("node:path");
const { resolveSelection, isWithin } = require("./project");
const { runCli } = require("./cli");
const { executeOperation } = require("./operations");

function selectedUris(uri, selections, activeUri) {
  if (uri?.scheme === "file") {
    return Array.isArray(selections) &&
      selections.some((value) => value.toString() === uri.toString())
      ? selections
      : [uri];
  }
  if (activeUri?.scheme === "file") return [activeUri];
  throw new Error(
    "Right-click a Salesforce source file or folder, or open a source file before using the command palette.",
  );
}

function createController(api, output, dependencies = {}) {
  const resolve = dependencies.resolve || resolveSelection;
  const cli = dependencies.cli || runCli;
  const busy = new Set();
  return async function run(operation, uri, selections) {
    let root;
    let ownsLock = false;
    try {
      if (!api.workspace.isTrusted)
        throw new Error(
          "Trust this workspace before running Salesforce source operations.",
        );
      const uris = selectedUris(
        uri,
        selections,
        api.window.activeTextEditor?.document.uri,
      );
      if (uris.some((value) => value.scheme !== "file"))
        throw new Error("Only local filesystem source is supported.");
      const context = resolve(uris.map((value) => value.fsPath));
      root = context.root;
      if (busy.has(root))
        throw new Error(
          `Another Salesforce operation is already running in ${root}. Wait for it to finish.`,
        );
      busy.add(root);
      ownsLock = true;
      const dirty = api.workspace.textDocuments.filter(
        (document) =>
          document.isDirty &&
          document.uri.scheme === "file" &&
          isWithin(root, document.uri.fsPath),
      );
      if (dirty.length) {
        const save = "Save Project Files";
        const chosen = await api.window.showWarningMessage(
          "Save modified files in this Salesforce project before continuing?",
          {
            modal: true,
            detail: dirty
              .map((document) => path.relative(root, document.uri.fsPath))
              .join("\n"),
          },
          save,
        );
        if (chosen !== save) return { canceled: true };
        for (const document of dirty) {
          if (!(await document.save()))
            throw new Error(
              `Could not save ${document.uri.fsPath}. Operation stopped.`,
            );
        }
      }
      const refreshed = resolve(uris.map((value) => value.fsPath));
      if (refreshed.org !== context.org || refreshed.root !== root)
        throw new Error(
          "Project or default org changed while preparing the operation. Run the command again.",
        );
      const config = api.workspace.getConfiguration("sfSourceTools", uris[0]);
      const executable = config.get("sfPath", "sf");
      const wait = config.get("waitMinutes", 33);
      output.show(true);
      const log = (line) => output.appendLine(line);
      const result = await api.window.withProgress(
        {
          location: api.ProgressLocation.Notification,
          title: `SF Source Tools: ${operation} → ${context.org}`,
          cancellable: false,
        },
        async () =>
          executeOperation(operation, refreshed, {
            wait,
            log,
            invoke: (args) => cli(executable, args, refreshed, log),
            confirm: async (message, detail, action) =>
              (await api.window.showWarningMessage(
                message,
                { modal: true, detail },
                action,
              )) === action,
          }),
      );
      if (!result.canceled)
        api.window.showInformationMessage(
          `SF Source Tools: ${operation} succeeded in ${path.basename(root)} (${context.org}).`,
        );
      return result;
    } catch (error) {
      output.appendLine(`ERROR: ${error.message}`);
      output.show(true);
      api.window.showErrorMessage(`SF Source Tools: ${error.message}`);
      return { error: error.message };
    } finally {
      if (ownsLock) busy.delete(root);
    }
  };
}

module.exports = { createController, selectedUris };
