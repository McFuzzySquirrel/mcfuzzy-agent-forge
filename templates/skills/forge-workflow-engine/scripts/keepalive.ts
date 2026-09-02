import { readFileSync } from "node:fs";

import type { ExecutionManifest } from "./types.ts";
import { loadState } from "./state.ts";

export type KeepAliveMode = "attach" | "keep-alive" | "adaptive" | "cold";

export interface KeepAliveDecision {
  /** Which keep-alive strategy applies. */
  mode: KeepAliveMode;
  /** True when the engine should auto-start a `opencode serve` for the run. */
  startServer: boolean;
  /** Number of tasks still pending (not complete/skipped). */
  remaining: number;
}

/**
 * Decide whether the run boots a warm `opencode serve` (keep-alive) or
 * cold-starts a fresh `opencode run` per task.
 *
 * Precedence:
 *   1. `--attach <url>` / FORGE_ENGINE_ATTACH_URL - reuse an existing server.
 *   2. `--no-keep-alive` / FORGE_ENGINE_ATTACH=0     - force cold start.
 *   3. `--keep-alive` / FORGE_ENGINE_ATTACH=1        - force keep-alive.
 *   4. Adaptive: keep-alive when more than one task remains, cold start
 *      otherwise (so short resumes do not pay the server boot cost).
 */
export function shouldKeepAlive(opts: {
  attachUrl?: string;
  keepAlive: boolean;
  noKeepAlive: boolean;
  harness: string;
  remaining: number;
}): KeepAliveDecision {
  const { attachUrl, keepAlive, noKeepAlive, harness, remaining } = opts;
  if (attachUrl) return { mode: "attach", startServer: false, remaining };
  if (noKeepAlive) return { mode: "cold", startServer: false, remaining };
  if (keepAlive) {
    return { mode: "keep-alive", startServer: harness === "opencode", remaining };
  }
  if (harness === "opencode" && remaining > 1) {
    return { mode: "adaptive", startServer: true, remaining };
  }
  return { mode: "cold", startServer: false, remaining };
}

/**
 * Number of manifest tasks still not finished: those with no state record
 * (fresh run) or a state status other than complete/skipped. Leftover "running"
 * records from a killed run count as remaining, matching the engine's reset
 * logic (a fresh `run` normalizes them back to pending).
 */
export function remainingTaskCount(manifestPath: string, sp: string, selectedTaskIds: string[] = []): number {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ExecutionManifest;
  const state = loadState(sp);
  const scoped = selectedTaskIds.length > 0 ? new Set(selectedTaskIds) : null;
  let remaining = 0;
  for (const phase of manifest.phases) {
    for (const task of phase.tasks ?? []) {
      if (scoped && !scoped.has(task.id)) continue;
      const record = state?.tasks[task.id];
      const status = record?.status ?? "pending";
      if (status !== "complete" && status !== "skipped") remaining += 1;
    }
  }
  return remaining;
}
