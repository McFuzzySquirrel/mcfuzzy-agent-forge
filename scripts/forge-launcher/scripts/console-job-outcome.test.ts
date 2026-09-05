import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { stageInputFingerprint } from "./authoring-state.ts";
import { jobResultPath, saveJobs, type BackgroundJob } from "./console/jobs.ts";
import { refreshJobs } from "./console/repo.ts";
import { jobRunnerCommand } from "./job-runner.ts";

function repoFixture(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `forge-job-${name}-`));
  mkdirSync(join(root, ".git"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  return root;
}

async function runRunner(id: string, resultPath: string, code: number): Promise<void> {
  const command = jobRunnerCommand(process.execPath, ["-e", `process.exit(${code})`], resultPath, id);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.cmd, command.args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("close", () => resolve());
  });
}

function job(overrides: Partial<BackgroundJob>): BackgroundJob {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? "job",
    type: overrides.type ?? "draft-skills",
    repoPath: overrides.repoPath ?? repoFixture("default"),
    pid: 999999,
    startedAt: now,
    updatedAt: now,
    status: "running",
    message: "running",
    ...overrides,
  };
}

test("nonzero CLI exit overrides an old complete authoring record", async () => {
  const home = mkdtempSync(join(tmpdir(), "forge-home-"));
  const previousHome = process.env.FORGE_HOME;
  process.env.FORGE_HOME = home;
  try {
    const repo = repoFixture("failed");
    writeFileSync(join(repo, "docs", "authoring-state.json"), JSON.stringify({
      version: 1,
      stages: { skills: { status: "complete", inputFingerprint: "old", outputs: [] } },
    }));
    const id = "failed-cli";
    const resultPath = jobResultPath(id);
    await runRunner(id, resultPath, 1);
    saveJobs([job({ id, repoPath: repo, resultPath })]);

    assert.equal(refreshJobs(), true);
    const current = JSON.parse(readFileSync(join(home, "jobs.json"), "utf8"))[0] as BackgroundJob;
    assert.equal(current.status, "failed");
    assert.match(current.message, /exited with code 1/);
  } finally {
    if (previousHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = previousHome;
  }
});

test("successful no-skills-required authoring remains complete", async () => {
  const home = mkdtempSync(join(tmpdir(), "forge-home-"));
  const previousHome = process.env.FORGE_HOME;
  process.env.FORGE_HOME = home;
  try {
    const repo = repoFixture("noop");
    writeFileSync(join(repo, "docs", "PRD.md"), "# PRD\n");
    mkdirSync(join(repo, ".agents", "agents"), { recursive: true });
    const id = "successful-noop";
    const resultPath = jobResultPath(id);
    writeFileSync(join(repo, "docs", "authoring-state.json"), JSON.stringify({
      version: 1,
      stages: {
        skills: {
          status: "complete",
          inputFingerprint: stageInputFingerprint(repo, "skills", ".agents"),
          outputs: [],
          noSkillsRequired: true,
        },
      },
    }));
    await runRunner(id, resultPath, 0);
    saveJobs([job({ id, repoPath: repo, resultPath })]);

    assert.equal(refreshJobs(), true);
    const current = JSON.parse(readFileSync(join(home, "jobs.json"), "utf8"))[0] as BackgroundJob;
    assert.equal(current.status, "complete");
  } finally {
    if (previousHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = previousHome;
  }
});

test("legacy authoring jobs without receipts are unverified despite old complete outputs", () => {
  const home = mkdtempSync(join(tmpdir(), "forge-home-"));
  const previousHome = process.env.FORGE_HOME;
  process.env.FORGE_HOME = home;
  try {
    const repo = repoFixture("legacy");
    writeFileSync(join(repo, "docs", "authoring-state.json"), JSON.stringify({
      version: 1,
      stages: { skills: { status: "complete", inputFingerprint: "old", outputs: [] } },
    }));
    saveJobs([job({ id: "legacy-authoring", repoPath: repo, type: "draft-skills" })]);

    assert.equal(refreshJobs(), true);
    const current = JSON.parse(readFileSync(join(home, "jobs.json"), "utf8"))[0] as BackgroundJob;
    assert.equal(current.status, "failed");
    assert.match(current.message, /without an attributable terminal receipt/);
    assert.match(current.message, /inspect the job log/);
  } finally {
    if (previousHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = previousHome;
  }
});

test("one malformed repository does not block a healthy job", async () => {
  const home = mkdtempSync(join(tmpdir(), "forge-home-"));
  const previousHome = process.env.FORGE_HOME;
  process.env.FORGE_HOME = home;
  try {
    const malformed = repoFixture("malformed");
    writeFileSync(join(malformed, "docs", "authoring-state.json"), '{"version":1,"stages":"broken"}');
    const healthy = repoFixture("healthy");
    writeFileSync(join(healthy, "docs", "EXECUTION-MANIFEST.json"), "{}");
    const firstId = "malformed";
    const secondId = "healthy";
    const firstResult = jobResultPath(firstId);
    const secondResult = jobResultPath(secondId);
    await runRunner(firstId, firstResult, 0);
    await runRunner(secondId, secondResult, 0);
    saveJobs([
      job({ id: firstId, repoPath: malformed, resultPath: firstResult }),
      job({ id: secondId, type: "compile-manifest", repoPath: healthy, resultPath: secondResult }),
    ]);

    assert.equal(refreshJobs(), true);
    const jobs = JSON.parse(readFileSync(join(home, "jobs.json"), "utf8")) as BackgroundJob[];
    assert.equal(jobs.find((entry) => entry.id === firstId)?.status, "failed");
    assert.equal(jobs.find((entry) => entry.id === secondId)?.status, "complete");
  } finally {
    if (previousHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = previousHome;
  }
});
