import { existsSync } from "node:fs";

import type { AgentDescriptor, HarnessAdapter, ManifestTask, TaskResult, WorkflowState } from "../types.ts";

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

  private readonly failIds: Set<string>;
  private readonly delayMs: number;

  constructor() {
    const raw = process.env["STUB_FAIL_TASK_IDS"] ?? "";
    this.failIds = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
    this.delayMs = Number(process.env["STUB_DELAY_MS"] ?? "0");
  }

  async invoke(
    agent: AgentDescriptor,
    task: ManifestTask,
    _context: WorkflowState,
    repoRoot: string,
    _contextBlock?: string,
    _timeoutMs?: number,
    _maxRetries?: number,
  ): Promise<TaskResult> {
    const start = Date.now();

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
      };
    }

    const outputFiles = task.expectedOutputs.filter((path) =>
      existsSync(path.startsWith("/") ? path : `${repoRoot}/${path}`),
    );

    const agentLabel = agent.model ? `${agent.name} (${agent.model})` : agent.name;

    return {
      success: true,
      outputFiles,
      stdout: `[stub] ${agentLabel} completed task ${task.id}: ${task.title}`,
      stderr: "",
      durationMs: Date.now() - start,
    };
  }
}
