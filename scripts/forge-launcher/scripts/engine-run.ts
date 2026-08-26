import fs from "node:fs";
import path from "node:path";
import { out } from "./format.ts";
import { runCommand } from "./format.ts";
import { detectRepoRoot } from "./paths.ts";

export interface EngineRunOptions {
  repo?: string;
  harness?: string;
  concurrency?: string;
  taskTimeoutMs?: string;
  yes?: boolean;
  dryRun?: boolean;
}

const HARNESS_ROOTS = [".agents", ".opencode", ".claude", ".github"];

function run(cmd: string, args: string[], dryRun: boolean, cwd: string): Promise<number> {
  if (dryRun) {
    out(`  [dry-run] ${cmd} ${args.join(" ")}`);
    return Promise.resolve(0);
  }
  return runCommand(cmd, args, { cwd }).then((r) => r.code);
}

export async function engineRun(opts: EngineRunOptions = {}): Promise<number> {
  const harness = opts.harness ?? process.env.FORGE_ENGINE_HARNESS ?? "opencode";
  const concurrency = opts.concurrency ?? process.env.FORGE_ENGINE_CONCURRENCY ?? "";
  const taskTimeoutMs = opts.taskTimeoutMs ?? process.env.FORGE_ENGINE_TASK_TIMEOUT_MS ?? "";
  const yes = opts.yes ?? process.env.FORGE_ENGINE_YES === "1";
  const dryRun = opts.dryRun ?? false;

  const repo = opts.repo
    ? path.resolve(opts.repo)
    : detectRepoRoot();
  if (!fs.existsSync(path.join(repo, ".git"))) {
    throw new Error(`Error: not a git repository: ${repo}`);
  }

  let engineDir = "";
  let adapterDir = "";
  for (const root of HARNESS_ROOTS) {
    if (fs.existsSync(path.join(repo, root, "skills", "forge-workflow-engine"))) {
      engineDir = path.join(repo, root, "skills", "forge-workflow-engine");
    }
    if (fs.existsSync(path.join(repo, root, "skills", "forge-execution-adapter"))) {
      adapterDir = path.join(repo, root, "skills", "forge-execution-adapter");
    }
    if (engineDir && adapterDir) break;
  }

  if (!engineDir) {
    throw new Error(
      `Error: forge-workflow-engine not found under ${repo} (looked in .agents/.opencode/.claude/.github skills dirs).`,
    );
  }

  const manifest = path.join(repo, "docs", "EXECUTION-MANIFEST.json");

  out(`forge-engine-run: repo=${repo} harness=${harness}${concurrency ? ` concurrency=${concurrency}` : ""}${taskTimeoutMs ? ` task-timeout=${taskTimeoutMs}` : ""}`);
  out(`  engine : ${engineDir}`);
  out(`  adapter: ${adapterDir || "<not bootstrapped; manifest must already exist>"}`);

  // 1. Prepare: install the execution adapter (if present) and compile the manifest.
  if (adapterDir && !fs.existsSync(manifest)) {
    await run("npm", ["install"], dryRun, adapterDir);
    await run("npm", ["run", "forge-execution-adapter", "--", "compile"], dryRun, adapterDir);
  } else if (adapterDir) {
    await run("npm", ["install"], dryRun, adapterDir);
  }

  if (fs.existsSync(manifest)) {
    out(`  manifest: ${manifest} (exists)`);
  } else {
    if (dryRun) {
      out(`  manifest: ${manifest} (will be compiled by the adapter step above)`);
    } else {
      throw new Error(
        `Error: ${manifest} not found. Compile it via forge-execution-adapter (or bootstrapped adapter + run again).`,
      );
    }
  }

  // 2. Install engine dependencies.
  await run("npm", ["install"], dryRun, engineDir);

  // 3. Run the engine as a foreground, standalone process.
  const engineFlags = ["--harness", harness];
  if (concurrency) engineFlags.push("--concurrency", concurrency);
  if (taskTimeoutMs) engineFlags.push("--task-timeout-ms", taskTimeoutMs);
  if (yes) engineFlags.push("--yes");

  if (dryRun) {
    out(`  [dry-run] (cd '${engineDir}' && npm run workflow-engine -- run ${engineFlags.join(" ")})`);
    return 0;
  }
  return run("npm", ["run", "workflow-engine", "--", "run", ...engineFlags], dryRun, engineDir);
}

export function engineRunCli(args: string[]): Promise<number> {
  const opts: EngineRunOptions = {};
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case "--repo": opts.repo = args[++i]; break;
      case "--harness": opts.harness = args[++i]; break;
      case "--concurrency": opts.concurrency = args[++i]; break;
      case "--task-timeout-ms": opts.taskTimeoutMs = args[++i]; break;
      case "--yes": opts.yes = true; break;
      case "--dry-run": opts.dryRun = true; break;
      default: throw new Error(`Unknown option: ${a}`);
    }
  }
  return engineRun(opts);
}
