import test from "node:test";
import assert from "node:assert/strict";
import { AppStore, Epoch } from "./console/dashboard/state.js";
import { validateTextUpload } from "./console/dashboard/views/new.js";
import { runnerForHarness } from "./console/dashboard/runners.js";
import { authoringRunnerForHarness, engineHarnessForHarness, harnessCliForHarness, harnessKey } from "./console/dashboard/harness-rules.js";
import type { AuthoringRunnerName, EngineHarnessName, HarnessCliName, HarnessKey } from "./console/dashboard/harness-rules.js";

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

test("harness rules resolve every harness name, harness root and empty input", () => {
  const cases: Array<{
    input: string | null | undefined;
    key: HarnessKey;
    runner: AuthoringRunnerName;
    engine: EngineHarnessName;
    cli: { cli: HarnessCliName; args: string[] };
  }> = [
    { input: "github", key: "github", runner: "copilot", engine: "copilot", cli: { cli: "copilot", args: [] } },
    { input: ".github", key: "github", runner: "copilot", engine: "copilot", cli: { cli: "copilot", args: [] } },
    { input: "claude", key: "claude", runner: "claude", engine: "claude", cli: { cli: "claude", args: ["."] } },
    { input: ".claude", key: "claude", runner: "claude", engine: "claude", cli: { cli: "claude", args: ["."] } },
    { input: "opencode", key: "opencode", runner: "opencode", engine: "opencode", cli: { cli: "opencode", args: ["."] } },
    { input: ".opencode", key: "opencode", runner: "opencode", engine: "opencode", cli: { cli: "opencode", args: ["."] } },
    { input: "agents", key: "agents", runner: "opencode", engine: "opencode", cli: { cli: "opencode", args: ["."] } },
    { input: ".agents", key: "agents", runner: "opencode", engine: "opencode", cli: { cli: "opencode", args: ["."] } },
    { input: "foo", key: "", runner: "opencode", engine: "opencode", cli: { cli: "opencode", args: ["."] } },
    { input: ".foo", key: "", runner: "opencode", engine: "opencode", cli: { cli: "opencode", args: ["."] } },
    { input: "", key: "", runner: "opencode", engine: "opencode", cli: { cli: "opencode", args: ["."] } },
    { input: null, key: "", runner: "opencode", engine: "opencode", cli: { cli: "opencode", args: ["."] } },
    { input: undefined, key: "", runner: "opencode", engine: "opencode", cli: { cli: "opencode", args: ["."] } },
  ];

  for (const { input, key, runner, engine, cli } of cases) {
    const label = JSON.stringify(input) ?? "undefined";
    assert.equal(harnessKey(input), key, `harnessKey(${label})`);
    assert.equal(authoringRunnerForHarness(input), runner, `authoringRunnerForHarness(${label})`);
    assert.equal(engineHarnessForHarness(input), engine, `engineHarnessForHarness(${label})`);
    assert.deepEqual(harnessCliForHarness(input), cli, `harnessCliForHarness(${label})`);
  }
});

test("harness to runner mapping accepts harness names and harness roots alike", () => {
  assert.equal(runnerForHarness("github"), "copilot");
  assert.equal(runnerForHarness(".github"), "copilot");
  assert.equal(runnerForHarness("claude"), "claude");
  assert.equal(runnerForHarness(".claude"), "claude");
  assert.equal(runnerForHarness("opencode"), "opencode");
  assert.equal(runnerForHarness(".opencode"), "opencode");
  assert.equal(runnerForHarness(".agents"), "opencode");
  assert.equal(runnerForHarness(""), "opencode");
});
