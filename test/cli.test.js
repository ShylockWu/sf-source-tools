const test = require("node:test");
const assert = require("node:assert/strict");
const { runCli, cliEnvironment, redact } = require("../src/cli");
const { temporary, write } = require("./helpers");

test("project-local org wins over inherited org environment", () => {
  const env = cliEnvironment("local-org", {
    SF_TARGET_ORG: "wrong-org",
    SFDX_DEFAULTUSERNAME: "legacy-wrong",
    PATH: "test-path",
  });
  assert.equal(env.SF_TARGET_ORG, "local-org");
  assert.equal(env.SFDX_DEFAULTUSERNAME, "local-org");
  assert.equal(env.PATH, "test-path");
  assert.equal(env.SF_USE_PROGRESS_BAR, "false");
});

test("runs argv literally in selected cwd and sanitizes JSON log", async (t) => {
  const root = temporary(t);
  const script = write(
    root,
    "fake-cli.cjs",
    'console.log(JSON.stringify({status:0,result:{cwd:process.cwd(),org:process.env.SF_TARGET_ORG,args:process.argv.slice(2),accessToken:"not-a-real-token"}}));',
  );
  const logs = [];
  const args = [script, "path with spaces;$(echo injection)", "--json"];
  const result = await runCli(
    process.execPath,
    args,
    { root, org: "selected-org" },
    (line) => logs.push(line),
  );
  assert.equal(result.cwd, require("node:fs").realpathSync(root));
  assert.equal(result.org, "selected-org");
  assert.deepEqual(result.args, args.slice(1));
  assert.equal(logs.join("\n").includes("not-a-real-token"), false);
  assert.deepEqual(
    redact({ nested: [{ refreshToken: "secret", status: "ok" }] }),
    { nested: [{ refreshToken: "[REDACTED]", status: "ok" }] },
  );
});

test("nonzero exit, invalid JSON, and missing executable fail visibly", async (t) => {
  const root = temporary(t);
  const context = { root, org: "test-org" };
  const script = write(
    root,
    "failure.cjs",
    'console.log(JSON.stringify({status:1,name:"RemoteError",message:"remote failed"}));process.exitCode=1;',
  );
  await assert.rejects(
    runCli(process.execPath, [script], context),
    /remote failed/,
  );
  const malformed = write(root, "malformed.cjs", 'console.log("not JSON");');
  await assert.rejects(
    runCli(process.execPath, [malformed], context),
    /valid JSON/,
  );
  await assert.rejects(
    runCli(require("node:path").join(root, "missing-sf"), [], context),
    /Cannot start Salesforce CLI/,
  );
});

test("real subprocess nonzero pending JSON is followed without resubmission", async (t) => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { runJob } = require("../src/cli");
  const root = temporary(t);
  const script = write(
    root,
    "pending.cjs",
    'const fs=require("node:fs");let n=fs.existsSync("count")?Number(fs.readFileSync("count","utf8")):0;fs.writeFileSync("count",String(++n));fs.appendFileSync("args",JSON.stringify(process.argv.slice(2))+"\\n");console.log(JSON.stringify(n===1?{status:69,result:{id:"0Af000000000001AAA",done:false,status:"InProgress"}}:{status:0,result:{success:true,done:true,status:"Succeeded"}}));process.exitCode=n===1?69:0;',
  );
  await runJob(
    (args) =>
      runCli(process.execPath, [script, ...args], { root, org: "test-org" }),
    ["project", "deploy", "start", "--json"],
    "deploy",
    33,
  );
  const log = fs
    .readFileSync(path.join(root, "args"), "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(log.length, 2);
  assert.equal(log[0][2], "start");
  assert.deepEqual(log[1], [
    "project",
    "deploy",
    "resume",
    "--job-id",
    "0Af000000000001AAA",
    "--wait",
    "33",
    "--json",
  ]);
});
