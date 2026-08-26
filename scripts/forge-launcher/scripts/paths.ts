import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Expands `$VAR` and `${VAR}` references in a string (unknown vars → empty). */
export function expandEnv(s: string): string {
  return s.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (_m, braced: string | undefined, plain: string | undefined) =>
      process.env[braced ?? plain ?? ""] ?? "",
  );
}

/**
 * Normalises a user-typed path: trims whitespace, expands `$VAR` references,
 * then expands a leading `~` / `~/...` / `~user` to a home directory.
 */
export function expandPath(input: string): string {
  let p = expandEnv(input).trim();
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  if (p.startsWith("~")) {
    const slash = p.indexOf("/");
    const user = slash === -1 ? p.slice(1) : p.slice(1, slash);
    const rest = slash === -1 ? "" : p.slice(slash + 1);
    let home = "";
    try {
      home = fs.readFileSync("/etc/passwd", "utf8")
        .split("\n")
        .map((l) => l.split(":"))
        .find((f) => f[0] === user)?.[5] ?? "";
    } catch {
      home = "";
    }
    home ||= path.join(os.homedir(), "..", user);
    return rest ? path.join(home, rest) : home;
  }
  return p;
}

export interface ResolveResult {
  path: string;
  reason: string;
  ok: boolean;
}

/**
 * Expands a user-typed path, resolves it to an absolute path, and checks it is
 * an existing regular file.
 */
export function resolveInputFile(raw: string): ResolveResult {
  const expanded = expandPath(raw);
  if (!expanded) return { path: "", reason: "empty path", ok: false };
  const abs = path.resolve(expanded);
  try {
    const st = fs.statSync(abs);
    if (st.isFile()) return { path: abs, reason: "", ok: true };
    return { path: abs, reason: `not a regular file: ${abs}`, ok: false };
  } catch {
    return { path: abs, reason: `file not found: ${abs}`, ok: false };
  }
}

/** Detects the repo root by walking up from cwd looking for a `.git` dir. */
export function detectRepoRoot(cwd = process.cwd(), maxUp = 12): string {
  let current = cwd;
  for (let i = 0; i < maxUp; i++) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}
