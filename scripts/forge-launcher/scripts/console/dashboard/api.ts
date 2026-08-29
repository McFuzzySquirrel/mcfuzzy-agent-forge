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
  ExecutionManifest,
  FileContent,
  LogsResponse,
  OpenResult,
  ProjectsIndex,
  SelectResult,
  Summary,
  TaskRow,
  TeamIndex,
  WorkflowState,
} from "./types.js";

function token(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="forge-token"]');
  return meta?.content ?? "";
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`request failed: ${res.status} ${res.statusText}`);
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
  control(action: ControlAction, taskId?: string): Promise<ControlResult> {
    return post<ControlResult>("/api/control", { action, taskId });
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
