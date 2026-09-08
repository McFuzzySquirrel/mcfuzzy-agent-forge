/**
 * Auto-commit of a task's work (see docs/research/auto-commit-after-task.md).
 *
 * The engine commits once per completed task, after the wave merge, so it is
 * safe regardless of concurrency. Failures are non-fatal: a task already
 * completed successfully, so a commit problem is logged (or skipped for
 * "nothing to commit") rather than failing the task or the run.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { runCommand } from "./harness/run.ts";

export const DEFAULT_COMMIT_TEMPLATE = "feat(forge-engine): complete task {taskId} - {taskTitle}";

/** Builds the commit message from the template, substituting the placeholders. */
export function buildCommitMessage(taskId: string, taskTitle: string, template?: string): string {
  return (template ?? DEFAULT_COMMIT_TEMPLATE)
    .replaceAll("{taskId}", taskId)
    .replaceAll("{taskTitle}", taskTitle);
}

/**
 * Stages all changes in the repo and commits the task's work. Returns the
 * commit SHA on success, or `null` when there was nothing to commit, the
 * directory is not a git repo, or the commit failed (non-fatal - logged only).
 */
export async function commitTaskWork(
  taskId: string,
  taskTitle: string,
  repoRoot: string,
  template?: string,
): Promise<string | null> {
  if (!existsSync(join(repoRoot, ".git"))) return null;

  const common = { cwd: repoRoot, timeoutMs: 30_000, maxBufferBytes: 10 * 1024 * 1024 };

  const stagedExecutions = await runCommand("git", ["diff", "--cached", "--name-only", "--", "docs/artifacts", "docs/task-executions"], common);
  if (stagedExecutions.status !== 0 || stagedExecutions.stdout.trim()) {
    console.warn(`[engine] Cannot auto-commit task ${taskId}: unable to exclude staged generated artifacts. Unstage docs/artifacts and docs/task-executions before committing.`);
    return null;
  }
  const add = await runCommand("git", ["add", "-A", "--", ".", ":(exclude,glob)docs/[a]rtifacts/**", ":(exclude,glob)docs/[t]ask-executions/**"], common);
  if (add.status !== 0) {
    const output = [add.stdout, add.stderr, add.error].filter(Boolean).join("\n");
    const tail = output.trim().split("\n").slice(-10).join("\n");
    console.warn(`[engine] git add failed (exit ${add.status}) for task ${taskId}; skipping commit.${tail ? `\n${tail}` : ""}`);
    return null;
  }

  const message = buildCommitMessage(taskId, taskTitle, template);
  const commit = await runCommand("git", ["commit", "-m", message], common);
  if (commit.status !== 0) {
    const output = `${commit.stdout}\n${commit.stderr}`;
    if (/nothing to commit/i.test(output)) {
      console.log(`[engine] No changes to commit for task ${taskId}; skipping.`);
      return null;
    }
    const tail = output.trim().split("\n").slice(-3).join("\n");
    console.warn(`[engine] git commit failed for task ${taskId} (exit ${commit.status}):\n${tail}`);
    return null;
  }

  const rev = await runCommand("git", ["rev-parse", "HEAD"], common);
  if (rev.status !== 0) return null;
  const sha = rev.stdout.trim();
  return sha || null;
}
