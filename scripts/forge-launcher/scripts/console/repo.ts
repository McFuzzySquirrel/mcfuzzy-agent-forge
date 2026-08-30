import fs from "node:fs";
import path from "node:path";

import type {
  Actions,
  AgentInfo,
  ArtifactIndex,
  ArtifactMeta,
  AuditEvent,
  DocEntry,
  DocsIndex,
  ExecutionManifest,
  FileContent,
  LogsResponse,
  ManifestSummary,
  ProjectInfo,
  RunSummary,
  SkillInfo,
  Summary,
  TaskRow,
  TeamIndex,
  TimeoutUpdateResult,
  WorkflowState,
} from "./types.ts";
import { loadEngineConfig, saveEngineConfig } from "../engine-config.ts";
import { detectHarnessRoot, findAdapterDir, inferEngineHarness, looksLikeForgeRepo, type RepoPaths, repoPaths } from "./paths.ts";

// ─── Low-level reads (tolerant of missing files) ─────────────────────────────

/** Mirrors the workflow engine's DEFAULT_TASK_TIMEOUT_MS (and the launcher's interactive default). */
const DEFAULT_TASK_TIMEOUT_MS = 600000;

function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function readText(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function loadState(p: RepoPaths): WorkflowState | null {
  return readJson<WorkflowState>(p.statePath);
}

export function loadManifest(p: RepoPaths): ExecutionManifest | null {
  return readJson<ExecutionManifest>(p.manifestPath);
}

function saveManifest(p: RepoPaths, manifest: ExecutionManifest): void {
  fs.mkdirSync(path.dirname(p.manifestPath), { recursive: true });
  fs.writeFileSync(p.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/** Sets the per-task `timeoutMs` override on a single manifest task. */
export function setTaskTimeout(p: RepoPaths, taskId: string, timeoutMs: number): TimeoutUpdateResult {
  const manifest = loadManifest(p);
  if (!manifest) return { ok: false, message: "No execution manifest found." };

  for (const phase of manifest.phases) {
    const task = phase.tasks.find((t) => t.id === taskId);
    if (task) {
      task.timeoutMs = timeoutMs;
      saveManifest(p, manifest);
      return { ok: true, message: `Timeout for ${taskId} set to ${timeoutMs}ms.`, taskId };
    }
  }
  return { ok: false, message: `Task ${taskId} not found in the manifest.` };
}

/** Sets the per-task `timeoutMs` override on every manifest task. */
export function setAllTaskTimeouts(p: RepoPaths, timeoutMs: number): TimeoutUpdateResult {
  const manifest = loadManifest(p);
  if (!manifest) return { ok: false, message: "No execution manifest found." };

  let affected = 0;
  for (const phase of manifest.phases) {
    for (const task of phase.tasks) {
      task.timeoutMs = timeoutMs;
      affected += 1;
    }
  }
  saveManifest(p, manifest);
  return { ok: true, message: `Timeout set to ${timeoutMs}ms on ${affected} task(s).`, affected };
}

/** Persists the engine-wide default task timeout in docs/engine-config.json. */
export function setDefaultTimeout(p: RepoPaths, timeoutMs: number): TimeoutUpdateResult {
  const existing = loadEngineConfig(p.repoRoot);
  const cfg = {
    harness: existing?.harness ?? inferEngineHarness(p.repoRoot),
    granularity: existing?.granularity ?? "",
    concurrency: existing?.concurrency ?? "",
    taskTimeoutMs: String(timeoutMs),
    maxRetries: existing?.maxRetries ?? "",
    viz: existing?.viz ?? false,
    vizPort: existing?.vizPort ?? "",
    keepAlive: existing?.keepAlive ?? false,
    attach: existing?.attach ?? "",
  };
  saveEngineConfig(p.repoRoot, cfg);
  return { ok: true, message: `Default timeout set to ${timeoutMs}ms.` };
}

export function loadAudit(p: RepoPaths): AuditEvent[] {
  const raw = readText(p.auditPath);
  if (!raw) return [];
  const events: AuditEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as AuditEvent);
    } catch {
      // ignore partial/invalid lines mid-append
    }
  }
  return events;
}

export function readControl(p: RepoPaths): string | null {
  const raw = readJson<{ request?: string }>(p.controlPath);
  return raw?.request === "pause" || raw?.request === "stop" ? raw.request : null;
}

export function readPid(p: RepoPaths): number | null {
  const raw = readText(p.pidPath);
  if (!raw) return null;
  const pid = Number(raw.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export function isPidAlive(pid: number | null): boolean {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────

function runSummary(p: RepoPaths, state: WorkflowState | null, manifest: ExecutionManifest | null): RunSummary | null {
  if (!state) return null;
  const counts = { pending: 0, running: 0, complete: 0, failed: 0, skipped: 0 };
  const tasks = Object.values(state.tasks ?? {});
  for (const t of tasks) {
    if (t.status in counts) (counts as unknown as Record<string, number>)[t.status] += 1;
  }
  let currentPhaseTitle: string | null = null;
  if (state.currentPhase && manifest) {
    currentPhaseTitle = manifest.phases.find((ph) => ph.id === state.currentPhase)?.title ?? null;
  }
  return {
    runId: state.runId,
    status: state.status,
    startedAt: state.startedAt ?? null,
    lastUpdatedAt: state.lastUpdatedAt ?? null,
    currentPhase: state.currentPhase ?? null,
    currentPhaseTitle,
    counts,
    total: tasks.length,
    blockers: state.blockers ?? [],
  };
}

export function summary(p: RepoPaths): Summary {
  const state = loadState(p);
  const manifest = loadManifest(p);
  const harness = detectHarnessRoot(p.repoRoot);
  const team = harness ? listAgents(p.repoRoot, harness) : [];
  const hasFeatures = fs.existsSync(p.featuresDir) && listMarkdown(p.featuresDir).length > 0;

  let manifestSummary: ManifestSummary | null = null;
  if (manifest) {
    const taskCount = manifest.phases.reduce((n, ph) => n + (ph.tasks?.length ?? 0), 0);
    manifestSummary = {
      version: manifest.version,
      generatedAt: manifest.generatedAt,
      granularity: manifest.granularity,
      phases: manifest.phases.length,
      tasks: taskCount,
    };
  }

  const cfgTimeoutMs = Number(loadEngineConfig(p.repoRoot)?.taskTimeoutMs);
  const defaultTimeoutMs = Number.isInteger(cfgTimeoutMs) && cfgTimeoutMs > 0
    ? cfgTimeoutMs
    : DEFAULT_TASK_TIMEOUT_MS;

  return {
    repoRoot: p.repoRoot,
    repoName: path.basename(p.repoRoot),
    harness,
    hasIdea: fs.existsSync(p.ideaPath) || fs.existsSync(path.join(p.repoRoot, "IDEA.md")),
    hasPrd: fs.existsSync(p.prdPath),
    hasVision: fs.existsSync(p.visionPath),
    hasFeatures,
    hasTeam: team.length > 0,
    hasManifest: manifest !== null,
    manifest: manifestSummary,
    run: runSummary(p, state, manifest),
    live: isPidAlive(readPid(p)),
    control: readControl(p),
    logExists: fs.existsSync(p.logPath),
    defaultTimeoutMs,
  };
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

function findPhaseFor(manifest: ExecutionManifest, taskId: string): { id: string; title: string } | null {
  for (const ph of manifest.phases) {
    if (ph.tasks.some((t) => t.id === taskId)) return { id: ph.id, title: ph.title };
  }
  return null;
}

export function tasks(p: RepoPaths): TaskRow[] {
  const manifest = loadManifest(p);
  const state = loadState(p);
  if (!manifest) return [];

  const rows: TaskRow[] = [];
  for (const phase of manifest.phases) {
    for (const task of phase.tasks ?? []) {
      const rec = state?.tasks?.[task.id];
      const durationMs = rec?.startedAt && rec?.completedAt
        ? Date.parse(rec.completedAt) - Date.parse(rec.startedAt)
        : null;
      rows.push({
        id: task.id,
        title: task.title ?? "",
        description: task.description ?? "",
        phaseId: phase.id,
        phaseTitle: phase.title ?? "",
        ownerAgent: task.ownerAgent ?? rec?.ownerAgent ?? null,
        status: rec?.status ?? "pending",
        attempt: rec?.attempt ?? 0,
        startedAt: rec?.startedAt ?? null,
        completedAt: rec?.completedAt ?? null,
        durationMs: durationMs !== null && !Number.isNaN(durationMs) ? durationMs : null,
        outputFiles: rec?.outputFiles ?? [],
        errorMessage: rec?.errorMessage ?? null,
        artifactId: rec?.artifactId ?? null,
        inputs: task.inputs ?? [],
        produces: task.produces ?? null,
        dependencies: task.dependencies ?? [],
        expectedOutputs: task.expectedOutputs ?? [],
        validationCommands: task.validationCommands ?? [],
        timeoutMs: task.timeoutMs ?? null,
        approvalRequired: task.approvalRequired ?? false,
      });
    }
  }
  return rows;
}

// ─── Logs ────────────────────────────────────────────────────────────────────

export function logs(p: RepoPaths, lines = 400): LogsResponse {
  const raw = readText(p.logPath);
  if (raw === null) return { lines: [], truncated: false };
  const all = raw.replace(/\n$/, "").split("\n");
  const truncated = all.length > lines;
  return { lines: all.slice(-lines), truncated };
}

// ─── Artifacts ───────────────────────────────────────────────────────────────

export function artifacts(p: RepoPaths): ArtifactIndex {
  const dir = p.artifactsDir;
  const out: ArtifactMeta[] = [];
  const types = new Set<string>();
  if (fs.existsSync(dir)) {
    for (const subdir of fs.readdirSync(dir)) {
      const sub = path.join(dir, subdir);
      if (!fs.statSync(sub, { throwIfNoEntry: false })?.isDirectory()) continue;
      for (const file of fs.readdirSync(sub)) {
        if (!file.endsWith(".json")) continue;
        const a = readJson<Record<string, unknown>>(path.join(sub, file));
        if (!a) continue;
        out.push({
          artifactId: String(a.artifactId ?? file.replace(/\.json$/, "")),
          type: String(a.type ?? subdir),
          category: String(a.category ?? ""),
          taskId: String(a.taskId ?? ""),
          producedBy: String(a.producedBy ?? ""),
          status: String(a.status ?? ""),
          summary: String(a.summary ?? ""),
          confidence: typeof a.confidence === "number" ? a.confidence : undefined,
          createdAt: String(a.createdAt ?? ""),
          filesChanged: Array.isArray(a.filesChanged) ? (a.filesChanged as string[]) : [],
          inputs: Array.isArray(a.inputs) ? (a.inputs as string[]) : [],
        });
        types.add(String(a.type ?? subdir));
      }
    }
  }
  out.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  return { artifacts: out, types: [...types].sort() };
}

export function artifactById(p: RepoPaths, id: string): unknown | null {
  const dir = p.artifactsDir;
  if (!fs.existsSync(dir)) return null;
  for (const subdir of fs.readdirSync(dir)) {
    const file = path.join(dir, subdir, `${id}.json`);
    if (fs.existsSync(file)) return readJson(file);
  }
  return null;
}

// ─── Documents ───────────────────────────────────────────────────────────────

function listMarkdown(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
}

export function docsIndex(p: RepoPaths): DocsIndex {
  const entries: DocEntry[] = [];
  const push = (id: string, kind: string, title: string, relPath: string, absPath: string) => {
    entries.push({ id, kind, title, relPath, exists: fs.existsSync(absPath) });
  };

  push("idea", "idea", "Project Idea", "docs/IDEA.md", p.ideaPath);
  push("prd", "prd", "PRD", "docs/PRD.md", p.prdPath);
  push("vision", "vision", "Product Vision", "docs/product-vision.md", p.visionPath);
  push("progress", "progress", "Progress", "docs/PROGRESS.md", p.progressPath);
  push("model-plan", "model-plan", "Model Plan", "docs/MODEL-PLAN.md", p.modelPlanPath);
  for (const f of listMarkdown(p.featuresDir)) {
    entries.push({
      id: `feature:${f}`,
      kind: "feature",
      title: f.replace(/\.md$/, ""),
      relPath: path.posix.join("docs", "features", f),
      exists: true,
    });
  }
  return { entries };
}

// ─── Team ────────────────────────────────────────────────────────────────────

function parseFrontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const rawLine of match[1]!.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && value) result[key] = value;
  }
  return result;
}

function sectionBullets(body: string, heading: string): string[] {
  const marker = `## ${heading}`.toLowerCase();
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === marker);
  if (start === -1) return [];
  const bullets: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (line.startsWith("## ")) break;
    if (/^[-*]\s+/.test(line)) bullets.push(line.replace(/^[-*]\s+/, "").trim());
  }
  return bullets;
}

function walk(dir: string, predicate: (entry: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        stack.push(full);
      } else if (predicate(entry.name)) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

function listAgents(repoRoot: string, harnessRoot: string): AgentInfo[] {
  // The three template agents ship with every bootstrap; exclude them so the
  // team view (and hasTeam) reflects the generated specialist team, mirroring
  // the launcher's hasGeneratedTeam().
  const excluded = new Set(["forge-team-builder.md", "project-orchestrator.md", "workflow-orchestrator.md"]);
  const agentsDir = path.join(repoRoot, harnessRoot, "agents");
  return walk(agentsDir, (name) => name.endsWith(".md") && name !== "SKILL.md" && !excluded.has(name)).map((file) => {
    const raw = readText(file) ?? "";
    const fm = parseFrontmatter(raw);
    const content = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    return {
      name: fm.name ?? path.basename(file, ".md"),
      description: (fm.description ?? "").replace(/\s+/g, " ").trim(),
      model: fm.model,
      modelFallback: fm.modelFallback,
      path: file,
      relPath: path.relative(repoRoot, file),
      expertise: sectionBullets(content, "Expertise"),
      collaboration: sectionBullets(content, "Collaboration"),
      constraints: sectionBullets(content, "Constraints"),
    };
  });
}

function listSkills(repoRoot: string, harnessRoot: string): SkillInfo[] {
  const skillsDir = path.join(repoRoot, harnessRoot, "skills");
  return walk(skillsDir, (name) => name === "SKILL.md").map((file) => {
    const raw = readText(file) ?? "";
    const fm = parseFrontmatter(raw);
    const dir = path.dirname(file);
    return {
      name: fm.name ?? path.basename(dir),
      description: (fm.description ?? "").replace(/\s+/g, " ").trim(),
      path: file,
      relPath: path.relative(repoRoot, dir),
    };
  });
}

export function team(p: RepoPaths): TeamIndex {
  const harnessRoot = detectHarnessRoot(p.repoRoot);
  if (!harnessRoot) return { harnessRoot: null, agents: [], skills: [] };
  return {
    harnessRoot,
    agents: listAgents(p.repoRoot, harnessRoot),
    skills: listSkills(p.repoRoot, harnessRoot),
  };
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export function actions(p: RepoPaths): Actions {
  const state = loadState(p);
  const manifest = loadManifest(p);
  const live = isPidAlive(readPid(p));

  const failedTasks: string[] = [];
  if (state) {
    for (const t of Object.values(state.tasks ?? {})) {
      if (t.status === "failed") failedTasks.push(t.taskId);
    }
  }

  const hasIncomplete = state ? Object.values(state.tasks ?? {}).some((t) => !["complete", "skipped"].includes(t.status)) : false;

  // The engine can compile a missing manifest itself when forge-execution-adapter
  // is bootstrapped, so allow Run when the adapter is present even without a manifest.
  const canCompile = manifest !== null || findAdapterDir(p.repoRoot) !== null;

  return {
    canRun: canCompile && (state === null || state.status === "complete" || state.status === "failed"),
    canResume: manifest !== null && state !== null && hasIncomplete && !live,
    canPause: live && state !== null && state.status === "running",
    canStop: live,
    failedTasks,
  };
}

// ─── Project stage ───────────────────────────────────────────────────────────

export function projectStage(repoPath: string): string {
  const p = repoPaths(repoPath);
  if (!looksLikeForgeRepo(repoPath)) return "unknown";
  const state = loadState(p);
  if (state) return state.status;
  if (fs.existsSync(p.manifestPath)) return "manifest";
  if (detectHarnessRoot(repoPath) && listAgents(repoPath, detectHarnessRoot(repoPath)!).length > 0) return "team";
  if (fs.existsSync(p.prdPath) || (fs.existsSync(p.visionPath) && fs.existsSync(p.featuresDir))) return "prd";
  return "idea";
}

export function projectInfo(repoPath: string): ProjectInfo {
  return {
    path: repoPath,
    name: path.basename(repoPath),
    stage: projectStage(repoPath),
  };
}

// ─── File content (guarded) ──────────────────────────────────────────────────

/** Resolves a relative path against a base dir, rejecting traversal. */
export function resolveWithin(baseDir: string, relPath: string): string | null {
  const resolved = path.resolve(baseDir, relPath);
  const base = path.resolve(baseDir) + path.sep;
  if (resolved !== path.resolve(baseDir) && !resolved.startsWith(base)) return null;
  return resolved;
}

export function readDocContent(p: RepoPaths, relPath: string): FileContent | null {
  const abs = resolveWithin(p.repoRoot, relPath);
  if (!abs) return null;
  // Allow docs/ and harness dirs only.
  const allowed = [p.repoRoot + path.sep + "docs", ...HARNESS_DIRS(p.repoRoot)];
  const ok = allowed.some((dir) => abs === dir || abs.startsWith(dir + path.sep));
  if (!ok) return null;
  const content = readText(abs);
  if (content === null) return null;
  return { path: relPath, content };
}

function HARNESS_DIRS(repoRoot: string): string[] {
  return [".agents", ".opencode", ".claude", ".github"].map((r) => path.join(repoRoot, r));
}

export function readArtifactContent(p: RepoPaths, relPath: string): FileContent | null {
  const abs = resolveWithin(p.artifactsDir, relPath);
  if (!abs) return null;
  const content = readText(abs);
  if (content === null) return null;
  return { path: relPath, content };
}
