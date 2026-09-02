import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { registryPath } from "./paths.ts";

export type BackgroundJobType =
  | "create-project"
  | "draft-prd"
  | "draft-team"
  | "engine-run"
  | "engine-resume"
  | "engine-replay";

export type BackgroundJobStatus = "running" | "complete" | "failed" | "paused";

export interface BackgroundJob {
  id: string;
  type: BackgroundJobType;
  repoPath: string;
  pid?: number;
  taskId?: string;
  logPath?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  status: BackgroundJobStatus;
  message: string;
}

export function jobsPath(): string {
  return path.join(path.dirname(registryPath()), "jobs.json");
}

export function loadJobs(): BackgroundJob[] {
  const file = jobsPath();
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((job): job is BackgroundJob =>
      Boolean(job && typeof job.id === "string" && typeof job.repoPath === "string" && typeof job.type === "string"));
  } catch {
    return [];
  }
}

export function saveJobs(jobs: BackgroundJob[]): void {
  const file = jobsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(jobs, null, 2)}\n`, "utf8");
}

export function startJob(input: {
  type: BackgroundJobType;
  repoPath: string;
  pid?: number;
  taskId?: string;
  logPath?: string;
  message: string;
}): BackgroundJob {
  const jobs = loadJobs();
  const now = new Date().toISOString();
  for (const job of jobs) {
    if (job.repoPath !== input.repoPath || job.status !== "running") continue;
    job.status = "failed";
    job.message = "Superseded by a newer background job.";
    job.updatedAt = now;
    job.finishedAt = now;
  }
  const job: BackgroundJob = {
    id: randomUUID(),
    type: input.type,
    repoPath: input.repoPath,
    pid: input.pid,
    taskId: input.taskId,
    logPath: input.logPath,
    startedAt: now,
    updatedAt: now,
    status: "running",
    message: input.message,
  };
  jobs.push(job);
  saveJobs(jobs);
  return job;
}

export function updateJob(jobId: string, patch: Partial<BackgroundJob>): BackgroundJob | null {
  const jobs = loadJobs();
  const job = jobs.find((entry) => entry.id === jobId);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  saveJobs(jobs);
  return job;
}

export function currentJobForRepo(repoPath: string): BackgroundJob | null {
  const matches = loadJobs().filter((job) => path.resolve(job.repoPath) === path.resolve(repoPath));
  if (matches.length === 0) return null;
  const running = matches.findLast((job) => job.status === "running");
  return running ?? matches.toSorted((a, b) => a.updatedAt.localeCompare(b.updatedAt)).at(-1) ?? null;
}
