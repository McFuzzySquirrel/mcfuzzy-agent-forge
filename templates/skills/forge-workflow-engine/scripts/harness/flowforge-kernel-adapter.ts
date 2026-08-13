import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { AgentDescriptor, HarnessAdapter, ManifestTask, TaskResult, WorkflowState } from "../types.ts";

function resolveCompilerDir(repoRoot: string): string | null {
  const candidates = [
    join(repoRoot, ".agents", "skills", "forge-workforce-compiler"),
    join(repoRoot, ".github", "skills", "forge-workforce-compiler"),
    join(repoRoot, ".claude", "skills", "forge-workforce-compiler"),
    join(repoRoot, ".opencode", "skills", "forge-workforce-compiler"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export class FlowForgeKernelAdapter implements HarnessAdapter {
  readonly name = "flowforge-kernel";

  private readonly bin: string;
  private readonly extraFlags: string[];
  private readonly workflowId: string;
  private readonly commandArgsTemplate?: string;
  private readonly mockMode: boolean;
  private readonly validateBeforeRun: boolean;
  private readonly validatedRepos = new Set<string>();

  constructor() {
    this.bin = process.env["FLOWFORGE_KERNEL_BIN"] ?? "flowforge";
    this.extraFlags = (process.env["FLOWFORGE_KERNEL_EXTRA_FLAGS"] ?? "").split(/\s+/).filter(Boolean);
    this.workflowId = process.env["FLOWFORGE_WORKFLOW_ID"] ?? "forge-build";
    this.commandArgsTemplate = process.env["FLOWFORGE_KERNEL_COMMAND_ARGS_JSON"];
    this.mockMode = (process.env["FLOWFORGE_KERNEL_MOCK"] ?? "false").toLowerCase() === "true";
    this.validateBeforeRun = (process.env["FLOWFORGE_VALIDATE_WORKFORCE"] ?? "true").toLowerCase() !== "false";
  }

  async invoke(
    agent: AgentDescriptor,
    task: ManifestTask,
    _context: WorkflowState,
    repoRoot: string,
  ): Promise<TaskResult> {
    const start = Date.now();

    const workforcePath = this.resolveWorkforcePath(repoRoot);

    try {
      this.validatePackage(repoRoot, workforcePath);

      const args = this.buildArgs(repoRoot, workforcePath, task, agent);
      const stdout = execFileSync(this.bin, args, {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 10 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          FORGE_TASK_ID: task.id,
          FORGE_TASK_TITLE: task.title,
          FORGE_TASK_DESCRIPTION: task.description,
          FORGE_TASK_OWNER: agent.name,
          FORGE_TASK_EXPECTED_OUTPUTS: task.expectedOutputs.join(","),
        },
      });

      return {
        success: true,
        outputFiles: task.expectedOutputs,
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

  private buildArgs(repoRoot: string, workforcePath: string, task: ManifestTask, agent: AgentDescriptor): string[] {
    if (this.commandArgsTemplate) {
      let template: unknown;
      try {
        template = JSON.parse(this.commandArgsTemplate);
      } catch {
        throw new Error("FLOWFORGE_KERNEL_COMMAND_ARGS_JSON must be valid JSON.");
      }
      if (!Array.isArray(template) || template.some((item) => typeof item !== "string")) {
        throw new Error("FLOWFORGE_KERNEL_COMMAND_ARGS_JSON must be a JSON string array.");
      }

      return template.map((item) =>
        item
          .replaceAll("{repoRoot}", repoRoot)
          .replaceAll("{workforce}", workforcePath)
          .replaceAll("{workflow}", this.workflowId)
          .replaceAll("{taskId}", task.id)
          .replaceAll("{agent}", agent.name),
      );
    }

    const args = [
      "run",
      workforcePath,
      this.workflowId,
      ...this.extraFlags,
    ];
    if (this.mockMode) args.push("--mock");
    return args;
  }

  private validatePackage(repoRoot: string, workforcePath: string): void {
    if (!this.validateBeforeRun) return;
    if (this.validatedRepos.has(repoRoot)) return;

    const compilerDir = resolveCompilerDir(repoRoot);
    if (!compilerDir) {
      throw new Error("forge-workforce-compiler skill was not found. Install/bootstrap it before using flowforge-kernel harness.");
    }

    const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
    execFileSync(npmBin, ["run", "forge-workforce-compiler", "--", "validate", "--package", workforcePath], {
      cwd: compilerDir,
      encoding: "utf8",
      timeout: 2 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024,
    });

    this.validatedRepos.add(repoRoot);
  }

  private resolveWorkforcePath(repoRoot: string): string {
    if (process.env["FLOWFORGE_WORKFORCE_PATH"]) {
      return process.env["FLOWFORGE_WORKFORCE_PATH"]!;
    }

    const bridgePath = join(repoRoot, "docs", "KERNEL-BRIDGE.json");
    if (existsSync(bridgePath)) {
      try {
        const bridge = JSON.parse(readFileSync(bridgePath, "utf8")) as { workforcePath?: string };
        if (bridge.workforcePath) {
          return join(repoRoot, bridge.workforcePath);
        }
      } catch {
        // Ignore parse errors and fall through to explicit configuration error.
      }
    }

    throw new Error(
      "FLOWFORGE_WORKFORCE_PATH is not set and docs/KERNEL-BRIDGE.json did not provide workforcePath. Run forge-workforce-compiler -- compile first or set FLOWFORGE_WORKFORCE_PATH.",
    );
  }
}
