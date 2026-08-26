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

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fl-launcher-"));
}

function runCli(args: string[], env: Record<string, string>): Promise<{ code: number; out: string }> {
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

test("non-interactive run with no PRD bootstraps and queues forge-auto-build-prd", async () => {
  const parent = tmpDir();
  const { code, out } = await runCli(["--non-interactive"], {
    FORGE_HARNESS_CHOICE: "4",
    FORGE_REPO_NAME: "no-prd-app",
    FORGE_REPO_PARENT_DIR: parent,
    FORGE_IDEA: "A small expense tracker CLI",
    FORGE_YN_DEFAULT: "n",
  });

  assert.equal(code, 0, out);
  const repo = path.join(parent, "no-prd-app");
  assert.ok(fs.existsSync(path.join(repo, ".agents", "agents", "project-orchestrator.md")));
  assert.ok(fs.existsSync(path.join(repo, ".agents", "skills", "forge-auto-build", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(repo, "docs", "IDEA.md")));
  assert.ok(fs.existsSync(path.join(repo, "IDEA.md")));
  assert.ok(!fs.existsSync(path.join(repo, "docs", "PRD.md")));
  // CR-001 lifecycle: no PRD -> queue forge-auto-build-prd
  assert.ok(out.includes("/forge-auto-build-prd Use docs/IDEA.md as the project idea"));
  assert.ok(!out.includes("/forge-auto-build Use docs/PRD.md as the project PRD"));
});

test("headless skill command pins the repo dir with --dir", async () => {
  const parent = tmpDir();
  const { code, out } = await runCli(["--non-interactive", "--dry-run"], {
    FORGE_HARNESS_CHOICE: "4",
    FORGE_REPO_NAME: "dir-app",
    FORGE_REPO_PARENT_DIR: parent,
    FORGE_IDEA: "A thing",
    FORGE_YN_DEFAULT: "n",
    FORGE_AUTO_DRAFT: "1",
    FORGE_RUN_WITH: "opencode",
  });

  assert.equal(code, 0, out);
  const repo = path.join(parent, "dir-app");
  // opencode resolves its project dir from its parent process, not the child's
  // spawn cwd, so the launcher must pass --dir explicitly or the skill runs in
  // the wrong repository and its input (docs/IDEA.md) is reported missing.
  assert.ok(out.includes(`opencode run --auto --dir "${repo}"`), out);
});

test("non-interactive run with a PRD queues forge-auto-build", async () => {
  const parent = tmpDir();
  const prd = path.join(parent, "prd.md");
  fs.writeFileSync(prd, "# PRD\n\nBuild a thing.\n");

  const { code, out } = await runCli(["--non-interactive"], {
    FORGE_HARNESS_CHOICE: "4",
    FORGE_REPO_NAME: "with-prd-app",
    FORGE_REPO_PARENT_DIR: parent,
    FORGE_IDEA: "A thing",
    FORGE_PRD_FILE: prd,
    FORGE_YN_DEFAULT: "n",
  });

  assert.equal(code, 0, out);
  const repo = path.join(parent, "with-prd-app");
  assert.ok(fs.existsSync(path.join(repo, "docs", "PRD.md")));
  assert.ok(out.includes("/forge-auto-build Use docs/PRD.md as the project PRD"));
  assert.ok(!out.includes("/forge-auto-build-prd Use docs/IDEA.md"));
});

test("commit step created the bootstrap commit", async () => {
  const parent = tmpDir();
  const { code } = await runCli(["--non-interactive"], {
    FORGE_HARNESS_CHOICE: "4",
    FORGE_REPO_NAME: "commit-app",
    FORGE_REPO_PARENT_DIR: parent,
    FORGE_IDEA: "A thing",
    FORGE_YN_DEFAULT: "n",
  });
  assert.equal(code, 0);
  const out = execFileSync("git", ["-C", path.join(parent, "commit-app"), "log", "--oneline"], { encoding: "utf8" });
  assert.ok(out.includes("chore: bootstrap agent forge"));
});

test("openCode harness bootstrap rewrites paths to .opencode", async () => {
  const parent = tmpDir();
  const { code } = await runCli(["--non-interactive"], {
    FORGE_HARNESS_CHOICE: "2",
    FORGE_REPO_NAME: "oc-app",
    FORGE_REPO_PARENT_DIR: parent,
    FORGE_IDEA: "A thing",
    FORGE_YN_DEFAULT: "n",
  });
  assert.equal(code, 0);
  const repo = path.join(parent, "oc-app");
  assert.ok(fs.existsSync(path.join(repo, ".opencode", "skills", "forge-auto-build", "SKILL.md")));
  assert.ok(!fs.existsSync(path.join(repo, ".agents")));
  const skill = fs.readFileSync(path.join(repo, ".opencode", "skills", "forge-auto-build", "SKILL.md"), "utf8");
  assert.ok(skill.includes(".opencode/"));
  assert.ok(!skill.includes(".agents/"));
});

test("auto-draft PRD succeeds via the stub skill runner", async () => {
  const parent = tmpDir();
  const { code, out } = await runCli(["--non-interactive"], {
    FORGE_HARNESS_CHOICE: "4",
    FORGE_REPO_NAME: "draft-app",
    FORGE_REPO_PARENT_DIR: parent,
    FORGE_IDEA: "A todo list app",
    FORGE_YN_DEFAULT: "n",
    FORGE_AUTO_DRAFT: "1",
    FORGE_RUN_WITH: "stub",
  });

  assert.equal(code, 0, out);
  const repo = path.join(parent, "draft-app");
  assert.ok(fs.existsSync(path.join(repo, "docs", "PRD.md")), "PRD should exist");
  assert.ok(out.includes("PRD generated."));
  assert.ok(out.includes("docs: add auto-drafted PRD"));
  // the team stage ran too
  assert.ok(fs.existsSync(path.join(repo, ".agents", "agents", "stub-project-agent.md")));
  assert.ok(out.includes("Agent team generated."));
  const log = execFileSync("git", ["-C", repo, "log", "--oneline"], { encoding: "utf8" });
  assert.ok(log.includes("docs: add auto-drafted PRD"));
  assert.ok(log.includes("feat: generate auto-drafted agent team"));
});

test("auto-draft PRD failure is diagnosed with log tail and no commit", async () => {
  const parent = tmpDir();
  const { code, out } = await runCli(["--non-interactive"], {
    FORGE_HARNESS_CHOICE: "4",
    FORGE_REPO_NAME: "draft-fail-app",
    FORGE_REPO_PARENT_DIR: parent,
    FORGE_IDEA: "A todo list app",
    FORGE_YN_DEFAULT: "n",
    FORGE_AUTO_DRAFT: "1",
    FORGE_RUN_WITH: "stub",
    FORGE_STUB_NOOP: "1",
  });

  assert.equal(code, 0, out);
  const repo = path.join(parent, "draft-fail-app");
  assert.ok(!fs.existsSync(path.join(repo, "docs", "PRD.md")), "no PRD should exist");
  assert.ok(out.includes("did not produce the expected artifact"));
  assert.ok(out.includes("Run it manually in the repo"));
  assert.ok(out.includes("[stub] invoking forge-auto-build-prd"));
  // nothing was committed beyond the bootstrap commit
  const log = execFileSync("git", ["-C", repo, "log", "--oneline"], { encoding: "utf8" });
  assert.ok(!log.includes("docs: add auto-drafted PRD"));
});
