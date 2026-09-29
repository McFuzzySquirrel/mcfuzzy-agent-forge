import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  clearSandboxRoot,
  createSandbox,
  destroySandbox,
  ensureSandboxExcluded,
  integrateSandbox,
  preflightSandboxMode,
  sandboxProvidedPaths,
  sandboxRoot,
  sweepStaleSandboxes,
} from "./sandbox.ts";
import { captureWorktree, diffWorktree } from "./verify.ts";

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

/** A committed repository with a gitignored build input and engine metadata. */
function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-sandbox-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "forge-test@local"]);
  git(root, ["config", "user.name", "Forge Test"]);
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n", "utf8");
  writeFileSync(join(root, "docs", "PRD.md"), "# Vision\n", "utf8");
  writeFileSync(join(root, "node_modules", "dep", "index.js"), "module.exports = 1;\n", "utf8");
  writeFileSync(join(root, ".gitignore"), "node_modules/\n", "utf8");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "seed"]);
  return root;
}

test("preflight passes on a clean repository and on untracked engine metadata", async () => {
  const root = makeRepo();
  assert.deepEqual(await preflightSandboxMode(root), { ok: true });

  writeFileSync(join(root, "docs", "EXECUTION-MANIFEST.json"), "{}\n", "utf8");
  assert.deepEqual(await preflightSandboxMode(root), { ok: true }, "untracked docs/ metadata is seeded, not blocking");
});

test("preflight names every uncommitted path that blocks parallel execution", async () => {
  const root = makeRepo();
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "wip.ts"), "work in progress\n", "utf8");
  writeFileSync(join(root, "docs", "PRD.md"), "# Vision, edited\n", "utf8");

  const result = await preflightSandboxMode(root);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /clean working tree/);
  assert.match(result.reason ?? "", /src\/wip\.ts/);
  assert.match(result.reason ?? "", /docs\/PRD\.md/, "a modified tracked docs file blocks rather than silently diverging");
  assert.match(result.reason ?? "", /--concurrency 1/, "the message offers a way forward");
});

test("preflight refuses a non-repository and a repository with no commits", async () => {
  const empty = mkdtempSync(join(tmpdir(), "forge-sandbox-empty-"));
  assert.match((await preflightSandboxMode(empty)).reason ?? "", /git repository/);

  const noCommits = mkdtempSync(join(tmpdir(), "forge-sandbox-nocommit-"));
  execFileSync("git", ["init", "-q"], { cwd: noCommits });
  assert.match((await preflightSandboxMode(noCommits)).reason ?? "", /at least one commit/);
});

test("ensureSandboxExcluded keeps the sandbox root out of git status without touching .gitignore", async () => {
  const root = makeRepo();
  await ensureSandboxExcluded(root);
  const exclude = readFileSync(join(root, ".git", "info", "exclude"), "utf8");
  assert.match(exclude, /^\.forge-sandboxes\/$/m);
  assert.equal(readFileSync(join(root, ".gitignore"), "utf8"), "node_modules/\n", "the tracked .gitignore is untouched");

  // Idempotent: a second run must not append the entry again.
  await ensureSandboxExcluded(root);
  assert.equal(readFileSync(join(root, ".git", "info", "exclude"), "utf8").match(/\.forge-sandboxes\//g)?.length, 1);
  assert.equal(git(root, ["status", "--porcelain"]).trim(), "", "a clean repo stays clean");
});

test("a sandbox is a clean checkout with build inputs linked and metadata seeded", async () => {
  const root = makeRepo();
  writeFileSync(join(root, "docs", "EXECUTION-MANIFEST.json"), '{"tasks":[]}\n', "utf8");
  const sandbox = await createSandbox(root, "1.1");

  assert.ok(sandbox.path.startsWith(sandboxRoot(root)));
  assert.deepEqual(sandbox.linkedInputs, ["node_modules"], "the gitignored build input is linked in");
  assert.ok(existsSync(join(sandbox.path, "src", "a.ts")), "tracked files are checked out");
  assert.ok(existsSync(join(sandbox.path, "node_modules", "dep", "index.js")), "node_modules is reachable in the sandbox");
  assert.equal(readFileSync(join(sandbox.path, "docs", "EXECUTION-MANIFEST.json"), "utf8"), '{"tasks":[]}\n');

  // The engine root must not see the sandbox; the untracked manifest the test
  // itself wrote is the only thing listed.
  const engineRootStatus = git(root, ["status", "--porcelain", "-uall"]);
  assert.ok(!engineRootStatus.includes(".forge-sandboxes"), "the sandbox is hidden from the engine root");
  assert.deepEqual(engineRootStatus.trim().split("\n").filter(Boolean), ["?? docs/EXECUTION-MANIFEST.json"]);

  // The engine snapshots the sandbox after seeding, so nothing it placed there
  // can be attributed to the task.
  const baseline = await captureWorktree(sandbox.path);
  const after = await captureWorktree(sandbox.path);
  assert.deepEqual(diffWorktree(baseline, after), []);
  assert.deepEqual(sandboxProvidedPaths(sandbox).sort(), ["docs/EXECUTION-MANIFEST.json", "node_modules"]);

  await destroySandbox(root, sandbox.path);
  assert.ok(!existsSync(sandbox.path));
  await clearSandboxRoot(root);
});

test("integrateSandbox copies a task's work, deletions, and symlinks back into the engine root", async () => {
  const root = makeRepo();
  const sandbox = await createSandbox(root, "1.1");
  // The engine's contract: the change set is the post-task snapshot diffed
  // against a baseline taken after seeding, so the linked build input and the
  // seeded metadata are not task work.
  const before = await captureWorktree(sandbox.path);
  writeFileSync(join(sandbox.path, "src", "new.ts"), "export const n = 1;\n", "utf8");
  writeFileSync(join(sandbox.path, "src", "a.ts"), "export const a = 2;\n", "utf8");
  rmSync(join(sandbox.path, "docs", "PRD.md"));
  symlinkSync("a.ts", join(sandbox.path, "src", "alias.ts"));
  const changed = diffWorktree(before, await captureWorktree(sandbox.path));
  assert.ok(!changed.includes("node_modules"), "a linked build input is never task work");

  const claimed = new Set<string>();
  const result = await integrateSandbox({ repoRoot: root, sandbox: sandbox.path, paths: changed, claimed });

  assert.deepEqual(result.conflicts, []);
  assert.deepEqual([...result.copied].sort(), ["src/a.ts", "src/alias.ts", "src/new.ts"]);
  assert.deepEqual(result.deleted, ["docs/PRD.md"]);
  assert.equal(readFileSync(join(root, "src", "a.ts"), "utf8"), "export const a = 2;\n");
  assert.equal(readFileSync(join(root, "src", "new.ts"), "utf8"), "export const n = 1;\n");
  assert.ok(!existsSync(join(root, "docs", "PRD.md")));
  assert.deepEqual(claimed, new Set(changed));

  await destroySandbox(root, sandbox.path);
  await clearSandboxRoot(root);
});

test("integrateSandbox refuses a path another task already integrated, and copies nothing", async () => {
  const root = makeRepo();
  const sandbox = await createSandbox(root, "1.1");
  writeFileSync(join(sandbox.path, "src", "clash.ts"), "export const clash = 1;\n", "utf8");

  const claimed = new Set(["src/clash.ts"]);
  const result = await integrateSandbox({ repoRoot: root, sandbox: sandbox.path, paths: ["src/clash.ts"], claimed });

  assert.deepEqual(result.conflicts, ["src/clash.ts"]);
  assert.deepEqual(result.copied, []);
  assert.ok(!existsSync(join(root, "src", "clash.ts")), "a losing task's work is never merged over its sibling's");

  await destroySandbox(root, sandbox.path);
  await clearSandboxRoot(root);
});

test("integrateSandbox refuses a path that escapes either root", async () => {
  const root = makeRepo();
  const sandbox = await createSandbox(root, "1.1");
  await assert.rejects(
    () => integrateSandbox({ repoRoot: root, sandbox: sandbox.path, paths: ["../escape.ts"], claimed: new Set() }),
    /outside the repository/,
  );
  await destroySandbox(root, sandbox.path);
  await clearSandboxRoot(root);
});

test("sweepStaleSandboxes removes worktrees left behind by a killed engine", async () => {
  const root = makeRepo();
  const survivor = await createSandbox(root, "1.1");
  const stale = await createSandbox(root, "1.2");
  writeFileSync(join(stale.path, "src", "half-done.ts"), "interrupted\n", "utf8");
  // Simulate a crash: the directory and its registration survive.
  await destroySandbox(root, survivor.path);

  const removed = await sweepStaleSandboxes(root);

  assert.equal(removed, 1);
  assert.ok(!existsSync(stale.path));
  assert.ok(!existsSync(sandboxRoot(root)), "the sandbox root is removed too");
  const registered = git(root, ["worktree", "list", "--porcelain"]).match(/^worktree /gm)?.length;
  assert.equal(registered, 1, "only the main worktree remains registered");
  assert.equal(git(root, ["status", "--porcelain", "-uall"]).trim(), "", "the engine root is untouched by the sweep");
});

test("destroySandbox ignores a path that is not inside the sandbox root", async () => {
  const root = makeRepo();
  const elsewhere = mkdtempSync(join(tmpdir(), "forge-not-a-sandbox-"));
  writeFileSync(join(elsewhere, "keep.txt"), "keep\n", "utf8");
  await destroySandbox(root, elsewhere);
  assert.ok(existsSync(join(elsewhere, "keep.txt")), "cleanup can never delete outside the sandbox root");
  rmSync(elsewhere, { recursive: true, force: true });
});

test("destroySandbox still removes a sandbox whose path is spelled the way git prints it", async () => {
  const root = makeRepo();
  const sandbox = await createSandbox(root, "1.1");
  // git reports worktrees with forward slashes and no trailing separator, and on
  // Windows the path can come back in a different case or through a short name.
  // A spelling mismatch used to make teardown skip the worktree entirely and
  // leak its registration.
  const asGitPrintsIt = sandbox.path.replace(/\\/g, "/").replace(/\/+$/, "");

  await destroySandbox(root, asGitPrintsIt);

  assert.ok(!existsSync(sandbox.path), `sandbox at ${sandbox.path} should be gone`);
  assert.equal(git(root, ["worktree", "list", "--porcelain"]).match(/^worktree /gm)?.length, 1, "no registration is left behind");
  await clearSandboxRoot(root);
});
