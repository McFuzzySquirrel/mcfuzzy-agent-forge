import { createServer } from "node:net";
import { execFile, type ChildProcess } from "node:child_process";

import spawn from "cross-spawn";

/**
 * Manages a warm `opencode serve` instance that tasks attach to via
 * `opencode run --attach`. The server bootstraps the project instance once
 * (config, AGENTS.md, skills, agent files, MCP server connections); every task
 * then attaches to it instead of paying a fresh cold start.
 */

export interface AttachServer {
  /** Base URL of the running server, e.g. `http://127.0.0.1:4096`. */
  url: string;
  port: number;
  stop(): Promise<void>;
}

export interface StartAttachServerOptions {
  /** Path to the opencode binary (defaults to `opencode`). */
  bin: string;
  /** Project root to bind the server to. Serves as the server's working dir. */
  repoRoot: string;
  /** Preferred port; 0 (or omitted) picks a free port. */
  port?: number;
  /** How long to wait for the server to report healthy before giving up. */
  timeoutMs?: number;
  /** How often to poll the health endpoint while waiting. */
  pollIntervalMs?: number;
  /** Per-attempt timeout for a single health request. */
  attemptTimeoutMs?: number;
  signal?: AbortSignal;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * The spawned server is loopback-only and short-lived, managed by the engine,
 * so strip any ambient HTTP basic auth creds the user has exported globally.
 * Otherwise `opencode serve` inherits them, requires auth, and the engine's own
 * health probe (and its attach invocations) get 401s.
 */
function serverEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["OPENCODE_SERVER_PASSWORD"];
  delete env["OPENCODE_SERVER_USERNAME"];
  return env;
}

export async function startAttachServer(opts: StartAttachServerOptions): Promise<AttachServer> {
  opts.signal?.throwIfAborted();
  const port = opts.port ?? (await freePort());
  const url = `http://127.0.0.1:${port}`;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 250;
  const attemptTimeoutMs = opts.attemptTimeoutMs ?? 2_000;

  const child = spawn(opts.bin, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: opts.repoRoot,
    env: serverEnv(),
    stdio: ["ignore", "ignore", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });

  let closed = false;
  let stopping: Promise<void> | undefined;
  child.once("close", () => { closed = true; });
  const stop = () => stopping ??= stopServer(child, closed);
  let stderr = "";
  let spawnError: string | undefined;
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  child.on("error", (err) => {
    spawnError = err.message;
  });

  // `opencode serve` binds its port before it is fully booted (config, skills,
  // MCP servers), so a health request in that window can connect but hang. Give
  // each attempt its own abort timeout so the deadline loop always advances.
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      opts.signal?.throwIfAborted();
      if (spawnError !== undefined) break;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`opencode serve exited early (code ${child.exitCode}) before becoming healthy. ${stderr.trim()}`);
      }
      try {
        const timeout = AbortSignal.timeout(Math.min(attemptTimeoutMs, Math.max(1, deadline - Date.now())));
        const res = await fetch(`${url}/global/health`, {
          signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
        });
        if (res.ok) {
          const body = (await res.json()) as { healthy?: boolean };
          if (body.healthy !== false) {
            opts.signal?.throwIfAborted();
            return { url, port, stop };
          }
        }
      } catch (error) {
        if (opts.signal?.aborted) throw error;
        // Connection/health failures are expected during startup; the deadline
        // below reports the failure if the server never becomes healthy.
      }
      await sleep(pollIntervalMs);
    }
    const reason = spawnError !== undefined ? spawnError : `did not become healthy within ${timeoutMs}ms`;
    throw new Error(`opencode serve failed to start on ${url}: ${reason}. ${stderr.trim()}`);
  } catch (error) {
    try {
      await stop();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `${String(error)}; ${String(cleanupError)}`);
    }
    throw error;
  }
}

async function stopServer(child: ReturnType<typeof spawn>, alreadyClosed: boolean): Promise<void> {
  if (alreadyClosed || !child.pid) return;
  const pid = child.pid;
  const timeoutMs = 5_000;
  await new Promise<void>((resolve, reject) => {
    let closed = false;
    let terminationFinished = false;
    let settled = false;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    let treeKiller: ChildProcess | undefined;
    const finish = (error?: Error) => {
      if (settled || (!error && (!closed || !terminationFinished))) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(forceTimer);
      child.removeListener("close", onClose);
      if (error) {
        for (const target of [treeKiller, child]) {
          try {
            target?.kill("SIGKILL");
          } catch (killError) {
            error = new AggregateError([error, killError], `${error.message}; fallback termination failed: ${String(killError)}`);
          }
          target?.unref();
        }
        child.stderr?.destroy();
        reject(error);
      } else {
        resolve();
      }
    };
    const onClose = () => {
      closed = true;
      finish();
    };
    const deadline = setTimeout(() => finish(new Error(`opencode serve process-tree cleanup exceeded ${timeoutMs}ms (PID ${pid})`)), timeoutMs);
    child.once("close", onClose);
    if (process.platform === "win32") {
      treeKiller = execFile("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024,
      }, (error, _stdout, stderr) => {
        terminationFinished = true;
        finish(error ? new Error(`opencode serve process-tree cleanup failed (PID ${pid}): ${stderr.trim() || error.message}`) : undefined);
      });
    } else {
      const signalTree = (signal: NodeJS.Signals) => {
        try {
          process.kill(-pid, signal);
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
            finish(new Error(`opencode serve process-tree cleanup failed (PID ${pid}): ${String(error)}`));
          }
        }
      };
      signalTree("SIGTERM");
      if (settled) return;
      forceTimer = setTimeout(() => {
        signalTree("SIGKILL");
        terminationFinished = true;
        finish();
      }, 1000);
    }
  });
}
