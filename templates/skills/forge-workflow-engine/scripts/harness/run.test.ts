import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import childProcess, { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { canSelectAgentNatively, runCommand } from "./run.ts";
import type { AgentDescriptor } from "../types.ts";

const options = { cwd: process.cwd(), timeoutMs: 5000, maxBufferBytes: 1024 };

for (const mode of ["timeout", "cancelled", "overflow"] as const) {
  for (const order of ["close-first", "cleanup-first"] as const) {
    test(`terminated process status is null for ${mode} with ${order}`, {
      skip: process.platform !== "win32" ? "Windows asynchronous taskkill callback ordering." : false,
    }, async (context) => {
      const child = Object.assign(new EventEmitter(), {
        pid: 43210,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: () => true,
        unref: () => {},
      }) as unknown as ChildProcess;
      let finishCleanup: (() => void) | undefined;
      const spawn = context.mock.method(childProcess, "spawn", () => child);
      const execFile = context.mock.method(childProcess, "execFile", (...args: unknown[]) => {
        assert.equal(args[0], "taskkill");
        assert.deepEqual(args[1], ["/PID", "43210", "/T", "/F"]);
        const callback = args.at(-1) as (error: null, stdout: string, stderr: string) => void;
        finishCleanup = () => callback(null, "", "");
        return { kill: () => true, unref: () => {} } as unknown as ChildProcess;
      });
      syncBuiltinESMExports();
      context.mock.timers.enable({ apis: ["setTimeout"] });
      try {
        const controller = new AbortController();
        let settled = false;
        const pending = runCommand(process.execPath, [], {
          ...options, timeoutMs: 150, signal: controller.signal,
        }).then((result) => {
          settled = true;
          return result;
        });
        if (mode === "timeout") context.mock.timers.tick(150);
        else if (mode === "cancelled") controller.abort();
        else child.stdout!.emit("data", Buffer.alloc(options.maxBufferBytes + 1));
        assert.ok(finishCleanup, "termination must start owned process-tree cleanup");
        if (order === "close-first") child.emit("close", 1);
        else finishCleanup();
        await Promise.resolve();
        assert.equal(settled, false, "must wait for both cleanup and stream closure");
        if (order === "close-first") finishCleanup();
        else child.emit("close", 1);
        const result = await pending;
        assert.equal(result.status, null);
        assert.equal(result.failureKind, mode === "overflow" ? "exception" : mode);
        assert.match(result.error ?? "", mode === "timeout" ? /timed out after 150ms/ : mode === "cancelled" ? /Task cancelled/ : /stdout exceeded 1024 bytes/);
      } finally {
        context.mock.timers.reset();
        spawn.mock.restore();
        execFile.mock.restore();
        syncBuiltinESMExports();
        child.stdout?.destroy();
        child.stderr?.destroy();
      }
    });
  }
}

for (const exitCode of [0, 7]) {
  test(`normal process exit preserves status ${exitCode}`, async () => {
    const result = await runCommand(process.execPath, ["-e", `process.exit(${exitCode})`], options);
    assert.equal(result.status, exitCode);
    assert.equal(result.error, undefined);
    assert.equal(result.failureKind, undefined);
  });
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
    }
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ESRCH" || error.code === "ENOENT")) return false;
    throw error;
  }
}

function descendantScript(detached = false): string {
  const descendant = `console.log("descendant:" + process.pid); setTimeout(() => console.log("survived"), 6000);`;
  return `
console.log("parent:" + process.pid);
require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], {
  stdio: ["ignore", "inherit", "inherit"], detached: ${detached}
});
setInterval(() => {}, 1000);
`;
}

test("process transport classifies startup failures without retrying internally", async () => {
  const result = await runCommand("forge-definitely-missing-command", [], options);
  assert.equal(result.failureKind, "configuration");
  assert.match(result.error ?? "", /ENOENT|not found|not recognized/);
});

test("process transport reports timeouts only after child cleanup", async () => {
  const result = await runCommand(process.execPath, ["-e", "process.stdout.write(String(process.pid)); setInterval(() => {}, 1000)"],
    { ...options, timeoutMs: 500 });
  assert.equal(result.failureKind, "timeout");
  assert.match(result.error ?? "", /timed out/);
  assert.ok(Number(result.stdout) > 0);
  assert.throws(() => process.kill(Number(result.stdout), 0));
});

test("process transport supports cancellation before spawn and during an attempt", async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  const before = await runCommand("forge-definitely-missing-command", [], { ...options, signal: cancelled.signal });
  assert.equal(before.failureKind, "cancelled");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 500);
  try {
    const during = await runCommand(process.execPath, ["-e", "process.stdout.write(String(process.pid)); setInterval(() => {}, 1000)"],
      { ...options, signal: controller.signal });
    assert.equal(during.failureKind, "cancelled");
    assert.ok(Number(during.stdout) > 0);
    assert.throws(() => process.kill(Number(during.stdout), 0));
  } finally {
    clearTimeout(timer);
  }
});

for (const mode of ["timeout", "cancelled"] as const) {
  test(`${mode} terminates descendants holding inherited stdout/stderr pipes`, {
    skip: process.platform === "win32" ? "Windows taskkill process-tree timing is runner-dependent." : false,
  }, async () => {
    const controller = new AbortController();
    const timer = mode === "cancelled" ? setTimeout(() => controller.abort(), 500) : undefined;
    const started = Date.now();
    let descendantPid: number | undefined;
    try {
      const result = await runCommand(process.execPath, ["-e", descendantScript()], {
        ...options, timeoutMs: mode === "timeout" ? 500 : 10_000, signal: controller.signal,
      });
      descendantPid = Number(result.stdout.match(/descendant:(\d+)/)?.[1]);
      assert.ok(descendantPid > 0, "descendant started before termination");
      assert.equal(result.failureKind, mode, result.error);
      assert.ok(Date.now() - started < 2500, "must not wait for the descendant's 6s lifetime");
      const deadline = Date.now() + 1000;
      while (isRunning(descendantPid) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(isRunning(descendantPid), false, "owned descendant must be terminated, not merely disconnected");
    } finally {
      clearTimeout(timer);
      if (descendantPid && isRunning(descendantPid)) process.kill(descendantPid, "SIGKILL");
    }
  });
}

test("termination settlement stays bounded when an escaped descendant retains output pipes", {
  skip: process.platform === "win32" ? "POSIX process-group escape fixture" : false,
}, async () => {
  const started = Date.now();
  let descendantPid: number | undefined;
  try {
    const result = await runCommand(process.execPath, ["-e", descendantScript(true)], { ...options, timeoutMs: 500 });
    descendantPid = Number(result.stdout.match(/descendant:(\d+)/)?.[1]);
    assert.ok(descendantPid > 0);
    assert.equal(result.failureKind, "exception", "incomplete cleanup must prevent an automatic retry");
    assert.match(result.error ?? "", /process-tree cleanup failed: exceeded 1000ms/);
    assert.ok(Date.now() - started < 2500, "inherited pipes must not keep the promise open indefinitely");
  } finally {
    if (descendantPid && isRunning(descendantPid)) process.kill(descendantPid, "SIGKILL");
  }
});

function agentAt(root: string, harnessRoot: string, name = "discovery-engineer"): AgentDescriptor {
  return {
    name,
    description: "Discovery engineer",
    path: join(root, harnessRoot, "agents", "discovery-engineer.md"),
    expertise: [],
    collaboration: [],
    constraints: [],
    rawBody: "You are a Discovery Engineer.",
  };
}

test("native agent selection accepts an agent under the harness's own agents directory", () => {
  const repoRoot = join(process.cwd(), "repo");
  assert.equal(canSelectAgentNatively({ agent: agentAt(repoRoot, ".claude"), repoRoot }, ".claude"), true);
});

test("native agent selection rejects an agent rooted at a different harness", () => {
  const repoRoot = join(process.cwd(), "repo");
  assert.equal(canSelectAgentNatively({ agent: agentAt(repoRoot, ".claude"), repoRoot }, ".github"), false);
});

test("native agent selection rejects an agent with no name", () => {
  const repoRoot = join(process.cwd(), "repo");
  assert.equal(canSelectAgentNatively({ agent: agentAt(repoRoot, ".claude", ""), repoRoot }, ".claude"), false);
});

test("FORGE_ENGINE_NATIVE_AGENT=0 forces the inline-persona fallback for every harness", () => {
  const repoRoot = join(process.cwd(), "repo");
  const saved = process.env["FORGE_ENGINE_NATIVE_AGENT"];
  process.env["FORGE_ENGINE_NATIVE_AGENT"] = "0";
  try {
    assert.equal(canSelectAgentNatively({ agent: agentAt(repoRoot, ".claude"), repoRoot }, ".claude"), false);
  } finally {
    if (saved === undefined) delete process.env["FORGE_ENGINE_NATIVE_AGENT"];
    else process.env["FORGE_ENGINE_NATIVE_AGENT"] = saved;
  }
});
