#!/usr/bin/env node
import path from "node:path";
import { bootstrapCli } from "./bootstrap.ts";
import { consoleCli } from "./console/cli.ts";
import { engineRunCli } from "./engine-run.ts";
import { fail } from "./format.ts";
import { runCompileManifest, runDraftExistingPrd, runDraftPrd, runDraftTeam, runDraftSkills, runFeaturePrd, runLauncher, runResume } from "./launcher.ts";
import { AUTHORING_STAGES, loadAuthoringConfig, saveAuthoringConfig, type AuthoringModels } from "./authoring-config.ts";
import { readAuthoringInventory, refreshAuthoringInventory } from "./authoring-inventory.ts";
import { detectRepoRoot } from "./paths.ts";
import { PromptCancelled, prompts } from "./prompts.ts";
import { checkForUpdate, printUpdateNotice } from "./update-check.ts";

const USAGE = `forge-launcher - One command from zero to auto-build

Usage:
  forge-launcher [options]
  forge-launcher bootstrap [TARGET_DIR] [--harness agents|github|claude|opencode] [--force] [--init-git]
  forge-launcher engine-run [--repo <path>] [--harness <h>] [--granularity <fine|coarse>]
                            [--concurrency <n>] [--task-timeout-ms <ms>] [--max-retries <n>]
                            [--retry-delay-ms <ms>] [--heartbeat-ms <ms>] [--yes] [--dry-run]
                            [--viz [--viz-port <n>]] [--no-open]
                            [--keep-alive [--keep-alive-port <n>]] [--no-keep-alive] [--attach <url>]
                            [--auto-commit|--no-auto-commit] [--commit-message-template <tmpl>]
                            [--stop] [--pause]
  forge-launcher resume [--repo <path>] [--non-interactive] [--dry-run]
  forge-launcher draft-prd [--repo <path>]      # headless: idea → PRD (Forge Console pipeline)
  forge-launcher draft-existing-prd [--repo <path>] # headless: existing repo → project PRD
  forge-launcher draft-team [--repo <path>]     # headless: PRD → agent team
  forge-launcher draft-skills [--repo <path>]   # headless: skill candidates → project skills
  forge-launcher authoring-config [--repo <path>] [--prd-model <id|inherit>] [--team-model <id|inherit>] [--skills-model <id|inherit>]
  forge-launcher authoring-models [--repo <path>] [--runner copilot|opencode] [--refresh]
  forge-launcher feature-prd [--repo <path>] [--prompt <text>] # author in docs/features/
  forge-launcher feature-increment [--repo <path>] [--prompt <text>] [--run] # author, update team, compile, optionally run
  forge-launcher compile-manifest [--repo <path>]  # headless: team → execution manifest

Launcher options:
  --prd-model <id|inherit>     Select the PRD authoring model.
  --team-model <id|inherit>    Select the team authoring model.
  --skills-model <id|inherit>  Select the skills authoring model.
  --non-interactive   Skip all interactive prompts (requires env vars; see docs/forge-launcher.md).
  --headless          Drive the queued skill directly from the terminal via
                      'opencode run --auto' or 'copilot -p --yolo' instead of opening a CLI.
  --draft             Pre-answer "yes" to the optional auto-draft stages (PRD and/or agent team).
  --dry-run           Print commands without executing them.
  --debug             Print the skill-run log tail after headless runs (also FORGE_LAUNCHER_DEBUG=1).
  --no-update-check   Skip the daily npm update check.
  -h, --help          Show this help.

Model flags are saved to docs/authoring-config.json when creating a project.
On draft/feature/resume subcommands they override only that invocation.

engine-run control:
  --stop              Stop a running detached engine after the current task
                      (writes docs/engine-control.json + SIGTERMs docs/engine.pid).
  --pause             Pause a running engine after the current task (same, no signal).

engine-run auto-commit:
  --auto-commit       Commit the working tree after each completed task (default: on).
  --no-auto-commit    Disable per-task auto-commit.
  --commit-message-template <tmpl>  Commit message with {taskId}/{taskTitle} placeholders.

Resume options:
  --repo <path>       Repository to resume (default: current directory).
  --non-interactive   Print current state and the exact next commands to run.
  --dry-run           Print what would run without executing.

Forge skills run with FORGE_HEADLESS=1 so their headless gate fires
deterministically. Set FORGE_RUN_WITH=stub (plus FORGE_STUB_NOOP=1) to run the
auto-draft stages offline against canned artifacts.
`;

async function main(): Promise<number> {
  const input = process.argv.slice(2);
  const args: string[] = [];
  const models: AuthoringModels = {};
  for (let i = 0; i < input.length; i++) {
    const argument = input[i]!;
    const stage = AUTHORING_STAGES.find((name) => argument === `--${name}-model`);
    if (!stage) { args.push(argument); continue; }
    const value = input[++i];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a model ID or inherit.`);
    models[stage] = value;
  }
  const authoringOptions = { models };

  if (args[0] === "authoring-config" || args[0] === "authoring-models") {
    let repo = detectRepoRoot();
    let runner: "copilot" | "opencode" = "opencode";
    let refresh = false;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--repo") {
        const value = args[++i];
        if (!value) throw new Error("--repo requires a path.");
        repo = path.resolve(value);
      } else if (args[i] === "--runner") {
        const value = args[++i];
        if (value !== "copilot" && value !== "opencode") throw new Error("--runner requires copilot or opencode.");
        runner = value;
      } else if (args[i] === "--refresh") refresh = true;
      else throw new Error(`Unknown option: ${args[i]}`);
    }
    if (args[0] === "authoring-models") {
      process.stdout.write(`${JSON.stringify(refresh ? await refreshAuthoringInventory(repo, runner) : readAuthoringInventory(repo), null, 2)}\n`);
    } else {
      const config = loadAuthoringConfig(repo);
      for (const stage of AUTHORING_STAGES) {
        if (models[stage] === "inherit") delete config.models[stage];
        else if (models[stage] !== undefined) config.models[stage] = models[stage];
      }
      process.stdout.write(`${JSON.stringify(Object.keys(models).length ? saveAuthoringConfig(repo, config) : config, null, 2)}\n`);
    }
    return 0;
  }

  // Subcommands
  if (args[0] === "bootstrap") return bootstrapCli(args.slice(1));
  if (args[0] === "console") return consoleCli(args.slice(1));
  if (args[0] === "engine-run") return engineRunCli(args.slice(1));
  if (args[0] === "draft-prd" || args[0] === "draft-existing-prd" || args[0] === "draft-team" || args[0] === "draft-skills" || args[0] === "compile-manifest" || args[0] === "feature-prd" || args[0] === "feature-increment") {
    let repo: string | undefined;
    let featurePrompt: string | undefined;
    let runIncrement = false;
    let dryRun = false;
    const rest = args.slice(1);
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === "--repo") {
        repo = rest[++i];
        if (!repo || repo.startsWith("--")) throw new Error("--repo requires a path.");
      }
      else if (a === "--prompt") {
        featurePrompt = rest[++i];
        if (!featurePrompt || featurePrompt.startsWith("--")) throw new Error("--prompt requires text.");
      }
      else if (a === "--run") runIncrement = true;
      else if (a === "--dry-run") dryRun = true;
      else if (a === "--non-interactive") { /* Authoring subcommands are already headless. */ }
      else if (a === "-h" || a === "--help") { process.stdout.write(USAGE); return 0; }
      else {
        fail(`Unknown option: ${a}`);
        process.stdout.write("\n" + USAGE);
        return 1;
      }
    }
    const repoDir = repo ? path.resolve(repo) : detectRepoRoot();
    const options = { ...authoringOptions, dryRun };
    if (args[0] === "draft-prd") return runDraftPrd(repoDir, options);
    if (args[0] === "draft-existing-prd") return runDraftExistingPrd(repoDir, options);
    if (args[0] === "draft-team") return runDraftTeam(repoDir, false, options);
    if (args[0] === "draft-skills") return runDraftSkills(repoDir, options);
    if (args[0] === "feature-prd") return runFeaturePrd(repoDir, featurePrompt, options);
    if (args[0] === "feature-increment") return (await import("./launcher.ts")).runFeatureIncrement(repoDir, featurePrompt, runIncrement, options);
    return runCompileManifest(repoDir, options);
  }
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
    return runResume({ ...opts, ...authoringOptions });
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
  return runLauncher({ ...opts, ...authoringOptions });
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
