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

/** Bootstraps a bare git repo with a forge harness root so resume can detect it. */
function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fl-resume-"));
  execFileSync("git", ["-C", dir, "init", "-q"], { env: { ...process.env, ...GIT_ENV } });
  fs.mkdirSync(path.join(dir, ".agents", "agents"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".agents", "skills"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  return dir;
}

function write(repo: string, rel: string, content: string): void {
  const file = path.join(repo, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test("resume on a non-git directory fails with guidance", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fl-resume-no-git-"));
  const { code, out } = await runCli(["resume", "--repo", dir, "--non-interactive"]);
  assert.equal(code, 1, out);
  assert.ok(out.includes("Not a git repository"), out);
  assert.ok(out.includes("forge-launcher"), out);
});

test("resume with nothing drafted queues the launcher", async () => {
  const repo = makeRepo();
  const { code, out } = await runCli(["resume", "--repo", repo, "--non-interactive"]);
  assert.equal(code, 0, out);
  assert.ok(out.includes("No idea or PRD captured yet"), out);
  assert.ok(out.includes("forge-launcher"), out);
});

test("resume with an idea queues PRD drafting", async () => {
  const repo = makeRepo();
  write(repo, "docs/IDEA.md", "# Project Idea\n\nA thing.\n");
  const { code, out } = await runCli(["resume", "--repo", repo, "--non-interactive"]);
  assert.equal(code, 0, out);
  assert.ok(out.includes("No PRD yet"), out);
  assert.ok(out.includes("forge-auto-build-prd"), out);
  assert.ok(out.includes(`opencode run --auto --dir "${repo}"`), out);
});

test("resume with a PRD but no team queues team generation", async () => {
  const repo = makeRepo();
  write(repo, "docs/PRD.md", "# PRD\n\nBuild a thing.\n");
  const { code, out } = await runCli(["resume", "--repo", repo, "--non-interactive"]);
  assert.equal(code, 0, out);
  assert.ok(out.includes("No agent team yet"), out);
  assert.ok(out.includes("forge-build-agent-team"), out);
  assert.ok(out.includes(`opencode run --auto --dir "${repo}"`), out);
});

test("resume with a team but no manifest queues an engine-run", async () => {
  const repo = makeRepo();
  write(repo, "docs/PRD.md", "# PRD\n\nBuild a thing.\n");
  write(repo, ".agents/agents/api-engineer.md", "---\nname: api-engineer\ndescription: API specialist.\n---\n");
  const { code, out } = await runCli(["resume", "--repo", repo, "--non-interactive"]);
  assert.equal(code, 0, out);
  assert.ok(out.includes(`engine-run --repo ${repo}`), out);
  assert.ok(out.includes("--harness opencode"), out);
  assert.ok(out.includes("--yes"), out);
});

test("resume with a paused engine run queues a resume", async () => {
  const repo = makeRepo();
  write(repo, "docs/PRD.md", "# PRD\n\nBuild a thing.\n");
  write(repo, ".agents/agents/api-engineer.md", "---\nname: api-engineer\ndescription: API specialist.\n---\n");
  write(repo, "docs/WORKFLOW-STATE.json", JSON.stringify({
    runId: "run-1",
    status: "paused",
    harness: "opencode",
    currentPhase: "1",
    tasks: { "1.1": { taskId: "1.1", status: "complete" }, "1.2": { taskId: "1.2", status: "pending" } },
    blockers: [],
  }));
  const { code, out } = await runCli(["resume", "--repo", repo, "--non-interactive"]);
  assert.equal(code, 0, out);
  assert.ok(out.includes("Status   : paused"), out);
  assert.ok(out.includes(`engine-run --repo ${repo}`), out);
});

test("resume carries persisted engine config (concurrency/keep-alive/retries/viz)", async () => {
  const repo = makeRepo();
  write(repo, "docs/PRD.md", "# PRD\n\nBuild a thing.\n");
  write(repo, ".agents/agents/api-engineer.md", "---\nname: api-engineer\ndescription: API specialist.\n---\n");
  write(repo, "docs/WORKFLOW-STATE.json", JSON.stringify({
    runId: "run-1",
    status: "paused",
    harness: "opencode",
    currentPhase: "1",
    tasks: { "1.1": { taskId: "1.1", status: "complete" }, "1.2": { taskId: "1.2", status: "pending" } },
    blockers: [],
  }));
  write(repo, "docs/engine-config.json", JSON.stringify({
    harness: "opencode",
    granularity: "coarse",
    concurrency: "4",
    taskTimeoutMs: "300000",
    maxRetries: "3",
    viz: true,
    vizPort: "4300",
    keepAlive: true,
    attach: "",
  }));
  const { code, out } = await runCli(["resume", "--repo", repo, "--non-interactive"]);
  assert.equal(code, 0, out);
  assert.ok(out.includes(`engine-run --repo ${repo}`), out);
  assert.ok(out.includes("--concurrency 4"), out);
  assert.ok(out.includes("--keep-alive"), out);
  assert.ok(out.includes("--max-retries 3"), out);
  assert.ok(out.includes("--task-timeout-ms 300000"), out);
  assert.ok(out.includes("--viz"), out);
});

test("explicit env overrides persisted engine config on resume", async () => {
  const repo = makeRepo();
  write(repo, "docs/PRD.md", "# PRD\n\nBuild a thing.\n");
  write(repo, ".agents/agents/api-engineer.md", "---\nname: api-engineer\ndescription: API specialist.\n---\n");
  write(repo, "docs/WORKFLOW-STATE.json", JSON.stringify({
    runId: "run-1",
    status: "paused",
    harness: "opencode",
    currentPhase: "1",
    tasks: { "1.1": { taskId: "1.1", status: "complete" } },
    blockers: [],
  }));
  write(repo, "docs/engine-config.json", JSON.stringify({
    harness: "opencode",
    granularity: "",
    concurrency: "4",
    taskTimeoutMs: "",
    maxRetries: "",
    viz: false,
    vizPort: "",
    keepAlive: true,
    attach: "",
  }));
  const { code, out } = await runCli(["resume", "--repo", repo, "--non-interactive"], {
    FORGE_ENGINE_CONCURRENCY: "2",
    FORGE_ENGINE_ATTACH: "0",
  });
  assert.equal(code, 0, out);
  assert.ok(out.includes("--concurrency 2"), out);
  assert.ok(!out.includes("--keep-alive"), out);
});

test("resume with a complete engine run suggests monitoring, not a resume", async () => {
  const repo = makeRepo();
  write(repo, "docs/PRD.md", "# PRD\n\nBuild a thing.\n");
  write(repo, ".agents/agents/api-engineer.md", "---\nname: api-engineer\ndescription: API specialist.\n---\n");
  write(repo, "docs/WORKFLOW-STATE.json", JSON.stringify({
    runId: "run-2",
    status: "complete",
    harness: "opencode",
    tasks: { "1.1": { taskId: "1.1", status: "complete" } },
    blockers: [],
  }));
  const { code, out } = await runCli(["resume", "--repo", repo, "--non-interactive"]);
  assert.equal(code, 0, out);
  assert.ok(out.includes("Status   : complete"), out);
  assert.ok(out.includes("tail -f"), out);
});

test("resume with a running engine run warns against starting a second one", async () => {
  const repo = makeRepo();
  write(repo, "docs/PRD.md", "# PRD\n\nBuild a thing.\n");
  write(repo, ".agents/agents/api-engineer.md", "---\nname: api-engineer\ndescription: API specialist.\n---\n");
  write(repo, "docs/WORKFLOW-STATE.json", JSON.stringify({
    runId: "run-3",
    status: "running",
    harness: "opencode",
    tasks: { "1.1": { taskId: "1.1", status: "running" } },
    blockers: [],
  }));
  const { code, out } = await runCli(["resume", "--repo", repo, "--non-interactive"]);
  assert.equal(code, 0, out);
  assert.ok(out.includes("Status   : running"), out);
  assert.ok(out.includes("already running"), out);
});
