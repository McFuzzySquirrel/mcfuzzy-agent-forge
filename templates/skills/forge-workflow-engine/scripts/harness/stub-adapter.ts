import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { HarnessAdapter, TaskAttemptRequest, TaskResult } from "../types.ts";

/**
 * Stub harness adapter for dry-run, testing, and CI scenarios.
 *
 * Does not invoke any external process or API. Returns a synthetic success
 * result for every task so the engine loop, state machine, and progress
 * sync can be exercised without real model calls.
 *
 * Set STUB_FAIL_TASK_IDS env var to a comma-separated list of task IDs that
 * should return synthetic failures (useful for testing retry logic).
 *
 * Set STUB_DELAY_MS env var to simulate latency (default: 0).
 */
export class StubAdapter implements HarnessAdapter {
  readonly name = "stub";
  readonly supportsConcurrency = true;
  readonly capabilities = ["text", "repository-tools"] as const;

  private readonly failIds: Set<string>;
  private readonly delayMs: number;

  constructor() {
    const raw = process.env["STUB_FAIL_TASK_IDS"] ?? "";
    this.failIds = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
    this.delayMs = Number(process.env["STUB_DELAY_MS"] ?? "0");
  }

  async invoke(request: TaskAttemptRequest): Promise<TaskResult> {
    const start = Date.now();
    const { agent, task, repoRoot } = request;
    request.signal?.throwIfAborted();

    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    if (this.failIds.has(task.id)) {
      return {
        success: false,
        outputFiles: [],
        stdout: "",
        stderr: `[stub] synthetic failure for task ${task.id}`,
        durationMs: Date.now() - start,
        errorMessage: `[stub] synthetic failure for task ${task.id}`,
        failureKind: "retryable",
      };
    }

    const outputFiles = task.expectedOutputs.filter((path) =>
      existsSync(resolve(repoRoot, path)),
    );

    const agentLabel = request.effectiveModel ? `${agent.name} (${request.effectiveModel})` : agent.name;

    return {
      success: true,
      outputFiles,
      stdout: `[stub] ${agentLabel} completed task ${task.id}: ${task.title}`,
      stderr: "",
      durationMs: Date.now() - start,
    };
  }
}
