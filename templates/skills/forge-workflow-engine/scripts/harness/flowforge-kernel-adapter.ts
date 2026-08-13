import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { AgentDescriptor, HarnessAdapter, ManifestTask, TaskResult, WorkflowState } from "../types.ts";

function shellQuote(value: string): string {
  return value.includes(" ") ? `"${value.replace(/"/g, "\\\"")}"` : value;
}

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
  private readonly commandTemplate?: string;
  private readonly validateBeforeRun: boolean;
  private readonly validatedRepos = new Set<string>();

  constructor() {
    this.bin = process.env["FLOWFORGE_KERNEL_BIN"] ?? "flowforge";
    this.extraFlags = (process.env["FLOWFORGE_KERNEL_EXTRA_FLAGS"] ?? "").split(/\s+/).filter(Boolean);
    this.workflowId = process.env["FLOWFORGE_WORKFLOW_ID"] ?? "forge-build";
    this.commandTemplate = process.env["FLOWFORGE_KERNEL_COMMAND_TEMPLATE"];
    this.validateBeforeRun = (process.env["FLOWFORGE_VALIDATE_WORKFORCE"] ?? "true").toLowerCase() !== "false";
  }

  async invoke(
    agent: AgentDescriptor,
    task: ManifestTask,
    _context: WorkflowState,
    repoRoot: string,
  ): Promise<TaskResult> {
    const start = Date.now();

    const workforcePath = process.env["FLOWFORGE_WORKFORCE_PATH"]
      ?? join(repoRoot, "dist", "dev-agent-forge-project.workforce");

    try {
      this.validatePackage(repoRoot, workforcePath);

      const command = this.buildCommand(repoRoot, workforcePath, task, agent);
      const stdout = execSync(command, {
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

  private buildCommand(repoRoot: string, workforcePath: string, task: ManifestTask, agent: AgentDescriptor): string {
    if (this.commandTemplate) {
      return this.commandTemplate
        .replaceAll("{bin}", this.bin)
        .replaceAll("{repoRoot}", repoRoot)
        .replaceAll("{workforce}", workforcePath)
        .replaceAll("{workflow}", this.workflowId)
        .replaceAll("{taskId}", task.id)
        .replaceAll("{agent}", agent.name);
    }

    const args = [
      this.bin,
      "run",
      workforcePath,
      this.workflowId,
      "--mock",
      ...this.extraFlags,
    ];

    return args.map(shellQuote).join(" ");
  }

  private validatePackage(repoRoot: string, workforcePath: string): void {
    if (!this.validateBeforeRun) return;
    if (this.validatedRepos.has(repoRoot)) return;

    const compilerDir = resolveCompilerDir(repoRoot);
    if (!compilerDir) {
      throw new Error("forge-workforce-compiler skill was not found. Install/bootstrap it before using flowforge-kernel harness.");
    }

    const cmd = `npm run forge-workforce-compiler -- validate --package ${shellQuote(workforcePath)}`;
    execSync(cmd, {
      cwd: compilerDir,
      encoding: "utf8",
      timeout: 2 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024,
    });

    this.validatedRepos.add(repoRoot);
  }
}
