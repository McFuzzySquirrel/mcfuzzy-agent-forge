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
