import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));

const GIT_ENV = {
  GIT_AUTHOR_NAME: "forge-launcher-test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "forge-launcher-test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function runCli(args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "node",
      ["--import", "tsx", CLI, ...args],
      { env: { ...process.env, ...GIT_ENV, ...env } },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ code: (err as { code?: number }).code ?? 1, out: stdout + stderr });
          return;
        }
        resolve({ code: 0, out: stdout + stderr });
      },
    );
  });
}

/** Bootstraps a bare git repo with a forge harness root + stub skill files. */
function makeRepo(harnessRoot = ".agents"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fl-draft-"));
  execFileSync("git", ["-C", dir, "init", "-q"], { env: { ...process.env, ...GIT_ENV } });
  fs.mkdirSync(path.join(dir, harnessRoot, "agents"), { recursive: true });
  for (const skill of ["forge-auto-build-prd", "forge-build-agent-team"]) {
    const skillDir = path.join(dir, harnessRoot, "skills", skill);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), `---\nname: ${skill}\ndescription: stub\n---\n# stub\n`);
  }
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  return dir;
}

function write(repo: string, rel: string, content: string): void {
  const file = path.join(repo, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test("draft-prd writes docs/PRD.md via the stub runner", async () => {
  const repo = makeRepo();
  write(repo, "docs/IDEA.md", "# Project Idea\n\nA thing.\n");
  const { code, out } = await runCli(["draft-prd", "--repo", repo], { FORGE_RUN_WITH: "stub" });
  assert.equal(code, 0, out);
  assert.ok(fs.existsSync(path.join(repo, "docs", "PRD.md")), "PRD.md should be written");
  assert.ok(out.includes("PRD generated"), out);
});

test("draft-prd with no idea fails with guidance", async () => {
  const repo = makeRepo();
  const { code, out } = await runCli(["draft-prd", "--repo", repo], { FORGE_RUN_WITH: "stub" });
  assert.equal(code, 1, out);
  assert.ok(out.includes("IDEA.md"), out);
});

test("draft-team writes an agent file via the stub runner", async () => {
  const repo = makeRepo();
  write(repo, "docs/PRD.md", "# PRD\n\nBuild a thing.\n");
  const { code, out } = await runCli(["draft-team", "--repo", repo], { FORGE_RUN_WITH: "stub" });
  assert.equal(code, 0, out);
  assert.ok(fs.existsSync(path.join(repo, ".agents", "agents", "stub-project-agent.md")), "agent file should be written");
  assert.ok(out.includes("Agent team generated"), out);
});

test("draft-team honors the opencode harness root", async () => {
  const repo = makeRepo(".opencode");
  write(repo, "docs/PRD.md", "# PRD\n\nBuild a thing.\n");
  const { code, out } = await runCli(["draft-team", "--repo", repo], { FORGE_RUN_WITH: "stub" });
  assert.equal(code, 0, out);
  assert.ok(fs.existsSync(path.join(repo, ".opencode", "agents", "stub-project-agent.md")), "agent file should be written");
  assert.ok(!fs.existsSync(path.join(repo, ".agents", "agents", "stub-project-agent.md")), "generic harness path should stay unused");
});

test("draft-team honors the GitHub harness root", async () => {
  const repo = makeRepo(".github");
  write(repo, "docs/PRD.md", "# PRD\n\nBuild a thing.\n");
  const { code, out } = await runCli(["draft-team", "--repo", repo], { FORGE_RUN_WITH: "stub" });
  assert.equal(code, 0, out);
  assert.ok(fs.existsSync(path.join(repo, ".github", "agents", "stub-project-agent.md")), "agent file should be written");
  assert.ok(!fs.existsSync(path.join(repo, ".agents", "agents", "stub-project-agent.md")), "generic harness path should stay unused");
});

test("draft-team with no PRD fails with guidance", async () => {
  const repo = makeRepo();
  const { code, out } = await runCli(["draft-team", "--repo", repo], { FORGE_RUN_WITH: "stub" });
  assert.equal(code, 1, out);
  assert.ok(out.includes("No PRD"), out);
});
