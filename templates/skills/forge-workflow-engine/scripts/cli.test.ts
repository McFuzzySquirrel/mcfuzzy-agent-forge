import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { humanTaskApproved } from "./task-context.ts";
import type { ManifestTask } from "./types.ts";

test("approve-task requires explicit operator confirmation and records verifiable evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-review-cli-"));
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "requirements.md"), "Review keyboard flow");
  writeFileSync(join(root, "evidence.md"), "Reviewer exercised the keyboard flow");
  const task: ManifestTask = { id: "REVIEW-1", title: "Review flow", description: "Check keyboard flow", dependencies: [], expectedOutputs: [], validationCommands: [], approvalRequired: false, sourceLines: [], contract: { version: 1, kind: "human-review", requirements: ["Keyboard flow"], acceptanceCriteria: ["Reviewer confirms flow"], constraints: [], references: ["requirements.md"], reviewFile: "docs/review.json" } };
  writeFileSync(join(root, "docs/EXECUTION-MANIFEST.json"), JSON.stringify({ phases: [{ tasks: [task] }] }));
  const args = ["--import", "tsx", fileURLToPath(new URL("./cli.ts", import.meta.url)), "approve-task", task.id, "--repo", root, "--reviewer", "Test Reviewer", "--evidence", "evidence.md"];
  const missing = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /confirm-human-review/);
  assert.equal(humanTaskApproved(root, task), false);
  const approved = spawnSync(process.execPath, [...args, "--confirm-human-review"], { encoding: "utf8" });
  assert.equal(approved.status, 0, approved.stderr);
  assert.equal(humanTaskApproved(root, task), true);
});

test("retired explicit, environment, and persisted harness selections fail with migration guidance", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-retired-harness-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "EXECUTION-MANIFEST.json"), JSON.stringify({ phases: [] }));
  for (const selection of ["explicit", "environment", "persisted"]) {
    writeFileSync(join(root, "docs", "engine-config.json"), JSON.stringify({ harness: selection === "persisted" ? "flowforge-kernel" : "opencode" }));
    const env = { ...process.env };
    delete env.FORGE_ENGINE_HARNESS;
    if (selection === "environment") env.FORGE_ENGINE_HARNESS = "flowforge-kernel";
    const result = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./cli.ts", import.meta.url)),
      "run", "--repo", root, "--yes", ...(selection === "explicit" ? ["--harness", "flowforge-kernel"] : [])],
    { encoding: "utf8", env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /flowforge-kernel harness is retired/);
    assert.match(result.stderr + result.stdout, /engine-config\.json/);
    assert.match(result.stderr + result.stdout, /artifacts are preserved/);
  }
});

test("run rejects retired keep-alive and attach flags, including equals forms", (t) => {
  const root = mkdtempSync(join(tmpdir(), "forge-retired-run-flag-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "EXECUTION-MANIFEST.json"), JSON.stringify({ phases: [] }));
  const retiredFlags = ["--keep-alive", "--keep-alive-port", "--no-keep-alive", "--attach"];

  for (const flag of retiredFlags) {
    for (const spelling of [flag, `${flag}=value`]) {
      const result = spawnSync(process.execPath, [
        "--import", "tsx", fileURLToPath(new URL("./cli.ts", import.meta.url)),
        "run", "--repo", root, "--yes", spelling,
      ], { encoding: "utf8" });
      assert.notEqual(result.status, 0, spelling);
      assert.match(result.stderr + result.stdout, new RegExp(`retired ${flag}`));
    }
  }
});
