import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import type { AuditEvent, TaskRecord, WorkflowState } from "./types.ts";
import type { ExecutionManifest, TaskSelection } from "./types.ts";
import { broadcastAudit } from "./viz/bus.ts";

// ─── State file helpers ───────────────────────────────────────────────────────

export function loadState(statePath: string): WorkflowState | null {
  if (!existsSync(statePath)) return null;
  return JSON.parse(readFileSync(statePath, "utf8")) as WorkflowState;
}

export function saveState(statePath: string, state: WorkflowState): void {
  mkdirSync(dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "wx", flush: true });
    renameSync(temporaryPath, statePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export function initState(
  manifest: ExecutionManifest,
  manifestPath: string,
  harnessName: string,
): WorkflowState {
  const now = new Date().toISOString();
  const tasks: Record<string, TaskRecord> = {};

  for (const phase of manifest.phases) {
    for (const task of phase.tasks) {
      tasks[task.id] = {
        taskId: task.id,
        status: "pending",
        ownerAgent: task.ownerAgent,
        attempt: 0,
        outputFiles: [],
      };
    }
  }

  return {
    runId: randomUUID(),
    startedAt: now,
    lastUpdatedAt: now,
    manifestPath,
    manifestVersion: manifest.version,
    harness: harnessName,
    status: "running",
    currentPhase: manifest.phases[0]?.id,
    tasks,
    blockers: [],
    auditLog: [],
  };
}

/** Preserve persisted task records by stable ID while adopting a new manifest. */
export function reconcileState(state: WorkflowState, manifest: ExecutionManifest): WorkflowState {
  const nextTasks: Record<string, TaskRecord> = {};
  for (const phase of manifest.phases) {
    for (const task of phase.tasks) {
      nextTasks[task.id] = state.tasks[task.id] ?? {
        taskId: task.id, status: "pending", ownerAgent: task.ownerAgent, attempt: 0, outputFiles: [],
      };
      if (state.tasks[task.id]) nextTasks[task.id] = { ...state.tasks[task.id], ownerAgent: task.ownerAgent };
    }
  }
  const added = Object.keys(nextTasks).filter((id) => !state.tasks[id]);
  const removed = Object.keys(state.tasks).filter((id) => !nextTasks[id]);
  const changed = new Set(manifest.reconciliation?.changedTaskIds ?? []);
  if (added.length === 0 && removed.length === 0 && changed.size === 0 && state.manifestVersion === manifest.version) return state;
  return {
    ...state,
    manifestVersion: manifest.version,
    tasks: nextTasks,
    blockers: [...state.blockers,
      ...(added.length ? [`Manifest reconciliation added ${added.length} pending task(s): ${added.join(", ")}`] : []),
      ...(removed.length ? [`Manifest reconciliation removed ${removed.length} task(s): ${removed.join(", ")}`] : []),
      ...(changed.size ? [`Manifest reconciliation changed ${changed.size} existing task(s): ${[...changed].join(", ")}`] : [])],
    lastUpdatedAt: new Date().toISOString(),
  };
}

export function markTaskStarted(state: WorkflowState, taskId: string): WorkflowState {
  const task = state.tasks[taskId];
  if (!task) throw new Error(`Unknown task: ${taskId}`);

  return {
    ...state,
    lastUpdatedAt: new Date().toISOString(),
    tasks: {
      ...state.tasks,
      [taskId]: {
        ...task,
        status: "running",
        startedAt: new Date().toISOString(),
        attempt: task.attempt + 1,
      },
    },
  };
}

export function markTaskComplete(
  state: WorkflowState,
  taskId: string,
  outputFiles: string[],
  agentOutput: string,
  artifactId?: string,
  inputArtifactIds?: string[],
): WorkflowState {
  const task = state.tasks[taskId];
  if (!task) throw new Error(`Unknown task: ${taskId}`);

  return {
    ...state,
    lastUpdatedAt: new Date().toISOString(),
    tasks: {
      ...state.tasks,
      [taskId]: {
        ...task,
        status: "complete",
        completedAt: new Date().toISOString(),
        outputFiles,
        agentOutput,
        errorMessage: undefined,
        failureKind: undefined,
        ...(artifactId !== undefined ? { artifactId } : {}),
        ...(inputArtifactIds !== undefined ? { inputArtifactIds } : {}),
      },
    },
  };
}

export function markTaskFailed(
  state: WorkflowState,
  taskId: string,
  errorMessage: string,
): WorkflowState {
  const task = state.tasks[taskId];
  if (!task) throw new Error(`Unknown task: ${taskId}`);

  return {
    ...state,
    lastUpdatedAt: new Date().toISOString(),
    tasks: {
      ...state.tasks,
      [taskId]: {
        ...task,
        status: "failed",
        completedAt: new Date().toISOString(),
        errorMessage,
      },
    },
  };
}

export function markTaskSkipped(state: WorkflowState, taskId: string): WorkflowState {
  const task = state.tasks[taskId];
  if (!task) throw new Error(`Unknown task: ${taskId}`);

  return {
    ...state,
    lastUpdatedAt: new Date().toISOString(),
    tasks: {
      ...state.tasks,
      [taskId]: { ...task, status: "skipped" },
    },
  };
}

export function setCurrentPhase(state: WorkflowState, phaseId: string): WorkflowState {
  return { ...state, currentPhase: phaseId, lastUpdatedAt: new Date().toISOString() };
}

export function setSelection(state: WorkflowState, selection: TaskSelection | undefined): WorkflowState {
  return { ...state, selection, lastUpdatedAt: new Date().toISOString() };
}

export function appendAuditEvent(state: WorkflowState, event: AuditEvent): WorkflowState {
  return {
    ...state,
    auditLog: [...state.auditLog, event],
  };
}

// ─── PROGRESS.md sync ─────────────────────────────────────────────────────────

export function syncProgressMd(
  progressPath: string,
  state: WorkflowState,
  manifest: ExecutionManifest,
): void {
  mkdirSync(dirname(progressPath), { recursive: true });
  const now = new Date().toISOString();

  const scoped = state.selection?.mode === "manual" && state.selection.taskIds.length > 0
    ? new Set(state.selection.taskIds)
    : null;
  const inScope = (taskId: string) => !scoped || scoped.has(taskId);

  const completedLines: string[] = [];
  for (const phase of manifest.phases) {
    for (const task of phase.tasks) {
      if (!inScope(task.id)) continue;
      const record = state.tasks[task.id];
      if (record?.status === "complete") {
        const agentTag = task.ownerAgent ? ` (@${task.ownerAgent})` : "";
        completedLines.push(`- [x] Phase ${phase.id}, Task ${task.id}: ${task.title}${agentTag}`);
        if (record.outputFiles.length > 0) {
          completedLines.push(`  - Files: ${record.outputFiles.join(", ")}`);
        }
      }
    }
  }

  const currentEntry = Object.values(state.tasks).find((t) => t.status === "running");
  const currentLines: string[] = [];
  if (currentEntry) {
    const phaseId = findPhaseForTask(manifest, currentEntry.taskId);
    const task = findTask(manifest, currentEntry.taskId);
    if (task && phaseId && inScope(task.id)) {
      currentLines.push(`- [ ] Phase ${phaseId}, Task ${task.id}: ${task.title}${task.ownerAgent ? ` (@${task.ownerAgent})` : ""}`);
      currentLines.push("  - Status: In progress");
    }
  } else if (state.status === "complete") {
    currentLines.push("- [x] All workflow tasks completed");
  } else {
    currentLines.push("- None currently running");
  }

  const remainingPhases = manifest.phases.filter((phase) =>
    phase.tasks.some((task) => {
      if (!inScope(task.id)) return false;
      const record = state.tasks[task.id];
      return record?.status === "pending" || record?.status === "running";
    }),
  );

  const remainingLines = remainingPhases.length > 0
    ? remainingPhases.map((phase) => `- [ ] Phase ${phase.id}: ${phase.title}`)
    : ["- [x] No remaining phases"];

  const blockerLines = state.blockers.length > 0
    ? state.blockers.map((b) => `- ${b}`)
    : ["- None"];

  const statusLabel = state.status === "complete" ? "Complete"
    : state.status === "paused" ? "Paused"
    : state.status === "failed" ? "Failed"
    : "In Progress";

  const lines = [
    "# Project Progress",
    "",
    "## Current State",
    `**Phase**: ${state.currentPhase ?? "Not Started"}`,
    `**Status**: ${statusLabel}`,
    `**Last Updated**: ${now}`,
    `**Run ID**: ${state.runId}`,
    `**Harness**: ${state.harness}`,
    `**Execution Mode**: ${state.selection?.mode ?? "auto"}`,
    ...(state.selection?.mode === "manual"
      ? [`**Selected Tasks**: ${state.selection.taskIds.join(", ") || "none"}`]
      : []),
    "",
    "## Completed Tasks",
    ...(completedLines.length > 0 ? completedLines : ["- None"]),
    "",
    "## Current Task",
    ...currentLines,
    "",
    "## Remaining",
    ...remainingLines,
    "",
    "## Blockers",
    ...blockerLines,
    "",
    "## Notes",
    `- Workflow engine run ${state.runId}`,
    `- Harness: ${state.harness}`,
    "",
  ];

  writeFileSync(progressPath, lines.join("\n"), "utf8");
}

// ─── Audit log helpers ────────────────────────────────────────────────────────

export function writeAuditEvent(auditPath: string, event: AuditEvent): void {
  mkdirSync(dirname(auditPath), { recursive: true });
  appendFileSync(auditPath, `${JSON.stringify(event)}\n`, "utf8");
  // Broadcast the same event to the live visualization server (no-op unless a
  // dashboard is running in this process).
  broadcastAudit(event);
}

// ─── Manifest traversal helpers ──────────────────────────────────────────────

export function findPhaseForTask(manifest: ExecutionManifest, taskId: string): string | undefined {
  for (const phase of manifest.phases) {
    if (phase.tasks.some((t) => t.id === taskId)) return phase.id;
  }
  return undefined;
}

export function findTask(manifest: ExecutionManifest, taskId: string) {
  for (const phase of manifest.phases) {
    const task = phase.tasks.find((t) => t.id === taskId);
    if (task) return task;
  }
  return undefined;
}

export function statePath(repoRoot: string): string {
  return join(repoRoot, "docs", "WORKFLOW-STATE.json");
}

export function auditPath(repoRoot: string): string {
  return join(repoRoot, "docs", "EXECUTION-AUDIT.jsonl");
}
