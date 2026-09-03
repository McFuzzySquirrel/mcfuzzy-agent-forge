// ─── Typed API client for the Forge Console server ───────────────────────────

import type {
  Actions,
  ArtifactIndex,
  ArtifactMeta,
  AuditEvent,
  ControlAction,
  ControlResult,
  CreateProjectRequest,
  CreateProjectResult,
  DocsIndex,
  ExecutionMode,
  ExecutionManifest,
  FileContent,
  LaunchCliResult,
  LogsResponse,
  OpenResult,
  ProjectsIndex,
  SelectionScope,
  SelectResult,
  Summary,
  TaskRow,
  TeamIndex,
  TimeoutUpdateResult,
  UploadResult,
  WorkflowState,
} from "./types.js";

function token(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="forge-token"]');
  return meta?.content ?? "";
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    // The console API returns structured errors. Preserve their message so a
    // failed bootstrap (or any other action) is actionable in the UI instead
    // of collapsing everything into "400 Bad Request".
    let detail = "";
    try {
      const body = await res.clone().json() as { message?: unknown };
      if (typeof body.message === "string") detail = `: ${body.message}`;
    } catch {
      // Some proxy/server failures are plain text; the status is still useful.
    }
    throw new Error(`request failed: ${res.status} ${res.statusText}${detail}`);
  }
  return res.json() as Promise<T>;
}

function post<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forge-Token": token() },
    body: JSON.stringify(body),
  });
}

export const api = {
  summary(): Promise<Summary | null> {
    return request<Summary | null>("/api/summary");
  },
  tasks(): Promise<TaskRow[]> {
    return request<TaskRow[]>("/api/tasks");
  },
  audit(): Promise<AuditEvent[]> {
    return request<AuditEvent[]>("/api/audit");
  },
  logs(lines = 400): Promise<LogsResponse> {
    return request<LogsResponse>(`/api/logs?lines=${lines}`);
  },
  artifacts(): Promise<ArtifactIndex> {
    return request<ArtifactIndex>("/api/artifacts");
  },
  artifact(id: string): Promise<unknown> {
    return request<unknown>(`/api/artifacts/${encodeURIComponent(id)}`);
  },
  artifactContent(relPath: string): Promise<FileContent> {
    return request<FileContent>(`/api/artifact/content?path=${encodeURIComponent(relPath)}`);
  },
  docs(): Promise<DocsIndex> {
    return request<DocsIndex>("/api/docs");
  },
  docContent(relPath: string): Promise<FileContent> {
    return request<FileContent>(`/api/docs/content?path=${encodeURIComponent(relPath)}`);
  },
  team(): Promise<TeamIndex> {
    return request<TeamIndex>("/api/team");
  },
  teamContent(relPath: string): Promise<FileContent> {
    return request<FileContent>(`/api/team/content?path=${encodeURIComponent(relPath)}`);
  },
  guideMarkdown(): Promise<string> {
    return fetch("/guide.md").then((res) => {
      if (!res.ok) throw new Error(`request failed: ${res.status} ${res.statusText}`);
      return res.text();
    });
  },
  actions(): Promise<Actions> {
    return request<Actions>("/api/actions");
  },
  projects(): Promise<ProjectsIndex> {
    return request<ProjectsIndex>("/api/projects");
  },
  selectRepo(path: string): Promise<SelectResult> {
    return post<SelectResult>("/api/projects/select", { path });
  },
  addRepo(path: string): Promise<SelectResult> {
    return post<SelectResult>("/api/projects/add", { path });
  },
  createProject(req: CreateProjectRequest): Promise<CreateProjectResult> {
    return post<CreateProjectResult>("/api/projects/create", req);
  },
  upload(name: string, content: string): Promise<UploadResult> {
    return post<UploadResult>("/api/uploads", { name, content });
  },
  setAutoCommit(enabled: boolean): Promise<{ ok: boolean; message: string }> {
    return post<{ ok: boolean; message: string }>("/api/engine-config", { autoCommit: enabled });
  },
  setConcurrency(value: number): Promise<{ ok: boolean; message: string }> {
    return post<{ ok: boolean; message: string }>("/api/engine-config", { concurrency: value });
  },
  setExecutionMode(mode: ExecutionMode): Promise<{ ok: boolean; message: string }> {
    return post<{ ok: boolean; message: string }>("/api/engine-config", { executionMode: mode });
  },
  setTaskSelection(selectionScope: SelectionScope | null, selectedTaskIds: string[]): Promise<{ ok: boolean; message: string }> {
    return post<{ ok: boolean; message: string }>("/api/engine-config", { selectionScope, selectedTaskIds });
  },
  launchCli(): Promise<LaunchCliResult> {
    return post<LaunchCliResult>("/api/launch-cli", {});
  },
  control(action: ControlAction, taskId?: string): Promise<ControlResult> {
    return post<ControlResult>("/api/control", { action, taskId });
  },
  bootstrap(req: { path: string; harness?: string; force?: boolean; initGit?: boolean }): Promise<ControlResult> {
    return post<ControlResult>("/api/projects/bootstrap", req);
  },
  featurePrd(prompt: string): Promise<ControlResult> {
    return post<ControlResult>("/api/control", { action: "feature-prd", prompt });
  },
  featureIncrement(prompt: string, run = false): Promise<ControlResult> {
    return post<ControlResult>("/api/control", { action: "feature-increment", prompt, run });
  },
  setTaskTimeout(taskId: string, timeoutMs: number): Promise<TimeoutUpdateResult> {
    return post<TimeoutUpdateResult>("/api/tasks/timeout", { taskId, timeoutMs });
  },
  setAllTaskTimeouts(timeoutMs: number): Promise<TimeoutUpdateResult> {
    return post<TimeoutUpdateResult>("/api/tasks/timeout", { timeoutMs });
  },
  openExternal(path: string): Promise<OpenResult> {
    return post<OpenResult>("/api/open", { path });
  },
  manifest(): Promise<ExecutionManifest | null> {
    return request<ExecutionManifest | null>("/api/manifest");
  },
  state(): Promise<WorkflowState | null> {
    return request<WorkflowState | null>("/api/state");
  },
};

export type { ArtifactMeta };
