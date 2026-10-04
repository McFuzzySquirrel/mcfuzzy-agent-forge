// ─── Task graph: the one definition of "is this task ready yet" ─────────────
//
// This module deliberately has no runtime imports beyond Node built-ins. The
// Forge Console serves an arbitrary project directory and dynamically imports
// engine code from the installed templates, where the engine's own
// `node_modules` may not be present - importing `engine.ts` there would drag in
// the harness and fail at runtime. Anything the Console and the engine must
// agree on therefore lives here, with `types.ts` for its shapes.
//
// Two consumers schedule from this rule and must not disagree about what the
// engine can dispatch: the dispatcher, which gates execution on
// `unmetPrerequisites`, and the Board's Gantt mode, which forecasts from
// `prerequisites`.

import type { ExecutionManifest, TaskStatus, WorkflowState } from "./types.ts";

/** A task counts as done once it is complete or deliberately skipped. */
export function isTaskDone(status: TaskStatus | undefined): boolean {
  return status === "complete" || status === "skipped";
}

/**
 * Every task that must finish before `taskId` may be dispatched: its direct
 * dependencies plus every task of each phase it depends on. Empty for an unknown
 * task id.
 *
 * A phase dependency brings in *all* of that phase's tasks, not just its last, so
 * ordering between phases comes from the compiler's dependency chain rather than
 * from picking one representative task.
 */
export function prerequisites(manifest: ExecutionManifest, taskId: string): string[] {
  const entry = manifest.phases
    .flatMap((phase) => phase.tasks.map((task) => ({ phase, task })))
    .find((candidate) => candidate.task.id === taskId);
  if (!entry) return [];
  const phaseDependencies = (entry.phase.dependencies ?? []).flatMap((id) =>
    (manifest.phases.find((candidate) => candidate.id === id)?.tasks ?? []).map((task) => task.id));
  return [...new Set([...(entry.task.dependencies ?? []), ...phaseDependencies])];
}

/**
 * Every prerequisite of `taskId` that is not yet complete or skipped, using the
 * same direct-dependency plus transitive-phase-dependency rule the engine
 * dispatches on.
 *
 * This is the single definition of "is this task reviewable yet". The engine
 * gates dispatch on it, the Console surfaces it, and both approval surfaces
 * refuse to record an attestation until it is empty - so the dispatcher, the row
 * label, and the guard cannot drift into disagreeing about what is ready.
 */
export function unmetPrerequisites(
  manifest: ExecutionManifest,
  state: WorkflowState,
  taskId: string,
): string[] {
  return prerequisites(manifest, taskId).filter((id) => !isTaskDone(state.tasks?.[id]?.status));
}
