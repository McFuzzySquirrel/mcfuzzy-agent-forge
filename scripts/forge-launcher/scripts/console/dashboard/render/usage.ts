// ─── Usage formatting for the Console ────────────────────────────────────────
//
// One place that turns a harness usage report into display strings, so the
// Overview, Tasks, and any future surface agree on "not reported" versus a real
// zero and never present Copilot credits as dollars.

import type { TaskUsage, UsageTotals } from "../types.js";
import { fmtTokens, fmtUsd } from "./dom.js";

/** Human-readable per-task usage, or an explicit "not reported" note. */
export function formatUsage(usage: TaskUsage | null | undefined): string {
  if (!usage || usage.source !== "harness") {
    return usage?.note ?? "Not reported by the harness";
  }
  const parts: string[] = [];
  if (usage.inputTokens !== undefined) parts.push(`in ${fmtTokens(usage.inputTokens)}`);
  if (usage.outputTokens !== undefined) parts.push(`out ${fmtTokens(usage.outputTokens)}`);
  if (usage.cacheReadTokens) parts.push(`cache read ${fmtTokens(usage.cacheReadTokens)}`);
  if (usage.cacheWriteTokens) parts.push(`cache write ${fmtTokens(usage.cacheWriteTokens)}`);
  if (usage.reasoningTokens) parts.push(`reasoning ${fmtTokens(usage.reasoningTokens)}`);
  if (usage.costUsd) parts.push(fmtUsd(usage.costUsd));
  if (usage.credits) parts.push(`${usage.credits.toFixed(2)} credits`);
  return parts.length > 0 ? parts.join(" · ") : "Not reported by the harness";
}

/** Compact cell value: total tokens (input + output), or "—" when unreported. */
export function usageCell(usage: TaskUsage | null | undefined): string {
  if (!usage || usage.source !== "harness") return "—";
  const total = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  return total > 0 ? fmtTokens(total) : "—";
}

/** Run-level usage line, or null when no task reported usage. */
export function formatUsageTotals(totals: UsageTotals | null | undefined): string | null {
  if (!totals || totals.tasksWithUsage === 0) return null;
  const parts = [`in ${fmtTokens(totals.inputTokens)}`, `out ${fmtTokens(totals.outputTokens)}`];
  if (totals.cacheReadTokens) parts.push(`cache ${fmtTokens(totals.cacheReadTokens)}`);
  if (totals.costUsd) parts.push(fmtUsd(totals.costUsd));
  if (totals.credits) parts.push(`${totals.credits.toFixed(2)} credits`);
  return parts.join(" · ");
}
