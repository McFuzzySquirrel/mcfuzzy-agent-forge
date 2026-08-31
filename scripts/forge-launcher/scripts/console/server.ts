import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { resolveResources } from "../resources.ts";
import { resolveInputFile } from "../paths.ts";
import { launchCliInTerminal } from "../terminal.ts";
import { RunController, type ControlDeps } from "./control.ts";
import {
  detectHarnessRoot,
  loadRegistry,
  looksLikeForgeRepo,
  repoPaths,
  upsertProject,
} from "./paths.ts";
import * as repo from "./repo.ts";
import type { ControlAction, CreateProjectRequest } from "./types.ts";

const CLIENT_DIR = fileURLToPath(new URL("../../resources/console/client", import.meta.url));

const DEFAULT_PORT = 4300;
const POLL_INTERVAL_MS = 500;
const HEARTBEAT_MS = 15_000;

export interface ConsoleServerOptions {
  /** Initial repo to open (optional; when absent the landing/picker shows). */
  repoRoot?: string;
  port?: number;
  open?: boolean;
  onLog?: (message: string) => void;
  /** Test overrides. */
  clientDir?: string;
  boardDir?: string;
  deps?: ControlDeps;
  allowExternalOpen?: boolean;
  /** Injectable "launch a harness CLI in a terminal" seam (defaults to launchCliInTerminal). */
  launchCli?: (cli: string, dir: string, args: string[]) => Promise<boolean>;
}

export interface ConsoleServer {
  url: string;
  port: number;
  token: string;
  selectRepo(repoRoot: string): void;
  stop(): Promise<void>;
}

function boardDir(): string {
  const { templatesDir } = resolveResources();
  return path.join(templatesDir, "skills", "forge-workflow-engine", "scripts", "viz", "dashboard");
}

async function findFreePort(start: number, onLog: (m: string) => void): Promise<number> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const port = start + attempt;
    const server: Server = http.createServer();
    const free = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
    if (free) return port;
  }
  onLog(`  console: no free port found starting at ${start}`);
  throw new Error(`No free port available starting at ${start}`);
}

function openBrowser(url: string): void {
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
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.unref?.();
  } catch {
    // best-effort
  }
}

function openPath(filePath: string): void {
  const platform = process.platform;
  let command: string;
  let args: string[];
  if (platform === "darwin") {
    command = "open";
    args = [filePath];
  } else if (platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", filePath];
  } else {
    command = "xdg-open";
    args = [filePath];
  }
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.unref?.();
  } catch {
    // best-effort
  }
}

/** Chooses the harness CLI + launch args for a forge repo (github → copilot, claude → claude, else opencode). */
function harnessCli(repoRoot: string): { cli: string; args: string[] } {
  const root = detectHarnessRoot(repoRoot);
  if (root === ".github") return { cli: "copilot", args: [] };
  if (root === ".claude") return { cli: "claude", args: ["."] };
  return { cli: "opencode", args: ["."] };
}

/** Staging dir for browser-uploaded PRD/research files (needed before the new repo exists). */
function uploadStagingDir(): string {
  return path.join(os.tmpdir(), "forge-console-uploads", randomBytes(6).toString("hex"));
}

function sanitizeFileName(name: string): string {
  const base = path.basename(name.trim());
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
  return cleaned || `upload-${randomBytes(4).toString("hex")}.txt`;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function sendJson(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendText(res: http.ServerResponse, code: number, body: string): void {
  res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

/** Reads a file from disk, resolved and confined within baseDir (no traversal). */
function readStatic(baseDir: string, urlPath: string): { body: Buffer; type: string } | null {
  const relative = decodeURIComponent(urlPath).replace(/^\/+/, "");
  const resolved = path.resolve(baseDir, relative);
  const base = path.resolve(baseDir) + path.sep;
  if (resolved !== path.resolve(baseDir) && !resolved.startsWith(base)) return null;
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
  const ext = path.extname(resolved);
  return { body: fs.readFileSync(resolved), type: MIME[ext] ?? "application/octet-stream" };
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      data += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

export async function startConsoleServer(options: ConsoleServerOptions = {}): Promise<ConsoleServer> {
  const clientDir = options.clientDir ?? CLIENT_DIR;
  const boardAssets = options.boardDir ?? boardDir();
  const onLog = options.onLog ?? ((m: string) => console.log(m));
  const launchCli = options.launchCli ?? launchCliInTerminal;
  const token = randomBytes(16).toString("hex");

  const controller = new RunController(options.repoRoot ?? "", options.deps);

  let currentRepo: string | null = options.repoRoot ?? null;
  const auditOffsetRef = { offset: 0 };
  const logOffsetRef = { offset: 0 };

  const currentPaths = () => (currentRepo ? repoPaths(currentRepo) : null);

  const port = await findFreePort(options.port ?? DEFAULT_PORT, onLog);
  const url = `http://127.0.0.1:${port}`;

  // ── SSE clients ────────────────────────────────────────────────────────────
  type Send = (event: string, data: unknown) => void;
  const clients = new Set<Send>();

  function broadcast(event: string, data: unknown): void {
    for (const send of clients) send(event, data);
  }

  function snapshotEvent(): unknown {
    const p = currentPaths();
    return {
      summary: p ? repo.summary(p) : null,
      manifest: p ? repo.loadManifest(p) : null,
      state: p ? repo.loadState(p) : null,
      layout: null,
    };
  }

  function resetOffsets(): void {
    const p = currentPaths();
    auditOffsetRef.offset = p ? fileSize(p.auditPath) : 0;
    logOffsetRef.offset = p ? fileSize(p.logPath) : 0;
  }

  function fileSize(file: string): number {
    try {
      return fs.statSync(file).size;
    } catch {
      return 0;
    }
  }

  // ── Audit/log tailing (single poller, follows the current repo) ────────────
  function readNewLines(file: string, offsetRef: { offset: number }): string[] {
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      return [];
    }
    if (size < offsetRef.offset) offsetRef.offset = 0;
    if (size <= offsetRef.offset) return [];
    const fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(size - offsetRef.offset);
    fs.readSync(fd, buffer, 0, buffer.length, offsetRef.offset);
    fs.closeSync(fd);
    offsetRef.offset = size;
    return buffer.toString("utf8").split("\n").filter((l) => l.length > 0);
  }

  resetOffsets();

  const poller = setInterval(() => {
    const p = currentPaths();
    if (!p) return;
    for (const line of readNewLines(p.auditPath, auditOffsetRef)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        broadcast("audit", JSON.parse(trimmed));
      } catch {
        // partial line mid-append
      }
    }
    for (const line of readNewLines(p.logPath, logOffsetRef)) {
      broadcast("log", { line });
    }
  }, POLL_INTERVAL_MS);
  poller.unref?.();

  // ── Request handler ────────────────────────────────────────────────────────
  const server = http.createServer(async (req, res) => {
    const rawUrl = req.url ?? "/";
    const urlPath = rawUrl.split("?")[0]!;
    const method = req.method ?? "GET";

    const authorized = req.headers["x-forge-token"] === token;

    try {
      // SSE
      if (urlPath === "/api/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write("retry: 1500\n\n");
        const send: Send = (event, data) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        clients.add(send);
        send("snapshot", snapshotEvent());
        const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
        heartbeat.unref?.();
        req.on("close", () => {
          clearInterval(heartbeat);
          clients.delete(send);
        });
        return;
      }

      // Read endpoints
      if (method === "GET") {
        const p = currentPaths();
        switch (urlPath) {
          case "/api/summary":
            return p ? sendJson(res, 200, repo.summary(p)) : sendJson(res, 200, null);
          case "/api/tasks":
            return p ? sendJson(res, 200, repo.tasks(p)) : sendJson(res, 200, []);
          case "/api/audit":
            return p ? sendJson(res, 200, repo.loadAudit(p)) : sendJson(res, 200, []);
          case "/api/logs": {
            if (!p) return sendJson(res, 200, { lines: [], truncated: false });
            const q = new URLSearchParams(rawUrl.split("?")[1] ?? "");
            const lines = Number(q.get("lines") ?? "400");
            return sendJson(res, 200, repo.logs(p, Number.isInteger(lines) && lines > 0 ? lines : 400));
          }
          case "/api/artifacts":
            return p ? sendJson(res, 200, repo.artifacts(p)) : sendJson(res, 200, { artifacts: [], types: [] });
          case "/api/docs":
            return p ? sendJson(res, 200, repo.docsIndex(p)) : sendJson(res, 200, { entries: [] });
          case "/api/team":
            return p ? sendJson(res, 200, repo.team(p)) : sendJson(res, 200, { harnessRoot: null, agents: [], skills: [] });
          case "/api/actions":
            return p ? sendJson(res, 200, repo.actions(p)) : sendJson(res, 200, { canRun: false, canResume: false, canPause: false, canStop: false, failedTasks: [] });
          case "/api/projects": {
            const projects = loadRegistry()
              .map((pr) => ({ ...pr, stage: repo.projectStage(pr.path) }))
              .sort((a, b) => (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? ""));
            return sendJson(res, 200, { projects, current: currentRepo });
          }
          case "/api/manifest":
            return p ? sendJson(res, 200, repo.loadManifest(p)) : sendJson(res, 200, null);
          case "/api/state":
            return p ? sendJson(res, 200, repo.loadState(p)) : sendJson(res, 200, null);
          case "/api/layout":
            return sendJson(res, 200, null);
          case "/api/token":
            return sendJson(res, 200, { token });
        }

        if (urlPath.startsWith("/api/artifacts/")) {
          if (!p) return sendJson(res, 404, null);
          const id = decodeURIComponent(urlPath.slice("/api/artifacts/".length));
          return sendJson(res, 200, repo.artifactById(p, id));
        }
        if (urlPath === "/api/artifact/content") {
          if (!p) return sendJson(res, 404, null);
          const q = new URLSearchParams(rawUrl.split("?")[1] ?? "");
          const rel = q.get("path") ?? "";
          const content = repo.readArtifactContent(p, rel);
          return content ? sendJson(res, 200, content) : sendJson(res, 404, null);
        }
        if (urlPath === "/api/docs/content" || urlPath === "/api/team/content") {
          if (!p) return sendJson(res, 404, null);
          const q = new URLSearchParams(rawUrl.split("?")[1] ?? "");
          const rel = q.get("path") ?? "";
          const content = repo.readDocContent(p, rel);
          return content ? sendJson(res, 200, content) : sendJson(res, 404, null);
        }
      }

      // POST endpoints (token-gated)
      if (method === "POST") {
        if (!authorized) return sendText(res, 403, "forbidden");
        const body = (await readBody(req)) as Record<string, unknown>;

        if (urlPath === "/api/control") {
          const action = body.action as ControlAction;
          const taskId = typeof body.taskId === "string" ? body.taskId : undefined;
          if (!currentRepo) return sendJson(res, 400, { ok: false, message: "no repo selected" });
          return sendJson(res, 200, controller.dispatch(action, taskId));
        }
        if (urlPath === "/api/tasks/timeout") {
          const timeoutMs = Number(body.timeoutMs);
          if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
            return sendJson(res, 400, { ok: false, message: "timeoutMs must be a positive integer (milliseconds)." });
          }
          if (!currentRepo) return sendJson(res, 400, { ok: false, message: "no repo selected" });
          const p = currentPaths()!;
          const taskId = typeof body.taskId === "string" && body.taskId.length > 0 ? body.taskId : undefined;
          let result;
          if (taskId) {
            result = repo.setTaskTimeout(p, taskId, timeoutMs);
          } else {
            result = repo.setAllTaskTimeouts(p, timeoutMs);
            if (result.ok) repo.setDefaultTimeout(p, timeoutMs);
          }
          if (result.ok) broadcast("snapshot", snapshotEvent());
          return sendJson(res, result.ok ? 200 : 400, result);
        }
        if (urlPath === "/api/projects/select") {
          const target = String(body.path ?? "");
          if (!target || !fs.existsSync(target) || !fs.existsSync(path.join(target, "docs"))) {
            return sendJson(res, 400, { ok: false, message: "not a forge repo" });
          }
          currentRepo = path.resolve(target);
          controller.repoRoot = currentRepo;
          resetOffsets();
          upsertProject({ path: currentRepo });
          broadcast("snapshot", snapshotEvent());
          return sendJson(res, 200, { ok: true, repoRoot: currentRepo });
        }
        if (urlPath === "/api/projects/add") {
          const target = path.resolve(String(body.path ?? ""));
          if (!target || !looksLikeForgeRepo(target)) {
            return sendJson(res, 400, { ok: false, message: "not a forge repo" });
          }
          upsertProject({ path: target });
          return sendJson(res, 200, { ok: true });
        }
        if (urlPath === "/api/uploads") {
          const name = String(body.name ?? "");
          const content = String(body.content ?? "");
          if (!name || typeof content !== "string" || content.length === 0) {
            return sendJson(res, 400, { ok: false, message: "name and non-empty content are required." });
          }
          const staging = uploadStagingDir();
          fs.mkdirSync(staging, { recursive: true });
          const file = path.join(staging, sanitizeFileName(name));
          fs.writeFileSync(file, content, "utf8");
          return sendJson(res, 200, { ok: true, path: file, name: path.basename(file) });
        }
        if (urlPath === "/api/engine-config") {
          if (!currentRepo) return sendJson(res, 400, { ok: false, message: "no repo selected" });
          const autoCommit = body.autoCommit;
          if (typeof autoCommit !== "boolean") {
            return sendJson(res, 400, { ok: false, message: "autoCommit must be a boolean." });
          }
          const result = repo.setAutoCommit(currentPaths()!, autoCommit);
          broadcast("snapshot", snapshotEvent());
          return sendJson(res, result.ok ? 200 : 400, result);
        }
        if (urlPath === "/api/launch-cli") {
          if (!options.allowExternalOpen) return sendJson(res, 200, { ok: false, message: "launch-cli not enabled" });
          if (!currentRepo) return sendJson(res, 400, { ok: false, message: "no repo selected" });
          const { cli, args } = harnessCli(currentRepo);
          const launched = await launchCli(cli, currentRepo, args);
          const command = `cd "${currentRepo}" && ${cli} ${args.join(" ")}`.trim();
          return sendJson(res, 200, {
            ok: true,
            launched,
            cli,
            command,
            message: launched
              ? `${cli} launched in a new terminal (cwd: ${currentRepo}).`
              : `No supported terminal emulator found - run it manually: ${command}`,
          });
        }
        if (urlPath === "/api/projects/create") {
          const req = body as unknown as CreateProjectRequest;
          if (!req.name || !req.idea) {
            return sendJson(res, 400, { ok: false, message: "name and idea are required" });
          }
          if (req.prdPath && !resolveInputFile(req.prdPath).ok) {
            return sendJson(res, 400, { ok: false, message: `PRD file not found: ${req.prdPath}` });
          }
          for (const p of req.researchPaths ?? []) {
            if (!resolveInputFile(p).ok) {
              return sendJson(res, 400, { ok: false, message: `Research/seed file not found: ${p}` });
            }
          }
          const result = controller.createProject(req);
          return sendJson(res, 200, result);
        }
        if (urlPath === "/api/open") {
          if (!options.allowExternalOpen) return sendJson(res, 200, { ok: false, message: "open not enabled" });
          const target = String(body.path ?? "");
          if (!currentRepo) return sendJson(res, 400, { ok: false, message: "no repo selected" });
          const p = currentPaths()!;
          const abs = repo.resolveWithin(p.repoRoot, target);
          if (!abs) return sendJson(res, 400, { ok: false, message: "invalid path" });
          openPath(abs);
          return sendJson(res, 200, { ok: true });
        }
        return sendText(res, 404, "not found");
      }

      // Static: console client + board
      if (method === "GET") {
        if (urlPath === "/") {
          const idx = fs.readFileSync(path.join(clientDir, "index.html"), "utf8")
            .replace(/__FORGE_TOKEN__/g, token);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(idx);
          return;
        }
        if (urlPath === "/board") {
          const idx = fs.readFileSync(path.join(boardAssets, "index.html"), "utf8")
            .replace('href="/style.css"', 'href="/board/style.css"')
            .replace('src="/vendor/pixi.min.js"', 'src="/board/vendor/pixi.min.js"')
            .replace('src="/app.js"', 'src="/board/app.js"');
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(idx);
          return;
        }
        if (urlPath.startsWith("/board/")) {
          const file = readStatic(boardAssets, urlPath.slice("/board/".length));
          if (file) {
            res.writeHead(200, { "Content-Type": file.type });
            res.end(file.body);
            return;
          }
          return sendText(res, 404, "not found");
        }
        const file = readStatic(clientDir, urlPath);
        if (file) {
          res.writeHead(200, { "Content-Type": file.type });
          res.end(file.body);
          return;
        }
      }

      sendText(res, 404, "not found");
    } catch (err) {
      sendText(res, 500, err instanceof Error ? err.message : "internal error");
    }
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

  onLog(`  forge console: ${url}`);

  if (options.repoRoot && looksLikeForgeRepo(options.repoRoot)) {
    upsertProject({ path: options.repoRoot });
  }

  if (options.open) openBrowser(url);

  return {
    url,
    port,
    token,
    selectRepo(repoRoot: string) {
      currentRepo = path.resolve(repoRoot);
      controller.repoRoot = currentRepo;
      resetOffsets();
      upsertProject({ path: currentRepo });
      broadcast("snapshot", snapshotEvent());
    },
    stop() {
      return new Promise<void>((resolve) => {
        clearInterval(poller);
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
  };
}
