// ─── Harness mapping rules (one source for server and client) ────────────────
//
// This module is deliberately import-free so it compiles unchanged in both the
// DOM client bundle (tsconfig.client.json, rootDir scripts/console/dashboard)
// and the Node server build (tsconfig.json, rootDir scripts).

export type HarnessKey = "github" | "claude" | "opencode" | "agents" | "";
export type AuthoringRunnerName = "copilot" | "opencode" | "claude";
export type EngineHarnessName = "copilot" | "opencode" | "claude";

const HARNESS_KEYS: readonly HarnessKey[] = ["github", "claude", "opencode", "agents"];

/**
 * Normalises a harness name (`github`) or harness root (`.github`) to a key.
 * One leading dot is stripped before comparing; anything unrecognised, empty,
 * null or undefined becomes `""`, which both rules below treat as the default.
 */
export function harnessKey(nameOrRoot: string | null | undefined): HarnessKey {
  if (!nameOrRoot) return "";
  const name = nameOrRoot.startsWith(".") ? nameOrRoot.slice(1) : nameOrRoot;
  return HARNESS_KEYS.includes(name as HarnessKey) ? (name as HarnessKey) : "";
}

/** Authoring runner for a harness: github gives copilot, claude gives claude, else opencode. */
export function authoringRunnerForHarness(nameOrRoot: string | null | undefined): AuthoringRunnerName {
  const key = harnessKey(nameOrRoot);
  if (key === "github") return "copilot";
  if (key === "claude") return "claude";
  return "opencode";
}

/**
 * Engine harness for a harness. Coincides with the runner rule today; kept
 * separate because the engine axis also admits openai and stub, which are never
 * runners, so the two maps are free to diverge without one silently dragging
 * the other along.
 */
export function engineHarnessForHarness(nameOrRoot: string | null | undefined): EngineHarnessName {
  const key = harnessKey(nameOrRoot);
  if (key === "github") return "copilot";
  if (key === "claude") return "claude";
  return "opencode";
}
