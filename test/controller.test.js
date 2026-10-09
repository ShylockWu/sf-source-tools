const test = require("node:test");
const assert = require("node:assert/strict");
const { createController, selectedUris } = require("../src/controller");
const { fixture, temporary, uri } = require("./helpers");
const success = { success: true, status: "Succeeded", done: true };

function harness(dependencies = {}) {
  const messages = [];
  const api = {
    workspace: {
      isTrusted: true,
      textDocuments: [],
      getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    },
    window: {
      showWarningMessage: async (_message, _options, action) => action,
      showInformationMessage: (message) => messages.push(message),
      showErrorMessage: (message) => messages.push(message),
      withProgress: async (_options, work) => work(),
    },
    ProgressLocation: { Notification: 1 },
  };
  const output = { show: () => {}, appendLine: () => {} };
  return { api, messages, run: createController(api, output, dependencies) };
}

test("right-click URI takes precedence over active editor and stale multiselect", () => {
  const a = uri("/a");
  const b = uri("/b");
  assert.deepEqual(selectedUris(a, [b], b), [a]);
  assert.deepEqual(selectedUris(a, [a, b], b), [a, b]);
  assert.deepEqual(selectedUris(undefined, undefined, b), [b]);
  assert.throws(() => selectedUris(), /Right-click/);
});

test("untrusted workspace never resolves or invokes source operations", async () => {
  const h = harness({
    resolve: () => {
      throw new Error("must not resolve");
    },
  });
  h.api.workspace.isTrusted = false;
  assert.match(
    (await h.run("deploy", uri("/unused"))).error,
    /Trust this workspace/,
  );
});

test("right-click deployment uses selected project's org, not active editor", async (t) => {
  const parent = temporary(t);
  const a = fixture(parent, "a", "org-a");
  const b = fixture(parent, "b", "org-b");
  const h = harness({
    cli: async (_exe, _args, context) => {
      assert.equal(context.root, a.root);
      assert.equal(context.org, "org-a");
      return success;
    },
  });
  h.api.window.activeTextEditor = { document: { uri: uri(b.html) } };
  assert.equal((await h.run("deploy", uri(a.html))).success, true);
  assert.match(h.messages[0], /org-a/);
});

test("same-project concurrent rejection never releases another operation's lock", async (t) => {
  const a = fixture(temporary(t));
  let finish;
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const h = harness({
    cli: async () => {
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const first = h.run("deploy", uri(a.html));
  await ready;
  assert.match((await h.run("deploy", uri(a.html))).error, /already running/);
  assert.match((await h.run("deploy", uri(a.html))).error, /already running/);
  finish(success);
  assert.equal((await first).success, true);
});

test("dirty file cancellation and failed save do not invoke CLI", async (t) => {
  const a = fixture(temporary(t));
  let calls = 0;
  const h = harness({
    cli: async () => {
      calls++;
      return success;
    },
  });
  h.api.workspace.textDocuments = [
    { isDirty: true, uri: uri(a.html), save: async () => false },
  ];
  h.api.window.showWarningMessage = async () => undefined;
  assert.deepEqual(await h.run("deploy", uri(a.html)), { canceled: true });
  h.api.window.showWarningMessage = async (_message, _options, action) =>
    action;
  assert.match((await h.run("deploy", uri(a.html))).error, /Could not save/);
  assert.equal(calls, 0);
});

test("failed operations produce errors, never success notifications", async (t) => {
  const a = fixture(temporary(t));
  const h = harness({
    cli: async () => {
      throw new Error("remote failed");
    },
  });
  assert.match((await h.run("deploy", uri(a.html))).error, /remote failed/);
  assert.equal(
    h.messages.some((message) => /succeeded/.test(message)),
    false,
  );
});
