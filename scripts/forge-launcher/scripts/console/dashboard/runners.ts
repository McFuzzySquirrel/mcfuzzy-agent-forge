// ─── Harness to authoring runner rule (shared by every view) ─────────────────

import { authoringRunnerForHarness } from "./harness-rules.js";
import type { AuthoringRunnerName } from "./harness-rules.js";

export type { AuthoringRunnerName } from "./harness-rules.js";

/**
 * Maps a repository harness to the authoring runner the console drives it with.
 * Accepts either a harness name (the wizard's harness select: `github`,
 * `claude`) or a harness root (`summary.harness`, which holds `detectHarnessRoot`
 * output: `.github`, `.claude`, `.opencode`, `.agents`). The rule itself lives in
 * `harness-rules.ts`, the one source shared with the server side; this stays as
 * the name the views import.
 */
export const runnerForHarness = authoringRunnerForHarness;

/**
 * The authoring runner choices offered by the Console selects, in display
 * order. `inherit` is the default and means "whatever `runnerForHarness` says
 * for this repo", which is exactly the behaviour the Console had before the
 * selector existed.
 */
export const AUTHORING_RUNNER_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ["inherit", "Inherit from harness"],
  ["opencode", "OpenCode"],
  ["copilot", "Copilot"],
  ["claude", "Claude Code"],
] as const;

/**
 * Resolves a select's value to the runner the inventory calls should use:
 * `inherit` falls back to the harness rule, anything else is taken as given.
 */
export function effectiveRunner(choice: string, harness: string): AuthoringRunnerName {
  if (!choice || choice === "inherit") return runnerForHarness(harness);
  return choice as AuthoringRunnerName;
}
