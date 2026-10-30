#!/usr/bin/env node
// apply.mjs — apply the Forge retirement inventory.
//
// Deletes only known Forge artifacts and Forge-named skills/agents. Project
// source, tests, documentation, and project-authored skills are never removed.
//
// Usage:
//   node scripts/apply.mjs --repo <repo>                    # dry run
//   node scripts/apply.mjs --repo <repo> --apply
//   node scripts/apply.mjs --repo <repo> --apply --archive
//   node scripts/apply.mjs --repo <repo> --apply --allow-dirty

import fs from "node:fs";
import path from "node:path";
import { GITIGNORE_FORGE_ENTRIES, SKILL_NAME, classify, isGitRepo, posix } from "./lib.mjs";

const args = process.argv.slice(2);
const valueFor = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};
const valuesFor = (flag) =>
  args.flatMap((value, index) => (value === flag && args[index + 1] ? [args[index + 1]] : []));
const hasFlag = (flag) => args.includes(flag);

const repo = path.resolve(valueFor("--repo") ?? process.cwd());
const apply = hasFlag("--apply");
const archive = hasFlag("--archive");
const allowDirty = hasFlag("--allow-dirty");

const plan = classify(repo, {
  harnessRoot: valueFor("--harness-root"),
  keep: valuesFor("--keep"),
});

if (plan.preflight.blocking.length > 0) {
  for (const item of plan.preflight.blocking) process.stderr.write(`✖ ${item}\n`);
  process.exit(1);
}
if (!plan.preflight.clean && !allowDirty) {
  process.stderr.write("✖ Working tree is not clean. Commit or stash first, or pass --allow-dirty.\n");
  process.exit(1);
}
if (!isGitRepo(repo)) {
  process.stderr.write("✖ Not a git repository; refusing to delete files without history.\n");
  process.exit(1);
}

const protectedPaths = plan.deletions.filter((item) => item.path.includes(SKILL_NAME));
if (protectedPaths.length > 0) {
  process.stderr.write(`✖ Internal error: the retirement plan targets its own skill (${protectedPaths[0].path}).\n`);
  process.exit(1);
}

if (!apply) {
  process.stdout.write(`Dry run: ${plan.deletions.length} path(s) would be removed.\n`);
  for (const item of plan.deletions) process.stdout.write(`  ${archive ? "archive" : "delete"}  ${item.path}\n`);
  process.stdout.write("Re-run with --apply to execute.\n");
  process.exit(0);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const archiveRoot = path.join(repo, ".forge-archive", timestamp);
const removed = [];
const archived = [];

function assertInsideRepo(target) {
  const relative = path.relative(repo, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to touch a path outside the repository: ${target}`);
  }
}

function removePath(relativePath) {
  const source = path.join(repo, relativePath);
  assertInsideRepo(source);
  if (!fs.existsSync(source)) return;
  if (archive) {
    const destination = path.join(archiveRoot, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    try {
      fs.renameSync(source, destination);
    } catch {
      fs.cpSync(source, destination, { recursive: true });
      fs.rmSync(source, { recursive: true, force: true });
    }
    archived.push(relativePath);
  } else {
    fs.rmSync(source, { recursive: true, force: true });
    removed.push(relativePath);
  }
}

for (const item of plan.deletions) removePath(item.path);

// A keep glob can turn a directory deletion into file-level removals. Remove
// any of the known directories that are now empty so the repository is clean.
for (const relativeDir of ["docs/features", "docs/artifacts", "docs/task-executions", "docs/reviews"]) {
  const absolute = path.join(repo, relativeDir);
  try {
    if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory() && fs.readdirSync(absolute).length === 0) {
      fs.rmdirSync(absolute);
    }
  } catch {
    // Leave a directory that cannot be removed; the verify step reports it.
  }
}

if (archive) {
  const manifest = {
    retiredAt: new Date().toISOString(),
    repository: repo,
    paths: plan.deletions.map((item) => ({ path: item.path, group: item.group })),
    rewrites: plan.rewrites,
    reviews: plan.reviews,
  };
  fs.mkdirSync(archiveRoot, { recursive: true });
  fs.writeFileSync(path.join(archiveRoot, "RETIREMENT-MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function cleanGitignore() {
  const file = path.join(repo, ".gitignore");
  if (!fs.existsSync(file)) return;
  const original = fs.readFileSync(file, "utf8");
  const lines = original.split(/\r?\n/);
  const filtered = lines.filter((line) => !GITIGNORE_FORGE_ENTRIES.includes(line.trim()));
  const next = filtered.join("\n");
  if (next !== original) fs.writeFileSync(file, next.endsWith("\n") ? next : `${next}\n`);
}

cleanGitignore();

process.stdout.write(
  `${archive ? "Archived" : "Removed"} ${archive ? archived.length : removed.length} path(s)` +
    `${archive ? ` under ${posix(path.relative(repo, archiveRoot))}` : ""}.\n`,
);
for (const item of archive ? archived : removed) process.stdout.write(`  ${item}\n`);
process.stdout.write("Next: rewrite agents, skills, and active docs, then run scripts/verify.mjs.\n");
