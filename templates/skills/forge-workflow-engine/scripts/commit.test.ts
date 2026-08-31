import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildCommitMessage, commitTaskWork } from "./commit.ts";

function initGit(root: string): void {
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "forge-test@local"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Forge Test"], { cwd: root });
}

function gitLogOneline(root: string): string[] {
  return execFileSync("git", ["log", "--oneline"], { cwd: root, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
}

test("buildCommitMessage substitutes {taskId} and {taskTitle} placeholders", () => {
  assert.equal(
    buildCommitMessage("1.1", "Build a thing"),
    "feat(forge-engine): complete task 1.1 - Build a thing",
  );
  assert.equal(
    buildCommitMessage("1.1", "Build a thing", "chore(task {taskId}): {taskTitle}"),
    "chore(task 1.1): Build a thing",
  );
});

test("commitTaskWork commits staged work and returns the SHA", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-commit-"));
  initGit(root);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "thing.ts"), "export const thing = 1;\n", "utf8");
  mkdirSync(join(root, "docs"), { recursive: true });

  const sha = await commitTaskWork("1.1", "Build a thing", root);
  assert.ok(sha, "a commit should be created");
  assert.match(sha, /^[0-9a-f]{40}$/);

  const log = gitLogOneline(root);
  assert.equal(log.length, 1);
  assert.match(log[0]!, /feat\(forge-engine\): complete task 1\.1 - Build a thing/);
});

test("commitTaskWork skips gracefully when there is nothing to commit", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-commit-"));
  initGit(root);
  writeFileSync(join(root, "a.txt"), "a\n", "utf8");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: root });

  const sha = await commitTaskWork("1.1", "Build a thing", root);
  assert.equal(sha, null);
  assert.equal(gitLogOneline(root).length, 1, "no extra commit should be made");
});

test("commitTaskWork returns null for a directory that is not a git repo", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-commit-"));
  writeFileSync(join(root, "a.txt"), "a\n", "utf8");
  assert.equal(await commitTaskWork("1.1", "Build a thing", root), null);
});

test("commitTaskWork honors a custom message template", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-commit-"));
  initGit(root);
  writeFileSync(join(root, "b.txt"), "b\n", "utf8");

  const sha = await commitTaskWork("2.3", "Fix the bug", root, "chore(task {taskId}): {taskTitle}");
  assert.ok(sha);
  assert.match(gitLogOneline(root)[0]!, /chore\(task 2\.3\): Fix the bug/);
});
