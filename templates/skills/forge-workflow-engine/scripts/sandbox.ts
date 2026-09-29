/**
 * Per-task git worktree sandboxes for parallel engine execution.
 *
 * The engine's output gate and `outputFiles` enrichment compare repository-wide
 * worktree snapshots taken around a task. With two tasks editing the same tree
 * those snapshots cannot say which task changed what, so concurrent execution
 * used to be impossible without weakening that evidence.
 *
 * A sandbox removes the ambiguity instead of weakening it: each task gets its
 * own `git worktree` on a detached HEAD, so the files it changed are exactly
 * the files in its sandbox. When the task finishes, those files are copied back
 * into the engine root and the existing per-task auto-commit runs unchanged.
 *
 * Assumptions that keep the copy-back sound:
 *
 *   - the engine root is clean when the wave starts (checked by
 *     `preflightSandboxMode`), so a sandbox at HEAD equals the engine root;
 *   - engine metadata under `docs/` is copied in, gitignored build inputs are
 *     symlinked in, and neither is ever attributed back to the task;
 *   - integration is serialized by the engine, so `git add -A` only ever sees
 *     one task's files plus the engine's own `docs/` state.
 */

import {
  appendFileSync,
  cpSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { runCommand } from "./harness/run.ts";
import { taskFileId } from "./task-execution.ts";
import { ENGINE_METADATA_ROOT, isEngineOwnedPath, parseWorktreeEntries } from "./verify.ts";

/** Repository-relative directory that holds live and stale task sandboxes. */
export const SANDBOX_DIRNAME = ".forge-sandboxes";

const GIT = { timeoutMs: 60_000, maxBufferBytes: 32 * 1024 * 1024 } as const;

export interface SandboxPreflight {
  ok: boolean;
  reason?: string;
}

export interface Sandbox {
  taskId: string;
  /** Absolute path of the task's worktree. */
  path: string;
  /** Ignored top-level build inputs symlinked in, e.g. `node_modules`. */
  linkedInputs: string[];
  /** Engine metadata copied in from `docs/`. */
  seededFiles: string[];
}

export interface SandboxIntegration {
  /** Paths written into the engine root. */
  copied: string[];
  /** Paths removed from the engine root (deleted inside the sandbox). */
  deleted: string[];
  /** Paths another task in this wave already integrated. */
  conflicts: string[];
}

export function sandboxRoot(repoRoot: string): string {
  return join(repoRoot, SANDBOX_DIRNAME);
}

// ─── git plumbing ─────────────────────────────────────────────────────────────

async function git(repoRoot: string, args: string[]): Promise<{ status: number | null; stdout: string; stderr: string; error?: string }> {
  return runCommand("git", args, { cwd: repoRoot, ...GIT });
}

async function gitOrThrow(repoRoot: string, args: string[]): Promise<string> {
  const result = await git(repoRoot, args);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error || "").trim();
    throw new Error(`git ${args.join(" ")} failed (exit ${result.status})${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout;
}

/** Runs a NUL-delimited git listing and returns its non-empty entries. */
async function gitPaths(repoRoot: string, args: string[]): Promise<string[]> {
  return (await gitOrThrow(repoRoot, args)).split("\0").filter(Boolean);
}

/**
 * A path in a form that can be compared for containment across platforms.
 *
 * Windows is case-insensitive, git prints paths with forward slashes, and a
 * directory reachable through a short (8.3) name can come back spelled the long
 * way. Resolving the real path first and then normalizing means a sandbox is
 * still recognized as one when the spelling differs from how we created it -
 * otherwise teardown silently skips it and the worktree leaks.
 */
function comparablePath(value: string): string {
  const absolute = resolve(value);
  let real = absolute;
  try {
    real = realpathSync.native(absolute);
  } catch {
    // The path may not exist yet (a sandbox being created, or one already
    // removed); the resolved form is still a stable comparison key.
  }
  const normalized = real.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/** True when `candidate` sits strictly inside `parent`. */
function isInside(parent: string, candidate: string): boolean {
  const rel = relative(comparablePath(parent), comparablePath(candidate));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Resolves a repository-relative path, refusing anything that escapes the root. */
function resolveWithin(root: string, relPath: string): string {
  const normalized = relPath.replace(/\\/g, "/");
  if (!normalized || isAbsolute(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`Refusing to touch a path outside the repository: ${relPath}`);
  }
  return join(root, normalized);
}

// ─── lifecycle ────────────────────────────────────────────────────────────────

/**
 * Keep the sandbox directory out of `git status` without touching the
 * operator's tracked `.gitignore`. `.git/info/exclude` is repository-local and
 * is never committed, so the run leaves no trace in the working tree.
 */
export async function ensureSandboxExcluded(repoRoot: string): Promise<void> {
  const infoExclude = (await gitOrThrow(repoRoot, ["rev-parse", "--git-path", "info/exclude"])).trim();
  if (!infoExclude) return;
  const file = resolve(repoRoot, infoExclude);
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (current.split(/\r?\n/).some((line) => line.trim() === `${SANDBOX_DIRNAME}/`)) return;
  appendFileSync(file, `${current && !current.endsWith("\n") ? "\n" : ""}${SANDBOX_DIRNAME}/\n`, "utf8");
}

/**
 * Remove sandboxes left behind by a killed engine. Registered worktrees are
 * detached with `git worktree remove`; anything else is deleted directly, and
 * `git worktree prune` clears the metadata either way.
 */
export async function sweepStaleSandboxes(repoRoot: string): Promise<number> {
  await ensureSandboxExcluded(repoRoot);
  const root = sandboxRoot(repoRoot);
  const listed = await git(repoRoot, ["worktree", "list", "--porcelain"]);
  const stale = (listed.status === 0 ? listed.stdout.split("\n") : [])
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter((path) => isInside(root, path));
  for (const path of stale) await removeWorktree(repoRoot, path);
  if (existsSync(root)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  await git(repoRoot, ["worktree", "prune"]);
  return stale.length;
}

/**
 * Refuse parallel execution unless a sandbox can faithfully stand in for the
 * engine root: the repository needs a resolvable HEAD, and the working tree
 * must be clean apart from engine metadata under `docs/`.
 *
 * Only *untracked* `docs/` files are tolerated, and those are copied into each
 * sandbox, so the task reads the same versions the operator does. A modified
 * tracked file anywhere - including a hand-edited `docs/PRD.md` - blocks the
 * run instead of silently handing the task the committed copy.
 */
export async function preflightSandboxMode(repoRoot: string): Promise<SandboxPreflight> {
  if (!existsSync(join(repoRoot, ".git"))) {
    return { ok: false, reason: "Parallel task execution needs a git repository: there is no .git in the repository root. Commit the project, or run with --concurrency 1." };
  }
  const head = await git(repoRoot, ["rev-parse", "--verify", "HEAD"]);
  if (head.status !== 0) {
    return { ok: false, reason: "Parallel task execution needs at least one commit so each task sandbox can start from HEAD. Make an initial commit, or run with --concurrency 1." };
  }
  const status = await git(repoRoot, ["status", "--porcelain", "-z", "--untracked-files=all"]);
  if (status.status !== 0) {
    return { ok: false, reason: "git could not be queried in the repository root, so task sandboxes cannot be built. Run with --concurrency 1." };
  }
  const blocking = parseWorktreeEntries(status.stdout)
    .filter((entry) => {
      if (entry.path === SANDBOX_DIRNAME || isEngineOwnedPath(entry.path)) return false;
      // Untracked docs/ files are engine metadata and are copied into the sandbox.
      return !(entry.code === "??" && entry.path.startsWith(ENGINE_METADATA_ROOT));
    })
    .map((entry) => entry.path)
    .sort();
  if (blocking.length > 0) {
    const shown = blocking.slice(0, 10).join(", ");
    const more = blocking.length > 10 ? ` (+${blocking.length - 10} more)` : "";
    return {
      ok: false,
      reason: `Parallel task execution requires a clean working tree, but these paths are uncommitted: ${shown}${more}. Commit or stash them, or run with --concurrency 1.`,
    };
  }
  return { ok: true };
}

/**
 * Creates the task's worktree and makes it usable: gitignored top-level build
 * inputs are symlinked (so `npm test` still finds `node_modules`) and engine
 * metadata under `docs/` is copied in (so the task can read the manifest and
 * the reference documents a compile just produced).
 */
export async function createSandbox(
  repoRoot: string,
  taskId: string,
  options: { signal?: AbortSignal } = {},
): Promise<Sandbox> {
  options.signal?.throwIfAborted();
  await ensureSandboxExcluded(repoRoot);
  const root = sandboxRoot(repoRoot);
  mkdirSync(root, { recursive: true });
  // `taskFileId` sanitises the id, so the directory can never escape the root.
  const path = join(root, taskFileId(taskId));
  rmSync(path, { recursive: true, force: true });
  await gitOrThrow(repoRoot, ["worktree", "add", "--detach", path, "HEAD"]);
  options.signal?.throwIfAborted();
  return { taskId, path, linkedInputs: await linkBuildInputs(repoRoot, path), seededFiles: await seedEngineMetadata(repoRoot, path) };
}

/**
 * Every path the engine placed in a sandbox, as prefix matches. A symlinked
 * build input is not matched by a `node_modules/`-style gitignore pattern (git
 * treats a symlink as a file, not a directory), so it can surface as untracked
 * inside the sandbox. Nothing the engine provided may ever be attributed to the
 * task or copied back into the operator's repository.
 */
export function sandboxProvidedPaths(sandbox: Pick<Sandbox, "linkedInputs" | "seededFiles">): string[] {
  return [...sandbox.linkedInputs, ...sandbox.seededFiles];
}

/**
 * Removes a worktree and makes sure it is actually gone.
 *
 * `git worktree remove` can report success and still leave the directory -
 * notably on Windows, where a linked build input is a directory junction that
 * git will not delete. The direct removal is therefore unconditional, and a
 * directory that survives both is reported rather than leaked silently, since
 * it would otherwise keep a worktree registration alive for the whole run.
 */
async function removeWorktree(repoRoot: string, path: string): Promise<void> {
  await git(repoRoot, ["worktree", "remove", "--force", path]);
  if (existsSync(path)) rmSync(path, { recursive: true, force: true, maxRetries: 3 });
  await git(repoRoot, ["worktree", "prune"]);
  if (existsSync(path)) {
    console.warn(`[engine] Could not remove task sandbox ${path}. Remove it by hand; git worktree prune will clear its registration.`);
  }
}

/** Removes the task's worktree. Safe to call twice. */
export async function destroySandbox(repoRoot: string, path: string): Promise<void> {
  if (!path || !isInside(sandboxRoot(repoRoot), path)) return;
  await removeWorktree(repoRoot, path);
}

/**
 * Removes the sandbox root once a run has drained, so a finished run leaves no
 * trace in the repository at all. Safe when tasks are still live: the caller
 * invokes it after the dispatcher returns.
 */
export async function clearSandboxRoot(repoRoot: string): Promise<void> {
  const root = sandboxRoot(repoRoot);
  if (existsSync(root)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  await git(repoRoot, ["worktree", "prune"]);
}

/**
 * Copies the task's work back into the engine root.
 *
 * A path another task in this wave already integrated is reported as a conflict
 * and nothing is copied, so two concurrent tasks touching the same file fail
 * loudly instead of silently losing one edit.
 */
export async function integrateSandbox(options: {
  repoRoot: string;
  sandbox: string;
  paths: readonly string[];
  claimed: Set<string>;
}): Promise<SandboxIntegration> {
  const conflicts = options.paths.filter((path) => options.claimed.has(path));
  if (conflicts.length > 0) return { copied: [], deleted: [], conflicts };

  const copied: string[] = [];
  const deleted: string[] = [];
  for (const relPath of options.paths) {
    const source = resolveWithin(options.sandbox, relPath);
    const target = resolveWithin(options.repoRoot, relPath);
    if (!existsSync(source) && !lstatSync(source, { throwIfNoEntry: false })) {
      rmSync(target, { force: true });
      deleted.push(relPath);
    } else {
      mkdirSync(dirname(target), { recursive: true });
      const stat = lstatSync(source);
      if (stat.isSymbolicLink()) {
        rmSync(target, { force: true });
        symlinkSync(readlinkSync(source), target, process.platform === "win32" ? "file" : undefined);
      } else if (stat.isDirectory()) {
        cpSync(source, target, { recursive: true, force: true });
      } else {
        copyFileSync(source, target);
      }
      copied.push(relPath);
    }
    options.claimed.add(relPath);
  }
  return { copied, deleted, conflicts: [] };
}

// ─── sandbox seeding ──────────────────────────────────────────────────────────

/**
 * Symlinks each gitignored top-level entry from the engine root into the
 * sandbox. A worktree only contains tracked files, so without this every
 * `validationCommands` that needs installed dependencies would fail.
 */
async function linkBuildInputs(repoRoot: string, sandbox: string): Promise<string[]> {
  const entries = await gitPaths(repoRoot, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"]);
  const linked: string[] = [];
  for (const entry of entries) {
    const trimmed = entry.replace(/\/$/, "");
    if (!trimmed || trimmed === ".git" || trimmed === SANDBOX_DIRNAME) continue;
    // A nested ignored path belongs to engine metadata and is copied, not linked.
    if (trimmed.includes("/")) continue;
    const source = join(repoRoot, trimmed);
    const target = join(sandbox, trimmed);
    if (!existsSync(source) || existsSync(target)) continue;
    mkdirSync(dirname(target), { recursive: true });
    const directory = lstatSync(source).isDirectory();
    symlinkSync(source, target, process.platform === "win32" ? (directory ? "junction" : "file") : directory ? "dir" : "file");
    linked.push(trimmed);
  }
  return linked;
}

/**
 * Copies the engine's own `docs/` output into the sandbox: the compiled
 * manifest, the engine config, human-review evidence, and any generated
 * artifacts. These are never tracked, so a worktree at HEAD does not have them,
 * and a task that reads them must see the current versions.
 */
async function seedEngineMetadata(repoRoot: string, sandbox: string): Promise<string[]> {
  const ignored = await gitPaths(repoRoot, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"]);
  const untracked = await gitPaths(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const seeded: string[] = [];
  for (const raw of [...ignored, ...untracked]) {
    const relPath = raw.replace(/\/$/, "");
    if (!relPath.startsWith(ENGINE_METADATA_ROOT)) continue;
    const source = join(repoRoot, relPath);
    const target = join(sandbox, relPath);
    if (!existsSync(source) || existsSync(target)) continue;
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target, { recursive: true, force: true });
    seeded.push(relPath);
  }
  return seeded;
}
