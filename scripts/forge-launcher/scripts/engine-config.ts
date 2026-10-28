import fs from "node:fs";
import path from "node:path";
import { loadSettings } from "./settings.ts";

/**
 * Persisted engine-run configuration (docs/engine-config.json). The interactive
 * launcher writes the engine options chosen in `configureEngineOptions` here so
 * `forge-launcher resume` / monitor commands rebuild the engine invocation with
 * the same concurrency / retries / viz settings instead of the
 * minimal `--harness`-only command.
 */

export interface PersistedEngineConfig {
  harness: string;
  granularity: string;
  concurrency: string;
  taskTimeoutMs: string;
  maxRetries: string;
  viz: boolean;
  vizPort: string;
  /** Auto-commit after each completed task; absent means the engine default (on). */
  autoCommit?: boolean;
  /** Stream harness CLI activity into docs/engine-run.log; absent means the engine default (off). */
  logHarnessActivity?: boolean;
  /** Execution mode for future run/resume commands. */
  executionMode?: ExecutionMode;
  /** How the selected task set was chosen for manual execution. */
  selectionScope?: SelectionScope;
  /** Explicit task ids to run when executionMode is "manual". */
  selectedTaskIds?: string[];
  /**
   * Teammate sub-agents one task may delegate to. Absent or `""` means auto (the
   * engine offers delegation up to its hard cap), `"0"` disables it, and
   * `"1"`-`"4"` caps it. Mirrors `--subagents`.
   */
  subagents?: string;
}

/**
 * Hard ceiling on per-task delegation, mirroring the engine's
 * `MAX_SUBAGENTS_PER_TASK`. The launcher cannot import engine code (it lives in
 * the target repo), so the value is duplicated here; the engine still clamps
 * defensively, so a drift can never over-delegate.
 */
export const MAX_SUBAGENTS = 4;

/** Engine harnesses whose adapter declares sub-agent support. */
export function harnessSupportsSubagents(harness: string | undefined): boolean {
  return harness === "opencode" || harness === "copilot" || harness === "claude" || harness === "stub";
}

export type ExecutionMode = "auto" | "manual";
export type SelectionScope = "single" | "range" | "list";

export function assertEngineHarnessAvailable(harness: string): void {
  if (harness === "flowforge-kernel") {
    throw new Error("The flowforge-kernel harness has been retired. Select opencode, copilot, or claude for repository tasks (or openai for explicit text tasks), and update docs/engine-config.json or FORGE_ENGINE_HARNESS. Existing workforce artifacts are not deleted.");
  }
}

export function normaliseExecutionMode(value: unknown): ExecutionMode {
  return value === "manual" ? "manual" : "auto";
}

export function normaliseSelectionScope(value: unknown, selectedTaskIds: string[]): SelectionScope | null {
  if (selectedTaskIds.length === 0) return null;
  return value === "single" || value === "range" || value === "list" ? value : "list";
}

export function normaliseSelectedTaskIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (id) unique.add(id);
  }
  return [...unique];
}

export function engineConfigPath(repoDir: string): string {
  return path.join(repoDir, "docs", "engine-config.json");
}

/** Returns the persisted config, or null when absent/invalid. */
export function loadEngineConfig(repoDir: string): PersistedEngineConfig | null {
  const file = engineConfigPath(repoDir);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as PersistedEngineConfig;
  } catch {
    return null;
  }
}

export function saveEngineConfig(repoDir: string, cfg: PersistedEngineConfig): void {
  fs.mkdirSync(path.join(repoDir, "docs"), { recursive: true });
  fs.writeFileSync(engineConfigPath(repoDir), `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
}

/**
 * Effective execution preferences for a repo: the project's
 * `docs/engine-config.json` wins, and each unset field falls back to the
 * system-level default (`settings.json` → `execution`), then to the engine's own
 * default (auto-commit on, activity logging off, concurrency 1).
 *
 * Selection and execution-mode are deliberately excluded: they describe the
 * current run's chosen task set, which is inherently per-project and never
 * inherited from a global default.
 */
export function effectiveExecution(repoDir: string): {
  autoCommit: boolean;
  logHarnessActivity: boolean;
  concurrency: number;
  /** `null` means auto (the engine's own default cap). */
  subagents: number | null;
} {
  const project = loadEngineConfig(repoDir);
  const global = loadSettings().execution ?? {};
  const concurrency = Math.max(0, Number(project?.concurrency ?? global.concurrency ?? 0) || 0);
  return {
    autoCommit: project?.autoCommit ?? global.autoCommit ?? true,
    logHarnessActivity: project?.logHarnessActivity ?? global.logHarnessActivity ?? false,
    concurrency,
    subagents: normaliseSubagents(project?.subagents ?? global.subagents),
  };
}

/**
 * Resolve a persisted delegation setting. `null` means auto/inherit; a number is
 * an explicit cap (`0` = off). Anything out of range falls back to auto rather
 * than propagating a value the engine would reject.
 */
export function normaliseSubagents(value: unknown): number | null {
  if (value === undefined || value === null || value === "" || value === "auto") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_SUBAGENTS ? parsed : null;
}
