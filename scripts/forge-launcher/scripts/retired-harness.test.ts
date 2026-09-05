import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { engineRun } from "./engine-run.ts";
import { assertEngineHarnessAvailable } from "./engine-config.ts";

test("retired harness fails before repository preparation or subprocesses", async () => {
  await assert.rejects(engineRun({ repo: "/not-a-forge-repo", harness: "flowforge-kernel" }), /has been retired/);
  for (const harness of ["copilot", "opencode", "openai", "stub"]) {
    assert.doesNotThrow(() => assertEngineHarnessAvailable(harness));
  }
});

test("persisted retired harness is not silently replaced by the default", async (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "forge-retired-"));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const before = process.env.FORGE_ENGINE_HARNESS;
  delete process.env.FORGE_ENGINE_HARNESS;
  t.after(() => { if (before === undefined) delete process.env.FORGE_ENGINE_HARNESS; else process.env.FORGE_ENGINE_HARNESS = before; });
  fs.mkdirSync(path.join(repo, "docs"));
  fs.writeFileSync(path.join(repo, "docs", "engine-config.json"), JSON.stringify({ harness: "flowforge-kernel" }));
  await assert.rejects(engineRun({ repo }), /docs\/engine-config\.json/);
});
