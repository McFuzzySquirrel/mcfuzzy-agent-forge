// ─── Harness to authoring runner rule (shared by every view) ─────────────────

import { authoringRunnerForHarness } from "./harness-rules.js";

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
