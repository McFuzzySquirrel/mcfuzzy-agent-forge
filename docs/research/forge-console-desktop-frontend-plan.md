# Feature Plan: Forge Console (Desktop/Web Front End for Launcher + Workflow Engine)

**Date:** 2026-08-29  
**Status:** Approved - Phases 1–3 shipped (`forge-launcher console` web UI); Phase 4 (desktop packaging) deferred (see [forge-console-implementation-plan.md](../forge-console-implementation-plan.md))

---

## Problem

`forge-launcher` and `forge-workflow-engine` are effective in terminal-first flows, but users still have to jump between files and commands to monitor execution:

- `docs/WORKFLOW-STATE.json` for machine state
- `docs/PROGRESS.md` for human-readable progress
- `docs/EXECUTION-AUDIT.jsonl` for event history
- `docs/engine-run.log` for streaming output
- `workflow-engine status` / `replay` / `pause` / `stop` for control actions

The goal is a simpler operator experience for run visibility, logs, outputs, and control.

---

## Current Baseline (Already in Repo)

The project already includes key building blocks for a front end:

- **Live Forge Board dashboard** (`workflow-engine --viz`) with SSE event streaming
- **Attach mode** (`workflow-engine viz --repo <path>`) for detached/background runs
- **Persisted state + audit artifacts** in `docs/`
- **Launcher resume intelligence** (`forge-launcher resume`) with run-state awareness and monitor actions
- **Graceful run control** (`pause`/`stop`) and replay support

This means the hardest foundation work is already done.

---

## Options Considered

### Option A - Desktop app first (Electron/Tauri)

Pros:
- Native app UX and packaging
- Potential richer local integrations

Cons:
- Higher build/distribution complexity
- Adds release and runtime surface area before feature fit is proven
- Duplicates UI/backend concerns already partially solved by current viz stack

### Option B - Expand existing web dashboard into a full local console (**Recommended**)

Pros:
- Reuses existing viz server, SSE model, state files, and launcher workflows
- Fastest time-to-value with lowest implementation risk
- Keeps local/loopback security posture and dependency footprint aligned with current approach
- Naturally supports both live and detached run monitoring

Cons:
- Still browser-based (not a packaged desktop app at first)

### Option C - IDE extension first

Pros:
- Good for developers already in an IDE

Cons:
- Host/editor-specific
- Harder to make universal across terminal + CI + detached workflows

---

## Recommended Direction

Adopt **Option B** first: evolve the existing workflow-engine dashboard into a broader **Forge Console** web UI. **This shipped** as the self-contained `forge-launcher console` subcommand - a tsc-compiled TypeScript client (not a React app) served on loopback - and a desktop wrapper remains an open follow-up only after usage validates demand.

---

## Viable Phased Plan

### Phase 1 - Forge Console MVP (Web, local-first) - **implemented**

- Keep current board view as the primary visual layer
- Add task table/filtering (status, phase, owner, retries, failures)
- Add log panels (engine log tail + audit stream)
- Add task detail drilldown (outputs, errors, artifact metadata, validation outcomes)
- Add run summary header (run id, status, elapsed, counts, blockers)

### Phase 2 - Operator controls in the console - **implemented**

- Expose pause/stop/replay actions through safe local endpoints or command bridging
- Surface resume/run guidance from launcher and current engine config
- Improve detached-run attach UX from `forge-launcher resume`/`engine-run`

### Phase 3 - Artifact and history views - **implemented**

- Add artifact browser (by type/task/producer)
- Add event timeline and failure-focused diagnostics
- Add quick navigation between task, artifact, and log context

### Phase 4 - Optional desktop packaging (still open / deferred)

- Wrap the local console in Electron or Tauri
- Keep the web console as canonical UI/backend contract
- Ensure packaging does not couple into engine execution semantics

> Phase 4 remains **open/deferred**: the web console shipped first (Phases 1–3)
> as `forge-launcher console`; desktop packaging waits on proven adoption and
> requirements. Note the Forge Board was **not** converted to TypeScript yet - it
> is still embedded as the vendored PixiJS artifact via iframe.

---

## Architecture Notes

- Continue using **loopback-only local serving** as default (`127.0.0.1`)
- Preserve `docs/*` files as source-of-truth execution artifacts
- Treat dashboard/console as a projection layer over existing engine data and controls
- Maintain terminal commands as first-class fallback paths

---

## Success Criteria

- Users can monitor progress, failures, logs, and outputs in one place
- Users can control long-running builds (pause/stop/replay) without deep terminal spelunking
- Detached and resumed runs remain easy to attach and inspect
- Existing CLI workflows continue to work unchanged

---

## Decision Summary

Build a **Forge Console web front end first** by extending the current viz infrastructure. **Shipped** as a self-contained `forge-launcher console` subcommand with a tsc-compiled TypeScript client (not a React app) served on loopback. Desktop packaging (Phase 4) is deferred until the web console proves adoption and requirements.
