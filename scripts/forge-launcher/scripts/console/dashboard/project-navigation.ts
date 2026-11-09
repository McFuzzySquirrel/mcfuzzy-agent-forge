import { api } from "./api.js";
import type { ProjectLifecycleState } from "./types.js";

/** Selects a registered Project and opens the destination appropriate to its current state. */
export async function selectProjectDestination(
  path: string,
  lifecycleState?: ProjectLifecycleState,
): Promise<"#/overview" | "#/project-files"> {
  const result = await api.selectRepo(path);
  if (!result.ok) throw new Error(result.message || "The Project could not be opened.");

  const summary = await api.summary().catch(() => null);
  const completed = summary?.run
    ? summary.run.status === "complete" || summary.run.status === "completed"
    : lifecycleState === "completed";
  return completed ? "#/project-files" : "#/overview";
}
