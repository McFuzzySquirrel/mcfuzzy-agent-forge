import test from "node:test";
import assert from "node:assert/strict";
import { AppStore, Epoch } from "./console/dashboard/state.js";
import { BoardPreferences, type BoardPreferenceStorage } from "./console/dashboard/views/board-preferences.js";
import { validateTextUpload } from "./console/dashboard/views/new.js";
import { AUTHORING_RUNNER_OPTIONS, effectiveRunner, runnerForHarness } from "./console/dashboard/runners.js";
import { authoringRunnerForHarness, engineHarnessForHarness, harnessCliForHarness, harnessKey } from "./console/dashboard/harness-rules.js";
import type { AuthoringRunnerName, EngineHarnessName, HarnessCliName, HarnessKey } from "./console/dashboard/harness-rules.js";

test("board view, filters, selection, and independent positions survive reload per project", () => {
  const values = new Map<string, string>();
  const storage: BoardPreferenceStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
  const first = new BoardPreferences(storage, "/repo/one");
  first.setMode("gantt");
  first.setStatuses(["failed", "running"]);
  first.setSelectedTaskId("build.2");
  first.setPosition("kanban", { left: 120, top: 40 });
  first.setPosition("gantt", { left: 360, top: 85 });

  const reloaded = new BoardPreferences(storage, "/repo/one");
  assert.deepEqual(reloaded.get(), {
    mode: "gantt",
    statuses: ["failed", "running"],
    selectedTaskId: "build.2",
    positions: {
      kanban: { left: 120, top: 40 },
      gantt: { left: 360, top: 85 },
    },
  });
  assert.equal(new BoardPreferences(storage, "/repo/two").get().mode, "kanban");
});

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

test("the authoring runner options are the four the console offers, inherit first", () => {
  assert.deepEqual(AUTHORING_RUNNER_OPTIONS.map(([value]) => value), ["inherit", "opencode", "copilot", "claude"]);
  assert.deepEqual(AUTHORING_RUNNER_OPTIONS.map(([, label]) => label), ["Inherit from harness", "OpenCode", "Copilot", "Claude Code"]);
});

test("effectiveRunner falls back to the harness rule only for inherit", () => {
  assert.equal(effectiveRunner("inherit", "github"), "copilot");
  assert.equal(effectiveRunner("inherit", ".claude"), "claude");
  assert.equal(effectiveRunner("inherit", ""), "opencode");
  assert.equal(effectiveRunner("", "github"), "copilot");
  assert.equal(effectiveRunner("claude", "github"), "claude");
  assert.equal(effectiveRunner("copilot", ".claude"), "copilot");
  assert.equal(effectiveRunner("opencode", "github"), "opencode");
});
