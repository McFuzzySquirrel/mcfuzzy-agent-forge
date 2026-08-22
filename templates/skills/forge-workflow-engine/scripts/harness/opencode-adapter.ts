import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import type { AgentDescriptor, HarnessAdapter, ManifestTask, TaskResult, WorkflowState } from "../types.ts";

/**
 * OpenCode CLI harness adapter.
 *
 * Invokes `opencode run` with the agent name, system prompt, and task prompt,
 * captures stdout/stderr, and returns a structured TaskResult.
 *
 * Expected CLI shape:
 *   opencode run [--agent <name>] [--model <model-id>] [--system-prompt <path-or-text>] "<prompt>"
 *
 * Set OPENCODE_BIN env var to override the opencode binary path.
 * Set OPENCODE_EXTRA_FLAGS env var to inject extra flags (e.g. "--no-stream").
 */
export class OpenCodeAdapter implements HarnessAdapter {
  readonly name = "opencode";

  private readonly bin: string;
  private readonly extraFlags: string[];

  constructor() {
    this.bin = process.env["OPENCODE_BIN"] ?? "opencode";
    this.extraFlags = (process.env["OPENCODE_EXTRA_FLAGS"] ?? "").split(/\s+/).filter(Boolean);
  }

  async invoke(
    agent: AgentDescriptor,
    task: ManifestTask,
    _context: WorkflowState,
    repoRoot: string,
    contextBlock?: string,
  ): Promise<TaskResult> {
    const start = Date.now();

    const agentFlag = agent.name ? ["--agent", agent.name] : [];
    const modelFlag = agent.model ? ["--model", agent.model] : [];
    const systemPromptFlag = existsSync(agent.path) ? ["--system-prompt", agent.path] : [];

    const prompt = this.buildPrompt(agent, task, contextBlock);
    const args = [
      this.bin,
      "run",
      ...agentFlag,
      ...modelFlag,
      ...systemPromptFlag,
      ...this.extraFlags,
      prompt,
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
    const contextHints = task.expectedOutputs.length > 0
      ? `\n\nExpected output files: ${task.expectedOutputs.join(", ")}`
      : "";

    const validationHint = task.validationCommands.length > 0
      ? `\n\nValidation commands to run after completion: ${task.validationCommands.join("; ")}`
      : "";

    return [
      contextBlock ?? "",
      `Task: ${task.title}`,
      "",
      task.description,
      contextHints,
      validationHint,
    ].filter(Boolean).join("\n").trim();
  }
}

export function resolveAgentForTask(
  agents: AgentDescriptor[],
  ownerName: string | undefined,
): AgentDescriptor | undefined {
  if (!ownerName) return undefined;
  return agents.find((a) => a.name === ownerName);
}

export function loadAgentFile(agentPath: string): string {
  return existsSync(agentPath) ? readFileSync(agentPath, "utf8") : "";
}
