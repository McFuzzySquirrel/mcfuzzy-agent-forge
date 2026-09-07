// ─── Harness to authoring runner rule (shared by every view) ─────────────────

export type AuthoringRunnerName = "copilot" | "opencode" | "claude";

/**
 * Maps a repository harness (`summary.harness`, or the wizard's harness select)
 * to the authoring runner the console drives it with. Mirrors
 * `selectedAuthoringRunner` in `console/authoring.ts`, which keys the same rule
 * on the harness root directory (`.github`, `.claude`, anything else).
 */
export function runnerForHarness(harness: string): AuthoringRunnerName {
  if (harness === "github") return "copilot";
  if (harness === "claude") return "claude";
  return "opencode";
}
