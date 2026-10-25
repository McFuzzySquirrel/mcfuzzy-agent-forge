import type { Server } from "node:http";
import path from "node:path";
import { spawn as spawnPty, type IPty } from "node-pty";
import { WebSocket, WebSocketServer } from "ws";

export type TerminalStartRequest =
  | { type: "start"; mode: "harness" }
  | { type: "start"; mode: "authoring"; target: "idea" | "prd" | "feature-prd"; prompt?: string };

export interface TerminalCommand {
  cli: "copilot" | "opencode" | "claude";
  args: string[];
}

export interface TerminalSessionOptions {
  token: string;
  origin: string;
  enabled?: boolean;
  currentRepo: () => string | null;
  resolveCommand: (request: TerminalStartRequest, repoRoot: string) => Promise<TerminalCommand>;
  ptySpawn?: typeof spawnPty;
}

interface Session {
  socket: WebSocket;
  repoRoot: string;
  process?: IPty;
  stopping?: NodeJS.Timeout;
}

const PROTOCOL = "forge-console-terminal";
const MAX_COLS = 300;
const MAX_ROWS = 120;
const MAX_BUFFERED_OUTPUT = 1_048_576;

function send(socket: WebSocket, message: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  const payload = JSON.stringify(message);
  if (socket.bufferedAmount + Buffer.byteLength(payload) > MAX_BUFFERED_OUTPUT) {
    socket.close(1013, "terminal output is too slow");
    return;
  }
  socket.send(payload);
}

function parseStartRequest(value: unknown): TerminalStartRequest | null {
  if (!value || typeof value !== "object") return null;
  const request = value as Record<string, unknown>;
  if (request.type !== "start") return null;
  if (request.mode === "harness") return { type: "start", mode: "harness" };
  if (request.mode !== "authoring" || !["idea", "prd", "feature-prd"].includes(String(request.target))) return null;
  if (request.prompt !== undefined && (typeof request.prompt !== "string" || request.prompt.length > 1000)) return null;
  if (request.target === "feature-prd" && !(typeof request.prompt === "string" && request.prompt.trim())) return null;
  return {
    type: "start",
    mode: "authoring",
    target: request.target as "idea" | "prd" | "feature-prd",
    ...(typeof request.prompt === "string" ? { prompt: request.prompt.trim() } : {}),
  };
}

function stopSession(session: Session): void {
  if (!session.process || session.stopping) return;
  try {
    session.process.kill("SIGTERM");
  } catch {
    // The process may have exited between the close event and this signal.
  }
  session.stopping = setTimeout(() => {
    try {
      session.process?.kill("SIGKILL");
    } catch {
      // The PTY may already have exited.
    }
  }, 2_000);
  session.stopping.unref?.();
}

export function attachTerminalSession(server: Server, options: TerminalSessionOptions): {
  closeActive(): void;
  stop(): Promise<void>;
} {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16_384, perMessageDeflate: false });
  const spawn = options.ptySpawn ?? spawnPty;
  let active: Session | null = null;

  const onUpgrade = (request: import("node:http").IncomingMessage, socket: import("node:net").Socket, head: Buffer) => {
    const url = new URL(request.url ?? "/", options.origin);
    if (url.pathname !== "/api/terminal") {
      socket.destroy();
      return;
    }
    const origin = request.headers.origin;
    const protocols = request.headers["sec-websocket-protocol"];
    const offered = (Array.isArray(protocols) ? protocols.join(",") : protocols ?? "").split(",").map((part) => part.trim());
    if (options.enabled === false || origin !== options.origin || !offered.includes(PROTOCOL) || !offered.includes(options.token)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit("connection", client, request);
    });
  };

  server.on("upgrade", onUpgrade);

  wss.on("connection", (socket) => {
    let started = false;
    socket.on("message", async (data, isBinary) => {
      if (isBinary || data.toString().length > 8_192) {
        send(socket, { type: "error", message: "Terminal messages must be small text frames." });
        socket.close(1003, "invalid message");
        return;
      }
      let message: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(data.toString());
        if (!parsed || typeof parsed !== "object") throw new Error("invalid message");
        message = parsed as Record<string, unknown>;
      } catch {
        send(socket, { type: "error", message: "Invalid terminal message." });
        return;
      }

      if (message.type === "start") {
        const request = parseStartRequest(message);
        if (!request) {
          send(socket, { type: "error", message: "Unsupported terminal session request." });
          return;
        }
        if (started || active) {
          send(socket, { type: "error", message: "A terminal session is already running." });
          return;
        }
        const selectedRepo = options.currentRepo();
        if (!selectedRepo) {
          send(socket, { type: "error", message: "Select a project before starting a terminal session." });
          return;
        }
        const repoRoot = path.resolve(selectedRepo);
        started = true;
        const session: Session = { socket, repoRoot };
        active = session;
        try {
          const command = await options.resolveCommand(request, repoRoot);
          if (active !== session || socket.readyState !== WebSocket.OPEN) return;
          const ptyProcess = spawn(command.cli, command.args, {
            name: "xterm-256color",
            cols: 80,
            rows: 24,
            cwd: repoRoot,
            env: { ...process.env, PWD: repoRoot, TERM: "xterm-256color", FORCE_COLOR: "1" },
          });
          session.process = ptyProcess;
          ptyProcess.onData((text) => send(socket, { type: "output", data: text }));
          ptyProcess.onExit(({ exitCode, signal }) => {
            if (session.stopping) clearTimeout(session.stopping);
            send(socket, { type: "exit", exitCode, signal });
            if (active === session) active = null;
            if (socket.readyState === WebSocket.OPEN) socket.close(1000, "process exited");
          });
          send(socket, { type: "started", cwd: repoRoot, cli: command.cli });
        } catch (error) {
          if (active === session) active = null;
          send(socket, { type: "error", message: error instanceof Error ? error.message : String(error) });
          socket.close(1011, "failed to start");
        }
        return;
      }

      const session = active?.socket === socket ? active : null;
      if (!session?.process) {
        send(socket, { type: "error", message: "Start a terminal session first." });
        return;
      }
      if (message.type === "input" && typeof message.data === "string" && message.data.length <= 4_096) {
        session.process.write(message.data);
      } else if (message.type === "resize" && Number.isInteger(message.cols) && Number.isInteger(message.rows)) {
        const cols = Number(message.cols);
        const rows = Number(message.rows);
        if (cols >= 20 && cols <= MAX_COLS && rows >= 5 && rows <= MAX_ROWS) session.process.resize(cols, rows);
      } else if (message.type === "stop") {
        stopSession(session);
      } else {
        send(socket, { type: "error", message: "Unsupported terminal message." });
      }
    });

    socket.on("close", () => {
      const session = active;
      if (session?.socket === socket) {
        if (session.process) stopSession(session);
        else active = null;
      }
    });
    socket.on("error", () => {
      const session = active;
      if (session?.socket === socket) {
        if (session.process) stopSession(session);
        else active = null;
      }
    });
  });

  return {
    closeActive() {
      if (!active) return;
      if (active.socket.readyState === WebSocket.OPEN) active.socket.close(1000, "project changed");
      if (active.process) stopSession(active);
      else active = null;
    },
    stop() {
      server.off("upgrade", onUpgrade);
      this.closeActive();
      for (const client of wss.clients) client.close(1001, "console stopping");
      return new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
