import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runRetire } from "./retire.ts";
import type { runLogged } from "./format.ts";

function makeRepo(options: { harness?: boolean } = {}): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "fl-retire-"));
  fs.mkdirSync(path.join(repo, "src", "api"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "api", "index.ts"), "export const api = 1;\n");
  fs.writeFileSync(path.join(repo, "README.md"), "# Project\n");
  if (options.harness !== false) {
    const agents = path.join(repo, ".agents", "agents");
    const skills = path.join(repo, ".agents", "skills", "forge-build-prd");
    fs.mkdirSync(agents, { recursive: true });
    fs.mkdirSync(skills, { recursive: true });
    fs.mkdirSync(path.join(repo, "docs", "features"), { recursive: true });
    fs.writeFileSync(
      path.join(agents, "api-engineer.md"),
      '---\nname: api-engineer\ndescription: "Maintains the API surface."\nmode: all\n---\n\n## Scope\n\n- `src/api`\n\n## Support Responsibilities\n\nFix defects and add regression tests.\n',
    );
    fs.writeFileSync(path.join(skills, "SKILL.md"), '---\nname: forge-build-prd\ndescription: "Authors requirements."\n---\n');
    fs.writeFileSync(path.join(repo, "docs", "PRD.md"), "# PRD\n");
    fs.writeFileSync(path.join(repo, "docs", "features", "core.md"), "# Core\n");
    fs.writeFileSync(path.join(repo, "docs", "PROGRESS.md"), "# Progress\n");
    fs.writeFileSync(
      path.join(repo, "docs", "SUPPORT.md"),
      "# Support\n\n| Agent | Scope |\n|---|---|\n| api-engineer | `src/api` |\n",
    );
  }
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], { cwd: repo });
  return repo;
}

test("retire without --apply is a read-only inventory", async () => {
  const repo = makeRepo();
  const code = await runRetire({ repo, env: { ...process.env } });
  assert.equal(code, 0);
  assert.ok(fs.existsSync(path.join(repo, "docs", "PRD.md")));
  assert.ok(fs.existsSync(path.join(repo, ".agents", "skills", "forge-build-prd", "SKILL.md")));
  assert.ok(!fs.existsSync(path.join(repo, ".agents", "skills", "forge-retire-project")));
});

test("retire --apply installs the skill, runs the harness, and verifies", async () => {
  const repo = makeRepo();
  const fakeRun = (async (_cmd: string, _args: string[], opts: { cwd?: string }) => {
    const cwd = opts.cwd ?? repo;
    const skill = path.join(cwd, ".agents", "skills", "forge-retire-project");
    assert.ok(fs.existsSync(path.join(skill, "SKILL.md")), "retirement skill must be installed before the run");
    execFileSync(process.execPath, [path.join(skill, "scripts", "apply.mjs"), "--repo", cwd, "--apply", "--allow-dirty"], { cwd, stdio: "ignore" });
    return { code: 0 };
  }) as typeof runLogged;

  const code = await runRetire({ repo, apply: true, env: { ...process.env }, runner: "opencode", dependencies: { runLogged: fakeRun } });
  assert.equal(code, 0);
  assert.ok(!fs.existsSync(path.join(repo, "docs", "PRD.md")));
  assert.ok(!fs.existsSync(path.join(repo, "docs", "features")));
  assert.ok(!fs.existsSync(path.join(repo, ".agents", "skills", "forge-build-prd")));
  assert.ok(fs.existsSync(path.join(repo, "src", "api", "index.ts")));
  assert.ok(fs.existsSync(path.join(repo, "docs", "SUPPORT.md")));
  assert.ok(!fs.existsSync(path.join(repo, ".agents", "skills", "forge-retire-project")), "launcher must remove the temporary skill");
});

test("retire --apply refuses while the engine pid is alive", async () => {
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs", "engine.pid"), `${process.pid}\n`);
  const code = await runRetire({ repo, apply: true, allowDirty: true, env: { ...process.env } });
  assert.equal(code, 1);
  assert.ok(fs.existsSync(path.join(repo, "docs", "PRD.md")));
});

test("retire refuses a directory that is not a git repository", async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "fl-retire-nogit-"));
  fs.mkdirSync(path.join(repo, ".agents", "agents"), { recursive: true });
  const code = await runRetire({ repo });
  assert.equal(code, 1);
});

test("retire refuses a repository without a harness root", async () => {
  const repo = makeRepo({ harness: false });
  const code = await runRetire({ repo });
  assert.equal(code, 1);
});
