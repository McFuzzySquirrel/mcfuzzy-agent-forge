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

  throw new Error(`Could not detect an MyForge repository root from ${start}`);
}

function detectHarnessRoot(repoRoot: string): { root: HarnessRoot; warnings: string[] } {
  const withAgents = HARNESS_ROOTS.filter((root) => isDir(join(repoRoot, root, "agents")));
  const withSkills = HARNESS_ROOTS.filter((root) => isDir(join(repoRoot, root, "skills")));
  // Prefer a root that owns agents: a skills-only root (e.g. a stray .github/
  // that has skills but no agents) must not shadow the real harness root, or
  // every task would fail owner matching. Only when no root has agents do we
  // fall back to a skills-only root.
  const matches = withAgents.length > 0 ? withAgents : withSkills;
  if (matches.length === 0) {
    throw new Error(`No supported harness root found under ${repoRoot}. Expected one of ${HARNESS_ROOTS.join(", ")}.`);
  }

  const warnings: string[] = [];
  const ignoredSkillsOnly = withSkills.filter((root) => !withAgents.includes(root));
  if (withAgents.length > 0 && ignoredSkillsOnly.length > 0) {
    warnings.push(`Ignoring skills-only harness root(s) ${ignoredSkillsOnly.join(", ")} (no agents/); using ${matches[0]}.`);
  }
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
  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `Invalid YAML frontmatter in ${path}: ${err instanceof Error ? err.message : String(err)}. ` +
      "Hint: wrap description values in double quotes (e.g. `description: \"...\"`).",
    );
  }
  const data = parsed.data as Record<string, unknown>;
  let override: { primary?: string; fallback?: string } | undefined;
  try {
    const overrides = JSON.parse(readFileSync(join(repoRoot, "docs", "model-overrides.json"), "utf8")) as Record<string, { primary?: string; fallback?: string }>;
    const key = typeof data.name === "string" ? data.name : relative(repoRoot, path);
    override = overrides[key];
  } catch {
    // Overrides are optional; frontmatter remains the source of defaults.
  }

  return {
    name: typeof data.name === "string" ? data.name : relative(repoRoot, path),
    description: typeof data.description === "string" ? data.description.replace(/\s+/g, " ").trim() : "",
    path,
    model: override?.primary ?? (canonicalModelId(typeof data.model === "string" ? data.model : "") || undefined),
    modelFallback: override?.fallback ?? (canonicalModelId(typeof data.modelFallback === "string" ? data.modelFallback : "") || undefined),
    expertise: sectionBullets(parsed.content, "Expertise"),
    collaboration: sectionBullets(parsed.content, "Collaboration"),
    constraints: sectionBullets(parsed.content, "Constraints"),
    rawBody: parsed.content,
  };
}

function canonicalModelId(model: string): string {
  const value = model.trim();
  return value.includes("/") ? value.slice(value.lastIndexOf("/") + 1).trim() : value;
}

function parseSkill(path: string, repoRoot: string): SkillDescriptor {
  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `Invalid YAML frontmatter in ${path}: ${err instanceof Error ? err.message : String(err)}. ` +
      "Hint: wrap description values in double quotes (e.g. `description: \"...\"`).",
    );
  }
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
  const visionPath = join(repoRoot, "docs", "product-vision.md");
  const featuresDir = join(repoRoot, "docs", "features");
  const progressPath = join(repoRoot, "docs", "PROGRESS.md");
  const auditPath = join(repoRoot, "docs", "EXECUTION-AUDIT.jsonl");
  const manifestPath = join(repoRoot, "docs", "EXECUTION-MANIFEST.json");

  const featurePaths = isDir(featuresDir)
    ? readdirSync(featuresDir).filter((entry) => entry.endsWith(".md")).sort().map((entry) => join(featuresDir, entry))
    : [];
  const decomposed = existsSync(visionPath) && featurePaths.length > 0;
  const sourceLayout: ForgeRepo["sourceLayout"] = decomposed ? "features" : "monolithic";

  if (!existsSync(prdPath) && !decomposed) {
    throw new Error(`No PRD representation found under ${repoRoot}. Expected docs/PRD.md, or docs/product-vision.md + docs/features/`);
  }

  const warnings = [...harness.warnings];
  if (!existsSync(prdPath) && decomposed) {
    warnings.push("No docs/PRD.md; compiling from docs/product-vision.md + docs/features/ only.");
  }
  if (existsSync(visionPath) && featurePaths.length === 0) {
    warnings.push("docs/product-vision.md present but docs/features/ has no .md files; compiling from docs/PRD.md.");
  }

  const agents = walk(agentRoot, (entry) => entry.endsWith(".md") && !entry.endsWith("SKILL.md")).map((path) => parseAgent(path, repoRoot));
  const skills = walk(skillRoot, (entry) => entry === "SKILL.md").map((path) => parseSkill(path, repoRoot));

  if (agents.length === 0) {
    warnings.push(`No .md agent files found under ${agentRoot}.`);
  }
  if (skills.length === 0) {
    warnings.push(`No SKILL.md files found under ${skillRoot}.`);
  }

  return {
    repoRoot,
    harnessRoot,
    agentRoot,
    skillRoot,
    sourceLayout,
    prdPath,
    visionPath,
    featurePaths,
    progressPath,
    auditPath,
    manifestPath,
    agents,
    skills,
    warnings,
  };
}
