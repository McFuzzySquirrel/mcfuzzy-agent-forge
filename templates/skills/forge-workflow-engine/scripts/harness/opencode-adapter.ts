import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { runCommand, extractModelFlags, canSelectAgentNatively } from "./run.ts";
import { harnessInvocationContext } from "./invocation-log.ts";
import type { AgentDescriptor, HarnessAdapter, SessionResumeStrategy, TaskAttemptRequest, TaskResult, TaskUsage } from "../types.ts";
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
 * while the project stayed wherever the process was launched.
 *
 * `cwd` is necessary but not sufficient on its own: v2 resolves the project
 * from `process.env.PWD ?? process.cwd()`, so an inherited stale `PWD`
 * outranks the correct `cwd`. `runCommand` pins both, so they cannot disagree -
 * see ADR-059, which corrects the `PWD` claim in ADR-058.
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
  /** `opencode run --session <id>` continues the session, or creates it if absent. */
  readonly sessionStrategy: SessionResumeStrategy = {
    kind: "deterministic",
    resumeFlags: (sessionId) => ["--session", sessionId],
    newSessionId: () => randomUUID(),
  };

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
    // Always address the session so its usage can be read afterwards. Under
    // task scope this creates a fresh, caller-chosen session; under phase scope
    // it continues the phase session the engine generated.
    const sessionOwned = !request.sessionId;
    const sessionId = request.sessionId ?? randomUUID();
    const sessionFlag = this.sessionStrategy.resumeFlags(sessionId);

    const prompt = executionPrompt(request, agentFlag.length === 0 ? inlinePersona(request) : "");
    const args = ["run", ...modelFlag, ...agentFlag, ...sessionFlag, ...this.extraFlags, prompt];

    const result = await runCommand(this.bin, args, {
      // `opencode run` resolves its project from `process.env.PWD ??
      // process.cwd()` (read out of the v2.0.20 bundle), so `PWD` is what
      // actually decides and an inherited one outranks `cwd`. `runCommand`
      // sets `PWD` to this `cwd` for the child, so pinning `cwd` keeps a task
      // in its repository - or, in parallel mode, in its own sandbox worktree
      // - even when the engine process lives in a subdirectory such as the
      // engine's own package dir. Do not drop `cwd` thinking PWD covers it.
      cwd: repoRoot,
      timeoutMs: request.budget.timeoutMs,
      signal: request.signal,
      maxBufferBytes: 10 * 1024 * 1024,
      invocation: harnessInvocationContext(this.name, request),
      activity: request.logHarnessActivity === true,
    });
    const durationMs = Date.now() - start;

    const usage = sessionOwned
      ? await readOpenCodeUsage(this.bin, sessionId, repoRoot)
      : { source: "unavailable" as const, note: "phase-scoped session: usage is cumulative across the phase" };

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
        usage,
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
        usage,
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
      usage,
    };
  }

  /** True when opencode can select this agent natively; see `canSelectAgentNatively`. */
  private canSelectAgent(request: TaskAttemptRequest): boolean {
    return canSelectAgentNatively(request, ".opencode");
  }
}

/**
 * Reads a session's authoritative token/cost usage from OpenCode.
 *
 * `opencode session export <id>` prints the session with
 * `info.tokens` (`{ input, output, reasoning, cache: { read, write } }`) and
 * `info.cost`. A failed or empty export is reported as "unavailable", never as
 * zeros, so the Console can tell "not reported" from "used nothing".
 */
async function readOpenCodeUsage(bin: string, sessionId: string, cwd: string): Promise<TaskUsage> {
  try {
    const result = await runCommand(bin, ["session", "export", sessionId], {
      cwd,
      timeoutMs: 15_000,
      maxBufferBytes: 32 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      return { source: "unavailable", note: "opencode session export failed" };
    }
    const parsed = JSON.parse(result.stdout) as {
      info?: {
        cost?: number;
        tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } };
      };
    };
    const tokens = parsed.info?.tokens;
    if (!tokens || (typeof tokens.input !== "number" && typeof tokens.output !== "number")) {
      return { source: "unavailable", note: "opencode session export reported no tokens" };
    }
    return {
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      reasoningTokens: tokens.reasoning,
      cacheReadTokens: tokens.cache?.read,
      cacheWriteTokens: tokens.cache?.write,
      costUsd: typeof parsed.info?.cost === "number" ? parsed.info.cost : undefined,
      source: "harness",
    };
  } catch (error) {
    return {
      source: "unavailable",
      note: `opencode usage unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
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
