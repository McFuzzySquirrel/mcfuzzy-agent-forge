#!/usr/bin/env node
// validate-frontmatter.mjs — mechanical gate for generated agent/skill
// frontmatter.
//
// Catches the footguns that break harness parsing and `forge-execution-adapter
// compile`:
//   - `description:` values must be single-line and double-quoted. Block
//     scalars (`>`, `|` and their `-`/`+` variants) and any multi-line value
//     are rejected — several harnesses' frontmatter readers cannot parse them.
//   - An unquoted `description:` value containing `: ` (colon-space) is read as
//     a nested mapping by YAML parsers and rejected by gray-matter.
//   - Missing `name` / `description`, and missing or unterminated frontmatter
//     blocks.
//
// Scans the same file set the execution adapter parses: every `.md` under
// <harness>/agents/ (excluding SKILL.md) and every file named SKILL.md under
// <harness>/skills/.
//
// Usage:
//   node scripts/validate-frontmatter.mjs                     # auto-detect harness root from cwd
//   node scripts/validate-frontmatter.mjs --repo <repo-root>  # detect under a given repo
//   node scripts/validate-frontmatter.mjs --harness-root <path>  # explicit harness root (e.g. .opencode)
//
// Exit 0 when every frontmatter is clean; exit 1 listing offending files.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const HARNESS_ROOTS = [".agents", ".opencode", ".claude", ".github"];

const args = process.argv.slice(2);
const valueFor = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};
const repoRoot = valueFor("--repo") ? resolve(valueFor("--repo")) : undefined;
const explicitHarness = valueFor("--harness-root");

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
        stack.push(full);
      } else {
        out.push(full);
      }
    }
  }
  return out;
}

function detectHarnessRoot() {
  if (explicitHarness) return resolve(explicitHarness);
  let current = resolve(repoRoot ?? process.cwd());
  for (let depth = 0; depth < 12; depth += 1) {
    for (const root of HARNESS_ROOTS) {
      if (existsSync(join(current, root, "agents")) || existsSync(join(current, root, "skills"))) {
        return join(current, root);
      }
    }
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  throw new Error("Could not detect a harness root (.agents/.opencode/.claude/.github). Pass --repo or --harness-root.");
}

function frontmatterBlock(text) {
  const lines = text.split(/\r?\n/);
  if (!/^\s*---\s*$/.test(lines[0] ?? "")) return null;
  const end = lines.slice(1).findIndex((l) => /^\s*---\s*$/.test(l));
  if (end === -1) return null;
  return lines.slice(1, 1 + end);
}

function problemsIn(file, text) {
  const block = frontmatterBlock(text);
  if (block === null) {
    return ["missing or unterminated `---` frontmatter block"];
  }
  const probs = [];
  const seen = new Set();
  for (let i = 0; i < block.length; i += 1) {
    const line = block[i];
    if (/^\s/.test(line)) {
      probs.push(`line ${i + 2}: multi-line value not allowed — keep every value on a single line (block scalars and continuation lines break some harness parsers)`);
      continue;
    }
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key || !value) continue;
    seen.add(key);
    if (key === "name") continue; // names are slugs, safe
    if (/^[>|](\s*[-+])?$/.test(value)) {
      probs.push(`line ${i + 2}: '${key}' uses a YAML block scalar ('${value}') — not supported by all harness readers; write a single-line, double-quoted value (${key}: "...")`);
      continue;
    }
    const quoted = (value.startsWith('"') && value.endsWith('"') && value.length > 1)
      || (value.startsWith("'") && value.endsWith("'") && value.length > 1);
    if (key === "description" && !quoted) {
      probs.push(`line ${i + 2}: 'description' must be double-quoted — single line, no block scalars (description: "...")`);
      continue;
    }
    if (!quoted && /:\s/.test(value)) {
      probs.push(`line ${i + 2}: unquoted '${key}' contains ': ' — wrap it in double quotes (${key}: "...")`);
    }
    if (!quoted && value.includes("#")) {
      probs.push(`line ${i + 2}: unquoted '${key}' contains '#' which YAML may read as a comment — wrap it in double quotes`);
    }
  }
  if (!seen.has("name")) probs.push("missing 'name' field");
  if (!seen.has("description")) probs.push("missing 'description' field");
  return probs;
}

const harness = detectHarnessRoot();
const agentDir = join(harness, "agents");
const skillDir = join(harness, "skills");

const files = [
  ...walk(agentDir).filter((f) => f.endsWith(".md") && !f.endsWith("SKILL.md")),
  ...walk(skillDir).filter((f) => f.endsWith("SKILL.md")),
];

let problems = 0;
for (const file of files) {
  const probs = problemsIn(file, readFileSync(file, "utf8"));
  if (probs.length > 0) {
    problems += 1;
    console.error(`✖ ${file}`);
    for (const p of probs) console.error(`    ${p}`);
  }
}

if (problems > 0) {
  console.error(`\nvalidate-frontmatter: ${problems} file(s) with frontmatter problems.`);
  console.error("Fix each (typically: a single-line, double-quoted description), then re-run.");
  process.exit(1);
}
console.log(`validate-frontmatter: OK — ${files.length} agent/skill file(s) parsed cleanly (harness: ${harness})`);
