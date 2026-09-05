import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { registryPath } from "./paths.ts";

export type BackgroundJobType =
  | "create-project"
  | "bootstrap"
  | "feature-prd"
  | "feature-increment"
  | "draft-prd"
  | "draft-existing-prd"
  | "draft-team"
  | "draft-skills"
  | "compile-manifest"
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
  resultPath?: string;
  status: BackgroundJobStatus;
  message: string;
  run?: boolean;
  autoDraft?: boolean;
}

export function jobsPath(): string {
  return path.join(path.dirname(registryPath()), "jobs.json");
}

export function jobResultPath(id: string): string {
  return path.join(path.dirname(jobsPath()), "job-results", `${id}.json`);
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
  id?: string;
  resultPath?: string;
  run?: boolean;
  autoDraft?: boolean;
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
    id: input.id ?? randomUUID(),
    type: input.type,
    repoPath: input.repoPath,
    pid: input.pid,
    taskId: input.taskId,
    logPath: input.logPath,
    resultPath: input.resultPath,
    startedAt: now,
    updatedAt: now,
    status: "running",
    message: input.message,
    run: input.run,
    autoDraft: input.autoDraft,
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
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    if (matches[i]!.status === "running") return matches[i]!;
  }
  matches.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  return matches[matches.length - 1] ?? null;
}
