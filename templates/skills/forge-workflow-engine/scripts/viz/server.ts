import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, openSync, readFileSync, readSync, closeSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AuditEvent } from "../types.ts";
import type { ExecutionManifest, WorkflowState } from "../types.ts";
import { setAuditListener } from "./bus.ts";
import { layoutManifest, type KanbanLayout } from "./layout.ts";

// ─── Live workflow-engine visualization server ───────────────────────────────
//
// A dependency-free `node:http` server that serves the PixiJS dashboard and
// streams engine audit events to it. Two event sources:
//   - "in-process": the engine broadcasts audit events through the module-level
//     bus (used when `--viz` is passed to the engine's `run` command).
//   - "tail": tails docs/EXECUTION-AUDIT.jsonl from the current offset (used by
//     the standalone `viz` command to attach to an already-running/detached run).
// Both serve a snapshot (`/api/state`, `/api/manifest`) on connect so a
// reconnecting browser re-syncs instantly.

export interface VizServerOptions {
  repoRoot: string;
  manifestPath: string;
  statePath: string;
  auditPath: string;
  /** Preferred port; the next free port is used when busy. Default 4299. */
  port?: number;
  /** Auto-open the dashboard in the default browser (default false). */
  open?: boolean;
  /** Event source. Default "in-process". */
  source?: "in-process" | "tail";
  /** Optional log sink for the startup message (default console.log). */
  onLog?: (message: string) => void;
  /** How long to keep the SSE stream alive after stop() so the finale renders. */
  keepAliveMs?: number;
}

export interface VizServer {
  url: string;
  port: number;
  /** Broadcast an audit event to all connected dashboards. */
  broadcast(event: AuditEvent): void;
  /** Send a final `done` event, then shut the server down after keepAliveMs. */
  stop(): Promise<void>;
}

export interface VizSnapshot {
  manifest: ExecutionManifest | null;
  state: WorkflowState | null;
  /** Pre-computed kanban layout derived from the manifest. */
  layout: KanbanLayout | null;
}

export interface VizSource {
  getSnapshot(): VizSnapshot;
  subscribe(callback: (event: AuditEvent) => void): () => void;
  stop(): void;
}

const DASHBOARD_DIR = join(dirname(fileURLToPath(import.meta.url)), "dashboard");

const STATIC_FILES: Record<string, { path: string; type: string }> = {
  "/": { path: join(DASHBOARD_DIR, "index.html"), type: "text/html; charset=utf-8" },
  "/index.html": { path: join(DASHBOARD_DIR, "index.html"), type: "text/html; charset=utf-8" },
  "/style.css": { path: join(DASHBOARD_DIR, "style.css"), type: "text/css; charset=utf-8" },
  "/app.js": { path: join(DASHBOARD_DIR, "app.js"), type: "application/javascript; charset=utf-8" },
  "/vendor/pixi.min.js": { path: join(DASHBOARD_DIR, "vendor", "pixi.min.js"), type: "application/javascript; charset=utf-8" },
};

const DEFAULT_PORT = 4299;
const POLL_INTERVAL_MS = 500;
const HEARTBEAT_MS = 15_000;

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

// ─── Event sources ────────────────────────────────────────────────────────────

function createInProcessSource(snapshot: () => VizSnapshot): VizSource {
  return {
    getSnapshot: snapshot,
    subscribe(callback) {
      setAuditListener(callback);
      return () => setAuditListener(undefined);
    },
    stop() {
      setAuditListener(undefined);
    },
  };
}

function createTailSource(snapshot: () => VizSnapshot, auditPath: string): VizSource {
  let offset = 0;
  try {
    offset = statSync(auditPath).size;
  } catch {
    offset = 0;
  }
  let callback: ((event: AuditEvent) => void) | undefined;
  const timer = setInterval(() => {
    if (!callback) return;
    try {
      const stat = statSync(auditPath);
      if (stat.size < offset) offset = 0; // rotated / truncated
      if (stat.size <= offset) return;
      const fd = openSync(auditPath, "r");
      const buffer = Buffer.alloc(stat.size - offset);
      readSync(fd, buffer, 0, buffer.length, offset);
      closeSync(fd);
      offset = stat.size;
      for (const line of buffer.toString("utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          callback(JSON.parse(trimmed) as AuditEvent);
        } catch {
          // Ignore partial/invalid lines mid-append.
        }
      }
    } catch {
      // Audit file may not exist yet; keep polling.
    }
  }, POLL_INTERVAL_MS);
  timer.unref?.();

  return {
    getSnapshot: snapshot,
    subscribe(cb) {
      callback = cb;
      return () => {
        callback = undefined;
      };
    },
    stop() {
      callback = undefined;
      clearInterval(timer);
    },
  };
}

// ─── Server ───────────────────────────────────────────────────────────────────

async function findFreePort(start: number, onLog: (m: string) => void): Promise<number> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const port = start + attempt;
    const server: Server = createServer();
    const free = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
    if (free) return port;
  }
  onLog(`  viz: no free port found starting at ${start}`);
  throw new Error(`No free port available starting at ${start}`);
}

export function openBrowser(url: string, spawnProcess: typeof spawn = spawn): void {
  const platform = process.platform;
  let command: string;
  let args: string[];
  if (platform === "darwin") {
    command = "open";
    args = [url];
  } else if (platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  try {
    const child = spawnProcess(command, args, { stdio: "ignore", detached: true });
    // spawn reports missing launchers asynchronously; keep browser opening
    // best-effort rather than allowing an unhandled ChildProcess error.
    child.on("error", () => {});
    child.unref?.();
  } catch {
    // Browser opening is best-effort; never fail the server over it.
  }
}

export async function startVizServer(options: VizServerOptions): Promise<VizServer> {
  const {
    repoRoot,
    manifestPath,
    statePath,
    auditPath,
    open = false,
    source: sourceKind = "in-process",
    keepAliveMs = 3_000,
    onLog = (m) => console.log(m),
  } = options;

  const snapshot = (): VizSnapshot => {
    const manifest = readJson<ExecutionManifest>(manifestPath);
    return {
      manifest,
      state: readJson<WorkflowState>(statePath),
      layout: manifest ? layoutManifest(manifest) : null,
    };
  };

  const source = sourceKind === "tail"
    ? createTailSource(snapshot, auditPath)
    : createInProcessSource(snapshot);

  const port = await findFreePort(options.port ?? DEFAULT_PORT, onLog);
  const url = `http://127.0.0.1:${port}`;

  const clients = new Set<(event: AuditEvent | { type: "done" }) => void>();
  source.subscribe((event) => {
    for (const send of clients) send(event);
  });

  const server = createServer((req, res) => {
    const urlPath = (req.url ?? "/").split("?")[0]!;

    if (urlPath === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write("retry: 1500\n\n");

      const send = (event: AuditEvent | { type: "done" }) => {
        if ("type" in event && event.type === "done") {
          res.write("event: done\ndata: {}\n\n");
          return;
        }
        res.write(`event: audit\ndata: ${JSON.stringify(event)}\n\n`);
      };
      clients.add(send);

      const snap = source.getSnapshot();
      res.write(`event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`);

      const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
      heartbeat.unref?.();

      req.on("close", () => {
        clearInterval(heartbeat);
        clients.delete(send);
      });
      return;
    }

    if (urlPath === "/api/state") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(source.getSnapshot().state));
      return;
    }

    if (urlPath === "/api/manifest") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(source.getSnapshot().manifest));
      return;
    }

    if (urlPath === "/api/layout") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(source.getSnapshot().layout));
      return;
    }

    const file = STATIC_FILES[urlPath];
    if (file && existsSync(file.path)) {
      res.writeHead(200, { "Content-Type": file.type });
      res.end(readFileSync(file.path));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

  onLog(`  viz: ${url}  (workflow-engine live dashboard)`);
  if (open) openBrowser(url);

  let stopResolve: (() => void) | undefined;
  let stopPromise: Promise<void> | undefined;

  return {
    url,
    port,
    broadcast(event) {
      for (const send of clients) send(event);
    },
    stop() {
      if (!stopPromise) {
        stopPromise = new Promise<void>((resolve) => {
          stopResolve = resolve;
        });
        for (const send of clients) send({ type: "done" });
        setTimeout(() => {
          server.close(() => {
            source.stop();
            stopResolve?.();
          });
          // SSE sockets never end on their own; force them closed so the
          // process can actually exit once the engine run finishes.
          server.closeAllConnections?.();
        }, keepAliveMs);
      }
      return stopPromise;
    },
  };
}
