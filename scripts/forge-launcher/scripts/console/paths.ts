import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HARNESS_ROOTS, selectProjectHarnessRoot, type HarnessRoot } from "../repo-metadata.ts";

// ─── Project registry ─────────────────────────────────────────────────────────
//
// The console remembers projects the user has created or opened so its landing
// page can offer a picker. Location honours FORGE_HOME first, then XDG_CONFIG_HOME,
// then ~/.myforge.

export interface RegistryProject {
  path: string;
  name: string;
  harness?: string;
  createdAt?: string;
  lastOpenedAt?: string;
}

function registryDir(): string {
  if (process.env.FORGE_HOME) return process.env.FORGE_HOME;
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return path.join(xdg, "myforge");
  return path.join(os.homedir(), ".myforge");
}

export function registryPath(): string {
  return path.join(registryDir(), "projects.json");
}

export function loadRegistry(): RegistryProject[] {
  const file = registryPath();
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is RegistryProject => Boolean(p && typeof p.path === "string"));
  } catch {
    return [];
  }
}

export function saveRegistry(projects: RegistryProject[]): void {
  const file = registryPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(projects, null, 2)}\n`, "utf8");
}

export function upsertProject(entry: Partial<RegistryProject> & { path: string }): RegistryProject[] {
  const projects = loadRegistry();
  const existing = projects.find((p) => p.path === entry.path);
  const now = new Date().toISOString();
  if (existing) {
    existing.name = entry.name ?? existing.name;
    existing.harness = entry.harness ?? existing.harness;
    existing.lastOpenedAt = now;
  } else {
    projects.push({
      path: entry.path,
      name: entry.name ?? path.basename(entry.path),
      harness: entry.harness,
      createdAt: entry.createdAt ?? now,
      lastOpenedAt: now,
    });
  }
  saveRegistry(projects);
  return projects;
}

export function touchProject(repoPath: string): void {
  upsertProject({ path: repoPath });
}

// ─── Repo file paths ──────────────────────────────────────────────────────────
//
// The console reads the same docs/* artifacts the engine and launcher write.

export interface RepoPaths {
  repoRoot: string;
  manifestPath: string;
  statePath: string;
  auditPath: string;
  progressPath: string;
  controlPath: string;
  pidPath: string;
  logPath: string;
  authoringEventsPath: string;
  artifactsDir: string;
  engineConfigPath: string;
  ideaPath: string;
  prdPath: string;
  visionPath: string;
  featuresDir: string;
  modelPlanPath: string;
  modelOverridesPath: string;
}

export function repoPaths(repoRoot: string): RepoPaths {
  const root = path.resolve(repoRoot);
  const docs = path.join(root, "docs");
  return {
    repoRoot: root,
    manifestPath: path.join(docs, "EXECUTION-MANIFEST.json"),
    statePath: path.join(docs, "WORKFLOW-STATE.json"),
    auditPath: path.join(docs, "EXECUTION-AUDIT.jsonl"),
    progressPath: path.join(docs, "PROGRESS.md"),
    controlPath: path.join(docs, "engine-control.json"),
    pidPath: path.join(docs, "engine.pid"),
    logPath: path.join(docs, "engine-run.log"),
    authoringEventsPath: path.join(docs, "AUTHORING-EVENTS.jsonl"),
    artifactsDir: path.join(docs, "artifacts"),
    engineConfigPath: path.join(docs, "engine-config.json"),
    ideaPath: path.join(docs, "IDEA.md"),
    prdPath: path.join(docs, "PRD.md"),
    visionPath: path.join(docs, "product-vision.md"),
    featuresDir: path.join(docs, "features"),
    modelPlanPath: path.join(docs, "MODEL-PLAN.md"),
    modelOverridesPath: path.join(docs, "model-overrides.json"),
  };
}

export type { HarnessRoot };

/** Uses the same agent-root preference as compilation and authoring. */
export function detectHarnessRoot(repoRoot: string): HarnessRoot | null {
  return selectProjectHarnessRoot(repoRoot).root;
}

/** Engine harness to use when a repo has no persisted engine-config.json. */
export function inferEngineHarness(repoRoot: string): string {
  return detectHarnessRoot(repoRoot) === ".github" ? "copilot" : "opencode";
}

/** Locates the bootstrapped forge-workflow-engine skill dir (any harness root). */
export function findEngineDir(repoRoot: string): string | null {
  const selected = detectHarnessRoot(repoRoot);
  for (const root of [...new Set([selected, ...HARNESS_ROOTS])]) {
    if (!root) continue;
    const candidate = path.join(repoRoot, root, "skills", "forge-workflow-engine");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Locates the bootstrapped forge-execution-adapter skill dir (any harness root). */
export function findAdapterDir(repoRoot: string): string | null {
  const selected = detectHarnessRoot(repoRoot);
  for (const root of [...new Set([selected, ...HARNESS_ROOTS])]) {
    if (!root) continue;
    const candidate = path.join(repoRoot, root, "skills", "forge-execution-adapter");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** True when the directory looks like a forge repo (git repo with docs/). */
export function looksLikeForgeRepo(dir: string): boolean {
  return fs.existsSync(path.join(dir, ".git")) && fs.existsSync(path.join(dir, "docs"));
}
