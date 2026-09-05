import test from "node:test";
import assert from "node:assert/strict";
import { AppStore, Epoch } from "./console/dashboard/state.js";
import { validateTextUpload } from "./console/dashboard/views/new.js";

test("project drafts remain isolated and can be reset independently", () => {
  const store = new AppStore();
  store.setDraft("/repo/one", "prompt", "one");
  store.setDraft("/repo/two", "prompt", "two");

  assert.equal(store.getDraft("/repo/one", "prompt", ""), "one");
  assert.equal(store.getDraft("/repo/two", "prompt", ""), "two");

  store.clearDraft("/repo/one");
  assert.equal(store.getDraft("/repo/one", "prompt", ""), "");
  assert.equal(store.getDraft("/repo/two", "prompt", ""), "two");
});

test("epoch guard rejects stale responses after a newer store change", () => {
  const epoch = new Epoch();
  const first = epoch.next();
  const second = epoch.next();

  assert.equal(epoch.isCurrent(first), false);
  assert.equal(epoch.isCurrent(second), true);
});

test("store subscriptions can be removed without affecting later listeners", () => {
  const store = new AppStore();
  let calls = 0;
  const unsubscribe = store.subscribe(() => { calls += 1; });
  store.applySnapshot({ summary: null, manifest: null, state: null, layout: null });
  assert.equal(calls, 1);

  unsubscribe();
  store.applySnapshot({ summary: null, manifest: null, state: null, layout: null });
  assert.equal(calls, 1);
});

test("upload validation rejects unsupported extensions and binary MIME types", () => {
  assert.doesNotThrow(() => validateTextUpload({ name: "notes.md", type: "text/markdown" }, "Research"));
  assert.doesNotThrow(() => validateTextUpload({ name: "notes.txt", type: "" }, "Research"));
  assert.throws(() => validateTextUpload({ name: "report.pdf", type: "application/pdf" }, "Research"), /supported text file/);
  assert.throws(() => validateTextUpload({ name: "notes.md", type: "application/pdf" }, "Research"), /unsupported MIME type/);
});
