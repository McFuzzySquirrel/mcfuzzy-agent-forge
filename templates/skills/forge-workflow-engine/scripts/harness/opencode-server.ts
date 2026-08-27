import { createServer } from "node:net";

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
  const port = opts.port ?? (await freePort());
  const url = `http://127.0.0.1:${port}`;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 250;
  const attemptTimeoutMs = opts.attemptTimeoutMs ?? 2_000;

  const child = spawn(opts.bin, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: opts.repoRoot,
    env: serverEnv(),
    stdio: ["ignore", "ignore", "pipe"],
  });

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
  while (Date.now() < deadline) {
    if (spawnError !== undefined) break;
    if (child.exitCode !== null) {
      throw new Error(`opencode serve exited early (code ${child.exitCode}) before becoming healthy. ${stderr.trim()}`);
    }
    try {
      const res = await fetch(`${url}/global/health`, {
        signal: AbortSignal.timeout(attemptTimeoutMs),
      });
      if (res.ok) {
        const body = (await res.json()) as { healthy?: boolean };
        if (body.healthy === false) continue;
        return {
          url,
          port,
          stop: () => stopServer(child),
        };
      }
    } catch {
      // Not up yet, or a connect-ok-but-no-response window - keep polling.
    }
    await sleep(pollIntervalMs);
  }

  child.kill("SIGKILL");
  const reason = spawnError !== undefined ? spawnError : `did not become healthy within ${timeoutMs}ms`;
  throw new Error(`opencode serve failed to start on ${url}: ${reason}. ${stderr.trim()}`);
}

async function stopServer(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 1000);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (child.exitCode === null) child.kill("SIGKILL");
}
