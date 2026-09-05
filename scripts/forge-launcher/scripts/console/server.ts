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
import { IncrementalLineReader } from "./incremental-reader.ts";
import { consoleAuthoringInventory } from "./authoring.ts";
import { loadAuthoringConfig, saveAuthoringConfig, validateAuthoringConfig } from "../authoring-config.ts";
import type { InventoryProbe } from "../authoring-inventory.ts";
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
const FORGE_EVENT_PREFIX = "FORGE_EVENT ";

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
  inventoryProbe?: InventoryProbe;
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
    // spawn reports missing launchers asynchronously; keep browser opening
    // best-effort rather than allowing an unhandled ChildProcess error.
    child.on("error", () => {});
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
  ".md": "text/markdown; charset=utf-8",
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
  const auditReader = new IncrementalLineReader({ partialLinePolicy: "hold" });
  const logReader = new IncrementalLineReader({ partialLinePolicy: "emit" });
  const authoringReader = new IncrementalLineReader({ partialLinePolicy: "hold" });

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
    auditReader.reset(p?.auditPath, true);
    logReader.reset(p?.logPath, true);
    authoringReader.reset(p?.logPath, true);
  }

  // ── Audit/log tailing (single poller, follows the current repo) ────────────
  resetOffsets();

  const poller = setInterval(() => {
    try {
      const jobsChanged = repo.refreshJobs();
      const p = currentPaths();
      if (p) {
        try {
          for (const line of auditReader.read(p.auditPath).lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              broadcast("audit", JSON.parse(trimmed));
            } catch (error) {
              onLog(`  console: invalid audit record: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        } catch (error) {
          onLog(`  console: failed to read audit log: ${error instanceof Error ? error.message : String(error)}`);
        }
        try {
          for (const line of logReader.read(p.logPath).lines) {
            broadcast("log", { line });
          }
          for (const line of authoringReader.read(p.logPath).lines) {
            if (line.startsWith(FORGE_EVENT_PREFIX)) {
              try {
                const event = JSON.parse(line.slice(FORGE_EVENT_PREFIX.length));
                if (event && typeof event.type === "string") broadcast("authoring", event);
              } catch (error) {
                onLog(`  console: invalid authoring record: ${error instanceof Error ? error.message : String(error)}`);
              }
            }
          }
        } catch (error) {
          onLog(`  console: failed to read engine log: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (jobsChanged) broadcast("snapshot", snapshotEvent());
    } catch (error) {
      onLog(`  console: poller error: ${error instanceof Error ? error.message : String(error)}`);
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
            repo.refreshJobs();
            return p ? sendJson(res, 200, repo.summary(p)) : sendJson(res, 200, null);
          case "/api/tasks":
            return p ? sendJson(res, 200, repo.tasks(p)) : sendJson(res, 200, []);
          case "/api/audit":
            return p ? sendJson(res, 200, repo.loadAudit(p)) : sendJson(res, 200, []);
          case "/api/authoring-events":
            return p ? sendJson(res, 200, repo.authoringEvents(p)) : sendJson(res, 200, []);
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
          case "/api/model-inventory":
            return p ? sendJson(res, 200, repo.modelInventory(p)) : sendJson(res, 200, { models: [] });
          case "/api/authoring-config":
            return sendJson(res, 200, p ? loadAuthoringConfig(p.repoRoot) : { version: 1, models: {} });
          case "/api/authoring-inventory": {
            const query = new URLSearchParams(rawUrl.split("?")[1] ?? "");
            return sendJson(res, 200, await consoleAuthoringInventory(p?.repoRoot, query.get("runner") ?? undefined));
          }
          case "/api/actions":
            return p ? sendJson(res, 200, repo.actions(p)) : sendJson(res, 200, { canRun: false, canResume: false, canPause: false, canStop: false, failedTasks: [] });
          case "/api/projects": {
            repo.refreshJobs();
            const projects = loadRegistry()
              .map((pr) => ({ ...pr, stage: repo.projectDisplayStage(pr.path), job: repo.projectInfo(pr.path).job }))
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

        if (urlPath === "/api/authoring-config") {
          if (!currentRepo) return sendJson(res, 400, { ok: false, message: "no repo selected" });
          let config;
          try {
            config = validateAuthoringConfig(body);
          } catch (error) {
            return sendJson(res, 400, { ok: false, message: error instanceof Error ? error.message : String(error) });
          }
          const saved = saveAuthoringConfig(currentRepo, config);
          broadcast("snapshot", snapshotEvent());
          return sendJson(res, 200, { ok: true, config: saved, message: "Authoring models saved. Omitted stages inherit the runner default." });
        }
        if (urlPath === "/api/authoring-inventory/refresh") {
          return sendJson(res, 200, await consoleAuthoringInventory(currentRepo ?? undefined, body.runner, true, options.inventoryProbe));
        }
        if (urlPath === "/api/control") {
          const action = body.action as ControlAction;
          const taskId = typeof body.taskId === "string" ? body.taskId : undefined;
          if (!currentRepo) return sendJson(res, 400, { ok: false, message: "no repo selected" });
          if (action === "feature-prd") {
            const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
            if (!prompt) return sendJson(res, 400, { ok: false, message: "prompt is required" });
            return sendJson(res, 200, controller.featurePrd(prompt));
          }
          if (action === "feature-increment") {
            const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
            if (!prompt) return sendJson(res, 400, { ok: false, message: "prompt is required" });
            return sendJson(res, 200, controller.featureIncrement(prompt, body.run === true));
          }
          return sendJson(res, 200, controller.dispatch(action, taskId));
        }
        if (urlPath === "/api/tasks/reset-changed") {
          if (!currentRepo) return sendJson(res, 400, { ok: false, message: "no repo selected" });
          const result = repo.resetChangedCompletedTasks(currentPaths()!);
          if (result.ok) broadcast("snapshot", snapshotEvent());
          return sendJson(res, result.ok ? 200 : 400, result);
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
          if (typeof body.concurrency === "number") {
            if (!Number.isInteger(body.concurrency) || body.concurrency < 0) {
              return sendJson(res, 400, { ok: false, message: "concurrency must be a non-negative integer." });
            }
            const result = repo.setConcurrency(currentPaths()!, body.concurrency);
            broadcast("snapshot", snapshotEvent());
            return sendJson(res, result.ok ? 200 : 400, result);
          }
          if (body.executionMode !== undefined) {
            if (body.executionMode !== "auto" && body.executionMode !== "manual") {
              return sendJson(res, 400, { ok: false, message: "executionMode must be 'auto' or 'manual'." });
            }
            const result = repo.setExecutionMode(currentPaths()!, body.executionMode);
            broadcast("snapshot", snapshotEvent());
            return sendJson(res, result.ok ? 200 : 400, result);
          }
          if (body.selectedTaskIds !== undefined || body.selectionScope !== undefined) {
            const rawIds = Array.isArray(body.selectedTaskIds) ? body.selectedTaskIds : [];
            const selectedTaskIds = rawIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
            const selectionScope = body.selectionScope;
            if (selectionScope !== undefined && selectionScope !== null && !["single", "range", "list"].includes(String(selectionScope))) {
              return sendJson(res, 400, { ok: false, message: "selectionScope must be single, range, or list." });
            }
            const result = repo.setTaskSelection(currentPaths()!, selectionScope as "single" | "range" | "list" | null | undefined ?? null, selectedTaskIds);
            broadcast("snapshot", snapshotEvent());
            return sendJson(res, result.ok ? 200 : 400, result);
          }
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
        if (urlPath === "/api/model-plan/override") {
          if (!currentRepo) return sendJson(res, 400, { ok: false, message: "no repo selected" });
          const agent = typeof body.agent === "string" ? body.agent : "";
          const primary = typeof body.primary === "string" && body.primary.trim() ? body.primary.trim() : undefined;
          const fallback = typeof body.fallback === "string" && body.fallback.trim() ? body.fallback.trim() : undefined;
          const result = repo.setModelOverride(currentPaths()!, agent, primary, fallback);
          if (result.ok) broadcast("snapshot", snapshotEvent());
          return sendJson(res, result.ok ? 200 : 400, result);
        }
        if (urlPath === "/api/model-plan/terminal") {
          if (!options.allowExternalOpen) return sendJson(res, 200, { ok: false, message: "terminal launch not enabled" });
          if (!currentRepo) return sendJson(res, 400, { ok: false, message: "no repo selected" });
          const provider = body.provider === "copilot" ? "copilot" : body.provider === "opencode" ? "opencode" : "";
          const message = typeof body.message === "string" ? body.message.trim() : "";
          if (!provider || !message || message.length > 10000) return sendJson(res, 400, { ok: false, message: "provider and a message up to 10000 characters are required" });
          const args = provider === "copilot" ? ["-i", message, "--yolo"] : ["--prompt", message];
          const launched = await launchCli(provider, currentRepo, args);
          const command = `${provider} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`;
          return sendJson(res, 200, { ok: true, launched, cli: provider, command, message: launched ? `${provider} launched in a new terminal.` : `Run manually: cd "${currentRepo}" && ${command}` });
        }
        if (urlPath === "/api/projects/create") {
          const req = body as unknown as CreateProjectRequest;
          if (!req.name || !req.idea) {
            return sendJson(res, 400, { ok: false, message: "name and idea are required" });
          }
          if (req.authoringConfig !== undefined) {
            try {
              req.authoringConfig = validateAuthoringConfig(req.authoringConfig);
            } catch (error) {
              return sendJson(res, 400, { ok: false, message: error instanceof Error ? error.message : String(error) });
            }
          }
          if (req.concurrency !== undefined) {
            if (typeof req.concurrency !== "number" || !Number.isInteger(req.concurrency) || req.concurrency <= 0) {
              return sendJson(res, 400, { ok: false, message: "concurrency must be a positive integer." });
            }
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
        if (urlPath === "/api/projects/bootstrap") {
          const requestedPath = typeof body.path === "string" ? body.path.trim() : "";
          if (!requestedPath) return sendJson(res, 400, { ok: false, message: "repository path is required" });
          const target = path.resolve(requestedPath);
          if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) return sendJson(res, 400, { ok: false, message: "directory not found" });
          const harness = typeof body.harness === "string" ? body.harness : undefined;
          if (harness !== undefined && !["agents", "github", "claude", "opencode"].includes(harness)) {
            return sendJson(res, 400, { ok: false, message: "harness must be agents, github, claude, or opencode" });
          }
          try {
            const result = controller.bootstrap({ path: target, harness, force: body.force === true, initGit: body.initGit === true });
            return sendJson(res, result.ok ? 200 : 400, result);
          } catch (err) {
            return sendJson(res, 500, { ok: false, message: err instanceof Error ? err.message : "failed to start bootstrap" });
          }
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
      const message = err instanceof Error ? err.message : "internal error";
      if (urlPath.startsWith("/api/")) sendJson(res, 500, { ok: false, message });
      else sendText(res, 500, message);
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
