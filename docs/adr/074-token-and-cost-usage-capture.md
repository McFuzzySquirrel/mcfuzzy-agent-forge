# ADR-074: Token and cost usage capture

**Date:** 2026-10-26
**Status:** Accepted
**Relates to:** ADR-056 (parallel execution task sandboxes), ADR-067 (phase-scoped session reuse), ADR-073 (background-job notifications)

## Context

The Console showed task status, duration, and outputs but no token or cost usage.
The harnesses expose usage in incompatible ways:

- **OpenCode** does not print usage on `run --format default`, but
  `opencode session export <id>` returns `info.tokens`
  (`{ input, output, reasoning, cache: { read, write } }`) and `info.cost`.
  `run --format json` emits the `sessionID` but not the usage itself.
- **Claude Code** `-p --output-format json` returns a result envelope that may
  carry `usage` (`input_tokens`, `output_tokens`,
  `cache_read_input_tokens`, `cache_creation_input_tokens`) and
  `total_cost_usd`. Older versions omit them.
- **Copilot** prints a stats block to stderr:
  `AI Credits 0.46` and `Tokens ↑ 18.6k (18.6k written) • ↓ 5`.

A single "tokens" number cannot honestly represent all three, and reporting a
missing value as zero would misrepresent usage as free.

## Decision

1. **One usage model, explicit absence.** `TaskUsage` carries optional
   `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`,
   `reasoningTokens`, `costUsd`, and `credits`, plus
   `source: "harness" | "unavailable"`. A harness that reports nothing yields
   `{ source: "unavailable", note }`, never zeros.
2. **Per-harness capture.**
   - **OpenCode:** the adapter always addresses the session. Under task scope it
     generates a fresh UUID and passes `--session <id>`; after the run it calls
     `opencode session export <id>` and reads `info.tokens` / `info.cost`. Under
     phase scope it reuses the phase session and reports `unavailable` (the
     export is cumulative across the phase, so attributing it to one task would
     over-count).
   - **Claude:** the adapter reads `usage` / `total_cost_usd` from the existing
     JSON envelope when present.
   - **Copilot:** the adapter parses the stderr stats block. Credits are stored
     as `credits` and never presented as USD.
   - **Stub:** `STUB_USAGE` (JSON) supplies synthetic usage for tests.
3. **Accumulate and persist.** The engine merges each attempt's usage onto the
   task record (`mergeUsage`), so a retried task reports its total. Usage is
   written to `WORKFLOW-STATE.json`'s task records and to the
   `task.attempt.finished`, `task.complete`, and `task.failed` audit events.
4. **Aggregate and display.** The Console sums reported usage into
   `RunSummary.usage` (with `tasksWithUsage` / `tasksTotal` coverage) and exposes
   per-task `TaskRow.usage`. The Overview run stats show tokens in/out, cost, and
   credits; the Tasks table adds a Tokens column and the detail drawer shows the
   full breakdown, or an explicit "not reported" note.

## Consequences

- Build tasks get authoritative per-task usage on OpenCode, the dominant harness
  in this repository, at the cost of one extra `opencode session export` process
  per task (bounded at 15s and 32 MiB; a failure degrades to "unavailable").
- Claude and Copilot usage is best-effort and version-dependent; an older CLI
  that omits the fields reports "unavailable" rather than a wrong number.
- Phase-scoped sessions deliberately report `unavailable` for per-task usage.
- Interactive authoring sessions (PRD/idea/feature) do not expose usage, so
  authoring-stage usage remains a follow-up; headless authoring could adopt the
  same session-export plumbing later.
- Any harness that adds a usage surface only needs its adapter to return a
  `TaskUsage`; the engine, state, audit, and Console aggregation already carry it.

## References

- Types: `templates/skills/forge-workflow-engine/scripts/types.ts`.
- Accumulation: `templates/skills/forge-workflow-engine/scripts/state.ts`
  (`mergeUsage`), `engine.ts` (`recordAttempt`).
- Adapters: `scripts/harness/{opencode,claude,copilot,stub}-adapter.ts`.
- Console aggregation: `scripts/forge-launcher/scripts/console/repo.ts`.
- Display: `scripts/forge-launcher/scripts/console/dashboard/render/usage.ts`,
  `views/overview.ts`, `views/tasks.ts`.
- Changelog: [updates.md](../updates.md), v3.110.
