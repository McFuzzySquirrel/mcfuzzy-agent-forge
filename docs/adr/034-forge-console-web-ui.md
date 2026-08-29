# ADR-034: Forge Console - a Local Web UI over the Launcher and Workflow Engine

**Date:** 2026-08-29
**Status:** Accepted
**Relates to:** ADR-026 (Forge Board), ADR-032 (engine stop / config persistence), ADR-023 (forge-launcher npm package)

---

## Context

Authoring and build live in the terminal: `forge-launcher` for onboarding, and
`forge-launcher engine-run` → `workflow-engine` for the autonomous build. Once a
run is in flight, monitoring means jumping between files (`docs/WORKFLOW-STATE.json`,
`docs/PROGRESS.md`, `docs/EXECUTION-AUDIT.jsonl`, `docs/engine-run.log`) and
commands (`workflow-engine status` / `replay` / `pause` / `stop`), with the Forge
Board (ADR-026) as the one visual layer. The pieces all exist, but there is no
single place to pick a project, resume a setup, start a build, and watch/control
it.

The research plan
([`docs/research/forge-console-desktop-frontend-plan.md`](../research/forge-console-desktop-frontend-plan.md))
evaluated three options - desktop-first, web-first, IDE-extension - and
recommended the web-first path: evolve the existing local viz into a broader
console, then consider desktop packaging only if adoption justifies it.

## Decision

Ship a **Forge Console** as a new `forge-launcher console` subcommand, in the
existing launcher npm package (ADR-023) rather than a separate project:

- **Web-first, self-contained.** A local web server that fronts both
  `forge-launcher` (authoring) and `forge-launcher engine-run` → `workflow-engine`
  (build), served on `127.0.0.1` (default port `4300`, next free port if busy).
  One browser app covers the whole flow: pick/add a project, create a project
  (New Project wizard), resume a setup (draft PRD, generate team, start build),
  start/resume a build, and monitor/control a run.
- **tsc-only TypeScript client.** The client is plain TypeScript compiled with
  `tsc` - no React, no bundler - served as static assets from the same Node
  server. Deliberately boring to keep the dependency footprint and build story
  minimal.
- **The Forge Board is embedded, not reimplemented.** The existing PixiJS
  Forge Board (ADR-026) is embedded full-screen via an iframe at `/board`; the
  board itself was **not** converted to TypeScript yet - it remains vendored
  PixiJS.
- **Project registry.** A `~/.myforge/projects.json` registry (honoring
  `FORGE_HOME` / `XDG_CONFIG_HOME`) remembers the projects the user has opened,
  so the landing page can offer a picker.
- **Control reuses the existing channels.** Pause/Stop write
  `docs/engine-control.json` and SIGTERM `docs/engine.pid` (ADR-032); Replay
  shells out to `workflow-engine replay <task>`; Run/Resume shells out to
  `forge-launcher engine-run`.
- **Loopback + CSRF token.** The server binds to loopback only, and
  state-changing POST endpoints require an `X-Forge-Token` header - a per-server
  random token embedded in the served HTML - to block cross-origin drive-by
  requests. File reads are guarded against path traversal.
- **CLI paths unchanged.** `forge-launcher`, `forge-launcher engine-run`, and
  `workflow-engine --viz` remain first-class and unchanged; the console is an
  additional front door, not a replacement.

## Consequences

Positive:

- One browser app replaces terminal spelunking across state/progress/audit/log
  files, with the Forge Board, task table, logs, documents, artifacts, and
  timeline in a single place.
- The authoring surface (new project, resume setup) is now reachable without
  the terminal, lowering the barrier for first-time users.
- Reuses the launcher package and existing control/state artifacts, so no new
  runtime or engine dependencies were introduced and the CLI contract is
  untouched.
- The tsc-only client keeps build and review cost low; no bundler or framework
  to maintain.

Negative:

- Another surface to keep consistent with the CLI; the console and the terminal
  now both drive the same flows and must stay in sync.
- The Board is embedded via iframe rather than a native TypeScript component, so
  it is still a separate vendored PixiJS artifact until it is converted.
- Loopback + token is sufficient for a local tool but is not auth; if the
  console ever leaves loopback it needs real authentication.

Trade-offs considered:

- **Desktop app first (Electron/Tauri)** - deferred (Phase 4 of the research
  plan) until the web console proves adoption and requirements; packaging adds
  release/runtime surface before fit is proven.
- **React front end** - rejected for now: the console is a thin projection over
  existing files/commands, and tsc-only TypeScript keeps the toolchain aligned
  with the rest of the repo.
- **Convert the Board to TypeScript in the same change** - rejected: embedding
  the existing board via iframe delivers the console now, deferring the
  TypeScript conversion to a follow-up.

## References

- ADR-026: The Forge Board (the embedded kanban dashboard).
- ADR-032: engine pause/stop control channel (`docs/engine-control.json`,
  `docs/engine.pid`) and launcher config persistence.
- ADR-023: forge-launcher as a Node npm package (the console's host package).
- Research plan: `docs/research/forge-console-desktop-frontend-plan.md`.
- Changelog: `docs/updates.md` v3.31.
