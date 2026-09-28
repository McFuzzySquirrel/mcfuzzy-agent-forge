import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { jobResultPath, jobsPath, loadJobs, saveJobs, type BackgroundJob } from "./console/jobs.ts";
import { loadRegistry, registryPath, saveRegistry, upsertProject } from "./console/paths.ts";
import { removeProjects } from "./console/remove-projects.ts";
import { startConsoleServer } from "./console/server.ts";

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-removal-"));
  const originalHome = process.env.FORGE_HOME;
  const home = path.join(root, "forge-home");
  process.env.FORGE_HOME = home;
  t.after(() => {
    if (originalHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = originalHome;
    fs.rmSync(root, { recursive: true, force: true });
  });
  function project(name: string) {
    const repo = path.join(root, name);
    for (const file of [".git/HEAD", "src/index.ts", "docs/PRD.md", "docs/engine-run.log",
      "docs/WORKFLOW-STATE.json", "docs/artifacts/result.json", ".agents/agents/dev.md",
      ".agents/skills/local/SKILL.md", "package.json"]) {
      const target = path.join(repo, ...file.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.endsWith(".json") ? "{}" : `Preserve ${file}\n`);
    }
    return repo;
  }
  function register(...repos: string[]) {
    saveRegistry(repos.map((repo) => ({ path: repo, name: path.basename(repo), lastOpenedAt: "2026-09-28T12:00:00Z" })));
  }
  function job(repo: string, patch: Partial<BackgroundJob> = {}): BackgroundJob {
    const id = randomUUID();
    const resultPath = jobResultPath(id);
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(resultPath, JSON.stringify({ version: 1, id, exitCode: 0, signal: null, finishedAt: "2026-09-28T12:00:00Z" }));
    return { id, resultPath, repoPath: repo, type: "draft-prd", status: "complete",
      startedAt: "2026-09-28T11:00:00Z", updatedAt: "2026-09-28T12:00:00Z", message: "Done", ...patch };
  }
  return { root, home, project, register, job };
}

function snapshot(root: string): Record<string, { bytes: string; modified: number }> {
  const files: Record<string, { bytes: string; modified: number }> = {};
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else files[path.relative(root, file)] = { bytes: fs.readFileSync(file).toString("hex"), modified: fs.statSync(file).mtimeMs };
    }
  }
  walk(root);
  return files;
}

test("removal deletes only registry/history and verified external receipts, preserving repositories and settings", (t) => {
  const f = fixture(t);
  const first = f.project("first");
  const second = f.project("second");
  f.register(first, second);
  const removed = f.job(first);
  const other = f.job(second);
  saveJobs([removed, other]);
  const settings = path.join(f.home, "settings.json");
  fs.writeFileSync(settings, '{"shared":true}\n');
  const before = [snapshot(first), snapshot(second)];
  const result = removeProjects([first], first);
  assert.equal(result[0]?.status, "removed");
  assert.deepEqual(loadRegistry().map((p) => p.path), [second]);
  assert.deepEqual(loadJobs(), [other]);
  assert.equal(fs.existsSync(removed.resultPath!), false);
  assert.equal(fs.existsSync(other.resultPath!), true);
  assert.equal(fs.readFileSync(settings, "utf8"), '{"shared":true}\n');
  assert.deepEqual([snapshot(first), snapshot(second)], before);
});

test("bulk removal reports removed, blocked and failed independently, including stale entries", (t) => {
  const f = fixture(t);
  const stale = path.join(f.root, "missing");
  const active = f.project("active");
  const engine = f.project("engine");
  const idle = f.project("idle");
  f.register(stale, active, engine, idle);
  const activeJob = f.job(active, { status: "running", pid: process.pid });
  // A newer terminal record must not hide an older active job.
  saveJobs([activeJob, f.job(active), f.job(stale)]);
  fs.writeFileSync(path.join(engine, "docs", "engine.pid"), String(process.pid));
  const before = [snapshot(active), snapshot(engine)];
  const results = removeProjects([stale, active, engine, path.join(f.root, "unknown"), idle, idle], idle);
  assert.deepEqual(results.map((r) => r.status), ["removed", "blocked", "blocked", "failed", "removed"]);
  assert.deepEqual(loadRegistry().map((p) => p.path), [active, engine]);
  assert.equal(loadJobs().length, 2);
  assert.deepEqual([snapshot(active), snapshot(engine)], before);
});

test("running jobs without a verifiable PID block removal rather than terminating or guessing", (t) => {
  const f = fixture(t);
  const repo = f.project("running");
  f.register(repo);
  saveJobs([f.job(repo, { status: "running" })]);
  assert.equal(removeProjects([repo], null)[0]?.status, "blocked");
  assert.equal(loadJobs().length, 1);
});

test("finished jobs whose PID was reused by an unrelated live process do not block removal", (t) => {
  const f = fixture(t);
  const repo = f.project("finished");
  f.register(repo);
  // process.pid is guaranteed alive, standing in for an OS-reused PID.
  saveJobs([f.job(repo, { status: "complete", pid: process.pid }), f.job(repo, { status: "failed", pid: process.pid })]);
  const result = removeProjects([repo], null)[0]!;
  assert.equal(result.status, "removed", result.message);
  assert.deepEqual(loadJobs(), []);
});

test("paused jobs with a live process still block removal", (t) => {
  const f = fixture(t);
  const repo = f.project("paused");
  f.register(repo);
  saveJobs([f.job(repo, { status: "paused", pid: process.pid })]);
  assert.equal(removeProjects([repo], null)[0]?.status, "blocked");
});

test("a stale running record with an exited PID does not prevent forgetting a missing folder", (t) => {
  const f = fixture(t);
  const repo = path.join(f.root, "missing");
  f.register(repo);
  const child = spawnSync(process.execPath, ["-e", ""]);
  assert.equal(child.status, 0);
  saveJobs([f.job(repo, { status: "running", pid: child.pid })]);
  assert.equal(removeProjects([repo], null)[0]?.status, "removed");
  assert.deepEqual(loadJobs(), []);
});

test("filesystem aliases match registry entries and their associated jobs", (t) => {
  const f = fixture(t);
  const repo = f.project("safe");
  const alias = path.join(f.root, "alias");
  fs.symlinkSync(repo, alias, "junction");
  f.register(repo, alias);
  const job = f.job(alias);
  saveJobs([job]);
  const before = snapshot(repo);
  assert.equal(removeProjects([repo], alias)[0]?.status, "removed");
  assert.deepEqual(loadRegistry(), []);
  assert.deepEqual(loadJobs(), []);
  assert.deepEqual(snapshot(repo), before);
  assert.equal(fs.lstatSync(alias).isSymbolicLink(), true);
});

test("arbitrary paths, logs, traversal IDs and non-attributable receipts are never deleted", (t) => {
  const f = fixture(t);
  const repo = f.project("safe");
  f.register(repo);
  const inside = path.join(repo, "docs", "PRD.md");
  const outside = path.join(f.root, "unrelated.json");
  fs.writeFileSync(outside, "unrelated");
  const invalid = f.job(repo);
  fs.writeFileSync(invalid.resultPath!, JSON.stringify({ version: 1, id: randomUUID() }));
  const malformed = f.job(repo);
  fs.writeFileSync(malformed.resultPath!, "{not-json");
  const jobs = [f.job(repo, { resultPath: inside, logPath: inside }), f.job(repo, { resultPath: outside }),
    f.job(repo, { id: "..\\settings", resultPath: outside }), invalid, malformed];
  saveJobs(jobs);
  const before = snapshot(repo);
  const result = removeProjects([repo], null)[0]!;
  assert.equal(result.status, "removed");
  assert.match(result.message, /unverified/);
  assert.equal(fs.readFileSync(outside, "utf8"), "unrelated");
  assert.equal(fs.existsSync(invalid.resultPath!), true);
  assert.equal(fs.existsSync(malformed.resultPath!), true);
  assert.deepEqual(snapshot(repo), before);
});

test("receipts shared by another project are preserved", (t) => {
  const f = fixture(t);
  const first = f.project("first");
  const second = f.project("second");
  f.register(first, second);
  const shared = f.job(first);
  const other = { ...shared, repoPath: second };
  saveJobs([shared, other]);
  assert.equal(removeProjects([first], null)[0]?.status, "removed");
  assert.equal(fs.existsSync(shared.resultPath!), true);
  assert.deepEqual(loadJobs(), [other]);
});

test("result-directory junctions into a repository are not followed or deleted", (t) => {
  const f = fixture(t);
  const repo = f.project("safe");
  f.register(repo);
  const job = f.job(repo);
  fs.unlinkSync(job.resultPath!);
  fs.rmdirSync(path.dirname(job.resultPath!));
  const target = path.join(repo, "docs", `${job.id}.json`);
  fs.writeFileSync(target, JSON.stringify({ version: 1, id: job.id, exitCode: 0, signal: null, finishedAt: "now" }));
  fs.symlinkSync(path.join(repo, "docs"), path.dirname(job.resultPath!), "junction");
  saveJobs([job]);
  const before = snapshot(repo);
  assert.equal(removeProjects([repo], null)[0]?.status, "removed");
  assert.deepEqual(snapshot(repo), before);
  assert.equal(fs.lstatSync(path.dirname(job.resultPath!)).isSymbolicLink(), true);
});

test("hard-linked receipts cannot remove repository files", (t) => {
  const f = fixture(t);
  const repo = f.project("safe");
  f.register(repo);
  const job = f.job(repo);
  const target = path.join(repo, "docs", "linked.json");
  fs.linkSync(job.resultPath!, target);
  saveJobs([job]);
  const before = snapshot(repo);
  assert.equal(removeProjects([repo], null)[0]?.status, "removed");
  assert.equal(fs.existsSync(job.resultPath!), true);
  assert.deepEqual(snapshot(repo), before);
});

test("Forge storage inside a project, including through a junction, fails without writing anything", (t) => {
  const f = fixture(t);
  const repo = f.project("safe");
  const target = path.join(repo, "forge-data");
  fs.mkdirSync(target);
  fs.symlinkSync(target, f.home, "junction");
  f.register(repo);
  saveJobs([f.job(repo)]);
  const before = snapshot(repo);
  assert.equal(removeProjects([repo], repo)[0]?.status, "failed");
  assert.deepEqual(snapshot(repo), before);
});

test("a hard-linked registry file cannot cause writes to project files", (t) => {
  const f = fixture(t);
  const repo = f.project("safe");
  f.register(repo);
  fs.linkSync(registryPath(), path.join(repo, "registry-copy.json"));
  const before = snapshot(repo);
  assert.equal(removeProjects([repo], null)[0]?.status, "failed");
  assert.deepEqual(snapshot(repo), before);
  assert.equal(loadRegistry().length, 1);
});

test("corrupt history or registry is surfaced and never overwritten with empty data", (t) => {
  const f = fixture(t);
  const repo = f.project("safe");
  f.register(repo);
  fs.writeFileSync(jobsPath(), "{broken");
  const registry = fs.readFileSync(registryPath(), "utf8");
  assert.equal(removeProjects([repo], null)[0]?.status, "failed");
  assert.equal(fs.readFileSync(jobsPath(), "utf8"), "{broken");
  assert.equal(fs.readFileSync(registryPath(), "utf8"), registry);
  saveJobs([]);
  fs.writeFileSync(registryPath(), '[{"invalid":true}]');
  const failed = removeProjects([repo], null)[0]!;
  assert.equal(failed.status, "failed");
  assert.match(failed.message, /still registered\. No files were deleted\./);
  assert.equal(fs.readFileSync(registryPath(), "utf8"), '[{"invalid":true}]');
});

test("legacy relative registry records do not block removal and are preserved verbatim", (t) => {
  const f = fixture(t);
  const repo = f.project("ai-playground");
  const other = f.project("other");
  const legacy = [
    { path: ".", name: ".", createdAt: "2026-01-01T00:00:00Z", lastOpenedAt: "2026-01-01T00:00:00Z" },
    { path: "relative/app", lastOpenedAt: "2026-01-02T00:00:00Z" },
  ];
  fs.mkdirSync(f.home, { recursive: true });
  fs.writeFileSync(registryPath(), JSON.stringify([
    ...legacy,
    { path: repo, name: "ai-playground", lastOpenedAt: "2026-09-28T12:00:00Z" },
    { path: other, name: "other", lastOpenedAt: "2026-09-28T12:00:00Z" },
  ]));
  saveJobs([f.job(repo), f.job(other)]);
  const result = removeProjects([repo], null)[0]!;
  assert.equal(result.status, "removed", result.message);
  const remaining = JSON.parse(fs.readFileSync(registryPath(), "utf8"));
  assert.deepEqual(remaining.slice(0, 2), legacy);
  assert.deepEqual(remaining.map((p: { path: string }) => p.path), [".", "relative/app", other]);
});

test("a legacy relative record is removed by exact text, never resolved against the working directory", (t) => {
  const f = fixture(t);
  const repo = f.project("cwd-repo");
  f.register(repo);
  const registered = loadRegistry();
  saveRegistry([{ path: ".", name: "." }, ...registered]);
  const job = f.job(repo, { status: "running", pid: process.pid });
  saveJobs([job]);
  const cwd = process.cwd();
  process.chdir(repo);
  const before = snapshot(repo);
  let result;
  try {
    // Resolving "." here would wrongly match the active cwd-repo and block removal.
    result = removeProjects(["."], null)[0]!;
  } finally {
    process.chdir(cwd);
  }
  assert.equal(result.status, "removed", result.message);
  assert.deepEqual(loadRegistry().map((p) => p.path), [repo]);
  assert.deepEqual(loadJobs(), [job]);
  assert.deepEqual(snapshot(repo), before);
});

test("new registry entries are stored as absolute paths", (t) => {
  const f = fixture(t);
  const repo = f.project("launched-with-dot");
  const cwd = process.cwd();
  process.chdir(repo);
  try {
    upsertProject({ path: "." });
  } finally {
    process.chdir(cwd);
  }
  assert.deepEqual(loadRegistry().map((p) => [p.path, p.name]), [[path.resolve(repo), "launched-with-dot"]]);
});

test("receipt cleanup failures leave history/registration and do not prevent other bulk removals", (t) => {
  const f = fixture(t);
  const first = f.project("first");
  const second = f.project("second");
  f.register(first, second);
  const failing = f.job(first);
  saveJobs([failing, f.job(second)]);
  const unlink = fs.unlinkSync;
  t.mock.method(fs, "unlinkSync", (file: fs.PathLike) => {
    if (file === failing.resultPath) throw new Error("Simulated cleanup failure");
    unlink(file);
  });
  const results = removeProjects([first, second], null);
  assert.deepEqual(results.map((r) => r.status), ["failed", "removed"]);
  assert.match(results[0]!.message, /Simulated cleanup failure/);
  assert.deepEqual(loadRegistry().map((p) => p.path), [first]);
  assert.deepEqual(loadJobs(), [failing]);
  t.mock.restoreAll();
});

test("registry save failure restores associated history and reports failure", (t) => {
  const f = fixture(t);
  const repo = f.project("safe");
  f.register(repo);
  const job = f.job(repo);
  saveJobs([job]);
  const registry = fs.readFileSync(registryPath(), "utf8");
  const rename = fs.renameSync;
  t.mock.method(fs, "renameSync", (...args: Parameters<typeof fs.renameSync>) => {
    if (args[1] === registryPath()) throw new Error("Simulated registry failure");
    rename(...args);
  });
  assert.equal(removeProjects([repo], null)[0]?.status, "failed");
  assert.deepEqual(loadJobs(), [job]);
  assert.equal(fs.readFileSync(registryPath(), "utf8"), registry);
  assert.equal(fs.readdirSync(f.home).some((name) => name.endsWith(".tmp")), false);
  t.mock.restoreAll();
});

test("removal API is token gated, validates input, clears selection and permits re-adding the unchanged folder", async (t) => {
  const f = fixture(t);
  const repo = f.project("safe");
  f.register(repo);
  saveJobs([f.job(repo)]);
  const server = await startConsoleServer({ port: 44800, onLog: () => {} });
  t.after(() => server.stop());
  const post = (route: string, body: unknown, token = server.token) => fetch(`${server.url}${route}`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-forge-token": token }, body: JSON.stringify(body),
  });
  const before = snapshot(repo);
  assert.equal((await post("/api/projects/remove", { paths: [repo] }, "wrong")).status, 403);
  for (const body of [null, {}, { paths: [] }, { paths: [""] }, { paths: [42] }]) {
    assert.equal((await post("/api/projects/remove", body)).status, 400);
  }
  assert.equal((await post("/api/projects/select", { path: repo })).status, 200);
  const response = await post("/api/projects/remove", { paths: [repo] });
  assert.equal(response.status, 200);
  const result = await response.json() as { results: Array<{ status: string }>; current: string | null };
  assert.equal(result.current, null);
  assert.equal(result.results[0]?.status, "removed");
  assert.equal(await (await fetch(`${server.url}/api/summary`)).json(), null);
  assert.equal((await post("/api/control", { action: "pause" })).status, 400);
  assert.deepEqual(snapshot(repo), before);
  assert.equal((await post("/api/projects/add", { path: repo })).status, 200);
  assert.deepEqual(loadRegistry().map((p) => p.path), [repo]);
  assert.equal((await post("/api/projects/select", { path: repo })).status, 200);
  assert.deepEqual(snapshot(repo), before);
});
