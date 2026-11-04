import type { Summary } from "./types.js";

const STORAGE_PREFIX = "forge-console:feature-task-review:";
const PENDING_PREFIX = "forge-console:feature-task-review-pending:";

export interface FeatureTaskReviewAttempt {
  marker: string;
  previous: string | null;
}

export function featureTaskReviewIds(summary: Summary): string[] {
  const reconciliation = summary.manifest?.reconciliation;
  if (!reconciliation?.previousGeneratedAt) return [];
  const ids = [...new Set([...reconciliation.newTaskIds, ...reconciliation.changedTaskIds])];
  if (ids.length === 0) return [];
  try {
    const raw = window.localStorage.getItem(pendingKey(summary.repoRoot));
    const marker = raw ? JSON.parse(raw) as Record<string, unknown> : null;
    if (marker?.state === "pending") {
      if (summary.job?.type === "feature-increment" && summary.job.status === "failed") {
        restoreMarker(summary.repoRoot, marker);
        return [];
      }
      return ids;
    }
    return marker?.state === "reviewed"
      && marker.generatedAt === summary.manifest?.generatedAt
      && Array.isArray(marker.ids)
      && marker.ids.join(",") === ids.join(",")
      ? ids
      : [];
  } catch {
    return [];
  }
}

export function featureTasksReviewed(summary: Summary): boolean {
  const ids = featureTaskReviewIds(summary);
  if (ids.length === 0) return true;
  try {
    return window.localStorage.getItem(storageKey(summary, ids)) === "reviewed";
  } catch {
    return false;
  }
}

export function markFeatureTaskReviewPending(repoRoot: string): FeatureTaskReviewAttempt | null {
  try {
    const key = pendingKey(repoRoot);
    const previous = window.localStorage.getItem(key);
    const marker = JSON.stringify({ state: "pending", previous });
    window.localStorage.setItem(key, marker);
    return { marker, previous };
  } catch {
    return null;
  }
}

export function clearFeatureTaskReviewPending(repoRoot: string, attempt: FeatureTaskReviewAttempt): void {
  try {
    const key = pendingKey(repoRoot);
    if (window.localStorage.getItem(key) !== attempt.marker) return;
    if (attempt.previous === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, attempt.previous);
  } catch {
    // A later explicit review still remains required if the marker cannot be cleared.
  }
}

export function recordFeatureTaskReview(summary: Summary): void {
  const ids = featureTaskReviewIds(summary);
  if (ids.length === 0) return;
  try {
    window.localStorage.setItem(pendingKey(summary.repoRoot), reviewedMarker(summary, ids));
    window.localStorage.setItem(storageKey(summary, ids), "reviewed");
  } catch {
    // Keep execution gated if the review record cannot be saved.
  }
}

function pendingKey(repoRoot: string): string {
  return `${PENDING_PREFIX}${repoRoot}`;
}

function reviewedMarker(summary: Summary, ids: string[]): string {
  return JSON.stringify({
    state: "reviewed",
    generatedAt: summary.manifest?.generatedAt ?? "",
    ids,
  });
}

function restoreMarker(repoRoot: string, marker: Record<string, unknown>): void {
  const key = pendingKey(repoRoot);
  if (typeof marker.previous === "string") window.localStorage.setItem(key, marker.previous);
  else window.localStorage.removeItem(key);
}

function storageKey(summary: Summary, ids: string[]): string {
  return `${STORAGE_PREFIX}${summary.repoRoot}:${summary.manifest?.generatedAt ?? ""}:${ids.join(",")}`;
}
