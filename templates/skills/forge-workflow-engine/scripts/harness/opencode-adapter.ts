import { existsSync, readFileSync } from "node:fs";

import { runCommand } from "./run.ts";
import { DEFAULT_TASK_TIMEOUT_MS, type AgentDescriptor, type HarnessAdapter, type ManifestTask, type TaskResult, type WorkflowState } from "../types.ts";

/**
 * OpenCode CLI harness adapter.
 *
 * Invokes `opencode run` with the agent's persona inlined into the prompt,
 * captures stdout/stderr, and returns a structured TaskResult.
 *
 * Unlike `copilot -p`, `opencode run` has no `--system-prompt` flag, so the
 * agent file body is prepended to the user prompt as an inline context block.
 *
 * Expected CLI shape:
 *   opencode run [--model <model-id>] "<agent body + task prompt>"
 *
 * Set OPENCODE_BIN env var to override the opencode binary path.
 * Set OPENCODE_EXTRA_FLAGS env var to inject extra flags (e.g. "--no-stream").
 * `--auto` is passed by default so per-task tool permissions are auto-approved;
 * this adapter runs non-interactively (no user is present to approve prompts).
 *
 * Pass `attachUrl` (e.g. "http://127.0.0.1:4096") to attach every task to a
 * warm `opencode serve` instance. This skips the per-task cold start (config,
 * AGENTS.md, skills, MCP server boot) - the server holds that state, and each
 * `run --attach` still creates a fresh, isolated session per task.
 */
export interface OpenCodeAdapterOptions {
  /** URL of a running `opencode serve` instance to attach to. */
  attachUrl?: string;
}

export class OpenCodeAdapter implements HarnessAdapter {
  readonly name = "opencode";
  readonly supportsConcurrency = true;

  private readonly bin: string;
  private readonly extraFlags: string[];
  private readonly attachUrl?: string;

  constructor(options: OpenCodeAdapterOptions = {}) {
    this.bin = process.env["OPENCODE_BIN"] ?? "opencode";
    const extra = (process.env["OPENCODE_EXTRA_FLAGS"] ?? "").split(/\s+/).filter(Boolean);
    this.extraFlags = ["--auto", ...extra];
    this.attachUrl = options.attachUrl;
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

    const modelFlag = agent.model ? ["--model", agent.model] : [];

    const prompt = this.buildPrompt(agent, task, contextBlock);
    // `--dir` pins the project directory explicitly: `opencode run` resolves its
    // working directory from its parent process, not the child's spawn `cwd`, so
    // relying on `cwd: repoRoot` alone runs tasks in the wrong project when the
    // engine process lives in a subdirectory (e.g. the engine's own package dir).
    // With `--attach`, `--dir` names the project root on the remote server.
    const attachFlags = this.attachUrl ? ["--attach", this.attachUrl] : [];
    const args = ["run", ...modelFlag, "--dir", repoRoot, ...attachFlags, ...this.extraFlags, prompt];

    const result = await runCommand(this.bin, args, {
      cwd: repoRoot,
      timeoutMs: timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS,
      maxBufferBytes: 10 * 1024 * 1024,
    });
    const durationMs = Date.now() - start;

    if (this.attachUrl) {
      // When attaching, `bootMs` is the client's startup, not a full harness
      // cold start - comparing it against a non-attach run quantifies the win.
      console.log(
        `[opencode] task ${task.id}: boot=${result.bootMs ?? durationMs}ms total=${durationMs}ms`,
      );
    }

    const stdout = result.stdout;
    const stderr = result.stderr;

    if (result.error) {
      return {
        success: false,
        outputFiles: [],
        stdout,
        stderr,
        durationMs,
        errorMessage: result.error,
      };
    }

    if (result.status !== 0) {
      return {
        success: false,
        outputFiles: [],
        stdout,
        stderr,
        durationMs,
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
      durationMs,
    };
  }

  private buildPrompt(agent: AgentDescriptor, task: ManifestTask, contextBlock?: string): string {
    const contextHints = task.expectedOutputs.length > 0
      ? `\n\nExpected output files: ${task.expectedOutputs.join(", ")}`
      : "";

    const validationHint = task.validationCommands.length > 0
      ? `\n\nValidation commands to run after completion: ${task.validationCommands.join("; ")}`
      : "";

    return [
      agent.rawBody,
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
