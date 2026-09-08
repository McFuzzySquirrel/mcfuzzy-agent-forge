import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { TaskAttemptRequest, TaskAttemptSummary, TaskGateResult, TaskResult } from "./types.ts";
import { parseTaskHandoff } from "./task-result.ts";

export const TASK_EXECUTION_DIR = "docs/artifacts";

function taskFileId(taskId: string): string {
  if (/^[A-Z0-9][A-Z0-9_.-]{0,79}$/.test(taskId) && !taskId.endsWith(".") && !/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/.test(taskId)) return taskId;
  const readable = taskId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  return `%${readable}-${createHash("sha256").update(taskId).digest("hex").slice(0, 16)}`;
}

function writeLatest(file: string, content: string): void {
  const existing = lstatSync(file, { throwIfNoEntry: false });
  if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink > 1)) throw new Error(`Execution file must be a regular unlinked file: ${file}`);
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try { renameSync(temporary, file); }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

function executionRoot(repoRoot: string): string {
  const root = realpathSync(repoRoot);
  for (const directory of [join(root, "docs"), join(root, TASK_EXECUTION_DIR)]) {
    if (existsSync(directory)) {
      const stat = lstatSync(directory);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Execution directory must be a regular repository directory: ${directory}`);
    } else mkdirSync(directory);
  }
  return root;
}

export function writeTaskAttempt(repoRoot: string, evidence: Omit<TaskAttemptSummary, "resultPath"> & {
  runId: string;
  taskId: string;
  result: TaskResult;
  gates: TaskGateResult[];
}): string {
  const root = executionRoot(repoRoot);
  const fileId = taskFileId(evidence.taskId);
  const timestamp = new Date().toISOString();
  const base = `${TASK_EXECUTION_DIR}/${fileId}.${timestamp.replace(/[:.]/g, "-")}.attempt-${evidence.attempt}`;
  const latest = `${TASK_EXECUTION_DIR}/${fileId}.result.json`;
  const content = JSON.stringify({ version: 1, timestamp, ...evidence, handoff: parseTaskHandoff(evidence.result.stdout) }, null, 2) + "\n";
  for (let collision = 0; ; collision += 1) {
    const file = `${base}${collision ? `-${collision}` : ""}.result.json`;
    try { writeFileSync(join(root, file), content, { encoding: "utf8", flag: "wx", mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    writeLatest(join(root, latest), content);
    return file;
  }
}

export function executionPrompt(request: TaskAttemptRequest, persona = ""): string {
  request.signal?.throwIfAborted();
  if (request.task.contract?.kind === "human-review") throw new Error("Human review must not create a model execution file.");
  if (!request.requiredCapabilities.includes("repository-tools")) return [persona, request.instructions].filter(Boolean).join("\n\n");
  if (request.task.expectedOutputs.some((file) => {
    const normalized = relative(request.repoRoot, resolve(request.repoRoot, file)).replace(/\\/g, "/").toLowerCase();
    return [TASK_EXECUTION_DIR, "docs/task-executions"].some((directory) => normalized === directory || normalized.startsWith(`${directory}/`));
  })) throw new Error("Task execution files are engine-owned, not task deliverables.");

  const root = executionRoot(request.repoRoot);
  const content = [
    "# Task Execution",
    JSON.stringify({ taskId: request.task.id, runId: request.attempt.runId, attempt: request.attempt.number, owner: request.agent.name, model: request.effectiveModel, dependencies: request.task.dependencies }),
    "This is an engine-generated execution snapshot. Do not modify it or include it in deliverables or commits. Execute only this task; supporting documents do not authorize unrelated work.",
    persona ? `## Specialist Instructions\n\n${persona}` : "",
    `## Execution Instructions\n\n${request.instructions}`,
  ].filter(Boolean).join("\n\n") + "\n";
  const digest = createHash("sha256").update(content).digest("hex");
  const file = `${TASK_EXECUTION_DIR}/${taskFileId(request.task.id)}.md`;
  writeLatest(join(root, file), content);
  console.log(`[engine] Task ${request.task.id} attempt ${request.attempt.number}: execution file ${file} (sha256 ${digest})`);
  return `Perform the task now. Read the execution file "${file}" relative to the project root before doing any work. Follow its task scope, mandatory requirements, acceptance criteria, constraints and validation commands. Read referenced documentation as needed. Do not modify the execution file or commit ${TASK_EXECUTION_DIR}/. Return the required result report and list the files you created or changed.`;
}