const fs = require("node:fs");
const spawn = require("cross-spawn");
const { cliEnvironment } = require("./cli");

function main(specPath) {
  const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  const child = spawn(spec.executable, spec.args, {
    cwd: spec.root,
    env: {
      ...cliEnvironment(spec.org),
      TERM: process.env.TERM || "xterm-256color",
      SF_USE_PROGRESS_BAR: "true",
    },
    stdio: "inherit",
    windowsHide: true,
  });
  let launchError;
  child.on("error", (error) => {
    launchError = `Cannot start Salesforce CLI (${spec.executable}): ${error.message}. Install sf or configure sfSourceTools.sfPath.`;
    console.error(launchError);
  });
  child.on("close", (exitCode, signal) => {
    fs.writeFileSync(
      spec.resultPath,
      JSON.stringify({
        nonce: spec.nonce,
        exitCode,
        signal,
        error: launchError,
      }),
      { mode: 0o600 },
    );
    process.exitCode = launchError || exitCode === null ? 1 : exitCode;
  });
}

if (require.main === module) main(process.argv[2]);
module.exports = { main };
