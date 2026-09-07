// ─── Harness to authoring runner rule (shared by every view) ─────────────────

export type AuthoringRunnerName = "copilot" | "opencode" | "claude";

/**
 * Maps a repository harness to the authoring runner the console drives it with.
 * Accepts either a harness name (the wizard's harness select: `github`,
 * `claude`) or a harness root (`summary.harness`, which holds `detectHarnessRoot`
 * output: `.github`, `.claude`, `.opencode`, `.agents`); one leading dot is
 * stripped before comparing. Mirrors `selectedAuthoringRunner` in
 * `console/authoring.ts`, which keys the same rule on the harness root directory.
 */
export function runnerForHarness(harness: string): AuthoringRunnerName {
  const name = harness.startsWith(".") ? harness.slice(1) : harness;
  if (name === "github") return "copilot";
  if (name === "claude") return "claude";
  return "opencode";
}
