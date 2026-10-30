#!/usr/bin/env node
// self-delete.mjs — remove the retirement skill after verification passes.
//
// The script copies itself to a temporary directory and respawns there before
// deleting the installed skill directory. That keeps Windows from trying to
// remove a directory that still contains the running script.
//
// Usage:
//   node scripts/self-delete.mjs --repo <repo>
//   node scripts/self-delete.mjs --repo <repo> --finalize --skill-dir <dir>

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { SKILL_NAME, detectHarnessRoot, posix } from "./lib.mjs";

const args = process.argv.slice(2);
const valueFor = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};
const hasFlag = (flag) => args.includes(flag);
const repo = path.resolve(valueFor("--repo") ?? process.cwd());
const finalize = hasFlag("--finalize");
const explicitSkillDir = valueFor("--skill-dir");

function skillDirectory() {
  if (explicitSkillDir) return path.resolve(explicitSkillDir);
  const detected = detectHarnessRoot(repo);
  return detected ? path.join(detected.rootAbs, "skills", SKILL_NAME) : null;
}

function guard(skillDir) {
  if (!skillDir) throw new Error("Could not locate the retirement skill directory.");
  if (path.basename(skillDir) !== SKILL_NAME) {
    throw new Error(`Refusing to delete '${skillDir}': not the retirement skill directory.`);
  }
  if (path.basename(path.dirname(skillDir)) !== "skills") {
    throw new Error(`Refusing to delete '${skillDir}': parent directory is not 'skills'.`);
  }
  const relative = path.relative(repo, skillDir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to delete '${skillDir}': outside the repository.`);
  }
}

const skillDir = skillDirectory();
guard(skillDir);

if (!finalize) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${SKILL_NAME}-`));
  const tempScript = path.join(tempDir, "self-delete.mjs");
  fs.copyFileSync(new URL(import.meta.url), tempScript);
  fs.copyFileSync(new URL("./lib.mjs", import.meta.url), path.join(tempDir, "lib.mjs"));
  const result = spawnSync(process.execPath, [tempScript, "--repo", repo, "--finalize", "--skill-dir", skillDir], {
    stdio: "inherit",
    cwd: repo,
  });
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.exit(result.status ?? 1);
}

fs.rmSync(skillDir, { recursive: true, force: true });
process.stdout.write(`Removed ${posix(path.relative(repo, skillDir))}.\n`);
