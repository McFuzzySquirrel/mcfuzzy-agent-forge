#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { selectHarnessRoot } from "../../forge-execution-adapter/scripts/repo-metadata.mjs";

const args = process.argv.slice(2);
const valueFor = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};
const valuesFor = (flag) => args.flatMap((value, index) => value === flag ? [args[index + 1]] : []).filter(Boolean);
const hasFlag = (flag) => args.includes(flag);
const repoRoot = resolve(valueFor("--repo") ?? process.cwd());
const explicitHarness = valueFor("--harness-root");
const explicitSkills = valueFor("--skills-dir");
const explicitSkillFiles = valuesFor("--skill-file");
const candidateFile = valueFor("--candidate-file") ?? join(repoRoot, "docs", "SKILL-CANDIDATES.json");
const minAxis = Number(valueFor("--min-axis") ?? "1");
const failAxisBelow = hasFlag("--fail-axis-below");
const failStructural = hasFlag("--fail-structural");
const AXES = [
  ["contextEconomy", (text) => text.length < 12000 && !/what is an? |stands for|in simple terms/i.test(text)],
  ["gotchasCoverage", (text) => /^##\s+Gotchas\b/im.test(text) && (text.match(/^\s*[-*]/gm) ?? []).length >= 3],
  ["proceduralClarity", (text) => /^##\s+Process\b/im.test(text) && (text.match(/^###?\s+Step\s+\d+/gm) ?? []).length >= 2],
  ["progressiveDisclosure", (text) => text.length < 20000 && /references\//i.test(text) && /load (?:when|`references\/)/i.test(text)],
  ["calibration", (text) => /(?:by default|if that doesn't work|fallback|alternatively|standard command)/i.test(text) && /`[^`]{3,}`|```/i.test(text)],
  ["validation", (text) => /^##\s+Validation\b/im.test(text) && (text.match(/^\s*-\s*\[[ x]\]/gm) ?? []).length >= 3],
];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".git", "dist"].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function detectHarness() {
  if (explicitHarness) return resolve(explicitHarness);
  const selected = selectHarnessRoot(repoRoot);
  if (!selected.root) throw new Error("Could not detect a harness root. Pass --harness-root.");
  return join(repoRoot, selected.root);
}

function frontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { data: {}, errors: ["missing frontmatter opening delimiter"] };
  const end = lines.slice(1).findIndex((line) => line.trim() === "---");
  if (end < 0) return { data: {}, errors: ["missing frontmatter closing delimiter"] };
  const data = {};
  const errors = [];
  for (let i = 1; i <= end; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/^\s/.test(line)) {
      errors.push(`line ${i + 1}: frontmatter continuation is not supported`);
      continue;
    }
    const colon = line.indexOf(":");
    if (colon < 1) {
      errors.push(`line ${i + 1}: invalid frontmatter field`);
      continue;
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!value) errors.push(`line ${i + 1}: empty ${key}`);
    data[key] = value;
    if (key === "description" && (!(value.startsWith('"') && value.endsWith('"')) || /[\r\n]/.test(value))) {
      errors.push(`line ${i + 1}: description must be single-line and double-quoted`);
    }
    if (/^[>|]/.test(value)) errors.push(`line ${i + 1}: block scalars are not supported`);
  }
  if (!data.name) errors.push("missing name");
  if (!data.description) errors.push("missing description");
  return { data, errors };
}

function links(text) {
  return [...text.matchAll(/\]\(([^)#]+\.md)(?:#[^)]+)?\)/g)].map((match) => match[1]);
}

function validateFile(file, kind, expectedName, root) {
  const text = readFileSync(file, "utf8");
  const parsed = frontmatter(text);
  const errors = [...parsed.errors];
  if (parsed.data.name && parsed.data.name !== expectedName) {
    errors.push(`name "${parsed.data.name}" does not match "${expectedName}"`);
  }
  if (kind === "agent") {
    for (const section of ["Responsibilities", "Collaboration"]) {
      if (!new RegExp(`^##\\s+${section}\\b`, "im").test(text)) errors.push(`missing ## ${section}`);
    }
  } else {
    for (const section of ["Process", "Validation", "Gotchas"]) {
      if (!new RegExp(`^##\\s+${section}\\b`, "im").test(text)) errors.push(`missing ## ${section}`);
    }
    for (const link of links(text)) {
      if (!existsSync(resolve(file, "..", link))) errors.push(`missing referenced file ${link}`);
    }
  }
  const scores = Object.fromEntries(AXES.map(([axis, predicate]) => [axis, predicate(text) ? 3 : 1]));
  return { file: relative(root, file), kind, errors, scores };
}

function validateCandidates(agentResults) {
  if (!existsSync(candidateFile)) return [];
  const errors = [];
  let handoff;
  try {
    handoff = JSON.parse(readFileSync(candidateFile, "utf8"));
  } catch (error) {
    return [`invalid candidate handoff JSON: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (handoff?.version !== 1 || !Array.isArray(handoff.candidates)) {
    return ["candidate handoff must contain version: 1 and candidates: []"];
  }
  const agentNames = new Set(agentResults.filter((result) => result.kind === "agent").map((result) => result.expectedName));
  const actions = new Set(["reuse", "extend", "create", "omit"]);
  for (const [index, candidate] of handoff.candidates.entries()) {
    const prefix = `candidate[${index}]`;
    if (!candidate || typeof candidate !== "object") {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    for (const key of ["name", "description", "reason"]) {
      if (typeof candidate[key] !== "string" || !candidate[key].trim()) errors.push(`${prefix}.${key} must be a non-empty string`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate.name ?? "")) errors.push(`${prefix}.name must be lowercase kebab-case`);
    if (!Array.isArray(candidate.consumers) || candidate.consumers.some((consumer) => typeof consumer !== "string")) {
      errors.push(`${prefix}.consumers must be an array of agent names`);
    } else if (candidate.action !== "omit") {
      for (const consumer of candidate.consumers) {
        if (!agentNames.has(consumer)) errors.push(`${prefix}.consumers references missing agent "${consumer}"`);
      }
    }
    if (!actions.has(candidate.action)) errors.push(`${prefix}.action must be reuse, extend, create, or omit`);
  }
  return errors;
}

function main() {
  if (!Number.isFinite(minAxis) || minAxis < 1 || minAxis > 3) throw new Error("--min-axis must be between 1 and 3");
  const harness = detectHarness();
  const skills = explicitSkills ? resolve(explicitSkills) : join(harness, "skills");
  const agents = join(harness, "agents");
  const results = [];
  for (const file of walk(agents).filter((entry) => entry.endsWith(".md") && !entry.endsWith("SKILL.md"))) {
    const result = validateFile(file, "agent", file.split("/").pop().replace(/\.md$/, ""), repoRoot);
    result.expectedName = file.split("/").pop().replace(/\.md$/, "");
    results.push(result);
  }
  const skillFiles = explicitSkillFiles.length > 0
    ? explicitSkillFiles.map((file) => resolve(repoRoot, file))
    : walk(skills).filter((entry) => entry.endsWith("SKILL.md"));
  for (const file of skillFiles) {
    results.push(validateFile(file, "skill", file.split("/").slice(-2, -1)[0], repoRoot));
  }
  const structural = results.filter((result) => result.errors.length > 0);
  const candidateErrors = validateCandidates(results);
  const axisFailures = results.filter((result) => result.kind === "skill").flatMap((result) =>
    Object.entries(result.scores).filter(([, score]) => score < minAxis).map(([axis]) => `${result.file}: ${axis}`),
  );
  for (const result of structural) {
    console.error(`✖ ${result.file}`);
    for (const error of result.errors) console.error(`    ${error}`);
  }
  for (const error of candidateErrors) console.error(`✖ ${candidateFile}\n    ${error}`);
  if (axisFailures.length > 0) {
    console.error(`\nPer-axis failures (minimum ${minAxis}):`);
    for (const failure of axisFailures) console.error(`    ${failure}`);
  }
  if ((failStructural && (structural.length > 0 || candidateErrors.length > 0)) || (failAxisBelow && axisFailures.length > 0)) {
    process.exit(1);
  }
  console.log(`validate-team: ${results.length} file(s), harness ${harness}`);
}

main();
