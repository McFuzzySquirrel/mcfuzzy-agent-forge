#!/usr/bin/env node
import { bootstrapCli } from "./bootstrap.ts";
import { engineRunCli } from "./engine-run.ts";
import { fail } from "./format.ts";
import { runLauncher } from "./launcher.ts";
import { PromptCancelled, prompts } from "./prompts.ts";

const USAGE = `forge-launcher - One command from zero to auto-build

Usage:
  forge-launcher [options]
  forge-launcher bootstrap [TARGET_DIR] [--harness agents|github|claude|opencode] [--force]
  forge-launcher engine-run [--repo <path>] [--harness <h>] [--concurrency <n>]
                            [--task-timeout-ms <ms>] [--yes] [--dry-run]

Launcher options:
  --non-interactive   Skip all interactive prompts (requires env vars; see docs/forge-launcher.md).
  --headless          Drive the queued skill directly from the terminal via
                      'opencode run --auto' or 'copilot -p --yolo' instead of opening a CLI.
  --draft             Pre-answer "yes" to the optional auto-draft stages (PRD and/or agent team).
  --dry-run           Print commands without executing them.
  -h, --help          Show this help.
`;

async function main(): Promise<number> {
  const args = process.argv.slice(2);

  // Subcommands
  if (args[0] === "bootstrap") return bootstrapCli(args.slice(1));
  if (args[0] === "engine-run") return engineRunCli(args.slice(1));
  if (args[0] === "help" || args[0] === "-h" || args[0] === "--help") {
    process.stdout.write(USAGE);
    return 0;
  }

  const opts = { nonInteractive: false, headless: false, draft: false, dryRun: false };
  for (const a of args) {
    switch (a) {
      case "--non-interactive": opts.nonInteractive = true; break;
      case "--headless":
      case "--run": opts.headless = true; break;
      case "--draft": opts.draft = true; break;
      case "--dry-run": opts.dryRun = true; break;
      default:
        fail(`Unknown option: ${a}`);
        process.stdout.write("\n" + USAGE);
        return 1;
    }
  }

  prompts.nonInteractive = opts.nonInteractive;
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
