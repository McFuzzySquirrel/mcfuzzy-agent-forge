import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { classify, coverage, globToRegExp, extractScopePaths } from "./lib.mjs";

const INVENTORY = fileURLToPath(new URL("./inventory.mjs", import.meta.url));
const APPLY = fileURLToPath(new URL("./apply.mjs", import.meta.url));
const VERIFY = fileURLToPath(new URL("./verify.mjs", import.meta.url));
const SELF_DELETE = fileURLToPath(new URL("./self-delete.mjs", import.meta.url));
const SKILL_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "forge-retire-"));
  fs.mkdirSync(path.join(repo, "docs", "features"), { recursive: true });
  fs.mkdirSync(path.join(repo, "docs", "adr"), { recursive: true });
  fs.mkdirSync(path.join(repo, "src", "api"), { recursive: true });
  fs.mkdirSync(path.join(repo, "src", "ui"), { recursive: true });
  fs.mkdirSync(path.join(repo, ".agents", "agents"), { recursive: true });
  fs.mkdirSync(path.join(repo, ".agents", "skills", "forge-build-prd"), { recursive: true });
  fs.mkdirSync(path.join(repo, ".agents", "skills", "my-project-skill"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "api", "index.ts"), "export const api = 1;\n");
  fs.writeFileSync(path.join(repo, "src", "ui", "app.ts"), "export const app = 1;\n");
  fs.writeFileSync(path.join(repo, "docs", "PRD.md"), "# PRD\n");
  fs.writeFileSync(path.join(repo, "docs", "features", "core.md"), "# Core\n");
  fs.writeFileSync(path.join(repo, "docs", "PROGRESS.md"), "# Progress\n");
  fs.writeFileSync(path.join(repo, "docs", "engine-run.log"), "running\n");
  fs.writeFileSync(path.join(repo, "docs", "adr", "001-history.md"), "See docs/PRD.md for history.\n");
  fs.writeFileSync(path.join(repo, ".agents", "agents", "project-orchestrator.md"), "---\nname: project-orchestrator\ndescription: \"Builds phases from docs/PRD.md\"\nmode: all\n---\n\n## Key Reference\n\n- docs/PRD.md\n");
  fs.writeFileSync(path.join(repo, ".agents", "agents", "game-engineer.md"), "---\nname: game-engineer\ndescription: \"Owns game systems\"\nmode: all\n---\n\n## Responsibilities\n\n- src/ui\n");
  fs.writeFileSync(path.join(repo, ".agents", "agents", "forge-team-builder.md"), "---\nname: forge-team-builder\ndescription: \"Builds teams\"\n---\n");
  fs.writeFileSync(path.join(repo, ".agents", "agents", "workflow-orchestrator.md"), "---\nname: workflow-orchestrator\ndescription: \"Runs the engine\"\n---\n");
  fs.writeFileSync(path.join(repo, ".agents", "skills", "forge-build-prd", "SKILL.md"), "---\nname: forge-build-prd\ndescription: \"Authors a PRD\"\n---\n");
  fs.writeFileSync(path.join(repo, ".agents", "skills", "my-project-skill", "SKILL.md"), "---\nname: my-project-skill\ndescription: \"Project procedure\"\n---\n");
  fs.writeFileSync(
    path.join(repo, "docs", "SKILL-CANDIDATES.json"),
    JSON.stringify({ version: 1, candidates: [{ name: "my-project-skill", description: "x", consumers: ["game-engineer"], action: "create", reason: "repeatable" }] }),
  );
  fs.writeFileSync(path.join(repo, "README.md"), "# Project\n\nSee docs/PRD.md for requirements.\n");
  fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules/\ndocs/engine-run.log\ndocs/artifacts/\n");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], { cwd: repo });
  return repo;
}

function cleanRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "forge-retire-clean-"));
  fs.mkdirSync(path.join(repo, "src", "api"), { recursive: true });
  fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
  fs.mkdirSync(path.join(repo, ".agents", "agents"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "api", "index.ts"), "export const api = 1;\n");
  fs.writeFileSync(path.join(repo, "README.md"), "# Project\n");
  fs.writeFileSync(
    path.join(repo, "docs", "SUPPORT.md"),
    "# Support\n\n| Agent | Scope |\n|---|---|\n| support-lead | triage |\n| api-engineer | src/api |\n",
  );
  fs.writeFileSync(
    path.join(repo, ".agents", "agents", "support-lead.md"),
    '---\nname: support-lead\ndescription: "Coordinates support triage and releases."\nmode: all\n---\n\n## Scope\n\n- `docs/`\n\n## Triage and Escalation\n\nRoute work to api-engineer.\n',
  );
  fs.writeFileSync(
    path.join(repo, ".agents", "agents", "api-engineer.md"),
    '---\nname: api-engineer\ndescription: "Maintains the API surface."\nmode: all\n---\n\n## Scope\n\n- `src/api`\n\n## Support Responsibilities\n\nFix defects and add regression tests.\n',
  );
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], { cwd: repo });
  return repo;
}

test("inventory classifies Forge artifacts, protected project skills, and rewrites", () => {
  const repo = makeRepo();
  const plan = classify(repo);
  const deleted = new Set(plan.deletions.map((item) => item.path));
  assert.ok(deleted.has("docs/PRD.md"));
  assert.ok(deleted.has("docs/features"));
  assert.ok(deleted.has("docs/PROGRESS.md"));
  assert.ok(deleted.has(".agents/skills/forge-build-prd"));
  assert.ok(deleted.has(".agents/agents/forge-team-builder.md"));
  assert.ok(!deleted.has(".agents/skills/my-project-skill"), "candidate project skill must survive");
  assert.ok(!deleted.has("docs/adr/001-history.md"), "historical docs must survive");
  assert.equal(plan.rewrites.supportLead, ".agents/agents/project-orchestrator.md");
  assert.deepEqual(plan.rewrites.agents, [".agents/agents/game-engineer.md"]);
  assert.deepEqual(plan.rewrites.skills.map((skill) => skill.name), ["my-project-skill"]);
  assert.ok(plan.rewrites.docs.some((doc) => doc.path === "README.md"));
  assert.equal(plan.repoMap.sourceDirectories.length, 2);
});

test("inventory --json is read-only", () => {
  const repo = makeRepo();
  const before = execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" });
  const output = execFileSync(process.execPath, [INVENTORY, "--repo", repo, "--json"], { encoding: "utf8" });
  const plan = JSON.parse(output);
  assert.equal(plan.version, 1);
  assert.ok(plan.deletions.length > 0);
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }), before);
});

test("apply removes classified paths, keeps project skills, and cleans gitignore", () => {
  const repo = makeRepo();
  execFileSync(process.execPath, [APPLY, "--repo", repo, "--apply"], { encoding: "utf8" });
  assert.ok(!fs.existsSync(path.join(repo, "docs", "PRD.md")));
  assert.ok(!fs.existsSync(path.join(repo, "docs", "features")));
  assert.ok(!fs.existsSync(path.join(repo, ".agents", "skills", "forge-build-prd")));
  assert.ok(!fs.existsSync(path.join(repo, ".agents", "agents", "forge-team-builder.md")));
  assert.ok(fs.existsSync(path.join(repo, ".agents", "skills", "my-project-skill", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(repo, "docs", "adr", "001-history.md")));
  assert.ok(fs.existsSync(path.join(repo, "src", "api", "index.ts")));
  const gitignore = fs.readFileSync(path.join(repo, ".gitignore"), "utf8");
  assert.ok(!gitignore.includes("docs/engine-run.log"));
  assert.ok(!gitignore.includes("docs/artifacts/"));
  assert.ok(gitignore.includes("node_modules/"));
});

test("inventory honors a keep glob inside a deleted directory", () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, "docs", "features", "keep.md"), "# Keep\n");
  const plan = classify(repo, { keep: ["docs/features/keep.md"] });
  const paths = plan.deletions.map((item) => item.path);
  assert.ok(!paths.includes("docs/features"), "the kept file must not be deleted with its directory");
  assert.ok(paths.includes("docs/features/core.md"));
  assert.ok(!paths.includes("docs/features/keep.md"));
});

test("inventory flags package scripts and CI that invoke Forge", () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "demo", scripts: { build: "forge-launcher engine-run --yes" } }));
  const plan = classify(repo);
  assert.ok(plan.rewrites.config.some((item) => item.path === "package.json"));
});

test("a project package that merely starts with 'forge-' is not a Forge reference", () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "forge-app", scripts: { build: "vite build" } }));
  const plan = classify(repo);
  assert.ok(!plan.rewrites.config.some((item) => item.path === "package.json"));
});

test("a temporarily installed retirement skill does not make the worktree dirty", () => {
  const repo = makeRepo();
  const installed = path.join(repo, ".agents", "skills", "forge-retire-project");
  fs.cpSync(SKILL_ROOT, installed, { recursive: true });
  execFileSync(process.execPath, [APPLY, "--repo", repo, "--apply"], { encoding: "utf8" });
  assert.ok(!fs.existsSync(path.join(repo, "docs", "PRD.md")));
  assert.ok(fs.existsSync(path.join(installed, "SKILL.md")), "apply must leave self-deletion to self-delete.mjs");
});

test("a reused Forge skill is still removed when the project retires Forge", () => {
  const repo = makeRepo();
  fs.writeFileSync(
    path.join(repo, "docs", "SKILL-CANDIDATES.json"),
    JSON.stringify({ version: 1, candidates: [{ name: "forge-build-prd", description: "x", consumers: ["game-engineer"], action: "reuse", reason: "existing" }] }),
  );
  const plan = classify(repo);
  assert.ok(plan.deletions.some((item) => item.path === ".agents/skills/forge-build-prd"));
});

test("apply --archive preserves removals and writes a manifest", () => {
  const repo = makeRepo();
  execFileSync(process.execPath, [APPLY, "--repo", repo, "--apply", "--archive"], { encoding: "utf8" });
  assert.ok(!fs.existsSync(path.join(repo, "docs", "PRD.md")));
  const archive = path.join(repo, ".forge-archive");
  const versions = fs.readdirSync(archive);
  assert.equal(versions.length, 1);
  const manifest = JSON.parse(fs.readFileSync(path.join(archive, versions[0], "RETIREMENT-MANIFEST.json"), "utf8"));
  assert.ok(manifest.paths.some((item) => item.path === "docs/PRD.md"));
  assert.ok(fs.existsSync(path.join(archive, versions[0], "docs", "PRD.md")));
});

test("apply refuses a dirty worktree unless explicitly allowed", () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, "scratch.txt"), "dirty\n");
  assert.throws(() =>
    execFileSync(process.execPath, [APPLY, "--repo", repo, "--apply"], { encoding: "utf8", stdio: "pipe" }),
  );
  execFileSync(process.execPath, [APPLY, "--repo", repo, "--apply", "--allow-dirty"], { encoding: "utf8" });
  assert.ok(!fs.existsSync(path.join(repo, "docs", "PRD.md")));
});

test("verify passes a clean support repository and fails leftover Forge references", () => {
  const clean = cleanRepo();
  const output = execFileSync(process.execPath, [VERIFY, "--repo", clean, "--strict-coverage"], { encoding: "utf8" });
  assert.match(output, /Retirement verification passed/);

  const dirty = cleanRepo();
  fs.writeFileSync(path.join(dirty, "README.md"), "# Project\n\nRead docs/PRD.md.\n");
  assert.throws(() =>
    execFileSync(process.execPath, [VERIFY, "--repo", dirty], { encoding: "utf8", stdio: "pipe" }),
  );
});

test("scope extraction and glob matching cover nested paths", () => {
  const text = "## Scope\n\n- `src/api`\n- `tests/api/**`\n";
  assert.deepEqual(extractScopePaths(text), ["src/api", "tests/api"]);
  assert.ok(globToRegExp("src/api").test("src/api"));
  assert.ok(globToRegExp("src/api").test("src/api/routes/users.ts"));
  assert.ok(!globToRegExp("src/api").test("src/ui/app.ts"));
  assert.ok(globToRegExp("src/**").test("src/ui/app.ts"));
});

test("coverage reports uncovered source areas", () => {
  const repo = cleanRepo();
  const result = coverage(repo, [".agents/agents/api-engineer.md"]);
  assert.deepEqual(result.sourceDirs, ["src/api"]);
  assert.deepEqual(result.uncovered, []);
  const partial = coverage(repo, [".agents/agents/support-lead.md"]);
  assert.deepEqual(partial.uncovered, ["src/api"]);
});

test("self-delete removes only the installed retirement skill directory", () => {
  const repo = makeRepo();
  const installed = path.join(repo, ".agents", "skills", "forge-retire-project");
  fs.cpSync(SKILL_ROOT, installed, { recursive: true });
  execFileSync(process.execPath, [path.join(installed, "scripts", "self-delete.mjs"), "--repo", repo], { encoding: "utf8" });
  assert.ok(!fs.existsSync(installed));
  assert.ok(fs.existsSync(path.join(repo, ".agents", "skills", "my-project-skill", "SKILL.md")));
});

test("self-delete refuses a directory that is not the retirement skill", () => {
  const repo = makeRepo();
  const other = path.join(repo, ".agents", "skills", "other");
  fs.mkdirSync(other, { recursive: true });
  assert.throws(() =>
    execFileSync(process.execPath, [SELF_DELETE, "--repo", repo, "--finalize", "--skill-dir", other], {
      encoding: "utf8",
      stdio: "pipe",
    }),
  );
  assert.ok(fs.existsSync(other));
});
