import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { runCommand, extractModelFlags } from "./run.ts";
import type { AgentDescriptor, HarnessAdapter, HarnessRunContext, TaskAttemptRequest, TaskResult } from "../types.ts";
import { inlinePersona } from "../request.ts";
import { startAttachServer, type AttachServer } from "./opencode-server.ts";

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
 * cannot discover the agent files, so - since `opencode run` has no
 * `--system-prompt` flag - the agent file body is prepended to the user prompt
 * as an inline context block instead.
 *
 * Expected CLI shapes:
 *   opencode run [--model <model-id>] [--agent <name>] "<task prompt>"
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
  startServer?: boolean;
  port?: number;
}

export class OpenCodeAdapter implements HarnessAdapter {
  readonly name = "opencode";
  readonly supportsConcurrency = true;
  readonly capabilities = ["text", "repository-tools"] as const;
  readonly defaultModel?: string;

  private readonly bin: string;
  private readonly extraFlags: string[];
  private attachUrl?: string;
  private server?: AttachServer;

  constructor(private readonly options: OpenCodeAdapterOptions = {}) {
    this.bin = process.env["OPENCODE_BIN"] ?? "opencode";
    const extra = (process.env["OPENCODE_EXTRA_FLAGS"] ?? "").split(/\s+/).filter(Boolean);
    const parsed = extractModelFlags(extra);
    this.extraFlags = ["--auto", ...parsed.flags];
    this.defaultModel = parsed.model;
    this.attachUrl = options.attachUrl;
  }

  async prepare(context: HarnessRunContext): Promise<void> {
    context.signal?.throwIfAborted();
    if (!this.options.startServer || this.attachUrl) return;
    this.server = await startAttachServer({ bin: this.bin, repoRoot: context.repoRoot, port: this.options.port, signal: context.signal });
    this.attachUrl = this.server.url;
    console.log(`[engine] opencode attach server ready at ${this.server.url}`);
  }

  async cleanup(): Promise<void> {
    if (!this.server) return;
    try {
      await this.server.stop();
    } finally {
      this.server = undefined;
      this.attachUrl = this.options.attachUrl;
    }
  }

  async invoke(request: TaskAttemptRequest): Promise<TaskResult> {
    const start = Date.now();
    const { agent, task, repoRoot } = request;

    // OpenCode model IDs are provider-qualified (for example,
    // `github-copilot/gpt-5.6-luna`); unlike Copilot, do not strip the prefix.
    const modelFlag = request.effectiveModel ? ["--model", request.effectiveModel] : [];
    const agentFlag = this.canSelectAgent(request) ? ["--agent", agent.name] : [];

    const prompt = [agentFlag.length === 0 ? inlinePersona(request) : "", request.instructions].filter(Boolean).join("\n\n");
    // `--dir` pins the project directory explicitly: `opencode run` resolves its
    // working directory from its parent process, not the child's spawn `cwd`, so
    // relying on `cwd: repoRoot` alone runs tasks in the wrong project when the
    // engine process lives in a subdirectory (e.g. the engine's own package dir).
    // With `--attach`, `--dir` names the project root on the remote server.
    const attachFlags = this.attachUrl ? ["--attach", this.attachUrl] : [];
    const args = ["run", ...modelFlag, ...agentFlag, "--dir", repoRoot, ...attachFlags, ...this.extraFlags, prompt];

    const result = await runCommand(this.bin, args, {
      cwd: repoRoot,
      timeoutMs: request.budget.timeoutMs,
      signal: request.signal,
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

  /**
   * True when opencode can select this agent natively: it must have a name and
   * its file must live under the project's `.opencode/agents/` directory - the
   * only harness root opencode scans for agent definitions. For `.agents`,
   * `.claude`, and `.github` roots the adapter falls back to inlining the
   * persona into the prompt. Set FORGE_ENGINE_NATIVE_AGENT=0
   * to force the inline-persona fallback even for `.opencode` agents.
   */
  private canSelectAgent({ agent, repoRoot }: TaskAttemptRequest): boolean {
    if (process.env["FORGE_ENGINE_NATIVE_AGENT"] === "0") return false;
    if (!agent.name) return false;
    const parts = relative(repoRoot, agent.path).split(/[\\/]/);
    return parts[0] === ".opencode" && parts[1] === "agents" && parts.length > 2;
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
