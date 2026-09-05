import spawn from "cross-spawn";
import fs from "node:fs";
import path from "node:path";
import { spinner as clackSpinner } from "@clack/prompts";

const useColor = process.stdout.isTTY;

const code = (n: number) => (useColor ? `\x1b[${n}m` : "");
const BOLD = code(1);
const RESET = code(0);
const GREEN = code(32);
const YELLOW = code(33);
const CYAN = code(36);
const RED = code(31);

export const header = () => {
  out("");
  out(`${CYAN}${BOLD}════════════════════════════════════════════════════════${RESET}`);
  out(`${CYAN}${BOLD}  MyForge Launcher${RESET}`);
  out(`${CYAN}${BOLD}════════════════════════════════════════════════════════${RESET}`);
  out("");
};

export const step = (msg: string) => {
  out("");
  out(`${BOLD}▶ ${msg}${RESET}`);
};

export const ok = (msg: string) => out(`  ${GREEN}✔${RESET}  ${msg}`);
export const warn = (msg: string) => out(`  ${YELLOW}⚠${RESET}  ${msg}`);
export const fail = (msg: string) => out(`  ${RED}✖${RESET}  ${msg}`);
export const info = (msg: string) => out(`  ${msg}`);

export const command = (msg: string) => out(`    ${BOLD}${msg}${RESET}`);

/**
 * Builds an OSC 8 terminal hyperlink (Ctrl/Cmd+click in supporting terminals).
 * Pure so it is unit-testable; see `link` for the TTY-aware wrapper.
 */
export function hyperlink(filePath: string, label = filePath): string {
  const uri = `file://${filePath}`;
  return `\x1b]8;;${uri}\x1b\\${label}\x1b]8;;\x1b\\`;
}

/**
 * Wraps a file path in an OSC 8 terminal hyperlink while keeping the plain
 * path as visible text. Falls back to the bare path when stdout is not a TTY,
 * so piped/CI output stays clean. Some terminals need the path percent-encoded
 * in the URL; we leave it raw (most modern terminals accept raw file:// paths).
 */
export function link(filePath: string, label = filePath): string {
  return useColor ? hyperlink(filePath, label) : filePath;
}

export function out(msg = "") {
  process.stdout.write(msg + "\n");
}

export function isInteractiveTty(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}

/**
 * Runs a long-running command with its output tee'd to a log file and a clack
 * spinner as progress. Falls back to running the function directly when stdout
 * is not a TTY or --dry-run is set, so CI/piped output stays clean.
 */
export async function runWithHeartbeat(
  label: string,
  fn: () => Promise<number>,
  opts: { dryRun?: boolean; interval?: number } = {},
): Promise<number> {
  if (!isInteractiveTty() || opts.dryRun) return fn();

  const sp = clackSpinner();
  sp.start(label);
  const interval = opts.interval ?? Number(process.env.FORGE_HEARTBEAT_INTERVAL ?? 15);
  const start = Date.now();
  let last = 0;
  const timer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    if (elapsed >= interval && elapsed - last >= interval) {
      last = elapsed;
      sp.message(`${label} (still running… ${elapsed}s)`);
    }
  }, 1000);

  try {
    return await fn();
  } finally {
    clearInterval(timer);
    sp.stop();
  }
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Wraps a spawn failure with a human-readable message. ENOENT on Windows usually
 * means a CLI installed as an npm .cmd/.bat shim that plain spawn cannot launch.
 */
export function describeSpawnError(cmd: string, err: Error): Error {
  const hint =
    (err as NodeJS.ErrnoException).code === "ENOENT"
      ? " - is it installed and on PATH? (Windows: try `npm install -g <cli>` or add the shim dir to PATH)"
      : "";
  return new Error(`Failed to run '${cmd}': ${err.message}${hint}`);
}

/** Runs a command, capturing output. Resolves with the exit code. */
export function runCommand(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; capture?: boolean } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: opts.capture ? ["inherit", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (opts.capture && child.stdout) {
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    }
    if (opts.capture && child.stderr) {
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    }
    child.on("error", (err) => reject(describeSpawnError(cmd, err)));
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

/** Runs a command, appending its output to a log file (stdout + stderr). */
export function runLogged(
  cmd: string,
  args: string[],
  opts: { cwd?: string; logFile?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number }> {
  return new Promise((resolve, reject) => {
    if (!opts.logFile) {
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        stdio: "inherit",
      });
      child.on("error", (err) => reject(describeSpawnError(cmd, err)));
      child.on("close", (code) => resolve({ code: code ?? 0 }));
      return;
    }
    fs.mkdirSync(path.dirname(opts.logFile), { recursive: true });
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["inherit", "pipe", "pipe"],
    });
    const stream = fs.createWriteStream(opts.logFile, { flags: "a" });
    child.stdout?.on("data", (d: Buffer) => stream.write(d));
    child.stderr?.on("data", (d: Buffer) => stream.write(d));
    child.on("error", (err) => {
      stream.end();
      reject(describeSpawnError(cmd, err));
    });
    child.on("close", (code) => {
      stream.end();
      resolve({ code: code ?? 0 });
    });
  });
}

/** Runs a command, streaming output to the terminal AND appending to a log file. */
export function runTee(
  cmd: string,
  args: string[],
  opts: { cwd?: string; logFile?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["inherit", "pipe", "pipe"],
    });
    let stream: fs.WriteStream | undefined;
    if (opts.logFile) {
      fs.mkdirSync(path.dirname(opts.logFile), { recursive: true });
      stream = fs.createWriteStream(opts.logFile, { flags: "a" });
    }
    child.stdout?.on("data", (d: Buffer) => {
      if (process.stdout.isTTY) process.stdout.write(d);
      stream?.write(d);
    });
    child.stderr?.on("data", (d: Buffer) => {
      if (process.stderr.isTTY) process.stderr.write(d);
      stream?.write(d);
    });
    child.on("error", (err) => {
      stream?.end();
      reject(describeSpawnError(cmd, err));
    });
    child.on("close", (code) => {
      stream?.end();
      resolve({ code: code ?? 0 });
    });
  });
}

/** Prints the last N lines of a log file to help diagnose a failed step. */
export function printLogTail(logFile: string, n = 12): void {
  let text: string;
  try {
    text = fs.readFileSync(logFile, "utf8");
  } catch {
    return;
  }
  const lines = text.replace(/\n$/, "").split("\n");
  const tail = lines.slice(-n);
  if (!tail.length) return;
  warn(`Last ${tail.length} lines of ${logFile}:`);
  for (const l of tail) out("  " + l);
}

/** Spawns a command detached, logging to the given file paths. */
export function spawnDetached(
  cmd: string,
  args: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    outFile?: string;
    errFile?: string;
    logFile?: string;
    onStartupError?: (error: Error) => void;
  },
): { pid: number | undefined } {
  // Capture stdout+stderr into a log when one is supplied. `logFile` alone is
  // sufficient (it opens the same file for both streams); `outFile`/`errFile`
  // allow splitting them. Without any file, both streams go to /dev/null.
  const outTarget = opts.logFile ?? opts.outFile;
  const errTarget = opts.logFile ?? opts.errFile;
  const stdio: Array<"ignore" | number> = ["ignore"];
  const parentFds = new Set<number>();
  let spawning = false;
  let failure: unknown;
  try {
    if (outTarget || errTarget) {
      if (outTarget) fs.mkdirSync(path.dirname(outTarget), { recursive: true });
      if (errTarget && errTarget !== outTarget) fs.mkdirSync(path.dirname(errTarget), { recursive: true });
      const outStream = outTarget ? fs.openSync(outTarget, "a") : undefined;
      if (outStream !== undefined) parentFds.add(outStream);
      const errStream = errTarget === outTarget ? outStream
        : errTarget ? fs.openSync(errTarget, "a") : undefined;
      if (errStream !== undefined) parentFds.add(errStream);
      stdio.push(outStream ?? "ignore", errStream ?? "ignore");
    } else {
      stdio.push("ignore", "ignore");
    }
    spawning = true;
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      detached: true,
      stdio,
    });
    child.on("error", (err) => {
      const wrapped = describeSpawnError(cmd, err);
      const logFile = opts.logFile ?? opts.outFile;
      const msg = `[forge-launcher] failed to start detached process: ${wrapped.message}`;
      try {
        if (logFile) fs.appendFileSync(logFile, msg + "\n");
      } catch (loggingError) {
        console.error(`[forge-launcher] could not write startup failure to ${logFile ?? "stderr"}: ${loggingError instanceof Error ? loggingError.message : String(loggingError)}`);
      }
      if (opts.onStartupError) {
        try {
          opts.onStartupError(wrapped);
        } catch (callbackError) {
          console.error(`[forge-launcher] startup failure callback threw: ${callbackError instanceof Error ? callbackError.message : String(callbackError)}`);
          console.error(msg);
        }
      } else {
        console.error(msg);
      }
    });
    child.unref();
    return { pid: child.pid };
  } catch (err) {
    failure = err;
    if (!spawning) {
      throw err;
    }
    const wrapped = describeSpawnError(cmd, err instanceof Error ? err : new Error(String(err)));
    if (opts.onStartupError) {
      try {
        opts.onStartupError(wrapped);
      } catch (callbackError) {
        console.error(`[forge-launcher] startup failure callback threw: ${callbackError instanceof Error ? callbackError.message : String(callbackError)}`);
        console.error(wrapped.message);
      }
    } else console.error(wrapped.message);
    return { pid: undefined };
  } finally {
    let closeFailure: unknown;
    for (const fd of parentFds) {
      try {
        fs.closeSync(fd);
      } catch (error) {
        closeFailure ??= error;
      }
    }
    if (failure === undefined && closeFailure !== undefined) throw closeFailure;
  }
}
