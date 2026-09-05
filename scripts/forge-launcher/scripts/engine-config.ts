import fs from "node:fs";
import path from "node:path";

/**
 * Persisted engine-run configuration (docs/engine-config.json). The interactive
 * launcher writes the engine options chosen in `configureEngineOptions` here so
 * `forge-launcher resume` / monitor commands rebuild the engine invocation with
 * the same concurrency / keep-alive / retries / viz settings instead of the
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
  keepAlive: boolean;
  attach: string;
  /** Auto-commit after each completed task; absent means the engine default (on). */
  autoCommit?: boolean;
  /** Execution mode for future run/resume commands. */
  executionMode?: ExecutionMode;
  /** How the selected task set was chosen for manual execution. */
  selectionScope?: SelectionScope;
  /** Explicit task ids to run when executionMode is "manual". */
  selectedTaskIds?: string[];
}

export type ExecutionMode = "auto" | "manual";
export type SelectionScope = "single" | "range" | "list";

export function assertEngineHarnessAvailable(harness: string): void {
  if (harness === "flowforge-kernel") {
    throw new Error("The flowforge-kernel harness has been retired. Select opencode or copilot for repository tasks (or openai for explicit text tasks), and update docs/engine-config.json or FORGE_ENGINE_HARNESS. Existing workforce artifacts are not deleted.");
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
