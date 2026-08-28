import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type ControlRequest = "pause" | "stop" | null;

export interface EngineControl {
  request: ControlRequest;
  /** ISO timestamp of when the request was written. */
  requestedAt?: string;
}

/**
 * Engine control file. `pause` and `stop` commands write a request here; the
 * running engine polls it at the top of each task wave and stops gracefully
 * after the current task (state saved as `paused`, resume-able via `run`).
 */
export function controlPath(repoRoot: string): string {
  return join(repoRoot, "docs", "engine-control.json");
}

export function readControl(path: string): ControlRequest {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as EngineControl;
    return parsed.request === "pause" || parsed.request === "stop" ? parsed.request : null;
  } catch {
    return null;
  }
}

export function writeControl(path: string, request: "pause" | "stop"): void {
  mkdirSync(dirname(path), { recursive: true });
  const control: EngineControl = { request, requestedAt: new Date().toISOString() };
  writeFileSync(path, `${JSON.stringify(control, null, 2)}\n`, "utf8");
}

export function clearControl(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // Best-effort; a stale file with no request reads back as null anyway.
  }
}

// ─── Engine PID file ───────────────────────────────────────────────────────────

/**
 * The engine writes its own PID to `<repo>/docs/engine.pid` at run start so
 * `workflow-engine stop` (and `forge-launcher resume`) can detect a live run
 * and signal it even while it is mid-task. Removed on clean exit.
 */
export function pidPath(repoRoot: string): string {
  return join(repoRoot, "docs", "engine.pid");
}

export function writePid(path: string, pid: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${pid}\n`, "utf8");
}

export function readPid(path: string): number | null {
  try {
    const pid = Number(readFileSync(path, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function removePid(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // Best-effort cleanup.
  }
}
