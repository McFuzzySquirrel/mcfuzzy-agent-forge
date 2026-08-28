import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { captureWorktree, isTrivialOutput, runTaskValidation, verifyTaskResult, worktreeChanged } from "./verify.ts";
import type { ManifestTask, TaskResult } from "./types.ts";

function makeTask(overrides: Partial<ManifestTask> = {}): ManifestTask {
  return {
    id: "1.1",
    title: "Task 1.1",
    description: "Task 1.1 description",
    dependencies: [],
    expectedOutputs: [],
    validationCommands: [],
    approvalRequired: false,
    sourceLines: [],
    ...overrides,
  };
}

function makeResult(overrides: Partial<TaskResult> = {}): TaskResult {
  return {
    success: true,
    outputFiles: [],
    stdout: "done",
    stderr: "",
    durationMs: 1,
    ...overrides,
  };
}

test("isTrivialOutput flags empty, short, and acknowledgment-only responses", () => {
  assert.equal(isTrivialOutput(""), true);
  assert.equal(isTrivialOutput("   \n  "), true);
  assert.equal(isTrivialOutput("Ready for the task."), true);
  assert.equal(isTrivialOutput("ok"), true);
  assert.equal(isTrivialOutput("a\nb\nc"), true);
  assert.equal(
    isTrivialOutput("Implemented the scanner and wrote unit tests covering every branch of the walker."),
    false,
  );
});

test("captureWorktree returns null when the directory is not a git repo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-no-git-"));
  assert.equal(await captureWorktree(dir), null);
});

test("captureWorktree lists untracked files and excludes engine-owned docs paths", async () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-git-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "docs", "artifacts"), { recursive: true });
  writeFileSync(join(dir, "src", "a.ts"), "// a\n", "utf8");
  writeFileSync(join(dir, "docs", "WORKFLOW-STATE.json"), "{}", "utf8");
  writeFileSync(join(dir, "docs", "artifacts", "x.json"), "{}", "utf8");

  const snap = await captureWorktree(dir);
  assert.ok(snap, "should capture a git worktree");
  assert.ok(snap.paths.has("src/a.ts"), `expected src/a.ts in ${[...snap.paths]}`);
  assert.ok(!snap.paths.has("docs/WORKFLOW-STATE.json"), "engine-owned state must be excluded");
  assert.ok(!snap.paths.has("docs/artifacts/x.json"), "engine artifacts must be excluded");
});

test("worktreeChanged compares snapshots and returns false when either is null", () => {
  const a = { paths: new Set(["src/a.ts"]) };
  const b = { paths: new Set(["src/a.ts", "src/b.ts"]) };
  assert.equal(worktreeChanged(a, a), false);
  assert.equal(worktreeChanged(a, b), true);
  assert.equal(worktreeChanged(null, b), false);
  assert.equal(worktreeChanged(a, null), false);
});

test("verifyTaskResult requires all expectedOutputs to exist", async () => {
  const root = mkdtempSync(join(tmpdir(), "verify-expected-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "out.ts"), "export {};\n", "utf8");

  const opts = { repoRoot: root, allowNoop: false, runValidation: false };
  const present = await verifyTaskResult(makeTask({ expectedOutputs: ["src/out.ts"] }), makeResult(), null, opts);
  assert.equal(present.ok, true);

  const missing = await verifyTaskResult(makeTask({ expectedOutputs: ["src/missing.ts"] }), makeResult(), null, opts);
  assert.equal(missing.ok, false);
  assert.match(missing.reason ?? "", /expected outputs missing: src\/missing\.ts/);
});

test("verifyTaskResult flags a no-op (no changes, trivial output) unless allowNoop", async () => {
  const root = mkdtempSync(join(tmpdir(), "verify-noop-"));
  const strict = await verifyTaskResult(
    makeTask(),
    makeResult({ stdout: "Ready for the task." }),
    null,
    { repoRoot: root, allowNoop: false, runValidation: false },
  );
  assert.equal(strict.ok, false);
  assert.match(strict.reason ?? "", /no changes and no substantive output/);

  const relaxed = await verifyTaskResult(
    makeTask(),
    makeResult({ stdout: "Ready for the task." }),
    null,
    { repoRoot: root, allowNoop: true, runValidation: false },
  );
  assert.equal(relaxed.ok, true);
});

test("verifyTaskResult passes a substantive response even without file changes", async () => {
  const root = mkdtempSync(join(tmpdir(), "verify-substantive-"));
  const result = await verifyTaskResult(
    makeTask(),
    makeResult({ stdout: "Implemented the whole feature and documented the design decisions in detail." }),
    null,
    { repoRoot: root, allowNoop: false, runValidation: false },
  );
  assert.equal(result.ok, true);
});

test("verifyTaskResult skips the no-op heuristic when validation is enabled and declared", async () => {
  const root = mkdtempSync(join(tmpdir(), "verify-validation-"));
  const result = await verifyTaskResult(
    makeTask({ validationCommands: ["true"] }),
    makeResult({ stdout: "Ready for the task." }),
    null,
    { repoRoot: root, allowNoop: false, runValidation: true },
  );
  assert.equal(result.ok, true, "validation is the gate, not the no-op heuristic");
});

test("runTaskValidation requires every command to pass", async () => {
  const root = mkdtempSync(join(tmpdir(), "verify-runval-"));
  const pass = await runTaskValidation(makeTask({ validationCommands: ["true"] }), root, 10_000);
  assert.equal(pass.ok, true);

  const fail = await runTaskValidation(makeTask({ validationCommands: ["false"] }), root, 10_000);
  assert.equal(fail.ok, false);
  assert.match(fail.reason ?? "", /validation command failed/);

  const none = await runTaskValidation(makeTask(), root, 10_000);
  assert.equal(none.ok, true);
});
