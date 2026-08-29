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

class AppStore {
  summary: Summary | null = null;
  manifest: ExecutionManifest | null = null;
  state: WorkflowState | null = null;

  private changeListeners = new Set<ChangeListener>();
  private auditListeners = new Set<AuditListener>();
  private logListeners = new Set<LogListener>();

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
