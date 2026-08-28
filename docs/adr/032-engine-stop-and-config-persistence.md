# ADR-032: Engine Pause/Stop Control Channel + Launcher Config Persistence

**Date:** 2026-08-28
**Status:** Accepted
**Relates to:** ADR-027 (keep-alive attach), ADR-014 (workflow engine), ADR-023 (forge-launcher npm package), ADR-031 (adaptive keep-alive)

---

## Context

The workflow engine runs **detached** (the launcher spawns it with
`detached: true` + `unref()`, discarding the PID), so once started there was no
supported way to stop it:

- `workflow-engine pause` only flipped `status: "paused"` in
  `WORKFLOW-STATE.json`. The running loop checks `opts.pauseRequested`, which the
  CLI hardcodes to `false` and never re-reads the state file, so **pause did
  nothing to a live run**. The docs' "graceful pause after the current task" was
  effectively broken.
- No `SIGINT`/`SIGTERM` handler existed in the engine's run path, and no PID was
  recorded anywhere, so the only way to stop a run was `pkill`-ing the process
  tree.

A second, related gap: the launcher's `resume`/monitor commands rebuilt the
engine invocation from a **minimal** `--harness`-only command, dropping the
menu-chosen concurrency, keep-alive, retries, and viz settings (which lived only
in per-process memory seeded from env).

## Decision

### 1. Control-file stop channel (engine)

- Add `docs/engine-control.json` (`{ request: "pause" | "stop" }`) plus a
  `docs/engine.pid` file holding the engine's own PID, written at run start and
  removed on exit.
- The engine polls the control file at the top of each task wave (alongside an
  in-process `stopRequested` flag wired to `SIGINT`/`SIGTERM` handlers). When a
  request is present, the run breaks **after the current task wave**, saves
  state as `paused`, clears the control file, and exits. `run` resumes from the
  last completed task — identical semantics to the pre-existing
  `opts.pauseRequested` exit path.
- `pause` writes the control file (in addition to flipping the state status, so
  it is honored even when no engine is running). `stop` writes the control file
  **and** `SIGTERM`s the PID recorded in `docs/engine.pid`, so a live detached
  run stops even mid-wave (still gracefully after the current task).
- Pure helpers (`readControl`/`writeControl`/`clearControl`/`pid` read/write)
  live in `scripts/control.ts`, and `runEngine` accepts a `stopRequested()`
  callback for signal wiring and tests.

### 2. Launcher config persistence

- The launcher persists the engine menu's options to `docs/engine-config.json`
  after `configureEngineOptions` and seeds `resume` from it (explicit env vars
  still take precedence).
- `resume`, monitor, and "where to pick up" commands now print
  `npx forge-launcher engine-run …` built from `engineRunArgs()` — carrying
  concurrency / keep-alive / retries / viz — instead of the minimal
  `--harness`-only command.
- `resume` offers **"Stop the engine after the current task"** when it detects a
  live (`running`) run, invoking the engine's `stop` command in the repo.

## Consequences

Positive:

- A detached engine can be stopped safely without hunting PIDs, and the run is
  resume-able (`paused` state, in-flight task not lost).
- `pause` finally does what the docs always claimed.
- Resume reuses the configured build parameters, so concurrency set in the menu
  survives a stop→resume cycle.
- Testable: the stop path is exercised via control file and signal-flag tests
  with a gated harness.

Negative:

- The control file is a polling channel; a stop lands at the next wave boundary
  (≤ one task late). For true pre-emption the engine would need to abort the
  in-flight harness call, which is intentionally out of scope (a half-written
  task is worse than finishing it).
- `docs/engine.pid` can go stale if the engine is SIGKILLed; `stop` treats a
  missing/ESRCH PID as "the control file will be honored on the next run".
- Persisted config can drift from the live engine's actual flags if the user
  edits the engine command by hand; env vars remain the override mechanism.

Trade-offs considered:

- **pidfile-free control file only** — works for the next `run`, but cannot stop
  a live detached process; the PID + SIGTERM nudge closes that gap.
- **Immediate SIGKILL of in-flight tasks** — rejected: risks a half-written task
  and orphaned subprocesses; graceful-after-current-task matches the documented
  pause semantics.

## References

- ADR-027: keep-alive attach mode (the other "engine lifecycle" concern);
  ADR-014: workflow engine; ADR-023: forge-launcher npm package.
- Implementation: `templates/skills/forge-workflow-engine/scripts/control.ts`,
  `cli.ts` (`stop` command, PID lifecycle, signal handlers), `engine.ts`
  (control poll + `stopRequested`), `types.ts` (`controlPath`/`pidPath`/
  `stopRequested`); launcher `scripts/engine-config.ts`, `launcher.ts`
  (`setupStateForRepo` seeding, `configureEngineOptions` save, `stopEngine`,
  `engineRunArgs()`-based commands).
