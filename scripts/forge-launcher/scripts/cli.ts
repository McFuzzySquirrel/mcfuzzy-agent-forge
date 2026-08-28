#!/usr/bin/env node
import { bootstrapCli } from "./bootstrap.ts";
import { engineRunCli } from "./engine-run.ts";
import { fail } from "./format.ts";
import { runLauncher, runResume } from "./launcher.ts";
import { PromptCancelled, prompts } from "./prompts.ts";
import { checkForUpdate, printUpdateNotice } from "./update-check.ts";

const USAGE = `forge-launcher - One command from zero to auto-build

Usage:
  forge-launcher [options]
  forge-launcher bootstrap [TARGET_DIR] [--harness agents|github|claude|opencode] [--force]
  forge-launcher engine-run [--repo <path>] [--harness <h>] [--granularity <fine|coarse>]
                            [--concurrency <n>] [--task-timeout-ms <ms>] [--max-retries <n>]
                            [--retry-delay-ms <ms>] [--heartbeat-ms <ms>] [--yes] [--dry-run]
                            [--viz [--viz-port <n>]] [--no-open]
                            [--keep-alive [--keep-alive-port <n>]] [--no-keep-alive] [--attach <url>]
  forge-launcher resume [--repo <path>] [--non-interactive] [--dry-run]

Launcher options:
  --non-interactive   Skip all interactive prompts (requires env vars; see docs/forge-launcher.md).
  --headless          Drive the queued skill directly from the terminal via
                      'opencode run --auto' or 'copilot -p --yolo' instead of opening a CLI.
  --draft             Pre-answer "yes" to the optional auto-draft stages (PRD and/or agent team).
  --dry-run           Print commands without executing them.
  --debug             Print the skill-run log tail after headless runs (also FORGE_LAUNCHER_DEBUG=1).
  --no-update-check   Skip the daily npm update check.
  -h, --help          Show this help.

Resume options:
  --repo <path>       Repository to resume (default: current directory).
  --non-interactive   Print current state and the exact next commands to run.
  --dry-run           Print what would run without executing.

Forge skills run with FORGE_HEADLESS=1 so their headless gate fires
deterministically. Set FORGE_RUN_WITH=stub (plus FORGE_STUB_NOOP=1) to run the
auto-draft stages offline against canned artifacts.
`;

async function main(): Promise<number> {
  const args = process.argv.slice(2);

  // Subcommands
  if (args[0] === "bootstrap") return bootstrapCli(args.slice(1));
  if (args[0] === "engine-run") return engineRunCli(args.slice(1));
  if (args[0] === "resume") {
    const opts = { repo: undefined as string | undefined, nonInteractive: false, dryRun: false };
    const rest = args.slice(1);
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === "--repo") opts.repo = rest[++i];
      else if (a === "--non-interactive") opts.nonInteractive = true;
      else if (a === "--dry-run") opts.dryRun = true;
      else if (a === "-h" || a === "--help") { process.stdout.write(USAGE); return 0; }
      else {
        fail(`Unknown option: ${a}`);
        process.stdout.write("\n" + USAGE);
        return 1;
      }
    }
    return runResume(opts);
  }
  if (args[0] === "help" || args[0] === "-h" || args[0] === "--help") {
    process.stdout.write(USAGE);
    return 0;
  }

  const opts = { nonInteractive: false, headless: false, draft: false, dryRun: false, noUpdateCheck: false };
  for (const a of args) {
    switch (a) {
      case "--non-interactive": opts.nonInteractive = true; break;
      case "--headless":
      case "--run": opts.headless = true; break;
      case "--draft": opts.draft = true; break;
      case "--dry-run": opts.dryRun = true; break;
      case "--debug": process.env.FORGE_LAUNCHER_DEBUG = "1"; break;
      case "--no-update-check": opts.noUpdateCheck = true; break;
      default:
        fail(`Unknown option: ${a}`);
        process.stdout.write("\n" + USAGE);
        return 1;
    }
  }

  prompts.nonInteractive = opts.nonInteractive;
  const update = await checkForUpdate({ skip: opts.noUpdateCheck });
  if (update) printUpdateNotice(update);
  return runLauncher(opts);
}

main().then((code) => {
  process.exitCode = code;
}).catch((err: unknown) => {
  if (err instanceof PromptCancelled) {
    process.stdout.write("\nCancelled.\n");
    process.exitCode = 130;
    return;
  }
  fail((err as Error).message);
  process.exitCode = 1;
});
