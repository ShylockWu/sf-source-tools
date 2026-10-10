const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  runOutputCli,
  lineWriter,
  captureLine,
  cliResult,
} = require("../src/output-cli");
const { runJob } = require("../src/cli");
const { temporary, write } = require("./helpers");

const success = { success: true, done: true, status: "Succeeded" };

test("output CLI runs once with literal arguments in the owning project and org", async (t) => {
  const root = temporary(t);
  const fake = write(
    root,
    "fake.cjs",
    'require("node:fs").writeFileSync("observed.json",JSON.stringify({cwd:process.cwd(),org:process.env.SF_TARGET_ORG,legacy:process.env.SFDX_DEFAULTUSERNAME,args:process.argv.slice(2),ci:process.env.CI,mso:process.env.MSO_DISABLE_CI_MODE,color:process.env.FORCE_COLOR,tty:process.stdout.isTTY===true}));console.log("✔ Done\\nDeployed Source\\nState | Name | Type | Path");',
  );
  const logs = [];
  const args = [fake, "project", "deploy", "start", "a' b;$()\"`&|", "--json"];
  assert.deepEqual(
    await runOutputCli(
      process.execPath,
      args,
      { root, org: "selected-org" },
      (line) => logs.push(line),
    ),
    success,
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(root, "observed.json"))),
    {
      cwd: fs.realpathSync(root),
      org: "selected-org",
      legacy: "selected-org",
      args: args.slice(1, -1),
      ci: "true",
      mso: "false",
      color: "0",
      tty: false,
    },
  );
  assert.match(
    logs.join("\n"),
    /Deployed Source\nState \| Name \| Type \| Path/,
  );
  assert.equal(logs.join("\n").includes("--json"), false);
});

test("progress arrives in Output before CLI completion and stderr is streamed", async (t) => {
  const root = temporary(t);
  const fake = write(
    root,
    "live.cjs",
    'const fs=require("node:fs");console.log("✔ Preparing");console.error("Warning: simulated warning");const timer=setInterval(()=>{if(fs.existsSync("continue")){clearInterval(timer);console.log("✔ Done\\nDeployed Source");}},10);setTimeout(()=>{clearInterval(timer);process.exit(1);},5000).unref();',
  );
  let live;
  const ready = new Promise((resolve) => {
    live = resolve;
  });
  let completed = false;
  const logs = [];
  const result = runOutputCli(
    process.execPath,
    [fake],
    { root, org: "org" },
    (line) => {
      logs.push(line);
      if (line.includes("Preparing")) live();
    },
  ).finally(() => {
    completed = true;
  });
  const timeout = setTimeout(() => live(), 3000);
  await ready;
  clearTimeout(timeout);
  assert.ok(logs.includes("✔ Preparing"));
  assert.equal(completed, false);
  assert.equal(logs.includes("✔ Done"), false);
  write(root, "continue", "ready");
  assert.deepEqual(await result, success);
  assert.ok(logs.includes("Warning: simulated warning"));
  assert.ok(logs.includes("Deployed Source"));
});

test("line writer preserves chunked ANSI, CRLF, tables, and final partial lines", () => {
  const lines = [];
  const writeLine = lineWriter((line) => lines.push(line));
  writeLine("\u001b[3");
  writeLine("2m✔ Preparing\u001b[0m\r");
  assert.deepEqual(lines, []);
  writeLine("\nComponents: 1/2\rComponents: 2/2\nName | Type\nfinal");
  writeLine("", true);
  assert.deepEqual(lines, [
    "✔ Preparing",
    "Components: 1/2",
    "Components: 2/2",
    "Name | Type",
    "final",
  ]);
});

test("UTF-8 characters split across subprocess writes remain intact", async (t) => {
  const root = temporary(t);
  const fake = write(
    root,
    "utf8.cjs",
    'const b=Buffer.from("✔ 完成\\n");process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),30);',
  );
  const logs = [];
  await runOutputCli(process.execPath, [fake], { root, org: "org" }, (line) =>
    logs.push(line),
  );
  assert.ok(logs.includes("✔ 完成"));
});

test("nonzero CLI exits, unknown completion, and launch errors never produce success", async (t) => {
  const root = temporary(t);
  const fake = write(
    root,
    "fail.cjs",
    'console.error("Error (RemoteError): remote failed");process.exitCode=1;',
  );
  const logs = [];
  await assert.rejects(
    runOutputCli(process.execPath, [fake], { root, org: "org" }, (line) =>
      logs.push(line),
    ),
    (error) =>
      error.message === "remote failed" && error.payload.name === "RemoteError",
  );
  assert.ok(logs.includes("Error (RemoteError): remote failed"));
  await assert.rejects(
    runOutputCli(path.join(root, "missing-sf"), [], { root, org: "org" }),
    /Cannot start Salesforce CLI/,
  );
  assert.throws(
    () => cliResult(null, "SIGTERM", { ids: new Set() }),
    /No success is assumed/,
  );
  assert.throws(
    () => cliResult(1, null, { ids: new Set() }),
    /See SF Source Tools output/,
  );
});

test("chunked timeout IDs are followed by resume without a second deploy start", async (t) => {
  const root = temporary(t);
  const fake = write(
    root,
    "timeout.cjs",
    'const fs=require("node:fs");const args=process.argv.slice(2);fs.appendFileSync("args.jsonl",JSON.stringify(args)+"\\n");if(args[2]==="start"){process.stdout.write("Deploy ID: 0Af000000000001");setTimeout(()=>{console.log("AAA");console.error("Error (DeployTimeoutError): timed out");process.exitCode=69;},30);}else{console.log("✔ Done\\nStatus: Succeeded\\nDeployed Source");}',
  );
  const logs = [];
  const result = await runJob(
    (args) =>
      runOutputCli(
        process.execPath,
        [fake, ...args],
        { root, org: "org" },
        (line) => logs.push(line),
      ),
    ["project", "deploy", "start", "--json"],
    "deploy",
    33,
  );
  assert.deepEqual(result, success);
  const calls = fs
    .readFileSync(path.join(root, "args.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ["project", "deploy", "start"]);
  assert.deepEqual(calls[1], [
    "project",
    "deploy",
    "resume",
    "--job-id",
    "0Af000000000001AAA",
    "--wait",
    "33",
  ]);
});

test("retrieve timeouts are incomplete and are not resubmitted", async (t) => {
  const root = temporary(t);
  const fake = write(
    root,
    "retrieve.cjs",
    'console.log("Retrieve ID: 09S000000000001AAA");process.exitCode=69;',
  );
  let calls = 0;
  await assert.rejects(
    runJob(
      (args) => {
        calls++;
        return runOutputCli(process.execPath, [fake, ...args], {
          root,
          org: "org",
        });
      },
      ["project", "retrieve", "start", "--json"],
      "retrieve",
      33,
    ),
    /Retrieve has not completed/,
  );
  assert.equal(calls, 1);
});

test("named source conflicts remain available for explicit overwrite confirmation", () => {
  const capture = { ids: new Set() };
  captureLine(
    capture,
    "Error (SourceConflictError): There are conflicts in this source",
  );
  assert.throws(
    () => cliResult(1, null, capture),
    (error) => error.payload.name === "SourceConflictError",
  );
});

test("ambiguous timeout IDs never confirm success or choose a remote job", () => {
  const capture = { ids: new Set() };
  captureLine(capture, "Deploy ID: 0Af000000000001AAA");
  captureLine(capture, "Deploy ID: 0Af000000000002AAA");
  assert.throws(() => cliResult(69, null, capture), /No success is assumed/);
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
