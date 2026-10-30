#!/usr/bin/env node
// verify.mjs — post-retirement gate.
//
// Fails when Forge authoring/execution artifacts or references survive, when a
// rewritten agent/skill has invalid frontmatter, or when the support team does
// not cover the repository's source areas.
//
// Usage:
//   node scripts/verify.mjs --repo <repo> [--strict-coverage] [--json]

import fs from "node:fs";
import path from "node:path";
import {
  HARNESS_ROOTS,
  SKILL_NAME,
  agentFiles,
  classify,
  coverage,
  detectHarnessRoot,
  extractScopePaths,
  globToRegExp,
  parseFrontmatter,
  readText,
  rel,
  scanDangling,
  skillDirs,
} from "./lib.mjs";

const args = process.argv.slice(2);
const valueFor = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};
const valuesFor = (flag) =>
  args.flatMap((value, index) => (value === flag && args[index + 1] ? [args[index + 1]] : []));
const hasFlag = (flag) => args.includes(flag);
const repo = path.resolve(valueFor("--repo") ?? process.cwd());
const strictCoverage = hasFlag("--strict-coverage");
const keep = valuesFor("--keep");
const keepPatterns = keep.map((pattern) => globToRegExp(pattern));
const isKept = (relativePath) => keepPatterns.some((pattern) => pattern.test(relativePath));
const detected = detectHarnessRoot(repo, valueFor("--harness-root"));
const harnessRootRel = detected?.rootRel ?? null;
const harnessRootAbs = detected?.rootAbs ?? null;

const errors = [];
const warnings = [];

function checkFrontmatter(file, expectedName) {
  const relativePath = rel(repo, file);
  const text = readText(file);
  const parsed = parseFrontmatter(text);
  if (!parsed) {
    errors.push({ path: relativePath, message: "missing or unterminated frontmatter block" });
    return null;
  }
  for (const error of parsed.errors) errors.push({ path: relativePath, message: error });
  const name = (parsed.data.name ?? "").replace(/^["']|["']$/g, "");
  if (!name) errors.push({ path: relativePath, message: "missing 'name' frontmatter" });
  if (expectedName && name !== expectedName) {
    errors.push({ path: relativePath, message: `frontmatter name '${name}' does not match '${expectedName}'` });
  }
  const description = parsed.data.description ?? "";
  if (!description) errors.push({ path: relativePath, message: "missing 'description' frontmatter" });
  if (description && !/^".*"$/.test(description)) {
    errors.push({ path: relativePath, message: "description must be a single-line double-quoted value" });
  }
  if (description && /\b(PRD|feature document|forge-task|forge-result|requirement ID)\b/i.test(description)) {
    errors.push({ path: relativePath, message: "description still refers to the retired build lifecycle" });
  }
  return parsed;
}

if (!harnessRootRel) errors.push({ path: ".", message: `no harness root found (${HARNESS_ROOTS.join(", ")})` });

const plan = classify(repo, { harnessRoot: harnessRootRel, keep });
if (plan.deletions.length > 0) {
  for (const item of plan.deletions) {
    errors.push({ path: item.path, message: `still present after retirement (${item.reason})` });
  }
}
if (plan.reviews.length > 0) {
  for (const item of plan.reviews) warnings.push({ path: item.path, message: `review forge-specific guide: ${item.reason}` });
}

const supportDoc = path.join(repo, "docs", "SUPPORT.md");
if (!fs.existsSync(supportDoc)) {
  errors.push({ path: "docs/SUPPORT.md", message: "missing support-team charter" });
}

const agents = harnessRootAbs
  ? agentFiles(repo, harnessRootAbs).map((file) => rel(repo, file))
  : [];
if (agents.length === 0) errors.push({ path: harnessRootRel ?? ".", message: "no surviving agents found" });

for (const relativePath of agents) {
  const file = path.join(repo, relativePath);
  const parsed = checkFrontmatter(file, path.basename(relativePath, ".md"));
  if (!parsed) continue;
  const mode = (parsed.data.mode ?? "").replace(/^["']|["']$/g, "");
  if (mode && mode !== "all") {
    errors.push({ path: relativePath, message: `mode must be 'all', found '${mode}'` });
  }
  if (!mode) warnings.push({ path: relativePath, message: "missing 'mode: all' frontmatter" });
  if (extractScopePaths(parsed.body).length === 0) {
    errors.push({ path: relativePath, message: "missing '## Scope' with at least one backticked path" });
  }
}

if (harnessRootAbs) {
  for (const skill of skillDirs(repo, harnessRootAbs)) {
    if (skill.name === SKILL_NAME) continue;
    const skillFile = path.join(skill.dir, "SKILL.md");
    if (!fs.existsSync(skillFile)) {
      errors.push({ path: rel(repo, skill.dir), message: "skill directory has no SKILL.md" });
      continue;
    }
    checkFrontmatter(skillFile, skill.name);
  }
}

for (const finding of scanDangling(repo, harnessRootRel)) {
  if (isKept(finding.path)) continue;
  errors.push({
    path: finding.path,
    message: `line ${finding.line}: references ${finding.markers.join(", ")} — ${finding.text}`,
  });
}

const coverageResult = coverage(repo, agents);
for (const dir of coverageResult.uncovered) {
  const item = { path: dir, message: "source area is not covered by any agent's Scope" };
  if (strictCoverage) errors.push(item);
  else warnings.push(item);
}
for (const agent of coverageResult.ownerless) {
  warnings.push({ path: agent, message: "agent Scope matches no known source area; verify its ownership" });
}

if (fs.existsSync(supportDoc) && agents.length > 0) {
  const support = readText(supportDoc);
  for (const agent of agents) {
    const name = path.basename(agent, ".md");
    if (!support.includes(name)) {
      warnings.push({ path: "docs/SUPPORT.md", message: `support charter does not mention '${name}'` });
    }
  }
}

const result = {
  ok: errors.length === 0,
  repo,
  harnessRoot: harnessRootRel,
  errors,
  warnings,
  coverage: coverageResult,
};

if (hasFlag("--json")) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  if (errors.length === 0) process.stdout.write("✔ Retirement verification passed.\n");
  else {
    process.stdout.write(`✖ Retirement verification failed with ${errors.length} error(s):\n`);
    for (const item of errors) process.stdout.write(`  ${item.path}: ${item.message}\n`);
  }
  if (warnings.length > 0) {
    process.stdout.write(`\n⚠ ${warnings.length} warning(s):\n`);
    for (const item of warnings) process.stdout.write(`  ${item.path}: ${item.message}\n`);
  }
}

process.exit(result.ok ? 0 : 1);
