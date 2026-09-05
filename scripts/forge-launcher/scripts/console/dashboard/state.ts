// ─── Shared app state + event bus for SSE-driven views ───────────────────────

import type { AuditEvent, ExecutionManifest, Summary, WorkflowState } from "./types.js";

export interface Snapshot {
  summary: Summary | null;
  manifest: ExecutionManifest | null;
  state: WorkflowState | null;
  layout: unknown;
}

type ChangeListener = () => void;
type AuditListener = (event: AuditEvent) => void;
type LogListener = (line: string) => void;
type AuthoringListener = (event: Record<string, unknown>) => void;

export interface ProjectDrafts {
  [key: string]: string;
}

export class Epoch {
  private current = 0;

  next(): number {
    this.current += 1;
    return this.current;
  }

  isCurrent(value: number): boolean {
    return value === this.current;
  }
}

export class AppStore {
  summary: Summary | null = null;
  manifest: ExecutionManifest | null = null;
  state: WorkflowState | null = null;

  private changeListeners = new Set<ChangeListener>();
  private auditListeners = new Set<AuditListener>();
  private logListeners = new Set<LogListener>();
  private authoringListeners = new Set<AuthoringListener>();
  private drafts = new Map<string, ProjectDrafts>();

  projectKey(): string {
    return this.summary?.repoRoot ?? "none";
  }

  getDraft<T extends string>(project: string, key: string, fallback: T): T {
    return (this.drafts.get(project)?.[key] as T | undefined) ?? fallback;
  }

  setDraft(project: string, key: string, value: string): void {
    const current = this.drafts.get(project) ?? {};
    current[key] = value;
    this.drafts.set(project, current);
  }

  clearDraft(project: string, key?: string): void {
    if (!key) {
      this.drafts.delete(project);
      return;
    }
    const current = this.drafts.get(project);
    if (!current) return;
    delete current[key];
    if (Object.keys(current).length === 0) this.drafts.delete(project);
  }

  applySnapshot(snapshot: Snapshot): void {
    this.summary = snapshot.summary;
    this.manifest = snapshot.manifest;
    this.state = snapshot.state;
    for (const fn of [...this.changeListeners]) fn();
  }

  setSummary(summary: Summary | null): void {
    this.summary = summary;
    for (const fn of [...this.changeListeners]) fn();
  }

  emitAudit(event: AuditEvent): void {
    for (const fn of [...this.auditListeners]) fn(event);
  }

  emitLog(line: string): void {
    for (const fn of [...this.logListeners]) fn(line);
  }

  emitAuthoring(event: Record<string, unknown>): void {
    for (const fn of [...this.authoringListeners]) fn(event);
  }

  onAuthoring(fn: AuthoringListener): () => void {
    this.authoringListeners.add(fn);
    return () => this.authoringListeners.delete(fn);
  }

  subscribe(fn: ChangeListener): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  onAudit(fn: AuditListener): () => void {
    this.auditListeners.add(fn);
    return () => this.auditListeners.delete(fn);
  }

  onLog(fn: LogListener): () => void {
    this.logListeners.add(fn);
    return () => this.logListeners.delete(fn);
  }
}

export const store = new AppStore();
