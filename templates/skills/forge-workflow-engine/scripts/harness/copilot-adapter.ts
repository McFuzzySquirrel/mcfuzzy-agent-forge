import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { runCommand, extractModelFlags, stripProviderPrefix, canSelectAgentNatively } from "./run.ts";
import { harnessInvocationContext } from "./invocation-log.ts";
import type { HarnessAdapter, SessionResumeStrategy, TaskAttemptRequest, TaskResult, TaskUsage } from "../types.ts";
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
  /** `copilot -p --session-id <uuid>` resumes the session, or sets the UUID for a new one. */
  readonly sessionStrategy: SessionResumeStrategy = {
    kind: "deterministic",
    resumeFlags: (sessionId) => ["--session-id", sessionId],
    newSessionId: () => randomUUID(),
  };

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
    const sessionFlag = request.sessionId ? this.sessionStrategy.resumeFlags(request.sessionId) : [];
    const args = ["-p", prompt, ...agentFlag, ...modelFlag, ...sessionFlag, ...this.extraFlags];

    const result = await runCommand(this.bin, args, {
      cwd: repoRoot,
      timeoutMs: request.budget.timeoutMs,
      signal: request.signal,
      maxBufferBytes: 10 * 1024 * 1024,
      invocation: harnessInvocationContext(this.name, request),
      activity: request.logHarnessActivity === true,
    });

    const stdout = result.stdout;
    const stderr = result.stderr;
    // Copilot prints its stats block to stderr; parse what it reports.
    const usage = copilotUsage(stderr);

    if (result.error) {
      return {
        success: false,
        outputFiles: [],
        stdout,
        stderr,
        durationMs: Date.now() - start,
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
        durationMs: Date.now() - start,
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
      durationMs: Date.now() - start,
      usage,
    };
  }

  /** True when the Copilot CLI can select this agent natively; see `canSelectAgentNatively`. */
  private canSelectAgent(request: TaskAttemptRequest): boolean {
    return canSelectAgentNatively(request, ".github");
  }
}

/**
 * Parses Copilot's stats block from stderr, for example:
 *
 *   AI Credits 0.46 (8s)
 *   Tokens     ↑ 18.6k (18.6k written) • ↓ 5
 *
 * "written" is the cache-write count. Credits are a harness-specific unit, not
 * USD, so they are kept separate from `costUsd`.
 */
function copilotUsage(stderr: string): TaskUsage {
  const tokens = /Tokens\s+[↑▲]\s*([\d.]+[kKmM]?)(?:\s*\(([\d.]+[kKmM]?)\s*written\))?\s*[•·]\s*[↓▼]\s*([\d.]+[kKmM]?)/.exec(stderr);
  const credits = /AI Credits\s+([\d.,]+)/.exec(stderr);
  if (!tokens && !credits) {
    return { source: "unavailable", note: "copilot reported no token stats" };
  }
  return {
    inputTokens: tokens ? parseCompactNumber(tokens[1]) : undefined,
    cacheWriteTokens: tokens?.[2] ? parseCompactNumber(tokens[2]) : undefined,
    outputTokens: tokens ? parseCompactNumber(tokens[3]) : undefined,
    credits: credits ? Number(credits[1]!.replace(/,/g, "")) : undefined,
    source: "harness",
  };
}

/** Parses "18.6k" / "1.2m" / "5" into an integer. */
function parseCompactNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const match = /^([\d.]+)([kKmM]?)$/.exec(raw.trim());
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  const unit = match[2]!.toLowerCase();
  const multiplier = unit === "k" ? 1_000 : unit === "m" ? 1_000_000 : 1;
  return Math.round(value * multiplier);
}
