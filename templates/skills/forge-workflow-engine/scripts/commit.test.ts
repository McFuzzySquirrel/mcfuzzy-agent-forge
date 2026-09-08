import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
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

test("commitTaskWork logs Git stderr when staging fails", async (context) => {
  const root = mkdtempSync(join(tmpdir(), "forge-commit-error-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  initGit(root);
  writeFileSync(join(root, "result.txt"), "Task output");
  writeFileSync(join(root, ".git", "index.lock"), "");
  const warnings: string[] = [];
  context.mock.method(console, "warn", (message: string) => warnings.push(message));

  assert.equal(await commitTaskWork("1", "Task", root), null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /git add failed/);
  assert.match(warnings[0]!, /index\.lock/);
  assert.match(warnings[0]!, /File exists/);
});

for (const directory of ["docs/artifacts", "docs/task-executions"]) {
test(`auto-commit succeeds when ${directory} is ignored`, async (context) => {
  const root = mkdtempSync(join(tmpdir(), "forge-commit-ignored-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  initGit(root);
  mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, directory, "request.md"), "Engine snapshot");
  writeFileSync(join(root, ".gitignore"), `${directory}/\n`);
  writeFileSync(join(root, "result.txt"), "Task output");

  assert.ok(await commitTaskWork("1", "Task", root));
  assert.deepEqual(
    execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], { cwd: root, encoding: "utf8" }).trim().split("\n"),
    [".gitignore", "result.txt"],
  );
  execFileSync("git", ["add", "-f", directory], { cwd: root });
  assert.equal(await commitTaskWork("2", "Task", root), null);
  assert.match(execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: root, encoding: "utf8" }), /request.md/);
});

test(`auto-commit excludes ${directory} and refuses pre-staged snapshots without discarding them`, async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-commit-execution-"));
  initGit(root);
  mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, directory, "request.md"), "Engine snapshot");
  mkdirSync(join(root, directory, "nested"), { recursive: true });
  writeFileSync(join(root, directory, "nested", "result.json"), "{}");
  mkdirSync(join(root, `${directory}-source`), { recursive: true });
  writeFileSync(join(root, `${directory}-source`, "keep.txt"), "Task output");
  writeFileSync(join(root, "result.txt"), "Task output");
  assert.ok(await commitTaskWork("1", "Task", root));
  assert.equal(execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), `${directory}-source/keep.txt\nresult.txt`);
  execFileSync("git", ["add", directory], { cwd: root });
  assert.equal(await commitTaskWork("2", "Task", root), null);
  assert.match(execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: root, encoding: "utf8" }), /request.md/);
});
}
