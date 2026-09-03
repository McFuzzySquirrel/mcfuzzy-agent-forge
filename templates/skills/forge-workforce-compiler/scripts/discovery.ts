import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { AgentDescriptor, ForgeRepo, HarnessRoot, SkillDescriptor } from "./types.ts";

const HARNESS_ROOTS: HarnessRoot[] = [".agents", ".github", ".claude", ".opencode"];

function isDir(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function parseFrontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  const lines = match[1]!.split(/\r?\n/);
  let currentKey: string | null = null;
  let currentLines: string[] = [];
  let blockMode: "fold" | "literal" | null = null;

  const commit = () => {
    if (currentKey === null) return;
    const value = (blockMode === "literal" ? currentLines.join("\n") : currentLines.join(" "))
      .replace(/\s+/g, " ")
      .trim();
    if (value) result[currentKey] = value;
    currentKey = null;
    currentLines = [];
    blockMode = null;
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (currentKey !== null && /^[ \t]/.test(rawLine)) {
      currentLines.push(trimmed);
      continue;
    }
    commit();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^"|"$/g, "");
    if (key && value) {
      if (/^[>|](\s*[-+])?$/.test(value)) {
        currentKey = key;
        blockMode = value.startsWith("|") ? "literal" : "fold";
        currentLines = [];
      } else {
        result[key] = value;
      }
    }
  }
  commit();
  return result;
}

function walk(dir: string, predicate: (entry: string) => boolean): string[] {
  if (!isDir(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        if (entry === "node_modules" || entry === ".git") continue;
        stack.push(full);
      } else if (predicate(entry)) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

function parseAgent(path: string): AgentDescriptor {
  const raw = readFileSync(path, "utf8");
  const frontmatter = parseFrontmatter(raw);
  let override: { primary?: string; fallback?: string } | undefined;
  try {
    const repoRoot = resolve(dirname(path), "..", "..");
    const overrides = JSON.parse(readFileSync(join(repoRoot, "docs", "model-overrides.json"), "utf8")) as Record<string, { primary?: string; fallback?: string }>;
    override = overrides[frontmatter["name"] ?? ""];
  } catch {
    // Overrides are optional; frontmatter remains the source of defaults.
  }
  return {
    name: frontmatter["name"] ?? "",
    description: frontmatter["description"] ?? "",
    path,
    model: override?.primary ?? canonicalModelId(frontmatter["model"]),
    modelFallback: override?.fallback ?? canonicalModelId(frontmatter["modelFallback"]),
    rawBody: raw,
  };
}

function canonicalModelId(model: string | undefined): string | undefined {
  if (!model) return undefined;
  const value = model.trim();
  return value.includes("/") ? value.slice(value.lastIndexOf("/") + 1).trim() : value;
}

function parseSkill(path: string): SkillDescriptor {
  const raw = readFileSync(path, "utf8");
  const frontmatter = parseFrontmatter(raw);
  return {
    name: frontmatter["name"] ?? "",
    description: frontmatter["description"] ?? "",
    path,
  };
}

function detectHarnessRoot(repoRoot: string): { root: HarnessRoot; warnings: string[] } {
  const matches = HARNESS_ROOTS.filter((root) => isDir(join(repoRoot, root, "agents")) || isDir(join(repoRoot, root, "skills")));
  if (matches.length === 0) {
    throw new Error(`No harness root found at ${repoRoot}. Expected one of ${HARNESS_ROOTS.join(", ")}.`);
  }
  const warnings: string[] = [];
  if (matches.length > 1) {
    warnings.push(`Multiple harness roots found (${matches.join(", ")}); using ${matches[0]}.`);
  }
  return { root: matches[0]!, warnings };
}

export function detectRepoRoot(start = process.cwd()): string {
  let current = resolve(start);
  for (let depth = 0; depth < 12; depth += 1) {
    if (existsSync(join(current, ".git"))) return current;
    if (HARNESS_ROOTS.some((root) => isDir(join(current, root, "agents")))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Could not detect repository root from ${start}`);
}

export function discoverForgeRepo(start = process.cwd()): ForgeRepo {
  const repoRoot = detectRepoRoot(start);
  const harness = detectHarnessRoot(repoRoot);
  const harnessRoot = harness.root;

  const agentRoot = join(repoRoot, harnessRoot, "agents");
  const skillRoot = join(repoRoot, harnessRoot, "skills");
  const manifestPath = join(repoRoot, "docs", "EXECUTION-MANIFEST.json");

  if (!existsSync(manifestPath)) {
    throw new Error(`Execution manifest not found at ${manifestPath}. Run forge-execution-adapter compile first.`);
  }

  const warnings = [...harness.warnings];
  const agents = walk(agentRoot, (name) => name.endsWith(".md") && name !== "SKILL.md").map(parseAgent);
  const skills = walk(skillRoot, (name) => name === "SKILL.md").map(parseSkill);

  if (agents.length === 0) warnings.push(`No .md agent files found under ${agentRoot}`);
  if (skills.length === 0) warnings.push(`No SKILL.md files found under ${skillRoot}`);

  return {
    repoRoot,
    harnessRoot,
    agentRoot,
    skillRoot,
    manifestPath,
    progressPath: join(repoRoot, "docs", "PROGRESS.md"),
    statePath: join(repoRoot, "docs", "WORKFLOW-STATE.json"),
    auditPath: join(repoRoot, "docs", "EXECUTION-AUDIT.jsonl"),
    agents,
    skills,
    warnings,
  };
}
