import spawn from "cross-spawn";

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
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"] });

    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let settled = false;
    let firstOutputAt: number | undefined;

    const settle = (status: number | null, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const bootMs = firstOutputAt === undefined ? Date.now() - startedAt : firstOutputAt - startedAt;
      resolve({ stdout, stderr, status, error, bootMs });
    };

    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      if (firstOutputAt === undefined) firstOutputAt = Date.now();
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
