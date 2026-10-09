const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  resolveSelection,
  findProject,
  localDefaultOrg,
} = require("../src/project");
const { fixture, temporary, write } = require("./helpers");

test("resolves the owning project, project-local org, and complete LWC component", (t) => {
  const a = fixture(temporary(t), "project with spaces", "org-a");
  const context = resolveSelection([a.html]);
  assert.equal(context.root, a.root);
  assert.equal(context.org, "org-a");
  assert.deepEqual(context.sources, [a.html]);
  assert.deepEqual(context.members, ["LightningComponentBundle:greeting"]);
  assert.ok(context.files.includes(a.html.replace(".html", ".js")));
  assert.ok(context.files.includes(a.html.replace(".html", ".js-meta.xml")));
});

test("uses official identities for decomposed fields and aggregate labels", (t) => {
  const a = fixture(temporary(t));
  assert.deepEqual(resolveSelection([a.field]).members, [
    "CustomField:Sample__c.Note__c",
  ]);
  assert.ok(
    resolveSelection([a.labels]).members.includes("CustomLabel:Greeting"),
  );
});

test("accepts same-project multiselect and deduplicates members", (t) => {
  const a = fixture(temporary(t));
  assert.deepEqual(
    resolveSelection([a.html, a.html.replace(".html", ".js"), a.field]).members,
    ["CustomField:Sample__c.Note__c", "LightningComponentBundle:greeting"],
  );
});

test("rejects cross-project multiselect", (t) => {
  const parent = temporary(t);
  const a = fixture(parent, "a");
  const b = fixture(parent, "b");
  assert.throws(
    () => resolveSelection([a.html, b.html]),
    /multiple Salesforce projects/,
  );
});

test("does not fall back when project-local default org is absent", (t) => {
  const a = fixture(temporary(t));
  fs.rmSync(path.join(a.root, ".sf/config.json"));
  assert.throws(
    () => resolveSelection([a.html]),
    /No project-local default org/,
  );
  assert.throws(
    () => localDefaultOrg(a.root),
    /Global and environment defaults are not used/,
  );
});

test("rejects malformed project config and non-metadata selections", (t) => {
  const a = fixture(temporary(t));
  assert.throws(() => resolveSelection([a.root]), /package directory/);
  const unknown = write(a.root, "force-app/notes.txt", "hello");
  assert.throws(() => resolveSelection([unknown]), /metadata|type/i);
  write(a.root, ".sf/config.json", "invalid JSON");
  assert.throws(() => localDefaultOrg(a.root), /Cannot read project-local/);
});

test("nearest nested project owns its source", (t) => {
  const a = fixture(temporary(t));
  const nested = fixture(
    path.join(a.root, "force-app"),
    "nested",
    "nested-org",
  );
  assert.equal(findProject(nested.html), nested.root);
  assert.equal(resolveSelection([nested.html]).org, "nested-org");
});

test(
  "symlink source cannot be assigned to the wrong project",
  { skip: process.platform === "win32" },
  (t) => {
    const parent = temporary(t);
    const a = fixture(parent, "a");
    const b = fixture(parent, "b");
    const link = path.join(a.root, "force-app", "foreign.html");
    fs.symlinkSync(b.html, link);
    assert.equal(resolveSelection([link]).root, b.root);
    assert.throws(
      () => resolveSelection([a.html, link]),
      /multiple Salesforce projects/,
    );
  },
);

test("registry follows the selected project's decomposed-label preset, not process cwd", (t) => {
  const a = fixture(temporary(t));
  write(
    a.root,
    "sfdx-project.json",
    JSON.stringify({
      packageDirectories: [{ path: "force-app" }],
      sourceApiVersion: "67.0",
      sourceBehaviorOptions: ["decomposeCustomLabelsBeta2"],
    }),
  );
  const label = write(
    a.root,
    "force-app/main/default/labels/Greeting.label-meta.xml",
    '<CustomLabel xmlns="http://soap.sforce.com/2006/04/metadata"><fullName>Greeting</fullName><language>en_US</language><protected>false</protected><shortDescription>Greeting</shortDescription><value>Hello</value></CustomLabel>',
  );
  assert.deepEqual(resolveSelection([label]).members, ["CustomLabel:Greeting"]);
});
