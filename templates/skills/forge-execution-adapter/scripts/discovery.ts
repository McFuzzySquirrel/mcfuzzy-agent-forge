import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import matter from "gray-matter";

import type { AgentDescriptor, AgentSkillReference, ForgeRepo, HarnessRoot, SkillDescriptor } from "./types.ts";
import { HARNESS_ROOTS, parseMetadata, selectHarnessRoot } from "./repo-metadata.mjs";


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

function detectHarnessRoot(repoRoot: string, preferred?: HarnessRoot): { root: HarnessRoot; warnings: string[] } {
  const selected = selectHarnessRoot(repoRoot, preferred);
  if (!selected.root) {
    throw new Error(`No supported harness root found under ${repoRoot}. Expected one of ${HARNESS_ROOTS.join(", ")}.`);
  }
  return { root: selected.root, warnings: selected.warnings };
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

function skillNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).map((entry) => entry.trim()))];
}

function parseAgent(path: string, repoRoot: string): AgentDescriptor {
  const parsed = parseMetadata(readFileSync(path, "utf8"), matter, path);
  const data = parsed.data;
  let override: { primary?: string; fallback?: string } | undefined;
  try {
    const overrides = JSON.parse(readFileSync(join(repoRoot, "docs", "model-overrides.json"), "utf8")) as Record<string, { primary?: string; fallback?: string }>;
    const key = typeof data.name === "string" ? data.name : relative(repoRoot, path);
    override = overrides[key];
  } catch {
    // Overrides are optional; frontmatter remains the source of defaults.
  }

  const skillData = data.skills && typeof data.skills === "object" ? data.skills as Record<string, unknown> : {};
  const requiredSkills = skillNames(data.skillsRequired ?? skillData.required);
  const recommendedSkills = skillNames(data.skillsRecommended ?? skillData.recommended);

  return {
    name: typeof data.name === "string" ? data.name : relative(repoRoot, path),
    description: typeof data.description === "string" ? data.description.replace(/\s+/g, " ").trim() : "",
    path,
    model: override?.primary ?? (canonicalModelId(typeof data.model === "string" ? data.model : "") || undefined),
    modelFallback: override?.fallback ?? (canonicalModelId(typeof data.modelFallback === "string" ? data.modelFallback : "") || undefined),
    expertise: sectionBullets(parsed.content, "Expertise"),
    collaboration: sectionBullets(parsed.content, "Collaboration"),
    constraints: sectionBullets(parsed.content, "Constraints"),
    skillReferences: [...requiredSkills.map((name) => ({ name, required: true })), ...recommendedSkills.filter((name) => !requiredSkills.includes(name)).map((name) => ({ name, required: false }))],
    rawBody: parsed.content,
  };
}

function canonicalModelId(model: string): string {
  return model.trim();
}

function parseSkill(path: string, repoRoot: string): SkillDescriptor {
  const parsed = parseMetadata(readFileSync(path, "utf8"), matter, path);
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

export function discoverForgeRepo(start = process.cwd(), preferredHarness?: HarnessRoot): ForgeRepo {
  const repoRoot = detectRepoRoot(start);
  const harness = detectHarnessRoot(repoRoot, preferredHarness);
  const harnessRoot = harness.root;
  const agentRoot = join(repoRoot, harnessRoot, "agents");
  const skillRoot = join(repoRoot, harnessRoot, "skills");
  const visionPath = join(repoRoot, "docs", "PRD.md");
  const prdPath = visionPath;
  const featuresDir = join(repoRoot, "docs", "features");
  const progressPath = join(repoRoot, "docs", "PROGRESS.md");
  const auditPath = join(repoRoot, "docs", "EXECUTION-AUDIT.jsonl");
  const manifestPath = join(repoRoot, "docs", "EXECUTION-MANIFEST.json");

  const featurePaths = isDir(featuresDir)
    ? readdirSync(featuresDir).filter((entry) => entry.endsWith(".md")).sort().map((entry) => join(featuresDir, entry))
    : [];
  const hasCanonicalVision = existsSync(visionPath);
  const decomposed = hasCanonicalVision && featurePaths.length > 0;
  const sourceLayout: ForgeRepo["sourceLayout"] = "features";

  if (!decomposed) {
    throw new Error(`Every solution requires docs/PRD.md + docs/features/*.md under ${repoRoot}. Run forge-build-prd, or forge-decompose-prd to convert legacy source documents.`);
  }

  const warnings = [...harness.warnings];

  const skills = walk(skillRoot, (entry) => entry === "SKILL.md").map((path) => parseSkill(path, repoRoot));
  const skillsByName = new Map(skills.map((skill) => [skill.name, skill]));
  const agents = walk(agentRoot, (entry) => entry.endsWith(".md") && !entry.endsWith("SKILL.md")).map((path) => {
    const agent = parseAgent(path, repoRoot);
    const skillReferences: AgentSkillReference[] = (agent.skillReferences ?? []).map((reference) => {
      const skill = skillsByName.get(reference.name);
      return {
        ...reference,
        description: skill?.description,
        available: skill !== undefined,
      };
    });
    return { ...agent, skillReferences };
  });

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
