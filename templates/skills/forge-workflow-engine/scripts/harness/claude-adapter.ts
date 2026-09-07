import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";

import { runCommand, extractModelFlags, stripProviderPrefix } from "./run.ts";
import type { HarnessAdapter, TaskAttemptRequest, TaskFailureKind, TaskResult } from "../types.ts";
import { inlinePersona } from "../request.ts";

/** Fields the adapter reads from `claude -p --output-format json`. All optional: the CLI may evolve. */
interface ClaudeResultEnvelope {
  type?: string;
  is_error?: boolean;
  subtype?: string;
  terminal_reason?: string;
  api_error_status?: number | null;
  result?: string;
  permission_denials?: Array<{ tool_name?: string }>;
  session_id?: string;
}

const STDOUT_PREVIEW_CHARS = 500;

/**
 * Claude Code CLI harness adapter.
 *
 * Invokes `claude -p` per task, parses the JSON result envelope, and returns a
 * structured TaskResult.
 *
 * Agent selection is native when possible: if the owning agent's file lives
 * under the project's `.claude/agents/` directory, the adapter passes
 * `--agent <name>` so the CLI loads the persona itself and the persona is not
 * inlined. For other harness roots (`.agents`, `.github`, `.opencode`) the CLI
 * cannot discover the agent files, so the agent file body is prepended to the
 * user prompt as an inline context block instead.
 *
 * Expected CLI shapes:
 *   claude -p "<task prompt>" --output-format json --agent <name> --permission-mode bypassPermissions
 *   claude -p "<agent body + task prompt>" --output-format json --permission-mode bypassPermissions
 *
 * Set CLAUDE_BIN env var to override the claude binary path.
 * Set CLAUDE_EXTRA_FLAGS env var to inject extra flags (e.g. "--model opus").
 * `--permission-mode bypassPermissions` is passed by default so per-task tool
 * permissions are auto-approved; this adapter runs non-interactively (no user
 * is present to approve prompts).
 */
export class ClaudeAdapter implements HarnessAdapter {
  readonly name = "claude";
  readonly supportsConcurrency = true;
  readonly capabilities = ["text", "repository-tools"] as const;
  readonly defaultModel?: string;

  private readonly bin: string;
  private readonly extraFlags: string[];

  constructor() {
    this.bin = process.env["CLAUDE_BIN"] ?? "claude";
    const extra = (process.env["CLAUDE_EXTRA_FLAGS"] ?? "").split(/\s+/).filter(Boolean);
    const parsed = extractModelFlags(extra);
    this.extraFlags = ["--permission-mode", "bypassPermissions", ...parsed.flags];
    this.defaultModel = parsed.model;
  }

  async invoke(request: TaskAttemptRequest): Promise<TaskResult> {
    const start = Date.now();
    const { agent, task, repoRoot } = request;
    const native = this.canSelectAgent(request);
    const prompt = native ? request.instructions : [inlinePersona(request), request.instructions].join("\n\n");
    const agentFlag = native ? ["--agent", agent.name] : [];
    const modelFlag = request.effectiveModel ? ["--model", stripProviderPrefix(request.effectiveModel)] : [];
    const args = ["-p", prompt, "--output-format", "json", ...agentFlag, ...modelFlag, ...this.extraFlags];

    const result = await runCommand(this.bin, args, {
      cwd: repoRoot,
      timeoutMs: request.budget.timeoutMs,
      signal: request.signal,
      maxBufferBytes: 10 * 1024 * 1024,
    });

    const stdout = result.stdout;
    const stderr = result.stderr;
    const failure = (errorMessage: string, failureKind: TaskFailureKind | undefined): TaskResult => ({
      success: false,
      outputFiles: [],
      stdout,
      stderr,
      durationMs: Date.now() - start,
      errorMessage,
      failureKind,
    });

    if (result.error) return failure(result.error, result.failureKind);

    const envelope = parseResultEnvelope(stdout);
    if (envelope?.session_id) console.log(`[engine] claude session ${envelope.session_id} (task ${task.id})`);

    if (!envelope) {
      if (result.status !== 0) {
        return failure(stderr.trim() || `${this.bin} exited with status ${result.status}`, "configuration");
      }
      const preview = stdout.trim().slice(0, STDOUT_PREVIEW_CHARS);
      const detail = preview ? `: ${preview}` : "";
      return failure(`claude returned no JSON result envelope${detail}`, "exception");
    }

    if (envelope.is_error === true) {
      return failure(envelopeErrorMessage(envelope, stderr), classifyEnvelopeFailure(envelope));
    }

    const denials = envelope.permission_denials ?? [];
    if (denials.length > 0) {
      const named = uniqueDeniedTools(envelope);
      const listed = named.length > 0 ? named.join(", ") : "unnamed tool";
      return failure(`claude denied tool calls under bypassPermissions: ${listed}`, "configuration");
    }

    if (result.status !== 0) {
      return failure(`${this.bin} exited with status ${result.status} despite a success envelope`, "retryable");
    }

    const outputFiles = task.expectedOutputs.filter((path) =>
      existsSync(resolve(repoRoot, path)),
    );

    return {
      success: true,
      outputFiles,
      stdout: envelope.result ?? "",
      stderr: "",
      durationMs: Date.now() - start,
    };
  }

  /**
   * True when the Claude Code CLI can select this agent natively: it must have
   * a name and its file must live under the project's `.claude/agents/`
   * directory - the only harness root the CLI scans for repo agent
   * definitions. For `.agents`, `.github`, and `.opencode` roots the adapter
   * falls back to inlining the persona into the prompt. Set
   * FORGE_ENGINE_NATIVE_AGENT=0 to force the inline-persona fallback even for
   * `.claude` agents.
   */
  private canSelectAgent({ agent, repoRoot }: TaskAttemptRequest): boolean {
    if (process.env["FORGE_ENGINE_NATIVE_AGENT"] === "0") return false;
    if (!agent.name) return false;
    const parts = relative(repoRoot, agent.path).split(/[\\/]/);
    return parts[0] === ".claude" && parts[1] === "agents" && parts.length > 2;
  }
}

/**
 * Reads the single JSON object `claude -p --output-format json` prints. Falls
 * back to the last non-empty line so a banner or warning ahead of the envelope
 * does not lose it. Anything that is not a JSON object counts as no envelope,
 * and so does a JSON object carrying a `type` other than "result" (a streamed
 * `system` or `assistant` message, say). An object with no `type` at all is
 * still accepted, since the field is optional in the shapes we have seen.
 */
function parseResultEnvelope(stdout: string): ClaudeResultEnvelope | undefined {
  const text = stdout.trim();
  if (!text) return undefined;
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const lastLine = lines.at(-1);
  const candidates = lastLine && lastLine !== text ? [text, lastLine] : [text];
  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const envelope = parsed as ClaudeResultEnvelope;
    if (envelope.type !== undefined && envelope.type !== "result") continue;
    return envelope;
  }
  return undefined;
}

/**
 * `subtype` is "success" even for some hard errors (the not-logged-in case), so
 * classification keys on the message and the API status before the subtype.
 */
function classifyEnvelopeFailure(envelope: ClaudeResultEnvelope): TaskFailureKind {
  if (envelope.result && /not logged in/i.test(envelope.result)) return "configuration";
  const status = envelope.api_error_status;
  if (typeof status === "number") {
    if (status === 429) return "retryable";
    if (status >= 500) return "retryable";
    if (status >= 400) return "configuration";
  }
  if (envelope.subtype === "error_max_turns" || envelope.subtype === "error_max_budget_usd") return "configuration";
  return "retryable";
}

function envelopeErrorMessage(envelope: ClaudeResultEnvelope, stderr: string): string {
  const message = envelope.result?.trim()
    ? envelope.result
    : `claude ${envelope.subtype ?? "error"} (${envelope.terminal_reason ?? "unknown"})`;
  return stderr.trim() ? `${message}\n${stderr.trim()}` : message;
}

function uniqueDeniedTools(envelope: ClaudeResultEnvelope): string[] {
  const names = (envelope.permission_denials ?? []).map((denial) => denial?.tool_name).filter((name): name is string => Boolean(name));
  return [...new Set(names)];
}
