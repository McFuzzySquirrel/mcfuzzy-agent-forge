import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";

import { runCommand } from "./run.ts";
import { DEFAULT_TASK_TIMEOUT_MS, type AgentDescriptor, type HarnessAdapter, type ManifestTask, type TaskResult, type WorkflowState } from "../types.ts";

/**
 * GitHub Copilot CLI harness adapter.
 *
 * Invokes `copilot -p` per task, captures stdout/stderr, and returns a
 * structured TaskResult.
 *
 * Agent selection is native when possible: if the owning agent's file lives
 * under the project's `.github/agents/` directory, the adapter prepends the
 * `/agent <name>` directive to the prompt so the Copilot CLI loads the persona
 * itself and the persona is not inlined. For other harness roots (`.agents`,
 * `.claude`, `.opencode`) Copilot cannot discover the agent files, so the agent
 * file body is prepended to the user prompt as an inline context block instead.
 *
 * Expected CLI shapes:
 *   copilot -p "/agent <name>\n\n<task prompt>" --yolo
 *   copilot -p "<agent body + task prompt>" --yolo
 *
 * Set COPILOT_BIN env var to override the copilot binary path.
 * Set COPILOT_EXTRA_FLAGS env var to inject extra flags (e.g. "--model gpt-4o").
 * `--yolo` is passed by default so per-task tool permissions are auto-approved;
 * this adapter runs non-interactively (no user is present to approve prompts).
 */
export class CopilotAdapter implements HarnessAdapter {
  readonly name = "copilot";
  readonly supportsConcurrency = true;

  private readonly bin: string;
  private readonly extraFlags: string[];

  constructor() {
    this.bin = process.env["COPILOT_BIN"] ?? "copilot";
    const extra = (process.env["COPILOT_EXTRA_FLAGS"] ?? "").split(/\s+/).filter(Boolean);
    this.extraFlags = ["--yolo", ...extra];
  }

  async invoke(
    agent: AgentDescriptor,
    task: ManifestTask,
    _context: WorkflowState,
    repoRoot: string,
    contextBlock?: string,
    timeoutMs?: number,
  ): Promise<TaskResult> {
    const start = Date.now();

    const native = this.canSelectAgent(agent, repoRoot);
    const prompt = this.buildPrompt(agent, task, contextBlock, !native);
    const args = ["-p", prompt, ...this.extraFlags];

    const result = await runCommand(this.bin, args, {
      cwd: repoRoot,
      timeoutMs: timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS,
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
      };
    }

    const outputFiles = task.expectedOutputs.filter((path) =>
      existsSync(path.startsWith("/") ? path : `${repoRoot}/${path}`),
    );

    return {
      success: true,
      outputFiles,
      stdout,
      stderr: "",
      durationMs: Date.now() - start,
    };
  }

  /**
   * True when the Copilot CLI can select this agent natively: it must have a
   * name and its file must live under the project's `.github/agents/` directory
   * - the only harness root Copilot scans for repo agent definitions. For
   * `.agents`, `.claude`, and `.opencode` roots the adapter falls back to
   * inlining the persona into the prompt (see `buildPrompt`). Set
   * FORGE_ENGINE_NATIVE_AGENT=0 to force the inline-persona fallback even for
   * `.github` agents.
   */
  private canSelectAgent(agent: AgentDescriptor, repoRoot: string): boolean {
    if (process.env["FORGE_ENGINE_NATIVE_AGENT"] === "0") return false;
    if (!agent.name) return false;
    return relative(repoRoot, agent.path).split(/[\\/]/).includes(".github");
  }

  private buildPrompt(
    agent: AgentDescriptor,
    task: ManifestTask,
    contextBlock?: string,
    inlinePersona = true,
  ): string {
    const agentBlock = inlinePersona
      ? (existsSync(agent.path) ? readFileSync(agent.path, "utf8") : agent.rawBody)
      : `/agent ${agent.name}`;

    const contextHints = task.expectedOutputs.length > 0
      ? `\n\nExpected output files: ${task.expectedOutputs.join(", ")}`
      : "";

    const validationHint = task.validationCommands.length > 0
      ? `\n\nValidation commands to run after completion: ${task.validationCommands.join("; ")}`
      : "";

    const executeDirective =
      "\n\nPerform the task now. Do not merely acknowledge it or say you are ready - " +
      "create or modify the files required, then list the files you created or changed.";

    return [
      agentBlock,
      "",
      contextBlock ?? "",
      `Task: ${task.title}`,
      "",
      task.description,
      contextHints,
      validationHint,
      executeDirective,
    ].filter(Boolean).join("\n").trim();
  }
}
