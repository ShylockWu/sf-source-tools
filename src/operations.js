const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { ComponentSet } = require("@salesforce/source-deploy-retrieve");
const { runJob, isConflict } = require("./cli");
const { assertDeleteScope } = require("./project");

async function executeOperation(operation, context, options) {
  const { invoke, confirm, log = () => {}, wait = 33 } = options;
  if (operation === "deleteBoth") assertDeleteScope(context);
  const summary = `Project: ${context.root}\nOrg: ${context.org}\n\n${context.members.join("\n")}`;
  log(summary);
  let args;
  let temporary;
  try {
    if (operation === "retrieve") {
      if (
        !(await confirm(
          "Retrieve may overwrite local source, including other files in a metadata component. Unsaved editors must be saved or closed first.",
          summary,
          "Retrieve",
        ))
      )
        return { canceled: true };
    }
    if (operation === "deleteOrg" || operation === "deleteBoth") {
      const action =
        operation === "deleteOrg"
          ? "Delete from Org"
          : "Delete from Project and Org";
      const notice =
        operation === "deleteOrg"
          ? "Local source will be retained."
          : "Local source will be removed by Salesforce CLI only after remote success.";
      if (
        !(await confirm(
          `${action}? This can delete object data and dependent metadata. Salesforce may cascade deletions. ${notice}`,
          summary,
          action,
        ))
      )
        return { canceled: true };
    }
    if (operation === "deleteOrg") {
      if (!/^\d+\.\d+$/.test(context.apiVersion || ""))
        throw new Error(
          "Set a valid sourceApiVersion in sfdx-project.json before deleting metadata.",
        );
      temporary = await fs.mkdtemp(
        path.join(
          process.env.PI_SCRATCH_DIR || os.tmpdir(),
          "sf-source-tools-",
        ),
      );
      const empty = new ComponentSet([], context.registry);
      empty.sourceApiVersion = context.apiVersion;
      empty.projectDirectory = context.root;
      const manifest = path.join(temporary, "package.xml");
      const destructive = path.join(temporary, "destructiveChangesPost.xml");
      await fs.writeFile(manifest, await empty.getPackageXml());
      await fs.writeFile(destructive, await context.components.getPackageXml());
      args = [
        "project",
        "deploy",
        "start",
        "--manifest",
        manifest,
        "--post-destructive-changes",
        destructive,
      ];
    } else if (operation === "deleteBoth") {
      args = [
        "project",
        "delete",
        "source",
        "--no-prompt",
        "--track-source",
        ...context.members.flatMap((member) => ["--metadata", member]),
      ];
    } else if (operation === "deploy" || operation === "retrieve") {
      args = [
        "project",
        operation,
        "start",
        ...context.sources.flatMap((source) => ["--source-dir", source]),
      ];
    } else throw new Error(`Unsupported source operation: ${operation}`);
    args.push("--wait", String(wait), "--json");
    try {
      return await runJob(invoke, args, operation, wait, log);
    } catch (error) {
      if (
        !["deploy", "retrieve", "deleteBoth"].includes(operation) ||
        !isConflict(error)
      )
        throw error;
      const action =
        operation === "deleteBoth"
          ? "Delete with Force Overwrite"
          : "Overwrite Conflicts";
      if (
        !(await confirm(
          "Salesforce reported conflicts. Force overwrite can discard changes. Continue against this same project and org?",
          summary,
          action,
        ))
      )
        throw error;
      return await runJob(
        invoke,
        [
          ...args,
          operation === "deleteBoth"
            ? "--force-overwrite"
            : "--ignore-conflicts",
        ],
        operation,
        wait,
        log,
      );
    }
  } finally {
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  }
}

module.exports = { executeOperation };
