export type GuidedAuthoringStep = "idea" | "brief" | "review" | "preparing" | "ready";
export type GuidedAuthoringTarget = "idea" | "prd";
export type ProjectToolChoice = "opencode" | "github" | "claude" | "agents";

interface ProgressStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

const STORAGE_PREFIX = "forge-console:guided-authoring:";
const EXTERNAL_SESSION_PREFIX = "forge-console:external-authoring:";
const STEPS = new Set<GuidedAuthoringStep>(["idea", "brief", "review", "preparing", "ready"]);
const PROJECT_TOOLS = new Set<ProjectToolChoice>(["opencode", "github", "claude", "agents"]);

export interface PendingExternalAuthoringSession {
  target: GuidedAuthoringTarget;
  baseline: string | null;
}

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

function externalSessionKey(repoPath: string): string {
  return `${EXTERNAL_SESSION_PREFIX}${repoPath}`;
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

export function setGuidedAuthoringStep(
  repoPath: string,
  step: GuidedAuthoringStep,
  storage = browserStorage(),
): void {
  if (!repoPath || !storage || !STEPS.has(step)) return;
  try {
    storage.setItem(storageKey(repoPath), step);
  } catch {
    // The current phase remains available if browser storage cannot be updated.
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

export function rememberExternalAuthoringSession(
  repoPath: string,
  target: GuidedAuthoringTarget,
  baseline: string | null,
  storage = browserStorage(),
): void {
  if (!repoPath || !storage) return;
  try {
    storage.setItem(externalSessionKey(repoPath), JSON.stringify({ target, baseline }));
  } catch {
    // Keep the guided step unchanged if the session baseline cannot be saved.
  }
}

export function pendingExternalAuthoringSession(
  repoPath: string,
  storage = browserStorage(),
): PendingExternalAuthoringSession | null {
  if (!repoPath || !storage) return null;
  try {
    const raw = storage.getItem(externalSessionKey(repoPath));
    if (!raw) return null;
    const value = JSON.parse(raw) as Record<string, unknown>;
    if ((value.target !== "idea" && value.target !== "prd")
      || (value.baseline !== null && typeof value.baseline !== "string")) return null;
    return { target: value.target, baseline: value.baseline };
  } catch {
    return null;
  }
}

export function reconcileExternalAuthoringSession(
  repoPath: string,
  target: GuidedAuthoringTarget,
  content: string,
  storage = browserStorage(),
): boolean {
  if (!storage) return false;
  const pending = pendingExternalAuthoringSession(repoPath, storage);
  if (!pending || pending.target !== target || pending.baseline === content) return false;
  const current = getGuidedAuthoringStep(repoPath, storage);
  const next = target === "idea" && current === "idea"
    ? "brief"
    : target === "prd" && current === "brief"
      ? "review"
      : null;
  if (!next) return false;
  try {
    storage.setItem(storageKey(repoPath), next);
    storage.removeItem?.(externalSessionKey(repoPath));
    return true;
  } catch {
    return false;
  }
}

export function clearExternalAuthoringSession(
  repoPath: string,
  storage = browserStorage(),
): void {
  if (!repoPath || !storage) return;
  try {
    storage.removeItem?.(externalSessionKey(repoPath));
  } catch {
    // A leftover snapshot is harmless; it cannot advance without a changed artifact.
  }
}
