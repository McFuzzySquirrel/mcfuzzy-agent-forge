// ─── Harness mapping rules (one source for server and client) ────────────────
//
// This module is deliberately import-free so it compiles unchanged in both the
// DOM client bundle (tsconfig.client.json, rootDir scripts/console/dashboard)
// and the Node server build (tsconfig.json, rootDir scripts).

export type HarnessKey = "github" | "claude" | "opencode" | "agents" | "";
export type AuthoringRunnerName = "copilot" | "opencode" | "claude";
export type EngineHarnessName = "copilot" | "opencode" | "claude";
export type HarnessCliName = "copilot" | "claude" | "opencode";

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

/**
 * Authoring runner for a harness: github gives copilot, everything else gives
 * opencode. Claude repos author through OpenCode by default because the
 * Console's inventory is per runner and OpenCode's covers every provider;
 * `claude` is selected explicitly with `FORGE_RUN_WITH=claude`.
 */
export function authoringRunnerForHarness(nameOrRoot: string | null | undefined): AuthoringRunnerName {
  const key = harnessKey(nameOrRoot);
  if (key === "github") return "copilot";
  return "opencode";
}

/**
 * Engine harness for a harness. Diverges from the runner rule at `claude`,
 * which is exactly the divergence the two maps were kept separate for: the
 * engine axis also admits openai and stub, which are never runners, so neither
 * map silently drags the other along.
 */
export function engineHarnessForHarness(nameOrRoot: string | null | undefined): EngineHarnessName {
  const key = harnessKey(nameOrRoot);
  if (key === "github") return "copilot";
  if (key === "claude") return "claude";
  return "opencode";
}

/**
 * Interactive CLI a human drives for a harness, and the args that open the repo
 * in it: github gives copilot with no args; claude and everything else open
 * with ".".
 */
export function harnessCliForHarness(nameOrRoot: string | null | undefined): { cli: HarnessCliName; args: string[] } {
  const key = harnessKey(nameOrRoot);
  if (key === "github") return { cli: "copilot", args: [] };
  if (key === "claude") return { cli: "claude", args: ["."] };
  return { cli: "opencode", args: ["."] };
}
