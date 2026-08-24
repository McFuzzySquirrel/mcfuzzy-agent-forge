import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import type { AgentDescriptor, HarnessAdapter, ManifestTask, TaskResult, WorkflowState } from "../types.ts";

/**
 * GitHub Copilot CLI harness adapter.
 *
 * Invokes `copilot -p` with the agent's context inlined into the prompt and
 * auto-approves tool permissions with `--yolo`, captures stdout/stderr, and
 * returns a structured TaskResult.
 *
 * Unlike the opencode adapter, `copilot -p` has no `--system-prompt` flag, so
 * the agent file contents are prepended to the user prompt as an inline
 * "You are..." context block.
 *
 * Expected CLI shape:
 *   copilot -p "<system prompt + task prompt>" --yolo
 *
 * Set COPILOT_BIN env var to override the copilot binary path.
 * Set COPILOT_EXTRA_FLAGS env var to inject extra flags (e.g. "--model gpt-4o").
 * `--yolo` is passed by default so per-task tool permissions are auto-approved;
 * this adapter runs non-interactively (no user is present to approve prompts).
 */
export class CopilotAdapter implements HarnessAdapter {
  readonly name = "copilot";

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
  ): Promise<TaskResult> {
    const start = Date.now();

    const prompt = this.buildPrompt(agent, task, contextBlock);
    const args = [
      this.bin,
      "-p",
      prompt,
      ...this.extraFlags,
    ];

    const cmd = args.map((arg) => (arg.includes(" ") ? `"${arg}"` : arg)).join(" ");

    try {
      const stdout = execSync(cmd, {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 10 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
      });

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
    } catch (error) {
      const execError = error as { stdout?: string; stderr?: string; message?: string };
      return {
        success: false,
        outputFiles: [],
        stdout: execError.stdout ?? "",
        stderr: execError.stderr ?? execError.message ?? String(error),
        durationMs: Date.now() - start,
        errorMessage: execError.stderr ?? execError.message ?? String(error),
      };
    }
  }

  private buildPrompt(agent: AgentDescriptor, task: ManifestTask, contextBlock?: string): string {
    const agentBody = existsSync(agent.path) ? readFileSync(agent.path, "utf8") : agent.rawBody;

    const contextHints = task.expectedOutputs.length > 0
      ? `\n\nExpected output files: ${task.expectedOutputs.join(", ")}`
      : "";

    const validationHint = task.validationCommands.length > 0
      ? `\n\nValidation commands to run after completion: ${task.validationCommands.join("; ")}`
      : "";

    return [
      agentBody,
      "",
      contextBlock ?? "",
      `Task: ${task.title}`,
      "",
      task.description,
      contextHints,
      validationHint,
    ].filter(Boolean).join("\n").trim();
  }
}
