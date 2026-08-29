# ADR-025: The Squirrel Forge - a Live Workflow-Engine Visualization

**Date:** 2026-08-27
**Status:** Accepted
**Relates to:** ADR-014 (workflow engine), ADR-017 (artifact store), ADR-021 (parallel dispatch), ADR-023 (forge launcher)

---

## Context

The workflow engine (`forge-workflow-engine`) is "dark orchestration": it runs
as a headless Node process, reading `docs/EXECUTION-MANIFEST.json` and driving
every task to completion through a pluggable harness, persisting state after
every transition. Observing it today means reading `docs/WORKFLOW-STATE.json`,
tailing `docs/EXECUTION-AUDIT.jsonl`, or watching heartbeat lines on the
terminal. There is no live, at-a-glance view of the build.

The engine already produces everything a live view needs:

- `docs/EXECUTION-MANIFEST.json` - the task DAG (phases → tasks, dependency
  edges, owner agents, `produces`/`inputs` artifact contracts, feature tags).
- `docs/WORKFLOW-STATE.json` - current per-task status
  (`pending`/`running`/`complete`/`failed`/`skipped`), attempts, timestamps,
  artifact IDs, output files.
- `docs/EXECUTION-AUDIT.jsonl` - an append-only event stream
  (`run.started`, `phase.started`, `task.started`, `context.projected`,
  `artifact.created`, `task.complete`, `run.complete`, …).
- `docs/artifacts/<type>/<id>.json` - typed artifacts with category
  (decision/work/evidence), confidence, producer, and consumed inputs.

The engine package is deliberately dependency-free (`node:http`, `tsx`). Any
visualization should preserve that.

## Decision

Add a **live, localhost visualization** to the workflow engine - *The Squirrel
Forge* - that renders the build DAG as a single oak tree that grows over the
course of the run, where each agent is a named squirrel performing its tasks.
Implement it with **PixiJS (v8) vendored into the dashboard** so the engine
keeps a zero-runtime-dependency footprint, stream events over **Server-Sent
Events (SSE) over `node:http`** (no WebSocket dependency), and offer it through
**two launch modes**:

1. **Embedded (`run --viz [port]`)** - the engine starts a localhost server
   before the main loop, broadcasts every audit event in-process, auto-opens
   the dashboard in the default browser, and shuts the server down shortly
   after the run ends so the finale can render.
2. **Attach (`viz` subcommand / `forge-launcher engine-run --viz`)** - a
   standalone mode that tails `docs/EXECUTION-AUDIT.jsonl` and serves the same
   dashboard, letting a user attach to an already-running or detached engine
   run (e.g. the `forge-auto-build` detached path).

### Design details

- **Data flow.** The engine keeps writing audit events to
  `docs/EXECUTION-AUDIT.jsonl` exactly as before. A single line added to
  `writeAuditEvent` in `state.ts` additionally broadcasts the event through a
  tiny module-level bus (`viz/bus.ts`). The viz server registers itself as the
  listener; when no dashboard is running the broadcast is a no-op. This
  centralizes the integration at one point instead of touching ~14 call sites.
- **Layout.** `viz/layout.ts` is a pure function that maps the manifest onto a
  whorled oak: phases become whorls/levels up the trunk (time grows upward,
  matching the engine's near-sequential phase model), each phase's tasks hang
  from a horizontal branch line, and dependency/artifact edges become acorn
  trails. Keeping it pure makes it unit-testable and keeps rendering out of the
  engine.
- **Theme.** Tasks are performed by **named squirrels** - one per agent, name
  derived deterministically from the agent name (`api-engineer` → "Tailor",
  `qa-engineer` → "Nutsy", seeded hash fallback for arbitrary agents).
  Statuses are poses: pending = dozing; running = frantic scurry with a
  knapsack arc showing `context.projected` token-reduction; complete =
  celebration bounce + leaf bloom; failed = tumble; skipped = faded. Artifacts
  are acorns that roll up the trunk to the consuming squirrel when
  `artifact.created` fires. The tree grows live (sapling → oak), canopy
  filling with leaves as tasks complete, browning on failure, blooming on
  completion, when all squirrels gather and hoist a golden acorn.
- **Frontend.** A single-page dashboard (`viz/dashboard/`) with a procedurally
  drawn PixiJS scene - firefly `ParticleContainer`, falling leaves, parallax
  moon, procedural squirrels/acorns (no image assets), DOM HUD (acorn counter,
  run ID, harness, elapsed clock, agent legend), hover tooltips, click detail
  panel, pan/zoom. Connects via `EventSource("/api/events")` with a snapshot
  replayed on every (re)connect, plus `/api/manifest`, `/api/state`, and
  `/api/layout` JSON endpoints.
- **Vendoring.** `pixi.min.js` (v8.20.1) is committed under
  `viz/dashboard/vendor/` so the dashboard works offline and the engine package
  gains no runtime dependencies.
- **No sound.** Visuals only (explicitly out of scope for v1).
- **Browser auto-open** is best-effort (`xdg-open`/`open`/`start`), skipped
  when `--no-open` is passed or a browser cannot be launched; the printed URL
  always remains the fallback. Port defaults to 4299 and walks to the next
  free port if busy.

### Client commands

```
npm run workflow-engine -- run --viz [port] [--no-open]   # run + embedded dashboard
npm run workflow-engine -- viz [--repo <path>] [--port <n>] [--no-open]  # attach to a run
forge-launcher engine-run --repo <dir> --viz [--no-open]  # launcher pass-through
```

Environment variables: `FORGE_ENGINE_VIZ=1`, `FORGE_ENGINE_VIZ_PORT`.

---

## Consequences

### Positive

- **Observability.** The whole build is legible at a glance: which phase is
  active, which squirrels are busy, what artifacts are flowing, where it
  failed. The artifact token-handoff (ADR-017) and parallel dispatch
  (ADR-021) become visible rather than inferred from files.
- **Zero-dependency engine preserved.** `node:http` + SSE + a vendored client
  bundle keeps `forge-workflow-engine`'s `dependencies: {}` intact.
- **Both live and detached runs are covered.** `--viz` covers foreground
  runs; the `viz` attach mode covers the detached/`forge-auto-build` path and
  can monitor a run started earlier.
- **A single integration point.** Broadcasting inside `writeAuditEvent` means
  every event already written to the audit file is automatically live - no
  engine rework per event type, and replay/pause flows are covered for free.
- **Fun > utilitarian.** The squirrel theme makes long engine runs enjoyable
  to watch, which increases the chance people actually use the dashboard.

### Negative

- **Vendored bundle size.** `pixi.min.js` adds ~0.8 MB to the skill template
  and every bootstrapped repo (the sourcemap is intentionally not vendored).
  Mitigation: it is a one-time committed file, comparable to the existing
  committed research assets.
- **Loopback-only.** The dashboard is bound to `127.0.0.1`, so it is not
  accessible from other machines. Intended for local observation only.
- **Browser dependency.** The dashboard requires a modern browser with WebGL.
  Terminal output, state files, and PROGRESS.md remain the universal
  interfaces; the viz is an enhancement.
- **Attach-mode latency.** Tailing is a 500ms poll, so attach mode lags the
  in-process broadcast slightly (which is instantaneous). Acceptable for a
  monitoring view; the embedded mode is the real-time path.

### Neutral

- The audit log remains the source of truth; the broadcast is a mirror.
- Naming is deterministic: the same repo/agents always produce the same
  squirrels, so screenshots and discussions are reproducible.

---

## References

- Engine package: `templates/skills/forge-workflow-engine/`
- Visualization code: `templates/skills/forge-workflow-engine/scripts/viz/`
- Docs: [docs/workflow-engine.md](../workflow-engine.md),
  [docs/forge-launcher.md](../forge-launcher.md)
- Related: [ADR-014 dynamic workflow orchestration](014-dynamic-workflow-orchestration.md),
  [ADR-017 artifact store and context projection](017-artifact-store-and-context-projection.md),
  [ADR-021 parallel task dispatch](021-parallel-task-dispatch.md),
  [ADR-023 forge launcher npm package](023-forge-launcher-npm-package.md)
