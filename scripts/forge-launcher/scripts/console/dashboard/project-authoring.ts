export type GuidedAuthoringStep = "idea" | "brief" | "review";
export type GuidedAuthoringTarget = "idea" | "prd";
export type ProjectToolChoice = "opencode" | "github" | "claude" | "agents";

interface ProgressStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_PREFIX = "forge-console:guided-authoring:";
const STEPS = new Set<GuidedAuthoringStep>(["idea", "brief", "review"]);
const PROJECT_TOOLS = new Set<ProjectToolChoice>(["opencode", "github", "claude", "agents"]);

export function initialProjectToolChoice(configuredDefault?: string): ProjectToolChoice | "" {
  return PROJECT_TOOLS.has(configuredDefault as ProjectToolChoice) ? configuredDefault as ProjectToolChoice : "";
}

function browserStorage(): ProgressStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function storageKey(repoPath: string): string {
  return `${STORAGE_PREFIX}${repoPath}`;
}

export function suggestProjectName(idea: string): string {
  const slug = idea
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 5)
    .join("-")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "my-project";
}

export function initializeGuidedAuthoring(repoPath: string, storage = browserStorage()): void {
  if (!repoPath || !storage) return;
  try {
    if (storage.getItem(storageKey(repoPath)) === null) storage.setItem(storageKey(repoPath), "idea");
  } catch {
    // The guided flow can still be used when browser storage is unavailable.
  }
}

export function getGuidedAuthoringStep(repoPath: string, storage = browserStorage()): GuidedAuthoringStep | null {
  if (!repoPath || !storage) return null;
  try {
    const value = storage.getItem(storageKey(repoPath));
    return STEPS.has(value as GuidedAuthoringStep) ? value as GuidedAuthoringStep : null;
  } catch {
    return null;
  }
}

export function recordGuidedAuthoringSessionExit(
  repoPath: string,
  target: GuidedAuthoringTarget,
  exitCode: number,
  storage = browserStorage(),
): void {
  if (!storage) return;
  const current = getGuidedAuthoringStep(repoPath, storage);
  if (!current || exitCode !== 0) return;
  try {
    if (target === "idea" && current === "idea") {
      storage.setItem(storageKey(repoPath), "brief");
    } else if (target === "prd" && current === "brief") {
      storage.setItem(storageKey(repoPath), "review");
    }
  } catch {
    // The current phase remains available if browser storage cannot be updated.
  }
}
