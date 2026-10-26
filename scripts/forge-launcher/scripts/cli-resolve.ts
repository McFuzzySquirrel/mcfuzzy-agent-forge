import fs from "node:fs";
import path from "node:path";

/**
 * Explicit executable overrides for each harness CLI, checked before PATH so a
 * user can point at a non-standard install location.
 */
const CLI_OVERRIDE_ENV: Record<string, string[]> = {
  opencode: ["OPENCODE_BIN"],
  claude: ["CLAUDE_CODE_BIN", "CLAUDE_BIN"],
  copilot: ["COPILOT_BIN"],
};

export interface ResolveCliOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

/**
 * Executable filenames to try for a command.
 *
 * Windows needs explicit extensions: node-pty's conpty backend does a literal
 * filename lookup on PATH (`path_util.cc` `get_shell_path`) and does not apply
 * PATHEXT, so a bare `opencode` never matches `opencode.exe`. Resolving the
 * absolute path here is what makes `spawn("opencode")` work with the official
 * Windows installers.
 */
export function cliExecutableNames(name: string, platform: NodeJS.Platform = process.platform): string[] {
  if (platform !== "win32") return [name];
  return [".exe", ".cmd", ".bat", ".com", ""].map((ext) => name + ext);
}

function joinFor(platform: NodeJS.Platform, dir: string, file: string): string {
  return (platform === "win32" ? path.win32 : path.posix).join(dir, file);
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Directories to search: PATH first, then well-known Windows install locations
 * so a harness installed off PATH (or with a stale PATH in a long-running
 * process) is still found.
 */
export function cliSearchDirs(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const delimiter = platform === "win32" ? ";" : ":";
  const pathVar = env.PATH ?? env.Path ?? "";
  const dirs = pathVar.split(delimiter).filter(Boolean);
  if (platform === "win32") {
    const { LOCALAPPDATA, APPDATA, USERPROFILE, SystemRoot, WINDIR } = env;
    if (LOCALAPPDATA) {
      dirs.push(
        path.win32.join(LOCALAPPDATA, "Programs", "opencode", "bin"),
        path.win32.join(LOCALAPPDATA, "Programs", "opencode"),
        path.win32.join(LOCALAPPDATA, "Programs", "Claude"),
        path.win32.join(LOCALAPPDATA, "Programs", "copilot"),
        path.win32.join(LOCALAPPDATA, "Microsoft", "WindowsApps"),
      );
    }
    if (APPDATA) dirs.push(path.win32.join(APPDATA, "npm"));
    if (USERPROFILE) {
      dirs.push(path.win32.join(USERPROFILE, ".opencode", "bin"), path.win32.join(USERPROFILE, ".local", "bin"));
    }
    const systemRoot = SystemRoot ?? WINDIR;
    if (systemRoot) {
      dirs.push(
        path.win32.join(systemRoot, "System32"),
        path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0"),
      );
    }
  }
  return [...new Set(dirs.filter(Boolean))];
}

/**
 * Resolves a CLI name to an absolute executable path, or null when it cannot be
 * found. An env override wins; otherwise PATH and common install dirs are
 * searched with the platform's executable extensions.
 */
export function resolveCliPath(name: string, options: ResolveCliOptions = {}): string | null {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  for (const key of CLI_OVERRIDE_ENV[name] ?? []) {
    const value = env[key];
    if (!value) continue;
    if (isFile(value)) return value;
    for (const file of cliExecutableNames(name, platform)) {
      const candidate = joinFor(platform, value, file);
      if (isFile(candidate)) return candidate;
    }
  }

  for (const dir of cliSearchDirs(env, platform)) {
    for (const file of cliExecutableNames(name, platform)) {
      const candidate = joinFor(platform, dir, file);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

/** User-facing explanation when a CLI cannot be resolved. */
export function cliNotFoundMessage(name: string): string {
  const override = CLI_OVERRIDE_ENV[name]?.[0] ?? `${name.toUpperCase()}_BIN`;
  return `${name} was not found on PATH. Install it, or set ${override} to its full path.`;
}
