import type { AgentDescriptor, ManifestTask, TaskAttemptRequest, HarnessAdapter, TaskCapability } from "./types.ts";
import { DEFAULT_TASK_TIMEOUT_MS } from "./types.ts";

export function taskCapabilities(task: ManifestTask): readonly TaskCapability[] {
  const capabilities = task.requiredCapabilities?.length ? task.requiredCapabilities : ["repository-tools"] as const;
  if (capabilities.some((capability) => capability !== "text" && capability !== "repository-tools")) {
    throw new Error(`Task '${task.id}' has unknown requiredCapabilities.`);
  }
  return capabilities;
}

export function assertTaskCapabilities(task: ManifestTask, harness: HarnessAdapter): void {
  const missing = taskCapabilities(task).filter((capability) => !harness.capabilities.includes(capability));
  if (missing.length > 0) {
    throw new Error(`Harness '${harness.name}' cannot execute task '${task.id}': requires ${missing.join(", ")}. Choose a repository-capable harness, or explicitly declare requiredCapabilities: ["text"] for genuinely text-only tasks.`);
  }
}

export function prepareTaskRequest(options: {
  agent: AgentDescriptor;
  task: ManifestTask;
  repoRoot: string;
  defaultModel?: string;
  contextBlock?: string;
  timeoutMs?: number;
  maxRetries?: number;
  attempt?: number;
  runId?: string;
  signal?: AbortSignal;
}): TaskAttemptRequest {
  const task = structuredClone(options.task);
  const agent = structuredClone(options.agent);
  const capabilities = [...taskCapabilities(task)];
  const timeoutMs = task.timeoutMs ?? options.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? 0;
  const effectiveModel = task.model ?? agent.model ?? options.defaultModel;
  if (effectiveModel !== undefined && !effectiveModel.trim()) throw new Error(`Task '${task.id}' has an empty model selection.`);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error(`Task '${task.id}' requires a positive timeout.`);
  if (!Number.isInteger(maxRetries) || maxRetries < 0) throw new Error(`Task '${task.id}' requires a nonnegative integer retry budget.`);
  const instructions = [
    options.contextBlock ?? "",
    `Task: ${task.title}`,
    task.description,
    task.expectedOutputs.length ? `Expected output files: ${task.expectedOutputs.join(", ")}` : "",
    task.validationCommands.length ? `Validation commands to run after completion: ${task.validationCommands.join("; ")}` : "",
    `Execution budget: Per-task timeout: ${Math.round(timeoutMs / 1000)}s; results failing verification are retried up to ${maxRetries} time(s). Do not rely on retries to fix hollow output - deliver complete results first.`,
    `Attempt: ${options.attempt ?? 1}`,
    "Perform the task now. Do not merely acknowledge it or say you are ready - " +
      (capabilities.includes("repository-tools")
        ? "create or modify the files required, then list the files you created or changed."
        : "return the complete substantive text result."),
  ].filter(Boolean).join("\n\n");
  for (const value of Object.values(task)) if (Array.isArray(value)) Object.freeze(value);
  for (const value of Object.values(agent)) if (Array.isArray(value)) Object.freeze(value);
  return Object.freeze({
    agent: Object.freeze(agent), task: Object.freeze(task), effectiveModel,
    repoRoot: options.repoRoot, contextBlock: options.contextBlock ?? "",
    requiredCapabilities: Object.freeze(capabilities),
    attempt: Object.freeze({ number: options.attempt ?? 1, maxRetries, runId: options.runId ?? "" }),
    budget: Object.freeze({ timeoutMs }), instructions, signal: options.signal,
  });
}

export function inlinePersona(request: TaskAttemptRequest): string {
  return [request.agent.rawBody, ...request.agent.constraints.map((constraint) => `- ${constraint}`)].join("\n").trim();
}
