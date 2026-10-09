const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runTests } = require("@vscode/test-electron");
const { fixture, write } = require("../test/helpers");

async function main() {
  const scratch = fs.mkdtempSync(
    path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), "h-"),
  );
  try {
    const a = fixture(scratch, "a", "host-org-a");
    const b = fixture(scratch, "b", "host-org-b");
    const cli = write(
      scratch,
      "fake-sf.cjs",
      'const fs=require("node:fs");fs.appendFileSync(process.env.SF_SOURCE_TEST_LOG,JSON.stringify({cwd:process.cwd(),org:process.env.SF_TARGET_ORG,args:process.argv.slice(2)})+"\\n");console.log(JSON.stringify({status:0,result:{success:true,status:"Succeeded",done:true}}));',
    );
    const launcher = write(
      scratch,
      process.platform === "win32" ? "fake-sf.cmd" : "fake-sf",
      process.platform === "win32"
        ? `@echo off\r\n"${process.execPath}" "${cli}" %*\r\n`
        : `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(cli)} "$@"\n`,
    );
    fs.chmodSync(launcher, 0o755);
    const workspace = write(
      scratch,
      "test.code-workspace",
      JSON.stringify({ folders: [{ path: a.root }, { path: b.root }] }),
    );
    write(
      scratch,
      "u/User/settings.json",
      JSON.stringify({
        "sfSourceTools.sfPath": launcher,
        "security.workspace.trust.enabled": false,
        "workbench.startupEditor": "none",
      }),
    );
    const installed = process.env.SF_SOURCE_TEST_EXTENSION;
    await runTests({
      ...(process.env.VSCODE_EXECUTABLE_PATH
        ? { vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH }
        : {
            version: "stable",
            cachePath: path.join(
              process.env.PI_SCRATCH_DIR || os.tmpdir(),
              "sf-source-vscode-cache",
            ),
          }),
      extensionDevelopmentPath: installed || path.resolve(__dirname, ".."),
      extensionTestsPath: path.resolve(__dirname, "../test/host/suite.js"),
      launchArgs: [
        workspace,
        "--user-data-dir",
        path.join(scratch, "u"),
        "--extensions-dir",
        path.join(scratch, "extensions"),
        "--disable-extensions",
        "--disable-workspace-trust",
        "--skip-welcome",
        "--skip-release-notes",
      ],
      extensionTestsEnv: {
        SF_SOURCE_TEST_ROOT: scratch,
        SF_SOURCE_TEST_LOG: path.join(scratch, "cli-log.jsonl"),
        SF_TARGET_ORG: "wrong-inherited-org",
      },
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
