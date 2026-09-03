#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { compileExecutionManifestDetailed } from "./compiler.ts";
import { detectRepoRoot, discoverForgeRepo } from "./discovery.ts";
import { appendAuditEvent, checkpointTask, parseProgress, writeProgress } from "./progress.ts";
import type { ExecutionManifest } from "./types.ts";

function usage(): never {
  console.log(`forge-execution-adapter

Usage:
  npm run forge-execution-adapter -- inspect [--repo <path>]
  npm run forge-execution-adapter -- compile [--repo <path>] [--output <path>] [--granularity <coarse|fine>]
  npm run forge-execution-adapter -- status [--repo <path>] [--manifest <path>]
  npm run forge-execution-adapter -- checkpoint --complete <task-id> [--repo <path>] [--manifest <path>] [--files <a,b>] [--note <text>]

--granularity <coarse|fine>   Task decomposition granularity (default: fine).
                              fine = expand sub-bullets and split oversized bullets
                              into smaller chained tasks; coarse = one task per bullet.
`);
  process.exit(1);
}

function flag(args: string[], name: string): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === name) return args[index + 1];
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return undefined;
}

function repoRootFrom(args: string[]): string {
  const repo = flag(args, "--repo");
  return detectRepoRoot(repo ? resolve(repo) : process.cwd());
}

function loadManifest(path: string): ExecutionManifest {
  return JSON.parse(readFileSync(path, "utf8")) as ExecutionManifest;
}

function main() {
  const [, , command, ...args] = process.argv;
  if (!command) usage();

  const repoRoot = repoRootFrom(args);

  switch (command) {
    case "inspect": {
      const repo = discoverForgeRepo(repoRoot);
      console.log(JSON.stringify({
        repoRoot: repo.repoRoot,
        harnessRoot: repo.harnessRoot,
        prdPath: repo.prdPath,
        progressPath: repo.progressPath,
        manifestPath: repo.manifestPath,
        agents: repo.agents.map((agent) => ({ name: agent.name, path: agent.path })),
        skills: repo.skills.map((skill) => ({ name: skill.name, path: skill.path })),
        warnings: repo.warnings,
      }, null, 2));
      break;
    }

    case "compile": {
      const repo = discoverForgeRepo(repoRoot);
      const oldManifest = existsSync(repo.manifestPath) ? loadManifest(repo.manifestPath) : undefined;
      const granularityArg = flag(args, "--granularity");
      const granularity = granularityArg === "coarse" ? "coarse" : "fine";
      const { manifest, matrix, validation } = compileExecutionManifestDetailed(repo, { granularity });

      const matrixPath = join(repo.repoRoot, "docs", "agent-responsibility-matrix.md");
      mkdirSync(dirname(matrixPath), { recursive: true });
      writeFileSync(matrixPath, matrix, "utf8");
      manifest.responsibilityMatrixPath = matrixPath;

      const output = resolve(flag(args, "--output") ?? repo.manifestPath);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      if (oldManifest && resolve(output) === resolve(repo.manifestPath) && existsSync(repo.progressPath)) {
        const progress = parseProgress(repo.progressPath, oldManifest);
        writeProgress(repo.progressPath, manifest, progress);
      }
      appendAuditEvent(repo.auditPath, { timestamp: new Date().toISOString(), action: "manifest.compiled", note: output });
      console.log(`Wrote execution manifest to ${output}`);
      console.log(`Wrote responsibility matrix to ${matrixPath}`);

      console.log(`Team validation: ${validation.unassignedTasks.length} unassigned, ${validation.duplicateFileOwners.length} duplicate file owners, ${validation.orphanAgents.length} orphan agents`);
      if (manifest.warnings.length > 0) {
        console.log(`Warnings (${manifest.warnings.length}):`);
        for (const warning of manifest.warnings) console.log(`- ${warning}`);
      }
      break;
    }

    case "status": {
      const repo = discoverForgeRepo(repoRoot);
      const manifestPath = resolve(flag(args, "--manifest") ?? repo.manifestPath);
      const manifest = loadManifest(manifestPath);
      const progress = parseProgress(repo.progressPath, manifest);
      console.log(JSON.stringify({
        manifestPath,
        phase: progress.phase,
        status: progress.status,
        currentTaskId: progress.currentTaskId,
        completedTasks: progress.completed.length,
        blockers: progress.blockers,
        notes: progress.notes,
      }, null, 2));
      break;
    }

    case "checkpoint": {
      const complete = flag(args, "--complete");
      if (!complete) usage();
      const repo = discoverForgeRepo(repoRoot);
      const manifestPath = resolve(flag(args, "--manifest") ?? repo.manifestPath);
      const manifest = loadManifest(manifestPath);
      const progress = parseProgress(repo.progressPath, manifest);
      const files = (flag(args, "--files") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
      const note = flag(args, "--note");
      const next = checkpointTask(manifest, progress, complete, files, note);
      writeProgress(repo.progressPath, manifest, next);
      appendAuditEvent(repo.auditPath, {
        timestamp: new Date().toISOString(),
        action: "task.checkpointed",
        taskId: complete,
        files,
        note,
      });
      console.log(`Checkpointed task ${complete}`);
      break;
    }

    default:
      usage();
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
