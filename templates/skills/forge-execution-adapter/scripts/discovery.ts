import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import matter from "gray-matter";

import type { AgentDescriptor, ForgeRepo, HarnessRoot, SkillDescriptor } from "./types.ts";

const HARNESS_ROOTS: HarnessRoot[] = [".agents", ".github", ".claude", ".opencode"];

function isDir(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

export function detectRepoRoot(start = process.cwd()): string {
  let current = resolve(start);

  for (let depth = 0; depth < 12; depth += 1) {
    if (existsSync(join(current, ".git"))) return current;
    if (HARNESS_ROOTS.some((root) => isDir(join(current, root, "agents")) || isDir(join(current, root, "skills")))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(`Could not detect an Agent Forge repository root from ${start}`);
}

function detectHarnessRoot(repoRoot: string): { root: HarnessRoot; warnings: string[] } {
  const matches = HARNESS_ROOTS.filter((root) => isDir(join(repoRoot, root, "agents")) || isDir(join(repoRoot, root, "skills")));
  if (matches.length === 0) {
    throw new Error(`No supported harness root found under ${repoRoot}. Expected one of ${HARNESS_ROOTS.join(", ")}.`);
  }

  const warnings: string[] = [];
  if (matches.length > 1) {
    warnings.push(`Multiple harness roots detected (${matches.join(", ")}); using ${matches[0]}.`);
  }
  return { root: matches[0]!, warnings };
}

function sectionBullets(body: string, heading: string): string[] {
  const lines = body.split(/\r?\n/);
  const marker = `## ${heading}`.toLowerCase();
  const start = lines.findIndex((line) => line.trim().toLowerCase() === marker);
  if (start === -1) return [];

  const bullets: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line.startsWith("## ")) break;
    if (/^[-*]\s+/.test(line)) bullets.push(line.replace(/^[-*]\s+/, "").trim());
  }
  return bullets;
}

function parseAgent(path: string, repoRoot: string): AgentDescriptor {
  const parsed = matter(readFileSync(path, "utf8"));
  const data = parsed.data as Record<string, unknown>;

  return {
    name: typeof data.name === "string" ? data.name : relative(repoRoot, path),
    description: typeof data.description === "string" ? data.description.replace(/\s+/g, " ").trim() : "",
    path,
    model: typeof data.model === "string" ? data.model : undefined,
    modelFallback: typeof data.modelFallback === "string" ? data.modelFallback : undefined,
    expertise: sectionBullets(parsed.content, "Expertise"),
    collaboration: sectionBullets(parsed.content, "Collaboration"),
    constraints: sectionBullets(parsed.content, "Constraints"),
    rawBody: parsed.content,
  };
}

function parseSkill(path: string, repoRoot: string): SkillDescriptor {
  const parsed = matter(readFileSync(path, "utf8"));
  const dir = dirname(path);
  const list = (name: string) => {
    const full = join(dir, name);
    if (!isDir(full)) return [];
    return readdirSync(full).sort().map((entry) => join(full, entry));
  };

  return {
    name: typeof parsed.data.name === "string" ? parsed.data.name : relative(repoRoot, dir),
    description: typeof parsed.data.description === "string" ? parsed.data.description : "",
    path,
    references: list("references"),
    scripts: list("scripts"),
    assets: list("assets"),
  };
}

function walk(dir: string, predicate: (entry: string) => boolean): string[] {
  if (!isDir(dir)) return [];
  const results: string[] = [];
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
        results.push(full);
      }
    }
  }
  return results.sort();
}

export function discoverForgeRepo(start = process.cwd()): ForgeRepo {
  const repoRoot = detectRepoRoot(start);
  const harness = detectHarnessRoot(repoRoot);
  const harnessRoot = harness.root;
  const agentRoot = join(repoRoot, harnessRoot, "agents");
  const skillRoot = join(repoRoot, harnessRoot, "skills");
  const prdPath = join(repoRoot, "docs", "PRD.md");
  const progressPath = join(repoRoot, "docs", "PROGRESS.md");
  const auditPath = join(repoRoot, "docs", "EXECUTION-AUDIT.jsonl");
  const manifestPath = join(repoRoot, "docs", "EXECUTION-MANIFEST.json");

  if (!existsSync(prdPath)) {
    throw new Error(`PRD not found at ${prdPath}`);
  }

  const warnings = [...harness.warnings];
  if (existsSync(join(repoRoot, "docs", "product-vision.md"))) {
    warnings.push("Detected docs/product-vision.md. Feature/decomposition mode is not compiled by this MVP.");
  }
  if (isDir(join(repoRoot, "docs", "features"))) {
    warnings.push("Detected docs/features/. This adapter currently compiles only the monolithic PRD flow.");
  }

  const agents = walk(agentRoot, (entry) => entry.endsWith(".agent.md")).map((path) => parseAgent(path, repoRoot));
  const skills = walk(skillRoot, (entry) => entry === "SKILL.md").map((path) => parseSkill(path, repoRoot));

  if (agents.length === 0) {
    warnings.push(`No .agent.md files found under ${agentRoot}.`);
  }
  if (skills.length === 0) {
    warnings.push(`No SKILL.md files found under ${skillRoot}.`);
  }

  return {
    repoRoot,
    harnessRoot,
    agentRoot,
    skillRoot,
    prdPath,
    progressPath,
    auditPath,
    manifestPath,
    agents,
    skills,
    warnings,
  };
}
