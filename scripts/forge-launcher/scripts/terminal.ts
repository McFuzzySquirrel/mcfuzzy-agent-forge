import spawn from "cross-spawn";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { command, isInteractiveTty, warn } from "./format.ts";

/**
 * Launches a CLI (copilot/opencode/claude) inside a new terminal window in the
 * given directory. Returns true on success, false when no supported terminal
 * emulator is found (caller prints fallback instructions).
 *
 * Refuses outright when the process has no TTY, unless the caller explicitly
 * allows it. A detached terminal launched from a pipe or a test harness is
 * unreachable, and because the script ends in `; exec bash` the emulator holds
 * a shell open with nobody able to close it. The Forge Console is the one
 * legitimate non-TTY caller: it exists to open terminals on the user's behalf.
 */
export function launchCliInTerminal(
  cliName: string,
  repoDir: string,
  args: string[] = [],
  options: { allowWithoutTty?: boolean } = {},
): Promise<boolean> {
  if (!options.allowWithoutTty && !isInteractiveTty()) {
    warn("No interactive terminal available; open a terminal manually and run:");
    command(`cd "${repoDir}" && ${cliName} ${args.join(" ")}`);
    return Promise.resolve(false);
  }
  if (os.platform() === "win32") {
    return launchWindows(cliName, repoDir, args);
  }
  return launchPosix(cliName, repoDir, args);
}

function launchPosix(cliName: string, repoDir: string, args: string[]): Promise<boolean> {
  // Desktop terminals may start a login shell with a different PATH from the
  // launcher process. Pin the resolved executable when it is discoverable so
  // npm-installed CLIs are found on macOS as well as Linux.
  const cliExe = commandExists(cliName) ?? cliName;
  const argStr = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
  const launchScript = `cd '${repoDir.replace(/'/g, "'\\''")}' && '${cliExe.replace(/'/g, "'\\''")}' ${argStr}; exec bash`;

  const candidates: Array<{ cmd: string; args: (dir: string, script: string) => string[] }> = [
    {
      cmd: "gnome-terminal",
      args: (dir, script) => ["--working-directory=" + dir, "--", "bash", "-lc", script],
    },
    {
      cmd: "x-terminal-emulator",
      args: (_dir, script) => ["-e", "bash", "-lc", script],
    },
    {
      cmd: "konsole",
      args: (dir, script) => ["--workdir", dir, "-e", "bash", "-lc", script],
    },
    {
      cmd: "mate-terminal",
      args: (dir, script) => ["--working-directory=" + dir, "--", "bash", "-lc", script],
    },
  ];

  return new Promise((resolve) => {
    const tryNext = (cands: typeof candidates) => {
      if (cands.length === 0) {
        warn("No supported desktop terminal emulator found. Open a terminal manually and run:");
        command(`cd "${repoDir}" && ${cliName} ${args.join(" ")}`);
        resolve(false);
        return;
      }
      const [first, ...rest] = cands;
      void spawnDetached(first.cmd, first.args(repoDir, launchScript)).then((started) => {
        if (started) resolve(true);
        else tryNext(rest);
      });
    };
    tryNext(candidates);
  });
}

async function launchWindows(cliName: string, repoDir: string, args: string[]): Promise<boolean> {
  const escapedDir = repoDir.replace(/'/g, "''");
  const cliExe = commandExists(cliName) ?? cliName;
  const escapedExe = cliExe.replace(/'/g, "''");
  const argStr = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(" ");
  const invokeScript = `& '${escapedExe}' ${argStr}`;
  const launchScript = `Set-Location '${escapedDir}'; ${invokeScript}`;

  const pwsh = commandExists("pwsh");
  const ps5 = commandExists("powershell");
  const powershell = pwsh ?? ps5;
  // Calling `wt` from a process already hosted by Windows Terminal can produce
  // an empty-command 0x80070002 error. Prefer detached PowerShell directly.
  if (powershell && await spawnDetached(powershell, ["-NoProfile", "-NoExit", "-Command", launchScript])) {
    return true;
  }
  const wt = commandExists("wt");
  if (wt && powershell && await spawnDetached(wt, windowsTerminalArgs(powershell, repoDir, invokeScript))) {
    return true;
  }
  warn("No supported Windows terminal found. Open a terminal manually and run:");
  command(`cd "${repoDir}"; ${cliName} ${args.join(" ")}`);
  return Promise.resolve(false);
}

export function windowsTerminalArgs(powershell: string, repoDir: string, invokeScript: string): string[] {
  return ["new-tab", "-d", repoDir, "--", powershell, "-NoProfile", "-NoExit", "-Command", invokeScript];
}

function commandExists(cmd: string): string | undefined {
  const isWin = process.platform === "win32";
  const exts = isWin ? [".com", ".exe", ".bat", ".cmd", ""] : [""];
  const dirs = (process.env.PATH ?? process.env.Path ?? "").split(path.delimiter);
  if (isWin) {
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
    const localAppData = process.env.LOCALAPPDATA;
    if (systemRoot) dirs.push(path.join(systemRoot, "System32"));
    if (systemRoot && cmd.toLowerCase() === "powershell") dirs.push(path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0"));
    if (localAppData) dirs.push(path.join(localAppData, "Microsoft", "WindowsApps"));
  }
  for (const dir of [...new Set(dirs)]) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, cmd + ext);
      try {
        fs.accessSync(full);
        return full;
      } catch {
        // continue
      }
    }
  }
  return undefined;
}

function spawnDetached(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    let settled = false;
    const finish = (started: boolean) => {
      if (settled) return;
      settled = true;
      if (started) child.unref();
      resolve(started);
    };
    child.once("error", () => finish(false));
    child.once("spawn", () => finish(true));
  });
}
