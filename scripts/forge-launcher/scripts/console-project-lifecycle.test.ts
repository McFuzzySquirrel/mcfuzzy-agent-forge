import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { startConsoleServer } from "./console/server.ts";
import { saveRegistry } from "./console/paths.ts";

test("the Projects API exposes state-aware routing and keeps unavailable entries", async (t) => {
  const root = path.resolve(process.cwd(), "../..", ".scratch", `console-project-lifecycle-${randomUUID()}`);
  const home = path.join(root, "forge-home");
  const originalHome = process.env.FORGE_HOME;
  process.env.FORGE_HOME = home;
  t.after(() => {
    if (originalHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = originalHome;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const states = [
    ["new", "new", null],
    ["partial", "partially-authored", "idea"],
    ["review", "needs-review", "prd"],
    ["preparing", "preparing", "team"],
    ["ready", "ready-to-start", "manifest"],
    ["running", "running", "running"],
    ["blocked", "blocked", "paused"],
    ["failed", "failed", "failed"],
    ["completed", "completed", "complete"],
  ] as const;
  const projects = states.map(([name, lifecycleState, stage]) => {
    const repo = path.join(root, name);
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
    fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
    if (stage === "idea") fs.writeFileSync(path.join(repo, "docs", "IDEA.md"), "# Idea\n");
    if (stage === "prd") {
      fs.writeFileSync(path.join(repo, "docs", "PRD.md"), "# Brief\n");
      fs.mkdirSync(path.join(repo, "docs", "features"), { recursive: true });
    }
    if (stage === "team") {
      fs.mkdirSync(path.join(repo, ".agents", "agents"), { recursive: true });
      fs.writeFileSync(path.join(repo, ".agents", "agents", "developer.md"), "name: developer\n");
    }
    if (stage === "manifest") fs.writeFileSync(path.join(repo, "docs", "EXECUTION-MANIFEST.json"), "{}");
    if (stage && ["running", "paused", "failed", "complete"].includes(stage)) {
      fs.writeFileSync(path.join(repo, "docs", "WORKFLOW-STATE.json"), JSON.stringify({ status: stage }));
    }
    return { path: repo, name, lifecycleState };
  });
  const missing = path.join(root, "unavailable");
  saveRegistry([
    ...projects.map(({ path: projectPath, name }) => ({ path: projectPath, name })),
    { path: missing, name: "unavailable" },
  ]);

  const server = await startConsoleServer({ port: 45000, onLog: () => {} });
  t.after(() => server.stop());
  const response = await fetch(`${server.url}/api/projects`);
  assert.equal(response.status, 200);
  const index = await response.json() as { projects: Array<{ name: string; lifecycleState?: string }> };
  const actual = new Map(index.projects.map((project) => [project.name, project.lifecycleState]));

  for (const [name, lifecycleState] of states) {
    assert.equal(actual.get(name), lifecycleState, `${name} should expose its current lifecycle state`);
  }
  assert.equal(actual.get("unavailable"), "unavailable");
  assert.equal(index.projects.length, states.length + 1, "unavailable Projects remain registered and visible");
});
