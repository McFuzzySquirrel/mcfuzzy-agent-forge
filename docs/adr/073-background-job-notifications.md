# ADR-073: Background-job notifications in the Console

**Date:** 2026-10-26
**Status:** Accepted
**Relates to:** ADR-034 (Forge Console web UI), ADR-071 (system-level console defaults)

## Context

Several Console actions run as detached background jobs — project creation,
interactive-authoring handoffs, re-derivation, feature increments — and their
state lives in `jobs.json` in the Forge registry directory, independent of the
currently selected repository. Before this change, the only way to see that a
background job was running (or had failed) was to open the Projects view or the
Overview of the owning repository. A `create-project` job, in particular, runs
for a repository that is not yet selected, so there was no in-view signal it was
still in flight after the wizard's status card was dismissed.

## Decision

1. **Expose a `GET /api/jobs` summary.** The endpoint reaps dead running jobs via
   `refreshJobs()`, then returns `{ jobs, active, failed }` where `active`
   counts `running`/`paused` and `failed` counts `failed` jobs across all
   registered projects. It is read-only and, like the other GET endpoints, is not
   token-gated.
2. **Broadcast a `jobs` SSE event.** When the poller detects a job-state change
   it emits `jobs` (in addition to the existing repo-scoped `snapshot`), reusing
   the same `jobsSummary()` helper as the endpoint so the two cannot drift.
3. **Render a persistent badge.** The context bar shows "N running" / "N failed"
   (failed takes precedence and is styled as an error), seeded from `/api/jobs`
   and updated by the `jobs` SSE event. It links to the Projects view, which is
   the one surface that lists every project's job state.

## Consequences

- Background work is visible from any view without polling; the badge updates
  when the server reaps or records a job transition.
- The badge points at the Projects view rather than a specific log, because a
  job may belong to a repository that is not (and cannot yet be) selected.
- The client mirrors the job shape it already had; no new client-side job model
  was introduced beyond the `JobsSummary` wrapper.

## References

- Endpoint + SSE broadcast: `scripts/forge-launcher/scripts/console/server.ts`.
- Job persistence: `scripts/forge-launcher/scripts/console/jobs.ts`.
- Badge: `scripts/forge-launcher/scripts/console/dashboard/main.ts`.
- Changelog: [updates.md](../updates.md), v3.109.
- Plan: [forge-console-ui-overhaul-plan.md](../forge-console-ui-overhaul-plan.md).
