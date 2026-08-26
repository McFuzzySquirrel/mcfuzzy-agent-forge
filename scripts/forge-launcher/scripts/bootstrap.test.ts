import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootstrap, HARNESS_ROOTS } from "./bootstrap.ts";
import { expandPath, detectRepoRoot, resolveInputFile } from "./paths.ts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fl-bootstrap-"));
}

test("harness roots map to the right directories", () => {
  assert.equal(HARNESS_ROOTS.agents, ".agents");
  assert.equal(HARNESS_ROOTS.github, ".github");
  assert.equal(HARNESS_ROOTS.claude, ".claude");
  assert.equal(HARNESS_ROOTS.opencode, ".opencode");
});

test("bootstrap copies agents, skills, prompt-playbook, and excludes artifacts", async () => {
  const target = tmpDir();
  fs.mkdirSync(path.join(target, ".git"));
  await bootstrap({ targetDir: target, harness: "agents", force: true, nonInteractive: true });

  assert.ok(fs.existsSync(path.join(target, ".agents", "agents", "project-orchestrator.md")));
  assert.ok(fs.existsSync(path.join(target, ".agents", "skills", "forge-auto-build", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(target, "docs", "prompt-playbook.md")));
  assert.ok(!fs.existsSync(path.join(target, ".agents", "skills", "forge-workflow-engine", "node_modules")));
  assert.ok(!fs.existsSync(path.join(target, ".agents", "skills", "forge-workflow-engine", "dist")));
});

test("bootstrap rewrites .agents/ paths for a non-default harness", async () => {
  const target = tmpDir();
  fs.mkdirSync(path.join(target, ".git"));
  await bootstrap({ targetDir: target, harness: "opencode", force: true, nonInteractive: true });

  const skill = fs.readFileSync(
    path.join(target, ".opencode", "skills", "forge-auto-build", "SKILL.md"),
    "utf8",
  );
  assert.ok(!skill.includes(".agents/"));
  assert.ok(skill.includes(".opencode/"));
  assert.ok(!fs.existsSync(path.join(target, ".agents")));
});

test("bootstrap adds gitignore entries without duplicating existing ones", async () => {
  const target = tmpDir();
  fs.mkdirSync(path.join(target, ".git"));
  fs.writeFileSync(path.join(target, ".gitignore"), "node_modules/\n");
  await bootstrap({ targetDir: target, harness: "agents", force: true, nonInteractive: true });

  const gi = fs.readFileSync(path.join(target, ".gitignore"), "utf8");
  const lines = gi.split("\n");
  assert.ok(lines.includes("docs/engine-run.log"));
  assert.equal(lines.filter((l) => l === "node_modules/").length, 1);
});

test("expandPath expands ~, ~/..., $VAR and ${VAR}", () => {
  assert.equal(expandPath("~"), os.homedir());
  assert.equal(expandPath("~/x"), path.join(os.homedir(), "x"));
  process.env.FL_TEST_HOME = "/tmp";
  assert.equal(expandPath("$FL_TEST_HOME/y"), path.join("/tmp", "y"));
  assert.equal(expandPath("${FL_TEST_HOME}/y"), path.join("/tmp", "y"));
  delete process.env.FL_TEST_HOME;
});

test("resolveInputFile reports existing files and explains failures", () => {
  const dir = tmpDir();
  const file = path.join(dir, "a.txt");
  fs.writeFileSync(file, "x");
  assert.equal(resolveInputFile(file).ok, true);
  assert.equal(resolveInputFile(path.join(dir, "missing.txt")).ok, false);
  assert.ok(resolveInputFile(path.join(dir, "missing.txt")).reason.includes("file not found"));
});

test("detectRepoRoot walks up to find .git", () => {
  const dir = tmpDir();
  const nested = path.join(dir, "a", "b", "c");
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(path.join(dir, ".git"));
  assert.equal(detectRepoRoot(nested), dir);
});
