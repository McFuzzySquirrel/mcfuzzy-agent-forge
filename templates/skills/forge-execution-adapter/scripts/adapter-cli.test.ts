import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExecutionManifest } from "./types.ts";

function mixedRootFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-cli-mixed-roots-"));
  for (const harness of [".agents", ".github"]) {
    const agentRoot = join(root, harness, "agents");
    mkdirSync(agentRoot, { recursive: true });
    writeFileSync(join(agentRoot, "service-engineer.md"),
      `---\nname: ${harness.slice(1)}-specialist\ndescription: Implements service entry points.\n---\n`);
  }
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs", "PRD.md"),
    "# PRD\n\n## Phase 1: Foundation\n- Create service entry point `src/index.ts`\n");
  return root;
}

function invoke(root: string, command: string, flags: string[] = []) {
  return spawnSync(process.execPath, [
    "--import", "tsx", fileURLToPath(new URL("./adapter.ts", import.meta.url)),
    command, "--repo", root, ...flags,
  ], { encoding: "utf8" });
}

test("inspect pins the explicit root rather than redetecting another generated team", (t) => {
  const root = mixedRootFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const implicit = invoke(root, "inspect");
  assert.equal(implicit.status, 0, implicit.stderr);
  assert.equal(JSON.parse(implicit.stdout).harnessRoot, ".agents");
  for (const flag of [["--harness-root", ".github"], ["--harness-root=.github"]]) {
    const explicit = invoke(root, "inspect", flag);
    assert.equal(explicit.status, 0, explicit.stderr);
    const repo = JSON.parse(explicit.stdout);
    assert.equal(repo.harnessRoot, ".github");
    assert.deepEqual(repo.agents.map((agent: { name: string }) => agent.name), ["github-specialist"]);
  }
});

test("granularity recompilation retains the explicit manifest team root and owners", (t) => {
  const root = mixedRootFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const granularity of ["coarse", "fine"]) {
    const result = invoke(root, "compile", ["--harness-root", ".github", "--granularity", granularity]);
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(readFileSync(join(root, "docs", "EXECUTION-MANIFEST.json"), "utf8")) as ExecutionManifest;
    assert.equal(manifest.harnessRoot, ".github");
    assert.equal(manifest.granularity, granularity);
    assert.ok(manifest.phases.flatMap((phase) => phase.tasks).every((task) => task.ownerAgent === "github-specialist"));
  }
});

test("invalid explicit root flags never fall back or overwrite an existing manifest", (t) => {
  const root = mixedRootFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const initial = invoke(root, "compile", ["--harness-root", ".github"]);
  assert.equal(initial.status, 0, initial.stderr);
  const manifestPath = join(root, "docs", "EXECUTION-MANIFEST.json");
  const original = readFileSync(manifestPath, "utf8");
  for (const flags of [
    ["--harness-root", ".invalid"],
    ["--harness-root"],
    ["--harness-root="],
    ["--harness-root", "--granularity", "fine"],
    ["--harness-root", ".github", "--harness-root", ".agents"],
    ["--harness-root", ".opencode"],
  ]) {
    const result = invoke(root, "compile", flags);
    assert.notEqual(result.status, 0, JSON.stringify(flags));
    assert.match(result.stderr, /Invalid --harness-root|Conflicting --harness-root|Selected harness root does not exist/);
    assert.equal(readFileSync(manifestPath, "utf8"), original);
  }
});
