#!/usr/bin/env node
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { compileWorkforcePackage } from "./compiler.ts";
import { detectRepoRoot, discoverForgeRepo } from "./discovery.ts";
import { validateWorkforcePackage } from "./validator.ts";

function usage(): never {
  console.log(`forge-workforce-compiler

Usage:
  npm run forge-workforce-compiler -- inspect [--repo <path>]
  npm run forge-workforce-compiler -- compile [--repo <path>] [--output-dir <path>] [--package-id <id>] [--name <name>] [--version <semver>] [--workflow-id <id>]
  npm run forge-workforce-compiler -- validate [--repo <path>] [--package <path>]
`);
  process.exit(1);
}

function flag(args: string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === name) return args[i + 1];
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return undefined;
}

function repoRootFrom(args: string[]): string {
  const value = flag(args, "--repo");
  return detectRepoRoot(value ? resolve(value) : process.cwd());
}

function defaultWorkforcePath(repoRoot: string): string {
  const dist = join(repoRoot, "dist");
  if (!existsSync(dist)) return join(dist, "dev-agent-forge-project.workforce");
  const match = readdirSync(dist).find((entry) => entry.endsWith(".workforce"));
  return join(dist, match ?? "dev-agent-forge-project.workforce");
}

function main(): void {
  const [, , command, ...args] = process.argv;
  if (!command) usage();

  const repoRoot = repoRootFrom(args);

  switch (command) {
    case "inspect": {
      const repo = discoverForgeRepo(repoRoot);
      console.log(JSON.stringify({
        repoRoot: repo.repoRoot,
        harnessRoot: repo.harnessRoot,
        manifestPath: repo.manifestPath,
        agentCount: repo.agents.length,
        skillCount: repo.skills.length,
        warnings: repo.warnings,
      }, null, 2));
      break;
    }

    case "compile": {
      const repo = discoverForgeRepo(repoRoot);
      const result = compileWorkforcePackage(repo, {
        outputDir: flag(args, "--output-dir"),
        packageId: flag(args, "--package-id"),
        packageName: flag(args, "--name"),
        packageVersion: flag(args, "--version"),
        workflowId: flag(args, "--workflow-id"),
      });

      console.log(`Wrote workforce package to ${result.workforceDir}`);
      console.log(`Wrote workflow definition to ${result.workflowPath}`);
      console.log(`Wrote kernel bridge file to ${result.bridgePath}`);

      if (result.warnings.length > 0) {
        console.log(`Warnings (${result.warnings.length}):`);
        for (const warning of result.warnings) console.log(`- ${warning}`);
      }

      const validation = validateWorkforcePackage(result.workforceDir);
      if (!validation.ok) {
        console.error("\nValidation failed:");
        for (const error of validation.errors) {
          console.error(`- ${error.path}: ${error.message}`);
        }
        process.exit(2);
      }

      console.log("FlowForge-compatible validation passed.");
      break;
    }

    case "validate": {
      const packagePath = resolve(flag(args, "--package") ?? defaultWorkforcePath(repoRoot));
      const validation = validateWorkforcePackage(packagePath);

      console.log(JSON.stringify({
        packagePath,
        ok: validation.ok,
        errorCount: validation.errors.length,
        warningCount: validation.warnings.length,
      }, null, 2));

      if (validation.errors.length > 0) {
        for (const error of validation.errors) {
          console.error(`- ${error.path}: ${error.message}`);
        }
        process.exit(2);
      }
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
