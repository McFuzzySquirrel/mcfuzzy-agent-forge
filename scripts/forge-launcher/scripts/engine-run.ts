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
  granularity?: string;
  maxRetries?: string;
  retryDelayMs?: string;
  heartbeatMs?: string;
  yes?: boolean;
  dryRun?: boolean;
  viz?: boolean;
  vizPort?: string;
  noOpen?: boolean;
  keepAlive?: boolean;
  keepAlivePort?: string;
  noKeepAlive?: boolean;
  attach?: string;
  allowNoop?: boolean;
  runValidation?: boolean;
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
  const granularity = opts.granularity ?? process.env.FORGE_ENGINE_GRANULARITY ?? "";
  const maxRetries = opts.maxRetries ?? process.env.FORGE_ENGINE_MAX_RETRIES ?? "";
  const retryDelayMs = opts.retryDelayMs ?? process.env.FORGE_ENGINE_RETRY_DELAY_MS ?? "";
  const heartbeatMs = opts.heartbeatMs ?? process.env.FORGE_ENGINE_HEARTBEAT_MS ?? "";
  const yes = opts.yes ?? process.env.FORGE_ENGINE_YES === "1";
  const dryRun = opts.dryRun ?? false;
  const viz = opts.viz ?? process.env.FORGE_ENGINE_VIZ === "1";
  const vizPort = opts.vizPort ?? process.env.FORGE_ENGINE_VIZ_PORT ?? "";
  const noOpen = opts.noOpen ?? false;
  const keepAlive = opts.keepAlive ?? process.env.FORGE_ENGINE_ATTACH === "1";
  const keepAlivePort = opts.keepAlivePort ?? "";
  const noKeepAlive = opts.noKeepAlive ?? process.env.FORGE_ENGINE_ATTACH === "0";
  const attach = opts.attach ?? process.env.FORGE_ENGINE_ATTACH_URL ?? "";
  const allowNoop = opts.allowNoop ?? process.env.FORGE_ENGINE_ALLOW_NOOP === "1";
  const runValidation = opts.runValidation ?? process.env.FORGE_ENGINE_RUN_VALIDATION === "1";

  if (granularity && granularity !== "fine" && granularity !== "coarse") {
    throw new Error(`Invalid --granularity '${granularity}'. Choose 'fine' or 'coarse'.`);
  }

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

  out(`forge-engine-run: repo=${repo} harness=${harness}${granularity ? ` granularity=${granularity}` : ""}${concurrency ? ` concurrency=${concurrency}` : ""}${taskTimeoutMs ? ` task-timeout=${taskTimeoutMs}` : ""}${maxRetries ? ` max-retries=${maxRetries}` : ""}${viz ? ` viz=${vizPort || "default"}` : ""}${keepAlive ? ` keep-alive${keepAlivePort ? `=${keepAlivePort}` : ""}` : ""}${noKeepAlive ? ` no-keep-alive` : ""}${attach ? ` attach=${attach}` : ""}`);
  out(`  engine : ${engineDir}`);
  out(`  adapter: ${adapterDir || "<not bootstrapped; manifest must already exist>"}`);

  // 1. Prepare: install the execution adapter (if present) and compile the
  //    manifest. Recompile whenever --granularity is set explicitly so a changed
  //    granularity takes effect even when a manifest already exists.
  const recompile = granularity !== "";
  if (adapterDir) {
    await run("npm", ["install"], dryRun, adapterDir);
    if (!fs.existsSync(manifest) || recompile) {
      const compileArgs = ["run", "forge-execution-adapter", "--", "compile"];
      if (granularity) compileArgs.push("--granularity", granularity);
      const code = await run("npm", compileArgs, dryRun, adapterDir);
      if (code !== 0) {
        // Fail fast with the compiler's own output instead of continuing on to
        // a confusing "manifest not found" error.
        throw new Error(
          `Execution-manifest compile failed (exit ${code}). Fix the errors above (often unquoted YAML frontmatter in a generated agent/skill file), then run the engine again.`,
        );
      }
      if (recompile && fs.existsSync(path.join(repo, "docs", "WORKFLOW-STATE.json"))) {
        out("  Note: manifest recompiled with a new granularity. If a previous engine run is in progress, remove docs/WORKFLOW-STATE.json before the next fresh run.");
      }
    }
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
  if (maxRetries) engineFlags.push("--max-retries", maxRetries);
  if (retryDelayMs) engineFlags.push("--retry-delay-ms", retryDelayMs);
  if (heartbeatMs) engineFlags.push("--heartbeat-ms", heartbeatMs);
  if (yes) engineFlags.push("--yes");
  if (viz) engineFlags.push(vizPort ? `--viz=${vizPort}` : "--viz");
  if (noOpen) engineFlags.push("--no-open");
  if (keepAlive) engineFlags.push("--keep-alive");
  if (keepAlivePort) engineFlags.push("--keep-alive-port", keepAlivePort);
  if (noKeepAlive) engineFlags.push("--no-keep-alive");
  if (attach) engineFlags.push("--attach", attach);
  if (allowNoop) engineFlags.push("--allow-noop");
  if (runValidation) engineFlags.push("--run-validation");

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
      case "--granularity": opts.granularity = args[++i]; break;
      case "--max-retries": opts.maxRetries = args[++i]; break;
      case "--retry-delay-ms": opts.retryDelayMs = args[++i]; break;
      case "--heartbeat-ms": opts.heartbeatMs = args[++i]; break;
      case "--yes": opts.yes = true; break;
      case "--dry-run": opts.dryRun = true; break;
      case "--viz": opts.viz = true; break;
      case "--viz-port": opts.vizPort = args[++i]; break;
      case "--no-open": opts.noOpen = true; break;
      case "--keep-alive": opts.keepAlive = true; break;
      case "--keep-alive-port": opts.keepAlivePort = args[++i]; break;
      case "--no-keep-alive": opts.noKeepAlive = true; break;
      case "--attach": opts.attach = args[++i]; break;
      case "--allow-noop": opts.allowNoop = true; break;
      case "--run-validation": opts.runValidation = true; break;
      default: throw new Error(`Unknown option: ${a}`);
    }
  }
  return engineRun(opts);
}
