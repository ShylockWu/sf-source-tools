const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { resolveSelection } = require("../src/project");
const { executeOperation } = require("../src/operations");
const { CliError, runJob } = require("../src/cli");
const { fixture, temporary } = require("./helpers");
const success = { success: true, status: "Succeeded", done: true };

for (const operation of ["retrieve", "deleteOrg", "deleteBoth"]) {
  test(`${operation} cancellation does not invoke CLI or change source`, async (t) => {
    const a = fixture(temporary(t));
    let invoked = false;
    const before = fs.readFileSync(a.html, "utf8");
    const result = await executeOperation(
      operation,
      resolveSelection([a.html]),
      {
        confirm: async () => false,
        invoke: async () => {
          invoked = true;
        },
      },
    );
    assert.deepEqual(result, { canceled: true });
    assert.equal(invoked, false);
    assert.equal(fs.readFileSync(a.html, "utf8"), before);
  });
}

test("deploy sends original source paths without auto force or target-org flags", async (t) => {
  const a = fixture(temporary(t));
  let args;
  await executeOperation("deploy", resolveSelection([a.html, a.field]), {
    invoke: async (value) => {
      args = value;
      return success;
    },
  });
  assert.deepEqual(args, [
    "project",
    "deploy",
    "start",
    "--source-dir",
    a.html,
    "--source-dir",
    a.field,
    "--wait",
    "33",
    "--json",
  ]);
});

test("retrieve confirms overwrite risk and respects source conflicts", async (t) => {
  const a = fixture(temporary(t));
  let confirmed = false;
  await executeOperation("retrieve", resolveSelection([a.html]), {
    confirm: async (message, detail, action) => {
      assert.match(message, /overwrite/);
      assert.match(detail, /fixture-org/);
      assert.equal(action, "Retrieve");
      confirmed = true;
      return true;
    },
    invoke: async (args) => {
      assert.equal(confirmed, true);
      assert.deepEqual(args.slice(0, 3), ["project", "retrieve", "start"]);
      assert.equal(args.includes("--ignore-conflicts"), false);
      return success;
    },
  });
});

test("org-only delete creates exact destructive and empty package manifests and retains files", async (t) => {
  const a = fixture(temporary(t));
  const before = fs.readFileSync(a.html, "utf8");
  let manifest;
  await executeOperation("deleteOrg", resolveSelection([a.html]), {
    confirm: async () => true,
    invoke: async (args) => {
      manifest = args[args.indexOf("--post-destructive-changes") + 1];
      const destructive = fs.readFileSync(manifest, "utf8");
      assert.match(destructive, /<members>greeting<\/members>/);
      assert.match(destructive, /<name>LightningComponentBundle<\/name>/);
      assert.match(destructive, /<version>67.0<\/version>/);
      assert.doesNotMatch(
        fs.readFileSync(args[args.indexOf("--manifest") + 1], "utf8"),
        /<types>/,
      );
      assert.equal(fs.readFileSync(a.html, "utf8"), before);
      return success;
    },
  });
  assert.equal(fs.existsSync(manifest), false);
  assert.equal(fs.readFileSync(a.html, "utf8"), before);
});

test("org-only deletion cleans temporary manifests after failure", async (t) => {
  const a = fixture(temporary(t));
  let manifest;
  await assert.rejects(
    executeOperation("deleteOrg", resolveSelection([a.html]), {
      confirm: async () => true,
      invoke: async (args) => {
        manifest = args[args.indexOf("--manifest") + 1];
        throw new Error("remote failed");
      },
    }),
    /remote failed/,
  );
  assert.equal(fs.existsSync(manifest), false);
  assert.equal(fs.existsSync(a.html), true);
});

test("both-delete delegates whole metadata components and tracking to official CLI", async (t) => {
  const a = fixture(temporary(t));
  let args;
  await executeOperation("deleteBoth", resolveSelection([a.html]), {
    confirm: async () => true,
    invoke: async (value) => {
      args = value;
      return success;
    },
  });
  assert.deepEqual(args, [
    "project",
    "delete",
    "source",
    "--no-prompt",
    "--track-source",
    "--metadata",
    "LightningComponentBundle:greeting",
    "--wait",
    "33",
    "--json",
  ]);
  assert.equal(args.includes("--force-overwrite"), false);
});

test("deletion failure is not reported as success and extension does not remove local files", async (t) => {
  const a = fixture(temporary(t));
  await assert.rejects(
    executeOperation("deleteBoth", resolveSelection([a.html]), {
      confirm: async () => true,
      invoke: async () => ({ success: false, status: "Failed" }),
    }),
    /did not succeed/,
  );
  assert.equal(fs.existsSync(a.html), true);
});

test("conflict retry requires explicit confirmation and does not alter selection", async (t) => {
  const a = fixture(temporary(t));
  let calls = 0;
  let prompts = 0;
  let first;
  await executeOperation("deploy", resolveSelection([a.html]), {
    confirm: async () => {
      prompts++;
      return true;
    },
    invoke: async (args) => {
      if (++calls === 1) {
        first = args;
        throw new CliError("Source conflict", { name: "SourceConflictError" });
      }
      assert.deepEqual(args, [...first, "--ignore-conflicts"]);
      return success;
    },
  });
  assert.equal(prompts, 1);
  assert.equal(calls, 2);
});

test("declining force preserves failure without retry", async (t) => {
  const a = fixture(temporary(t));
  let calls = 0;
  await assert.rejects(
    executeOperation("deploy", resolveSelection([a.html]), {
      confirm: async () => false,
      invoke: async () => {
        calls++;
        throw new CliError("Source conflict", { name: "SourceConflictError" });
      },
    }),
    /conflict/,
  );
  assert.equal(calls, 1);
});

test("unfinished deploy follows only returned job ID", async () => {
  let calls = 0;
  await runJob(
    async (args) => {
      if (++calls === 1)
        return { id: "0Af000000000001AAA", done: false, status: "InProgress" };
      assert.deepEqual(args, [
        "project",
        "deploy",
        "resume",
        "--job-id",
        "0Af000000000001AAA",
        "--wait",
        "33",
        "--json",
      ]);
      return success;
    },
    ["start"],
    "deploy",
    33,
  );
  assert.equal(calls, 2);
});

test("unfinished both-delete stops without retry or premature success", async () => {
  await assert.rejects(
    runJob(
      async () => ({
        id: "0Af000000000001AAA",
        done: false,
        status: "InProgress",
      }),
      [],
      "deleteBoth",
      33,
    ),
    /do not blindly retry/,
  );
});

test("retrieve timeout reports incomplete status without invoking nonexistent resume", async () => {
  let calls = 0;
  await assert.rejects(
    runJob(
      async () => {
        calls++;
        throw new CliError("The metadata operation timed out", {
          name: "MetadataTransferError",
          status: 69,
          data: { id: "09S000000000001AAA" },
        });
      },
      [],
      "retrieve",
      33,
    ),
    /no retrieve resume command/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    runJob(async () => undefined, [], "deploy", 33),
    /did not succeed/,
  );
  await assert.rejects(
    runJob(async () => ({ status: "SucceededPartial" }), [], "deploy", 33),
    /did not succeed/,
  );
});

test("deploy follows nonzero JSON pending results and repeated resume timeouts", async () => {
  let calls = 0;
  await runJob(
    async (args) => {
      calls++;
      if (calls === 1)
        throw new CliError("CLI status 69", {
          status: 69,
          result: {
            id: "0Af000000000001AAA",
            done: false,
            status: "InProgress",
          },
        });
      assert.equal(args[2], "resume");
      assert.equal(args[4], "0Af000000000001AAA");
      if (calls === 2)
        throw new CliError("Timed out", {
          name: "DeployTimeout",
          status: 69,
          data: { id: "0Af000000000001AAA" },
        });
      return success;
    },
    [],
    "deploy",
    33,
  );
  assert.equal(calls, 3);
});

test("both-delete rejects unselected duplicate source before confirmation or CLI", async (t) => {
  const a = fixture(temporary(t));
  const { write } = require("./helpers");
  const path = require("node:path");
  const second = "other/main/default/lwc/greeting/";
  for (const suffix of ["html", "js", "js-meta.xml"])
    write(
      a.root,
      `${second}greeting.${suffix}`,
      fs.readFileSync(a.html.replace(/html$/, suffix), "utf8"),
    );
  write(
    a.root,
    "sfdx-project.json",
    JSON.stringify({
      packageDirectories: [{ path: "force-app" }, { path: "other" }],
      sourceApiVersion: "67.0",
    }),
  );
  let calls = 0;
  await assert.rejects(
    executeOperation("deleteBoth", resolveSelection([a.html]), {
      confirm: async () => {
        calls++;
        return true;
      },
      invoke: async () => {
        calls++;
        return success;
      },
    }),
    /Ambiguous deletion/,
  );
  assert.equal(calls, 0);
  assert.equal(fs.existsSync(a.html), true);
  await executeOperation(
    "deleteBoth",
    resolveSelection([a.html, path.join(a.root, second, "greeting.html")]),
    { confirm: async () => true, invoke: async () => success },
  );
});
