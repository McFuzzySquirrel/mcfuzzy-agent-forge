import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { runCommand, extractModelFlags, stripProviderPrefix, canSelectAgentNatively } from "./run.ts";
import type { HarnessAdapter, TaskAttemptRequest, TaskResult } from "../types.ts";
import { inlinePersona } from "../request.ts";
import { executionPrompt } from "../task-execution.ts";

/**
 * GitHub Copilot CLI harness adapter.
 *
 * Invokes `copilot -p` per task, captures stdout/stderr, and returns a
 * structured TaskResult.
 *
 * Agent selection is native when possible: if the owning agent's file lives
 * under the project's `.github/agents/` directory, the adapter passes
 * `--agent <name>` so the Copilot CLI loads the persona itself. For other roots (`.agents`,
 * `.claude`, `.opencode`) Copilot cannot discover the agent files, so the agent
 * file body is included in the repository task's execution file instead.
 *
 * Expected CLI shapes:
 *   copilot -p "<short execution-file instruction>" --agent <name> --yolo
 *   copilot -p "<short execution-file instruction>" --yolo
 *
 * Set COPILOT_BIN env var to override the copilot binary path.
 * Set COPILOT_EXTRA_FLAGS env var to inject extra flags (e.g. "--model gpt-4o").
 * `--yolo` is passed by default so per-task tool permissions are auto-approved;
 * this adapter runs non-interactively (no user is present to approve prompts).
 */
export class CopilotAdapter implements HarnessAdapter {
  readonly name = "copilot";
  readonly supportsConcurrency = true;
  readonly capabilities = ["text", "repository-tools"] as const;
  readonly defaultModel?: string;

  private readonly bin: string;
  private readonly extraFlags: string[];

  constructor() {
    this.bin = process.env["COPILOT_BIN"] ?? "copilot";
    const extra = (process.env["COPILOT_EXTRA_FLAGS"] ?? "").split(/\s+/).filter(Boolean);
    const parsed = extractModelFlags(extra);
    this.extraFlags = ["--yolo", ...parsed.flags];
    this.defaultModel = parsed.model;
  }

  async invoke(request: TaskAttemptRequest): Promise<TaskResult> {
    const start = Date.now();
    const { agent, task, repoRoot } = request;
    const native = this.canSelectAgent(request);
    const prompt = executionPrompt(request, native ? "" : inlinePersona(request));
    const agentFlag = native ? ["--agent", agent.name] : [];
    const modelFlag = request.effectiveModel ? ["--model", stripProviderPrefix(request.effectiveModel)] : [];
    const args = ["-p", prompt, ...agentFlag, ...modelFlag, ...this.extraFlags];

    const result = await runCommand(this.bin, args, {
      cwd: repoRoot,
      timeoutMs: request.budget.timeoutMs,
      signal: request.signal,
      maxBufferBytes: 10 * 1024 * 1024,
    });

    const stdout = result.stdout;
    const stderr = result.stderr;

    if (result.error) {
      return {
        success: false,
        outputFiles: [],
        stdout,
        stderr,
        durationMs: Date.now() - start,
        errorMessage: result.error,
        failureKind: result.failureKind,
      };
    }

    if (result.status !== 0) {
      return {
        success: false,
        outputFiles: [],
        stdout,
        stderr,
        durationMs: Date.now() - start,
        errorMessage: stderr || `${this.bin} exited with status ${result.status}`,
        failureKind: "retryable",
      };
    }

    const outputFiles = task.expectedOutputs.filter((path) =>
      existsSync(resolve(repoRoot, path)),
    );

    return {
      success: true,
      outputFiles,
      stdout,
      stderr: "",
      durationMs: Date.now() - start,
    };
  }

  /** True when the Copilot CLI can select this agent natively; see `canSelectAgentNatively`. */
  private canSelectAgent(request: TaskAttemptRequest): boolean {
    return canSelectAgentNatively(request, ".github");
  }
}
