import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { taskPath, validateTaskContract } from "../../forge-execution-adapter/scripts/task-contract.ts";
import { resolvedReferenceBlocks } from "../../forge-execution-adapter/scripts/requirement-sources.ts";
import type { ManifestTask } from "./types.ts";

function localFile(repoRoot: string, path: string): string {
  const full = resolve(repoRoot, taskPath(path));
  const existing = existsSync(full) ? full : dirname(full);
  let parent = existing;
  while (!existsSync(parent)) parent = dirname(parent);
  const rel = relative(realpathSync(repoRoot), realpathSync(parent));
  if (rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || isAbsolute(rel)) throw new Error(`Task file escapes repository: ${path}`);
  return full;
}

export function readTaskFile(repoRoot: string, path: string): string {
  const full = localFile(repoRoot, path);
  const stat = statSync(full);
  if (!stat.isFile() || stat.size > 128 * 1024) throw new Error(`Task file '${path}' must be a file no larger than 128 KiB; provide a scoped reference.`);
  return readFileSync(full, "utf8");
}

export function taskReferenceContext(repoRoot: string, task: ManifestTask, inline = true): string {
  validateTaskContract(task);
  if (!task.contract) return "";
  const blocks = resolvedReferenceBlocks(repoRoot, task.contract.references);
  const context = blocks.join("\n\n");
  if (Buffer.byteLength(context) > 256 * 1024) throw new Error(`Task '${task.id}' references exceed 256 KiB; split the work or supply scoped references.`);
  return inline ? context : [...new Set(task.contract.references)].map((path) => `- ${path}`).join("\n");
}

export function taskReviewDigest(repoRoot: string, task: ManifestTask): string {
  return createHash("sha256").update(JSON.stringify(task)).update(taskReferenceContext(repoRoot, task)).digest("hex");
}

export function approveHumanTask(repoRoot: string, task: ManifestTask, reviewer: string, evidence: string[]): void {
  validateTaskContract(task);
  if (task.contract?.kind !== "human-review") throw new Error("Only human-review tasks accept attestations.");
  if (!reviewer.trim() || !evidence.length) throw new Error("Reviewer identity and at least one evidence file are required.");
  const evidenceHashes = evidence.map((path) => {
    const content = readTaskFile(repoRoot, path);
    if (!content.trim()) throw new Error(`Empty review evidence: ${path}`);
    return { path, sha256: createHash("sha256").update(content).digest("hex") };
  });
  const file = localFile(repoRoot, task.contract.reviewFile!);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ taskId: task.id, taskDigest: taskReviewDigest(repoRoot, task), reviewer, reviewedAt: new Date().toISOString(), decision: "approved", evidence: evidenceHashes }, null, 2) + "\n");
}

export function humanTaskApproved(repoRoot: string, task: ManifestTask): boolean {
  validateTaskContract(task);
  if (task.contract?.kind !== "human-review") return false;
  try {
    const review = JSON.parse(readTaskFile(repoRoot, task.contract.reviewFile!));
    return review.taskId === task.id && review.taskDigest === taskReviewDigest(repoRoot, task) && review.decision === "approved" &&
      typeof review.reviewer === "string" && Boolean(review.reviewer.trim()) && Number.isFinite(Date.parse(review.reviewedAt)) &&
      Array.isArray(review.evidence) && review.evidence.length > 0 && review.evidence.every((entry: { path: string; sha256: string }) =>
        createHash("sha256").update(readTaskFile(repoRoot, entry.path)).digest("hex") === entry.sha256);
  } catch { return false; }
}