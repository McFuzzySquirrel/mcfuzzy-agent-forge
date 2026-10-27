import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  defaultSettings,
  loadSettings,
  saveSettings,
  settingsPath,
  validateSettings,
  type GlobalSettings,
} from "./settings.ts";
import {
  selectAuthoringModel,
  selectAuthoringRunner,
} from "./authoring-config.ts";

// Isolate the registry dir so these tests never read a real ~/.myforge/settings.json.
const FORGE_HOME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "forge-settings-"));
process.env.FORGE_HOME = FORGE_HOME_DIR;
process.on("exit", () => {
  try { fs.rmSync(FORGE_HOME_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

function withFreshHome(t: { after: (fn: () => void) => void }): void {
  fs.rmSync(FORGE_HOME_DIR, { recursive: true, force: true });
  fs.mkdirSync(FORGE_HOME_DIR, { recursive: true });
  t.after(() => {
    fs.rmSync(FORGE_HOME_DIR, { recursive: true, force: true });
    fs.mkdirSync(FORGE_HOME_DIR, { recursive: true });
  });
}

test("loadSettings returns defaults when no settings file exists", (t) => {
  withFreshHome(t);
  assert.deepEqual(loadSettings(), defaultSettings());
});

test("saveSettings round-trips through loadSettings", (t) => {
  withFreshHome(t);
  const settings: GlobalSettings = {
    version: 1,
    authoring: { runner: "claude", models: { prd: "opus" } },
    execution: { concurrency: 3, autoCommit: false, logHarnessActivity: true },
    harness: "github",
    ui: { theme: "dark", boardMode: "gantt" },
  };
  const saved = saveSettings(settings);
  assert.deepEqual(saved, settings);
  assert.equal(fs.existsSync(settingsPath()), true);
  assert.deepEqual(loadSettings(), settings);
});

test("a corrupt settings file falls back to defaults and is never clobbered on read", (t) => {
  withFreshHome(t);
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), "{not valid json\n", "utf8");
  assert.deepEqual(loadSettings(), defaultSettings());
  // The corrupt bytes are untouched by a read.
  assert.equal(fs.readFileSync(settingsPath(), "utf8"), "{not valid json\n");
});

test("validateSettings rejects invalid shapes", () => {
  assert.throws(() => validateSettings(null), /expected an object/);
  assert.throws(() => validateSettings({ version: 2 }), /unsupported version/);
  assert.throws(() => validateSettings({ version: 1, authoring: { runner: "gpt" } }), /authoring\.runner/);
  assert.throws(() => validateSettings({ version: 1, authoring: { models: { bogus: "x" } } }), /unknown authoring stage/);
  assert.throws(() => validateSettings({ version: 1, authoring: { models: { prd: "  " } } }), /non-empty model ID/);
  assert.throws(() => validateSettings({ version: 1, execution: { concurrency: -1 } }), /non-negative integer/);
  assert.throws(() => validateSettings({ version: 1, execution: { autoCommit: "yes" } }), /boolean/);
  assert.throws(() => validateSettings({ version: 1, harness: "flowforge-kernel" }), /harness/);
  assert.throws(() => validateSettings({ version: 1, ui: { theme: "sepia" } }), /ui\.theme/);
  assert.throws(() => validateSettings({ version: 1, ui: { boardMode: "kanban3d" } }), /boardMode/);
});

test("authoring model system default is consulted after the project value", () => {
  const global: GlobalSettings = { version: 1, authoring: { models: { prd: "sys-1" } } };
  // No project value: the system default wins.
  assert.deepEqual(
    selectAuthoringModel("", "prd", {}, {}, global),
    { requestedModel: "sys-1", source: "system" },
  );
  // An explicit project value still beats the system default.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "forge-settings-repo-"));
  fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs", "authoring-config.json"), JSON.stringify({ version: 1, models: { prd: "proj-1" } }), "utf8");
  assert.deepEqual(
    selectAuthoringModel(repo, "prd", {}, {}, global),
    { requestedModel: "proj-1", source: "project" },
  );
  fs.rmSync(repo, { recursive: true, force: true });
});

test("authoring runner system default is consulted after the project value", () => {
  const global: GlobalSettings = { version: 1, authoring: { runner: "claude" } };
  assert.deepEqual(
    selectAuthoringRunner("", ".github", {}, {}, global),
    { runner: "claude", source: "system" },
  );
  // FORGE_RUN_WITH (environment) still beats the system default.
  assert.deepEqual(
    selectAuthoringRunner("", ".github", {}, { FORGE_RUN_WITH: "opencode" }, global),
    { runner: "opencode", source: "environment" },
  );
});
