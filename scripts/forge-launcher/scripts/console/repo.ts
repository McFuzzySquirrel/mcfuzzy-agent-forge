import fs from "node:fs";
import path from "node:path";

import type {
  Actions,
  AgentInfo,
  ArtifactIndex,
  ArtifactMeta,
  BackgroundJob,
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
import {
  loadEngineConfig,
  normaliseExecutionMode,
  normaliseSelectedTaskIds,
  normaliseSelectionScope,
  saveEngineConfig,
  type ExecutionMode,
  type SelectionScope,
} from "../engine-config.ts";
import { currentJobForRepo, loadJobs, saveJobs } from "./jobs.ts";
import { resolveResources } from "../resources.ts";
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

function saveState(p: RepoPaths, state: WorkflowState): void {
  fs.mkdirSync(path.dirname(p.statePath), { recursive: true });
  fs.writeFileSync(p.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
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
  const cfg = nextEngineConfig(p, existing, { taskTimeoutMs: String(timeoutMs) });
  saveEngineConfig(p.repoRoot, cfg);
  return { ok: true, message: `Default timeout set to ${timeoutMs}ms.` };
}

/** Persists the auto-commit-after-each-task toggle in docs/engine-config.json. */
export function setAutoCommit(p: RepoPaths, enabled: boolean): { ok: boolean; message: string } {
  const existing = loadEngineConfig(p.repoRoot);
  const cfg = nextEngineConfig(p, existing, { autoCommit: enabled });
  saveEngineConfig(p.repoRoot, cfg);
  return { ok: true, message: `Auto-commit ${enabled ? "enabled" : "disabled"}.` };
}

/** Persists the max-parallelism (concurrency) setting in docs/engine-config.json. */
export function setConcurrency(p: RepoPaths, value: number): { ok: boolean; message: string } {
  const existing = loadEngineConfig(p.repoRoot);
  const cfg = nextEngineConfig(p, existing, { concurrency: value > 0 ? String(value) : "" });
  saveEngineConfig(p.repoRoot, cfg);
  return { ok: true, message: value > 0 ? `Concurrency set to ${value}.` : "Concurrency reset to engine default." };
}

export function setExecutionMode(p: RepoPaths, mode: ExecutionMode): { ok: boolean; message: string } {
  const existing = loadEngineConfig(p.repoRoot);
  const cfg = nextEngineConfig(p, existing, { executionMode: mode });
  saveEngineConfig(p.repoRoot, cfg);
  return { ok: true, message: `Execution mode set to ${mode}.` };
}

export function setTaskSelection(
  p: RepoPaths,
  selectionScope: SelectionScope | null,
  taskIds: string[],
): { ok: boolean; message: string } {
  const existing = loadEngineConfig(p.repoRoot);
  const selectedTaskIds = [...new Set(taskIds.map((id) => id.trim()).filter(Boolean))];
  const cfg = nextEngineConfig(p, existing, {
    selectionScope: selectionScope ?? undefined,
    selectedTaskIds,
  });
  saveEngineConfig(p.repoRoot, cfg);
  const state = loadState(p);
  if (state?.status === "paused" && state.selection?.mode === "manual") {
    state.selection = {
      mode: "manual",
      taskIds: selectedTaskIds,
      ...(selectionScope ? { scope: selectionScope } : {}),
    };
    saveState(p, state);
  }
  const count = selectedTaskIds.length;
  return { ok: true, message: count > 0 ? `Saved ${count} selected task(s).` : "Cleared the manual task selection." };
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

function nextEngineConfig(
  p: RepoPaths,
  existing: ReturnType<typeof loadEngineConfig>,
  patch: Partial<NonNullable<ReturnType<typeof loadEngineConfig>>>,
) {
  return {
    harness: existing?.harness ?? inferEngineHarness(p.repoRoot),
    granularity: existing?.granularity ?? "",
    concurrency: existing?.concurrency ?? "",
    taskTimeoutMs: existing?.taskTimeoutMs ?? "",
    maxRetries: existing?.maxRetries ?? "",
    viz: existing?.viz ?? false,
    vizPort: existing?.vizPort ?? "",
    keepAlive: existing?.keepAlive ?? false,
    attach: existing?.attach ?? "",
    autoCommit: existing?.autoCommit,
    executionMode: normaliseExecutionMode(existing?.executionMode),
    selectionScope: normaliseSelectionScope(existing?.selectionScope, normaliseSelectedTaskIds(existing?.selectedTaskIds)) ?? undefined,
    selectedTaskIds: normaliseSelectedTaskIds(existing?.selectedTaskIds),
    ...patch,
  };
}

function activeSelection(state: WorkflowState | null, engineCfg: ReturnType<typeof loadEngineConfig>) {
  const stateSelection = state && (state.status === "running" || state.status === "paused") ? state.selection : undefined;
  const selectedTaskIds = normaliseSelectedTaskIds(stateSelection?.taskIds ?? engineCfg?.selectedTaskIds);
  const executionMode = normaliseExecutionMode(stateSelection?.mode ?? engineCfg?.executionMode);
  const selectionScope = normaliseSelectionScope(stateSelection?.scope ?? engineCfg?.selectionScope, selectedTaskIds);
  return { executionMode, selectionScope, selectedTaskIds };
}

function scopedTaskIds(state: WorkflowState | null): Set<string> | null {
  const selected = normaliseSelectedTaskIds(state?.selection?.taskIds);
  return state?.selection?.mode === "manual" && selected.length > 0 ? new Set(selected) : null;
}

function currentJob(repoRoot: string): BackgroundJob | null {
  return currentJobForRepo(repoRoot);
}

// ─── Summary ─────────────────────────────────────────────────────────────────

function runSummary(p: RepoPaths, state: WorkflowState | null, manifest: ExecutionManifest | null): RunSummary | null {
  if (!state) return null;
  const counts = { pending: 0, running: 0, complete: 0, failed: 0, skipped: 0 };
  const visible = scopedTaskIds(state);
  const tasks = Object.values(state.tasks ?? {}).filter((task) => !visible || visible.has(task.taskId));
  let completedDurationMs = 0;
  for (const t of tasks) {
    if (t.status in counts) (counts as unknown as Record<string, number>)[t.status] += 1;
    if (t.status === "complete" && t.startedAt && t.completedAt) {
      const durationMs = Date.parse(t.completedAt) - Date.parse(t.startedAt);
      if (!Number.isNaN(durationMs) && durationMs >= 0) completedDurationMs += durationMs;
    }
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
    completedDurationMs,
    currentPhase: state.currentPhase ?? null,
    currentPhaseTitle,
    counts,
    total: tasks.length,
    blockers: state.blockers ?? [],
  };
}

export function summary(p: RepoPaths): Summary {
  refreshJobs();
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

  const engineCfg = loadEngineConfig(p.repoRoot);
  const selection = activeSelection(state, engineCfg);
  const job = currentJob(p.repoRoot);

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
    autoCommit: engineCfg?.autoCommit !== false,
    concurrency: Math.max(0, Number(engineCfg?.concurrency) || 0),
    executionMode: selection.executionMode,
    selectionScope: selection.selectionScope,
    selectedTaskIds: selection.selectedTaskIds,
    selectedTaskCount: selection.selectedTaskIds.length,
    job,
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
  for (const f of listMarkdown(path.join(p.repoRoot, "docs", "research"))) {
    entries.push({
      id: `research:${f}`,
      kind: "research",
      title: f.replace(/\.md$/, ""),
      relPath: path.posix.join("docs", "research", f),
      exists: true,
    });
  }
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
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
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
      category: forgeSkillNames().has(path.basename(dir)) ? "forge" : "project",
    };
  });
}

let cachedForgeSkills: Set<string> | null = null;

/** Directory names of the forge template skills (the set `bootstrap()` copies). */
function forgeSkillNames(): Set<string> {
  if (cachedForgeSkills !== null) return cachedForgeSkills;
  const skillsDir = path.join(resolveResources().templatesDir, "skills");
  cachedForgeSkills = new Set(
    fs.existsSync(skillsDir)
      ? fs.readdirSync(skillsDir).filter((name) => fs.statSync(path.join(skillsDir, name), { throwIfNoEntry: false })?.isDirectory())
      : [],
  );
  return cachedForgeSkills;
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

function jobLabel(job: BackgroundJob): string {
  if (job.status === "failed") return "failed";
  if (job.status === "paused") return "paused";
  if (job.status === "running") {
    switch (job.type) {
      case "create-project": return "creating";
      case "draft-prd": return "drafting PRD";
      case "draft-team": return "generating team";
      case "compile-manifest": return "compiling manifest";
      case "engine-run":
      case "engine-resume": return "running";
      case "engine-replay": return "replaying";
    }
  }
  return "ready";
}

export function projectDisplayStage(repoPath: string): string {
  const job = currentJob(repoPath);
  if (job && (job.status === "running" || job.status === "failed" || job.status === "paused")) {
    return jobLabel(job);
  }
  const stage = projectStage(repoPath);
  if (stage === "unknown") return "unknown";
  if (stage === "failed" || stage === "running" || stage === "paused") return stage;
  return "ready";
}

export function projectInfo(repoPath: string): ProjectInfo {
  return {
    path: repoPath,
    name: path.basename(repoPath),
    stage: projectDisplayStage(repoPath),
    job: currentJob(repoPath),
  };
}

export function refreshJobs(): boolean {
  const jobs = loadJobs();
  let changed = false;
  for (const job of jobs) {
    if (job.status !== "running" || isPidAlive(job.pid ?? null)) continue;
    const outcome = resolveJobOutcome(job);
    job.status = outcome.status;
    job.message = outcome.message;
    job.updatedAt = new Date().toISOString();
    job.finishedAt = job.updatedAt;
    changed = true;
  }
  if (changed) saveJobs(jobs);
  return changed;
}

function resolveJobOutcome(job: BackgroundJob): { status: BackgroundJob["status"]; message: string } {
  if (job.type === "create-project") {
    if (!looksLikeForgeRepo(job.repoPath)) {
      return { status: "failed", message: "Project creation ended before the forge repo was ready." };
    }
    return { status: "complete", message: "Project creation finished." };
  }

  if (job.type === "bootstrap") {
    return looksLikeForgeRepo(job.repoPath)
      ? { status: "complete", message: "Repository bootstrap finished." }
      : { status: "failed", message: "Bootstrap exited before creating a forge repo." };
  }

  if (job.type === "feature-prd") {
    const p = repoPaths(job.repoPath);
    return fs.existsSync(p.featuresDir) && listMarkdown(p.featuresDir).length > 0
      ? { status: "complete", message: "Feature PRD authoring completed." }
      : { status: "failed", message: "Feature PRD exited without producing docs/features/*.md." };
  }

  if (job.type === "feature-increment") {
    const p = repoPaths(job.repoPath);
    if (!fs.existsSync(p.featuresDir) || listMarkdown(p.featuresDir).length === 0) {
      return { status: "failed", message: "Feature increment exited without producing docs/features/*.md." };
    }
    if (!fs.existsSync(p.manifestPath)) {
      return { status: "failed", message: "Feature increment exited without producing an execution manifest." };
    }
    if (job.run) {
      const state = loadState(p);
      if (state?.status === "complete") return { status: "complete", message: "Feature increment and build completed." };
      if (state?.status === "paused") return { status: "paused", message: "Feature increment prepared and build paused." };
      return { status: "failed", message: "Feature increment build exited before reaching a terminal state." };
    }
    return { status: "complete", message: "Feature increment prepared; manifest compiled." };
  }

  if (!looksLikeForgeRepo(job.repoPath)) {
    return { status: "failed", message: "The project folder is not a forge repo." };
  }

  const p = repoPaths(job.repoPath);
  switch (job.type) {
    case "draft-prd":
      return hasProjectPrd(p)
        ? { status: "complete", message: "PRD draft completed." }
        : { status: "failed", message: "PRD draft exited without producing a PRD." };
    case "draft-team":
      return hasProjectTeam(job.repoPath)
        ? { status: "complete", message: "Agent team generation completed." }
        : { status: "failed", message: "Agent team generation exited without producing a team." };
    case "compile-manifest":
      return fs.existsSync(p.manifestPath)
        ? { status: "complete", message: "Execution manifest compiled." }
        : { status: "failed", message: "Manifest compile exited without producing a manifest." };
    case "engine-run":
    case "engine-resume": {
      const state = loadState(p);
      if (!state) return { status: "failed", message: "Engine exited without writing workflow state." };
      if (state.status === "complete") return { status: "complete", message: "Build completed." };
      if (state.status === "paused") return { status: "paused", message: "Build paused." };
      if (state.status === "failed") return { status: "failed", message: "Build failed." };
      return { status: "failed", message: "Engine exited before reaching a terminal state." };
    }
    case "engine-replay": {
      const state = loadState(p);
      const record = state?.tasks?.[job.taskId ?? ""];
      if (record?.status === "complete") return { status: "complete", message: `Replay of ${job.taskId} completed.` };
      if (record?.status === "failed") return { status: "failed", message: `Replay of ${job.taskId} failed.` };
      if (state?.status === "paused") return { status: "paused", message: `Replay of ${job.taskId} paused.` };
      return { status: "failed", message: `Replay of ${job.taskId ?? "task"} exited before completion.` };
    }
  }
}

function hasProjectPrd(p: RepoPaths): boolean {
  return fs.existsSync(p.prdPath) || (fs.existsSync(p.visionPath) && listMarkdown(p.featuresDir).length > 0);
}

function hasProjectTeam(repoRoot: string): boolean {
  const harness = detectHarnessRoot(repoRoot);
  return harness ? listAgents(repoRoot, harness).length > 0 : false;
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
