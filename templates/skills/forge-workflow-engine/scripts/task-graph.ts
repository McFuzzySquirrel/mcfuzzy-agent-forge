// ─── Task graph: the one definition of "is this task ready yet" ─────────────
//
// This module deliberately has no runtime imports beyond Node built-ins. The
// Forge Console serves an arbitrary project directory and dynamically imports
// engine code from the installed templates, where the engine's own
// `node_modules` may not be present - importing `engine.ts` there would drag in
// the harness and fail at runtime. Anything the Console and the engine must
// agree on therefore lives here, with `types.ts` for its shapes.

import type { ExecutionManifest, TaskStatus, WorkflowState } from "./types.ts";

/** A task counts as done once it is complete or deliberately skipped. */
export function isTaskDone(status: TaskStatus | undefined): boolean {
  return status === "complete" || status === "skipped";
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
  const entry = manifest.phases
    .flatMap((phase, phaseIndex) => phase.tasks.map((task) => ({ phase, phaseIndex, task })))
    .find((candidate) => candidate.task.id === taskId);
  if (!entry) return [];

  // A phase dependency brings in every task of that phase, not just its last.
  const phaseDependencies = (entry.phase.dependencies ?? []).flatMap((id) =>
    (manifest.phases.find((candidate) => candidate.id === id)?.tasks ?? []).map((task) => task.id));
  const prerequisites = [...new Set([...(entry.task.dependencies ?? []), ...phaseDependencies])];
  return prerequisites.filter((id) => !isTaskDone(state.tasks?.[id]?.status));
}
