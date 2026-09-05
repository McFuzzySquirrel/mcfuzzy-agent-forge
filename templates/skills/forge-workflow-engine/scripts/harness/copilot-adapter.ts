import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";

import { runCommand, extractModelFlags } from "./run.ts";
import type { HarnessAdapter, TaskAttemptRequest, TaskResult } from "../types.ts";
import { inlinePersona } from "../request.ts";

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
    const prompt = [native ? `/agent ${agent.name}` : inlinePersona(request), request.instructions].join("\n\n");
    const modelFlag = request.effectiveModel ? ["--model", stripProviderPrefix(request.effectiveModel)] : [];
    const args = ["-p", prompt, ...modelFlag, ...this.extraFlags];

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

  /**
   * True when the Copilot CLI can select this agent natively: it must have a
   * name and its file must live under the project's `.github/agents/` directory
   * - the only harness root Copilot scans for repo agent definitions. For
   * `.agents`, `.claude`, and `.opencode` roots the adapter falls back to
   * inlining the persona into the prompt. Set
   * FORGE_ENGINE_NATIVE_AGENT=0 to force the inline-persona fallback even for
   * `.github` agents.
   */
  private canSelectAgent({ agent, repoRoot }: TaskAttemptRequest): boolean {
    if (process.env["FORGE_ENGINE_NATIVE_AGENT"] === "0") return false;
    if (!agent.name) return false;
    const parts = relative(repoRoot, agent.path).split(/[\\/]/);
    return parts[0] === ".github" && parts[1] === "agents" && parts.length > 2;
  }
}

function stripProviderPrefix(model: string): string {
  return model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model;
}
