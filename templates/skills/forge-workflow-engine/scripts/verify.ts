/**
 * Output verification for the forge-workflow-engine.
 *
 * The harness adapters report `success` on a zero-exit call, which is not proof
 * that a task did anything: a model can reply "Ready for the task." and exit 0
 * without creating a single file. This module is the gate that turns a hollow
 * "complete" into a failed (retryable) attempt.
 *
 * Rules, applied after a successful harness call:
 *   1. If the task declares `expectedOutputs`, every one must exist on disk.
 *   2. Otherwise (no expected outputs), the task must show evidence of work:
 *      file changes in the git working tree, or a substantive agent response.
 *      (This is the "no-op detection" that `--allow-noop` bypasses.)
 *   3. Optionally, the task's manifest `validationCommands` are executed and
 *      must all exit 0 before the task counts as complete (`--run-validation`).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ManifestTask, TaskResult } from "./types.ts";
import { runCommand } from "./harness/run.ts";

/** Trivial responses are short and contain no content line of real length. */
const MIN_SUBSTANTIVE_OUTPUT_LEN = 40;
const MIN_CONTENT_LINE_LEN = 20;

/** Engine-owned files under docs/ that a run writes; never evidence of task work. */
const ENGINE_OWNED_PREFIXES = [
  "docs/WORKFLOW-STATE.json",
  "docs/EXECUTION-AUDIT.jsonl",
  "docs/PROGRESS.md",
  "docs/engine-run.log",
  "docs/artifacts/",
];

export interface VerifyOptions {
  repoRoot: string;
  allowNoop: boolean;
  runValidation: boolean;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

export interface WorktreeSnapshot {
  paths: Set<string>;
}

/** True when a response is too short / thin to count as real work output. */
export function isTrivialOutput(stdout: string): boolean {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length < MIN_SUBSTANTIVE_OUTPUT_LEN) return true;
  return !trimmed.split(/\r?\n/).some((line) => line.trim().length > MIN_CONTENT_LINE_LEN);
}

function isEngineOwnedPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  return ENGINE_OWNED_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(prefix));
}

function resolveRepoPath(repoRoot: string, filePath: string): string {
  return filePath.startsWith("/") ? filePath : join(repoRoot, filePath);
}

/**
 * Captures the current git working-tree state (modified tracked files +
 * untracked non-ignored files), excluding engine-owned docs/ files. Returns
 * null when the directory is not a git repo or git cannot be queried — in that
 * case the no-op heuristic cannot detect file changes and must rely on output
 * substance alone.
 */
export async function captureWorktree(repoRoot: string): Promise<WorktreeSnapshot | null> {
  if (!existsSync(join(repoRoot, ".git"))) return null;

  // --untracked-files=all lists individual untracked files instead of collapsing
  // whole untracked directories, so adding one file inside an existing untracked
  // directory is still detected as a change.
  const result = await runCommand("git", ["status", "--porcelain", "-z", "--untracked-files=all"], {
    cwd: repoRoot,
    timeoutMs: 10_000,
    maxBufferBytes: 10 * 1024 * 1024,
  });
  if (result.status !== 0) return null;

  const paths = new Set<string>();
  for (const chunk of result.stdout.split("\0")) {
    if (!chunk) continue;
    // porcelain -z entry: "<XY> <path>" (renames: "<XY> <orig> -> <new>").
    const rest = chunk.slice(3);
    const arrow = rest.indexOf(" -> ");
    const file = arrow !== -1 ? rest.slice(arrow + 4) : rest;
    const rel = file.replace(/\\/g, "/");
    if (!isEngineOwnedPath(rel)) paths.add(rel);
  }
  return { paths };
}

/** True when the working tree changed between two snapshots (null = unknown). */
export function worktreeChanged(before: WorktreeSnapshot | null, after: WorktreeSnapshot | null): boolean {
  if (!before || !after) return false;
  if (before.paths.size !== after.paths.size) return true;
  for (const p of before.paths) {
    if (!after.paths.has(p)) return true;
  }
  return false;
}

/**
 * Returns the set of relative file paths that became dirty during a task —
 * i.e. paths that appear in `after` but not in `before`.
 *
 * Because `captureWorktree` uses `git status --porcelain`, `before.paths`
 * contains all files that were already dirty *before* the task ran.  A
 * pre-existing file modified in place therefore shows up in both snapshots
 * (already dirty before → still dirty after), so it is correctly excluded.
 * Only files that moved from clean to dirty during the task are returned.
 *
 * Returns an empty array when either snapshot is null (git unavailable).
 *
 * This is the primary mechanism for recording `outputFiles` when an agent
 * modifies existing files rather than creating new ones.
 */
export function diffWorktree(before: WorktreeSnapshot | null, after: WorktreeSnapshot | null): string[] {
  if (!before || !after) return [];
  const result: string[] = [];
  for (const p of after.paths) {
    if (!before.paths.has(p)) result.push(p);
  }
  return result;
}

/**
 * Runs the task's manifest `validationCommands` (if any) and requires them all
 * to exit 0. Used when `--run-validation` is enabled.
 */
export async function runTaskValidation(
  task: ManifestTask,
  repoRoot: string,
  timeoutMs: number,
): Promise<VerifyResult> {
  if (task.validationCommands.length === 0) return { ok: true };

  const isWin = process.platform === "win32";
  for (const command of task.validationCommands) {
    const bin = isWin ? "cmd" : "sh";
    const args = isWin ? ["/c", command] : ["-c", command];
    const result = await runCommand(bin, args, {
      cwd: repoRoot,
      timeoutMs,
      maxBufferBytes: 10 * 1024 * 1024,
    });
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout).trim();
      return {
        ok: false,
        reason: `validation command failed (exit ${result.status}): ${command}${detail ? `\n${detail}` : ""}`,
      };
    }
  }
  return { ok: true };
}

/**
 * Decides whether a successful harness call counts as real task completion.
 * A non-`ok` result means the attempt did nothing useful and should be retried
 * (then marked failed with `reason`).
 */
export async function verifyTaskResult(
  task: ManifestTask,
  result: TaskResult,
  baseline: WorktreeSnapshot | null,
  opts: VerifyOptions,
): Promise<VerifyResult> {
  // 1. Expected outputs must exist.
  if (task.expectedOutputs.length > 0) {
    const missing = task.expectedOutputs.filter((p) => !existsSync(resolveRepoPath(opts.repoRoot, p)));
    if (missing.length > 0) {
      return { ok: false, reason: `expected outputs missing: ${missing.join(", ")}` };
    }
    return { ok: true };
  }

  // 2. Validation commands (when enabled) are stronger evidence than the
  //    no-op heuristic — a passing validation gate means work happened.
  if (opts.runValidation && task.validationCommands.length > 0) {
    return { ok: true };
  }

  // 3. No-op detection: no file changes + trivial output => hollow completion.
  if (!opts.allowNoop) {
    const after = await captureWorktree(opts.repoRoot);
    if (!worktreeChanged(baseline, after) && isTrivialOutput(result.stdout)) {
      return { ok: false, reason: "task produced no changes and no substantive output" };
    }
  }

  return { ok: true };
}
