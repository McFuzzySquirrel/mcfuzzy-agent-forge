import spawn from "cross-spawn";
import { execFile, type ChildProcess } from "node:child_process";
import type { TaskFailureKind } from "../types.ts";

const CLEANUP_TIMEOUT_MS = 1000;

export interface RunCommandOptions {
  cwd: string;
  timeoutMs: number;
  maxBufferBytes: number;
  /** Extra environment variables merged over `process.env`. */
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export interface RunCommandResult {
  stdout: string;
  stderr: string;
  /** Process exit code, or null when the process was killed or failed to start. */
  status: number | null;
  /** Human-readable failure reason (spawn error, timeout, or buffer overflow). */
  error?: string;
  failureKind?: TaskFailureKind;
  /**
   * Milliseconds from spawn until the first stdout/stderr byte arrived. A proxy
   * for process startup cost (the harness cold-boot the attach mode removes).
   */
  bootMs?: number;
}

/**
 * Runs a command, capturing stdout/stderr asynchronously.
 *
 * Uses `cross-spawn` so npm-installed CLIs (opencode, copilot, claude), which
 * are `.cmd`/`.bat` shims on Windows, launch correctly. Unlike `spawnSync`
 * (which blocks the event loop), this yields while the child runs, so the
 * engine can emit heartbeat output during long-running tasks.
 */
export function runCommand(
  bin: string,
  args: string[],
  opts: RunCommandOptions,
): Promise<RunCommandResult> {
  if (opts.signal?.aborted) return Promise.resolve({ stdout: "", stderr: "", status: null, error: "Task cancelled", failureKind: "cancelled" });
  return new Promise((resolve) => {
    // A dedicated POSIX process group lets cancellation include descendants
    // inheriting the output pipes. This remains attached: no unref during work.
    const child = spawn(bin, args, {
      cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32", windowsHide: true,
    });

    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let settled = false;
    let firstOutputAt: number | undefined;
    let failure: { error: string; failureKind: TaskFailureKind } | undefined;
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    let treeKiller: ChildProcess | undefined;
    let terminating = false;
    let terminationFinished = false;
    let closed = false;
    let exitStatus: number | null = null;

    const settle = (status: number | null, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(cleanupTimer);
      opts.signal?.removeEventListener("abort", cancel);
      const bootMs = firstOutputAt === undefined ? Date.now() - startedAt : firstOutputAt - startedAt;
      resolve({ stdout, stderr, status, error: failure?.error ?? error, failureKind: failure?.failureKind, bootMs });
    };

    const terminate = (error: string, failureKind: TaskFailureKind) => {
      if (settled || failure) return;
      failure = { error, failureKind };
      terminating = true;
      const cleanupFailed = (reason: string) => {
        if (settled) return;
        failure = { error: `${error}; process-tree cleanup failed: ${reason}`, failureKind: "exception" };
      };
      cleanupTimer = setTimeout(() => {
        cleanupFailed(`exceeded ${CLEANUP_TIMEOUT_MS}ms; closing inherited output pipes`);
        treeKiller?.kill("SIGKILL");
        treeKiller?.unref();
        try {
          child.kill("SIGKILL");
        } catch (killError) {
          cleanupFailed(`exceeded ${CLEANUP_TIMEOUT_MS}ms; direct-child termination also failed: ${String(killError)}`);
        }
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref();
        settle(null);
      }, CLEANUP_TIMEOUT_MS);
      const finished = () => {
        terminationFinished = true;
        if (closed) settle(exitStatus);
      };
      if (!child.pid) {
        finished();
      } else if (process.platform === "win32") {
        // taskkill targets this invocation's PID tree, including .cmd wrappers.
        treeKiller = execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true, timeout: CLEANUP_TIMEOUT_MS, maxBuffer: 64 * 1024,
        }, (killError, _stdout, killStderr) => {
          if (killError) cleanupFailed(killStderr.trim() || killError.message);
          finished();
        });
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (killError) {
          if (!(killError instanceof Error && "code" in killError && killError.code === "ESRCH")) {
            cleanupFailed(killError instanceof Error ? killError.message : String(killError));
          }
        }
        finished();
      }
    };
    const cancel = () => terminate("Task cancelled", "cancelled");
    opts.signal?.addEventListener("abort", cancel, { once: true });
    if (opts.signal?.aborted) cancel();

    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      if (firstOutputAt === undefined) firstOutputAt = Date.now();
      const text = chunk.toString("utf8");
      if (target === "stdout") {
        if (stdout.length + text.length > opts.maxBufferBytes) {
          terminate(`stdout exceeded ${opts.maxBufferBytes} bytes`, "exception");
          return;
        }
        stdout += text;
      } else {
        if (stderr.length + text.length > opts.maxBufferBytes) {
          terminate(`stderr exceeded ${opts.maxBufferBytes} bytes`, "exception");
          return;
        }
        stderr += text;
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));

    const timer = setTimeout(() => {
      terminate(`timed out after ${opts.timeoutMs}ms`, "timeout");
    }, opts.timeoutMs);

    child.on("error", (err) => {
      failure ??= { error: err.message, failureKind: "configuration" };
    });
    child.on("close", (code) => {
      closed = true;
      exitStatus = code;
      if (!terminating || terminationFinished) settle(code);
    });
  });
}

/** Extra model flags are transport defaults, never later argv overrides. */
export function extractModelFlags(args: string[]): { flags: string[]; model?: string } {
  const flags: string[] = [];
  let model: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--model" || arg === "-m" || arg.startsWith("--model=")) {
      const value = arg.startsWith("--model=") ? arg.slice("--model=".length) : args[++index];
      if (!value || value.startsWith("-")) throw new Error("Extra model flag requires a model ID.");
      if (model !== undefined && model !== value) throw new Error("Conflicting extra model flags; provide one transport default.");
      model = value;
    } else flags.push(arg);
  }
  return { flags, model };
}
