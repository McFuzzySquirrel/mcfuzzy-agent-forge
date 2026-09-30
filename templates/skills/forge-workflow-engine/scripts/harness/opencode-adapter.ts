import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { runCommand, extractModelFlags, canSelectAgentNatively } from "./run.ts";
import { harnessInvocationContext } from "./invocation-log.ts";
import type { AgentDescriptor, HarnessAdapter, TaskAttemptRequest, TaskResult } from "../types.ts";
import { inlinePersona } from "../request.ts";
import { executionPrompt } from "../task-execution.ts";

/**
 * OpenCode CLI harness adapter.
 *
 * Invokes `opencode run` per task, captures stdout/stderr, and returns a
 * structured TaskResult.
 *
 * Agent selection is native when possible: if the owning agent's file lives
 * under the project's `.opencode/agents/` directory, the adapter passes
 * `--agent <name>` so opencode loads the persona itself (the session shows the
 * forge agent rather than the default build agent) and the persona is not
 * inlined. For other harness roots (`.agents`, `.claude`, `.github`) opencode
 * cannot discover the agent files, so the persona is included in the repository
 * task's execution file instead (inline for text-only tasks).
 *
 * Expected CLI shapes:
 *   opencode run [--model <model-id>] [--agent <name>] "<short execution-file instruction>"
 *   opencode run [--model <model-id>] "<short execution-file instruction>"
 *
 * Set OPENCODE_BIN env var to override the opencode binary path.
 * Set OPENCODE_EXTRA_FLAGS env var to inject extra flags (e.g. "--no-stream").
 * `--auto` is passed by default so per-task tool permissions are auto-approved;
 * this adapter runs non-interactively (no user is present to approve prompts).
 *
 * The project directory is pinned by the child's spawn `cwd` (see `invoke`).
 * OpenCode v2 removed `run --dir` and added no replacement: `run` takes only
 * `message...` arguments, so a trailing path would be swallowed into the prompt
 * while the project stayed wherever the process was launched. v2 resolves the
 * project from `process.cwd()`, so `cwd` is the only mechanism - see ADR-058.
 *
 * There is no engine-managed warm server. OpenCode v2 dropped `run --attach`,
 * so instead each `opencode run` connects to OpenCode's own background
 * service, which is warm by default (config, AGENTS.md, skills, and MCP
 * servers are already booted) while every run still gets a fresh, isolated
 * session in the project its `cwd` names. Pass `--standalone` via
 * OPENCODE_EXTRA_FLAGS to give a run its own private server instead.
 */
export class OpenCodeAdapter implements HarnessAdapter {
  readonly name = "opencode";
  readonly supportsConcurrency = true;
  readonly capabilities = ["text", "repository-tools"] as const;
  readonly defaultModel?: string;

  private readonly bin: string;
  private readonly extraFlags: string[];

  constructor() {
    this.bin = process.env["OPENCODE_BIN"] ?? "opencode";
    const extra = (process.env["OPENCODE_EXTRA_FLAGS"] ?? "").split(/\s+/).filter(Boolean);
    const parsed = extractModelFlags(extra);
    this.extraFlags = ["--auto", ...parsed.flags];
    this.defaultModel = parsed.model;
  }

  async invoke(request: TaskAttemptRequest): Promise<TaskResult> {
    const start = Date.now();
    const { agent, task, repoRoot } = request;

    // OpenCode model IDs are provider-qualified (for example,
    // `github-copilot/gpt-5.6-luna`); unlike Copilot, do not strip the prefix.
    const modelFlag = request.effectiveModel ? ["--model", request.effectiveModel] : [];
    const agentFlag = this.canSelectAgent(request) ? ["--agent", agent.name] : [];

    const prompt = executionPrompt(request, agentFlag.length === 0 ? inlinePersona(request) : "");
    const args = ["run", ...modelFlag, ...agentFlag, ...this.extraFlags, prompt];

    const result = await runCommand(this.bin, args, {
      // `opencode run` resolves its project from `process.cwd()` (verified on
      // v2.0.20: the `PWD` environment variable is ignored). Pinning `cwd` is
      // what keeps a task in its repository - or, in parallel mode, in its own
      // sandbox worktree - even when the engine process lives in a
      // subdirectory such as the engine's own package dir.
      cwd: repoRoot,
      timeoutMs: request.budget.timeoutMs,
      signal: request.signal,
      maxBufferBytes: 10 * 1024 * 1024,
      invocation: harnessInvocationContext(this.name, request),
      activity: request.logHarnessActivity === true,
    });
    const durationMs = Date.now() - start;

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
        failureKind: result.failureKind,
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
      durationMs,
    };
  }

  /** True when opencode can select this agent natively; see `canSelectAgentNatively`. */
  private canSelectAgent(request: TaskAttemptRequest): boolean {
    return canSelectAgentNatively(request, ".opencode");
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
