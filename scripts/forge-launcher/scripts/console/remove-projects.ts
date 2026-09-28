import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { jobResultPath, jobsPath, loadJobs, type BackgroundJob } from "./jobs.ts";
import { loadRegistry, registryPath, repoPaths } from "./paths.ts";

export interface ProjectRemovalResult {
  path: string;
  name: string;
  status: "removed" | "blocked" | "failed";
  message: string;
}

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Resolve existing ancestors too, so missing folders behind a junction stay protected. */
function physicalPath(file: string): string {
  const absolute = path.resolve(file);
  try {
    return fs.realpathSync.native(absolute);
  } catch (error) {
    if (!missing(error)) throw error;
    const parent = path.dirname(absolute);
    if (parent === absolute) throw error;
    return path.join(physicalPath(parent), path.basename(absolute));
  }
}

function pathKey(file: string): string {
  const resolved = physicalPath(file);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function sameProjectPath(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right);
}

/**
 * Legacy registry records may hold relative paths (e.g. from `--repo .`). Their
 * real location is unknowable, so they match only by exact text and are never
 * resolved against the Console's working directory.
 */
function sameRecordPath(left: string, right: string): boolean {
  if (!path.isAbsolute(left) || !path.isAbsolute(right)) return left === right;
  return sameProjectPath(left, right);
}

function inside(file: string, root: string): boolean {
  const relative = path.relative(root, file);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function assertExternal(file: string, roots: string[]): void {
  const physical = pathKey(file);
  if (roots.some((root) => inside(physical, pathKey(root)))) {
    throw new Error("Forge storage overlaps a project folder; no removal was performed.");
  }
  // Protect repositories that are not currently registered as well.
  for (let dir = path.dirname(physical); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".git"))) {
      throw new Error("Forge storage is inside a Git repository; no removal was performed.");
    }
    if (path.dirname(dir) === dir) break;
  }
}

function assertStorageFile(file: string, roots: string[]): void {
  assertExternal(file, roots);
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)) {
    throw new Error("Forge registry/history must be regular, unshared files outside project folders.");
  }
}

function pidActive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      if (error.code === "ESRCH") return false;
      if (error.code === "EPERM") return true;
    }
    throw error;
  }
}

function hasActiveJobs(root: string, jobs: BackgroundJob[]): boolean {
  // Finished jobs are never active: the OS may have reused their PIDs for
  // unrelated processes, so only unfinished jobs are checked for liveness.
  const unfinished = jobs.filter((job) => job.status === "running" || job.status === "paused");
  if (unfinished.some((job) => (job.pid !== undefined && pidActive(job.pid))
    || (job.status === "running" && job.pid === undefined))) return true;
  if (!path.isAbsolute(root)) return false;
  try {
    const raw = fs.readFileSync(repoPaths(root).pidPath, "utf8").trim();
    const pid = Number(raw);
    if (!Number.isInteger(pid) || pid <= 0) throw new Error("Cannot verify the project's engine PID; removal refused.");
    return pidActive(pid);
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

function writeStore(file: string, records: unknown[]): void {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(records, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function verifiedResult(job: BackgroundJob, jobs: BackgroundJob[], roots: string[]): string | null {
  if (!job.resultPath) return null;
  // Only the exact Console-generated filename and attributable terminal receipt
  // establish ownership. Never follow a resultPath supplied by history alone.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(job.id)) return null;
  const expected = jobResultPath(job.id);
  if (path.resolve(job.resultPath) !== path.resolve(expected)) return null;
  const dir = fs.lstatSync(path.dirname(expected), { throwIfNoEntry: false });
  if (!dir || !dir.isDirectory() || dir.isSymbolicLink()) return null;
  const stat = fs.lstatSync(expected, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) return null;
  assertExternal(expected, roots);
  if (jobs.some((other) => !sameRecordPath(other.repoPath, job.repoPath)
    && (other.id === job.id || (other.resultPath && sameProjectPath(other.resultPath, expected))))) return null;
  let receipt: unknown;
  try {
    receipt = JSON.parse(fs.readFileSync(expected, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (!receipt || typeof receipt !== "object") return null;
  const value = receipt as Record<string, unknown>;
  return value.version === 1 && value.id === job.id
    && (value.exitCode === null || typeof value.exitCode === "number")
    && (value.signal === null || typeof value.signal === "string")
    && typeof value.finishedAt === "string" ? expected : null;
}

/** Synchronous read/check/write prevents interleaving with this Console's job launches. */
export function removeProjects(paths: string[], current: string | null): ProjectRemovalResult[] {
  const protectedRoots = new Set(current ? [current] : []);
  return [...new Set(paths)].map((target): ProjectRemovalResult => {
    let name = path.basename(target);
    let deleted = 0;
    try {
      const projects = loadRegistry(true);
      const jobs = loadJobs(true);
      const project = projects.find((entry) => sameRecordPath(entry.path, target));
      if (!project) throw new Error("Project is not registered in Forge.");
      name = project.name ?? name;
      for (const entry of projects) if (path.isAbsolute(entry.path)) protectedRoots.add(entry.path);
      for (const job of jobs) if (path.isAbsolute(job.repoPath)) protectedRoots.add(job.repoPath);
      const roots = [...protectedRoots];
      assertStorageFile(registryPath(), roots);
      assertStorageFile(jobsPath(), roots);
      const associated = jobs.filter((job) => sameRecordPath(job.repoPath, target));
      if (hasActiveJobs(project.path, associated)) {
        return { path: target, name, status: "blocked", message: "Project has active jobs. Wait for them to finish; no jobs were terminated." };
      }
      const results = associated.map((job) => verifiedResult(job, jobs, roots));
      const retained = associated.filter((job, index) => job.resultPath && !results[index]).length;
      // Preflight every candidate before unlinking anything. Never remove directories or logs.
      for (const file of new Set(results)) {
        if (!file) continue;
        fs.unlinkSync(file);
        deleted += 1;
      }
      const remainingJobs = jobs.filter((job) => !associated.includes(job));
      if (associated.length > 0) writeStore(jobsPath(), remainingJobs);
      try {
        writeStore(registryPath(), projects.filter((entry) => !sameRecordPath(entry.path, target)));
      } catch (error) {
        if (associated.length > 0) {
          try { writeStore(jobsPath(), jobs); } catch (rollbackError) {
            throw new Error(`Registry update failed and job history could not be restored: ${String(error)}; ${String(rollbackError)}`);
          }
        }
        throw error;
      }
      return {
        path: target, name, status: "removed",
        message: `Removed from Forge. No files inside project folders were changed or deleted.${retained ? ` ${retained} missing or unverified result file(s) were left untouched.` : ""}`,
      };
    } catch (error) {
      const cleanup = deleted > 0
        ? ` ${deleted} verified external result file(s) had already been deleted and cannot be restored.`
        : " No files were deleted.";
      return {
        path: target, name, status: "failed",
        message: `Removal failed: ${error instanceof Error ? error.message : String(error)} The project is still registered.${cleanup}`,
      };
    }
  });
}
