import { spawn } from "node:child_process";

export interface RunCommandOptions {
  cwd: string;
  timeoutMs: number;
  maxBufferBytes: number;
  /** Extra environment variables merged over `process.env`. */
  env?: NodeJS.ProcessEnv;
}

export interface RunCommandResult {
  stdout: string;
  stderr: string;
  /** Process exit code, or null when the process was killed or failed to start. */
  status: number | null;
  /** Human-readable failure reason (spawn error, timeout, or buffer overflow). */
  error?: string;
}

/**
 * Runs a command without a shell, capturing stdout/stderr asynchronously.
 *
 * Unlike `spawnSync` (which blocks the event loop), this yields while the child
 * runs, so the engine can emit heartbeat output during long-running tasks.
 */
export function runCommand(
  bin: string,
  args: string[],
  opts: RunCommandOptions,
): Promise<RunCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const settle = (status: number | null, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, status, error });
    };

    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (target === "stdout") {
        if (stdout.length + text.length > opts.maxBufferBytes) {
          child.kill("SIGKILL");
          settle(null, `stdout exceeded ${opts.maxBufferBytes} bytes`);
          return;
        }
        stdout += text;
      } else {
        if (stderr.length + text.length > opts.maxBufferBytes) {
          child.kill("SIGKILL");
          settle(null, `stderr exceeded ${opts.maxBufferBytes} bytes`);
          return;
        }
        stderr += text;
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle(null, `timed out after ${opts.timeoutMs}ms`);
    }, opts.timeoutMs);

    child.on("error", (err) => settle(null, err.message));
    child.on("close", (code) => settle(code));
  });
}
