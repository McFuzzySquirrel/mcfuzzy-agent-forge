import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { authoringArgv, type AuthoringInvocation } from "./authoring-inventory.ts";
import { selectAuthoringRunner, type AuthoringRunnerChoice } from "./authoring-config.ts";
import { command, fail, info, ok, out, runLogged, warn } from "./format.ts";
import { detectRepoRoot } from "./paths.ts";
import { selectHarnessRoot } from "./repo-metadata.ts";
import { resolveResources } from "./resources.ts";

const SKILL_NAME = "forge-retire-project";

export interface RetireOptions {
  repo?: string;
  apply?: boolean;
  archive?: boolean;
  keep?: string[];
  allowDirty?: boolean;
  commit?: boolean;
  runChecks?: boolean;
  dryRun?: boolean;
  runner?: string;
  env?: NodeJS.ProcessEnv;
  dependencies?: {
    runLogged?: typeof runLogged;
  };
}

function skillScripts(repo: string, harnessRoot: string): string | null {
  const installed = path.join(repo, harnessRoot, "skills", SKILL_NAME, "scripts");
  if (fs.existsSync(path.join(installed, "inventory.mjs"))) return installed;
  const bundled = path.join(resolveResources().templatesDir, "skills", SKILL_NAME, "scripts");
  return fs.existsSync(path.join(bundled, "inventory.mjs")) ? bundled : null;
}

function runNode(script: string, args: string[], repo: string, env: NodeJS.ProcessEnv): Promise<number> {
  return runLogged(process.execPath, [script, ...args], { cwd: repo, env }).then((result) => result.code);
}

function ensureSkillInstalled(repo: string, harnessRoot: string): string | null {
  const installed = path.join(repo, harnessRoot, "skills", SKILL_NAME);
  if (fs.existsSync(path.join(installed, "SKILL.md"))) return installed;
  const bundled = path.join(resolveResources().templatesDir, "skills", SKILL_NAME);
  if (!fs.existsSync(path.join(bundled, "SKILL.md"))) return null;
  fs.mkdirSync(path.dirname(installed), { recursive: true });
  fs.cpSync(bundled, installed, { recursive: true });
  warn(`Installed ${SKILL_NAME} temporarily from the Forge resources.`);
  return installed;
}

function retirementPrompt(repo: string, harnessRoot: string, options: RetireOptions): string {
  const flags = ["apply", `--repo ${JSON.stringify(repo)}`, `--harness-root ${harnessRoot}`];
  if (options.archive) flags.push("--archive");
  if (options.allowDirty) flags.push("--allow-dirty");
  for (const pattern of options.keep ?? []) flags.push(`--keep ${JSON.stringify(pattern)}`);
  return `/${SKILL_NAME} ${flags.join(" ")}`;
}

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function preflightApply(repo: string, allowDirty: boolean): string[] {
  const problems: string[] = [];
  const pidFile = path.join(repo, "docs", "engine.pid");
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        problems.push(`The Forge engine is still running (pid ${pid}). Stop it with 'forge-launcher engine-run --stop' first.`);
      } catch {
        // Stale pid file: not a gate.
      }
    }
  }
  const state = readJsonFile(path.join(repo, "docs", "WORKFLOW-STATE.json")) as { status?: unknown } | null;
  if (state && typeof state.status === "string" && ["running", "paused"].includes(state.status)) {
    problems.push(`Workflow state is '${state.status}'. Finish or stop the run before retiring the project.`);
  }
  if (!allowDirty) {
    try {
      const status = execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })
        .split("\n")
        .filter((line) => {
          const pathPart = line.slice(3).trim();
          if (!pathPart) return false;
          return !pathPart.startsWith(".forge-archive/") && !pathPart.includes(`skills/${SKILL_NAME}`);
        })
        .join("\n")
        .trim();
      if (status) problems.push("Working tree is not clean. Commit or stash first, or pass --allow-dirty.");
    } catch {
      problems.push("Could not read git status.");
    }
  }
  return problems;
}

function commitRetirement(repo: string): void {
  const status = execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }).trim();
  if (!status) {
    info("No changes to commit.");
    return;
  }
  execFileSync("git", ["add", "-A"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "chore: retire forge scaffolding and publish support team"], {
    cwd: repo,
    stdio: "inherit",
  });
  ok("Committed the retirement.");
}

async function runRepoChecks(repo: string, env: NodeJS.ProcessEnv, run: typeof runLogged): Promise<boolean> {
  const manifestPath = path.join(repo, "package.json");
  if (!fs.existsSync(manifestPath)) {
    warn("No package.json; skipping --run-checks.");
    return true;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { scripts?: Record<string, string> };
  const scripts = manifest.scripts ?? {};
  const order = ["typecheck", "lint", "test", "build"];
  const selected = order.filter((name) => typeof scripts[name] === "string");
  if (selected.length === 0) {
    warn("No typecheck, lint, test, or build scripts; skipping --run-checks.");
    return true;
  }
  for (const name of selected) {
    out(`Running npm run ${name} …`);
    const result = await run("npm", ["run", name], { cwd: repo, env });
    if (result.code !== 0) {
      fail(`npm run ${name} failed with exit code ${result.code}.`);
      return false;
    }
  }
  ok("Repository checks passed.");
  return true;
}

/**
 * Retires Forge scaffolding from a completed repository.
 *
 * Without `--apply` this is a deterministic, read-only inventory. With
 * `--apply` it installs the retirement skill when necessary, invokes the
 * configured harness runner once, verifies the result from a temporary copy of
 * the scripts, optionally runs repository checks, and optionally commits.
 */
export async function runRetire(options: RetireOptions = {}): Promise<number> {
  const env = options.env ?? process.env;
  const repo = path.resolve(options.repo ?? detectRepoRoot());
  const run = options.dependencies?.runLogged ?? runLogged;

  if (!fs.existsSync(path.join(repo, ".git"))) {
    fail(`Not a git repository: ${repo}`);
    return 1;
  }

  const selected = selectHarnessRoot(repo);
  if (!selected.root) {
    fail("No harness root found (.agents, .opencode, .claude, or .github).");
    return 1;
  }
  for (const warning of selected.warnings) warn(warning);
  const harnessRoot = selected.root;

  const apply = options.apply === true && options.dryRun !== true;
  if (apply) {
    const problems = preflightApply(repo, options.allowDirty === true);
    if (problems.length > 0) {
      for (const problem of problems) fail(problem);
      return 1;
    }
  }
  const preview = skillScripts(repo, harnessRoot);
  if (!preview) {
    fail(`Bundled ${SKILL_NAME} scripts were not found. Reinstall forge-launcher or add the skill manually.`);
    return 1;
  }

  if (!apply) {
    const inventoryArgs = ["--repo", repo, "--harness-root", harnessRoot];
    for (const pattern of options.keep ?? []) inventoryArgs.push("--keep", pattern);
    out("Dry run: building the retirement inventory. No files will be changed.");
    command(`node ${path.join(preview, "inventory.mjs")} ${inventoryArgs.join(" ")}`);
    return runNode(path.join(preview, "inventory.mjs"), inventoryArgs, repo, env);
  }

  const installed = ensureSkillInstalled(repo, harnessRoot);
  if (!installed) {
    fail(`Could not install ${SKILL_NAME} into ${harnessRoot}/skills.`);
    return 1;
  }

  // Keep a verification copy outside the skill directory: the skill removes
  // itself only after its own verification passes, so a post-run gate needs an
  // independent copy.
  const verifyRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${SKILL_NAME}-verify-`));
  const verifyScripts = path.join(verifyRoot, "scripts");
  fs.cpSync(path.join(installed, "scripts"), verifyScripts, { recursive: true });

  try {
    const selection = selectAuthoringRunner(repo, harnessRoot, { runner: options.runner as AuthoringRunnerChoice | undefined }, env);
    if (selection.runner === "stub") {
      fail("The retirement skill needs a real harness runner; FORGE_RUN_WITH=stub is not supported.");
      return 1;
    }
    const invocation: AuthoringInvocation = { runner: selection.runner, source: "inherit" };
    const prompt = retirementPrompt(repo, harnessRoot, options);
    const args = authoringArgv(invocation, repo, prompt);
    out(`Running ${selection.runner} to retire the project …`);
    const result = await run(selection.runner, args, { cwd: repo, env: { ...env, FORGE_HEADLESS: "1" } });
    if (result.code !== 0) {
      fail(`Retirement skill exited with code ${result.code}.`);
      return result.code;
    }

    const verifyArgs = ["--repo", repo, "--harness-root", harnessRoot, "--strict-coverage"];
    for (const pattern of options.keep ?? []) verifyArgs.push("--keep", pattern);
    const verified = await runNode(path.join(verifyScripts, "verify.mjs"), verifyArgs, repo, env);
    if (verified !== 0) {
      fail("Post-retirement verification failed. Inspect the errors above before committing.");
      return verified;
    }
    ok("Retirement verification passed.");

    // The skill removes itself as its final step. If the harness skipped that
    // (or the skill was pre-installed), finish the job from the independent
    // copy so a successful retirement never leaves the skill behind.
    const installedSkill = path.join(repo, harnessRoot, "skills", SKILL_NAME);
    if (fs.existsSync(installedSkill)) {
      await runNode(path.join(verifyScripts, "self-delete.mjs"), ["--repo", repo, "--finalize", "--skill-dir", installedSkill], repo, env);
    }

    if (options.runChecks && !(await runRepoChecks(repo, env, run))) return 1;
    if (options.commit) commitRetirement(repo);
    else info("Changes are uncommitted. Review them and commit when satisfied.");
    return 0;
  } finally {
    fs.rmSync(verifyRoot, { recursive: true, force: true });
  }
}
