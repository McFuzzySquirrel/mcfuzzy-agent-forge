import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import path from "node:path";
import { test } from "node:test";
import { spawn as spawnPty, type IPty } from "node-pty";
import WebSocket from "ws";

import { attachTerminalSession, type TerminalCommand, type TerminalStartRequest } from "./console/terminal-session.ts";

const token = "test-token";
const protocol = "forge-console-terminal";
// The server normalizes the selected repo ("/fixture/project") with
// path.resolve(), which adds a drive letter on Windows, so the expected root
// must be resolved the same way.
const fixtureRepo = path.resolve("/fixture/project");
const receiveTimeoutMs = 10_000;

interface FakePty {
  writes: string[];
  resizes: Array<[number, number]>;
  kills: string[];
  output: (text: string) => void;
  exit: (exitCode: number, signal?: number) => void;
}

function fakePty(): { pty: IPty; state: FakePty } {
  const dataListeners: Array<(data: string) => void> = [];
  const exitListeners: Array<(event: { exitCode: number; signal?: number }) => void> = [];
  const state: FakePty = {
    writes: [],
    resizes: [],
    kills: [],
    output: (text) => dataListeners.forEach((listener) => listener(text)),
    exit: (exitCode, signal) => exitListeners.forEach((listener) => listener({ exitCode, signal })),
  };
  const pty = {
    onData: (listener: (data: string) => void) => {
      dataListeners.push(listener);
      return { dispose() {} };
    },
    onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
      exitListeners.push(listener);
      return { dispose() {} };
    },
    write: (value: string) => state.writes.push(value),
    resize: (cols: number, rows: number) => state.resizes.push([cols, rows]),
    kill: (signal = "SIGTERM") => {
      state.kills.push(signal);
      state.exit(143, signal === "SIGTERM" ? 15 : 9);
    },
  } as unknown as IPty;
  return { pty, state };
}

async function setup(
  t: import("node:test").TestContext,
  overrides: { resolveCli?: (name: string) => string | null } = {},
) {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const spawned: Array<{ cli: string; args: string[]; cwd?: string; pwd?: string }> = [];
  const fake = fakePty();
  const resolveCommand = async (request: TerminalStartRequest, repoRoot: string): Promise<TerminalCommand> => {
    assert.equal(repoRoot, fixtureRepo);
    if (request.mode === "harness") return { cli: "opencode", args: ["mini"] };
    return { cli: "copilot", args: ["-i", request.prompt ?? ""] };
  };
  const sessions = attachTerminalSession(server, {
    token,
    origin,
    currentRepo: () => "/fixture/project",
    resolveCommand,
    resolveCli: overrides.resolveCli ?? ((name: string) => name),
    ptySpawn: ((cli: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }) => {
      spawned.push({ cli, args, cwd: options.cwd, pwd: options.env?.PWD });
      return fake.pty;
    }) as typeof spawnPty,
  });
  t.after(async () => {
    await sessions.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const socket = (auth = token, requestOrigin = origin) =>
    new WebSocket(`${origin.replace(/^http/, "ws")}/api/terminal`, [protocol, auth], { origin: requestOrigin });
  return { origin, spawned, fake: fake.state, socket };
}

function receive(socket: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("close", onClose);
      socket.off("error", onError);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const timeout = setTimeout(() => fail(new Error(`timed out waiting for ${type}`)), receiveTimeoutMs);
    const onMessage = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      if (message.type === type) {
        cleanup();
        resolve(message);
      } else if (message.type === "error") {
        fail(new Error(`terminal error while waiting for ${type}: ${String(message.message)}`));
      }
    };
    const onClose = (code: number, reason: Buffer) => {
      fail(new Error(`socket closed (${code} ${reason.toString()}) while waiting for ${type}`));
    };
    const onError = (error: Error) => fail(new Error(`socket error while waiting for ${type}: ${error.message}`));
    socket.on("message", onMessage);
    socket.on("close", onClose);
    socket.on("error", onError);
  });
}

test("terminal WebSocket requires the Console token and same-origin browser", async (t) => {
  const { socket } = await setup(t);
  const rejected = (client: WebSocket) => new Promise<void>((resolve) => {
    client.once("close", () => resolve());
    client.once("error", () => resolve());
  });
  await rejected(socket("wrong-token"));
  await rejected(socket(token, "http://evil.example"));
});

test("terminal sessions launch a fixed harness in the selected project and bridge PTY I/O", async (t) => {
  const { socket: createSocket, spawned, fake } = await setup(t);
  const client = createSocket();
  await once(client, "open");
  const started = receive(client, "started");
  client.send(JSON.stringify({ type: "start", mode: "harness", command: "sh" }));
  assert.equal((await started).cli, "opencode");
  assert.deepEqual(spawned, [{ cli: "opencode", args: ["mini"], cwd: fixtureRepo, pwd: fixtureRepo }]);

  const output = receive(client, "output");
  fake.output("\u001b[32mhello\u001b[0m");
  assert.equal((await output).data, "\u001b[32mhello\u001b[0m");

  client.send(JSON.stringify({ type: "input", data: "hello\r" }));
  client.send(JSON.stringify({ type: "resize", cols: 100, rows: 32 }));
  client.send(JSON.stringify({ type: "resize", cols: 900, rows: 32 }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(fake.writes, ["hello\r"]);
  assert.deepEqual(fake.resizes, [[100, 32]]);

  const exit = receive(client, "exit");
  client.send(JSON.stringify({ type: "stop" }));
  assert.equal((await exit).exitCode, 143);
  assert.deepEqual(fake.kills, ["SIGTERM"]);
});

test("terminal sessions report a clear error when the harness CLI cannot be resolved", async (t) => {
  const { socket: createSocket } = await setup(t, { resolveCli: () => null });
  const client = createSocket();
  await once(client, "open");
  const error = receive(client, "error");
  client.send(JSON.stringify({ type: "start", mode: "harness" }));
  assert.match(String((await error).message), /not found on PATH/);
});

test("terminal disconnect cleans up the PTY and rejects shell-like session requests", async (t) => {
  const { socket: createSocket, fake } = await setup(t);
  const client = createSocket();
  await once(client, "open");
  const invalid = receive(client, "error");
  client.send(JSON.stringify({ type: "start", mode: "shell", command: "sh" }));
  assert.match(String((await invalid).message), /Unsupported terminal session/);

  const started = receive(client, "started");
  client.send(JSON.stringify({ type: "start", mode: "harness" }));
  await started;
  client.close();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(fake.kills, ["SIGTERM"]);
});
