# Updates

Detailed release and change notes for McFuzzy Agent Forge.

---

## August 2026 - v3.19

### Headless PRD quality: the gap check now runs automatically

The manual PRD flow runs a dedicated gap check (Step 2b of the prompt playbook):
verify every major component has clear acceptance criteria, a defined tech stack,
non-functional requirements (performance, security, privacy), and implementation
phases - then fill any gaps. Headless/auto-draft PRD runs skipped that pass:

- **Headless PRD gap check.** `forge-auto-build-prd` (headless) now runs the same
  gap check on `docs/PRD.md` after drafting and re-invokes `forge-build-prd` in
  gap-fill mode to fix any gaps, re-verifying before the decomposition check.
  Direct headless `forge-build-prd` invocations do the same before saving. The
  launcher's headless PRD command now spells the check out so the printed
  command documents it.
- **Decomposition and team validation were already covered.** `forge-decompose-prd`
  Step 6 (coverage, valid dependency DAG, no cycles) and `forge-build-agent-team`
  Step 7 (one owner per requirement, no conflicts, naming/frontmatter rules) run
  unconditionally, headless included - no change needed there.
- **Responsibility matrix from the team skill.** `forge-build-agent-team` Step 7
  now writes `docs/agent-responsibility-matrix.md` (ownership by agent, team
  validation summary, phase execution order) matching the execution-adapter's
  deterministic matrix, so headless team generation produces the same durable
  artifact the manual validation prompt and the compile gate do.
- **Tests.** The launcher suite is now **40** `node --test` cases (new: the
  headless PRD message documents the gap check). All packages typecheck clean.

### Forge Board: crisp zoom and in-place expanding cards

- **Crisp text at any zoom.** The dashboard bakes all text at **2× resolution**
  (a shared text-style factory) and bakes the small dot/glow textures at 2×, so
  zooming in no longer upscales soft rasters. Max zoom is clamped to 2× to match
  the bake ceiling.
- **Click a card to expand it in place.** Instead of a side panel, clicking a
  card expands it on the board (floating above its neighbors) with the task's
  detail: description, status, owner, phase, duration, timeout, artifact, error,
  inputs, dependencies, output files, and validation commands. Click the card
  again, the board, or press Escape to collapse it; it animates open/closed and
  stays live as the task's status changes mid-run. The DOM side panel was
  removed.

---

## August 2026 - v3.18

### Workflow-engine keep-alive attach mode

The opencode harness cold-starts a fresh `opencode run` process for **every
task**, and each one re-boots the project instance: config, AGENTS.md, skills,
agent files, and every MCP server. On multi-task runs that per-task overhead can
rival the actual model work. The engine now attaches tasks to a single warm
`opencode serve` instance instead:

- **`--keep-alive`** (`FORGE_ENGINE_ATTACH=1`): the engine boots one headless
  `opencode serve` for the run, waits for `GET /global/health`, attaches every
  task via `opencode run --attach`, and tears the server down when the run
  finishes (even on error). `--keep-alive-port <n>` pins the port; otherwise a
  free port is chosen.
- **`--attach <url>`** (`FORGE_ENGINE_ATTACH_URL`): reuse an already-running
  server (e.g. one started by the TUI or a long-lived `opencode serve`) with no
  lifecycle management. `--keep-alive` is ignored (with a warning) for
  non-opencode harnesses.
- **Tasks stay isolated.** Each `opencode run --attach` invocation creates a
  fresh session (no `--continue`/`--session`/`--fork`), so one task's context
  never leaks into the next — the server only keeps the shared project instance
  warm.
- **Server hygiene.** The engine-spawned server is loopback-only and strips any
  ambient `OPENCODE_SERVER_*` auth so the engine's own health probe and attach
  calls aren't 401'd. Attaching to a user-managed authenticated server still
  works (the client auto-sends credentials from the environment).
- **Robust readiness.** `opencode serve` binds its port before it is fully
  booted, so a health request in that window can connect but hang; each probe
  now aborts itself (`AbortSignal.timeout`, 2s) so the readiness loop always
  advances.
- **Measurable win.** `run.ts` reports `bootMs` (ms to first output) and the
  adapter prints `[opencode] task <id>: boot=… total=…` when attaching, so
  per-task durations in `docs/EXECUTION-AUDIT.jsonl` show the cold-boot cost
  dropping to ~0 on tasks 2..N.
- **Launcher passthrough.** `forge-launcher engine-run` accepts
  `--keep-alive`, `--keep-alive-port <n>`, and `--attach <url>` (with
  `FORGE_ENGINE_ATTACH` / `FORGE_ENGINE_ATTACH_URL` env equivalents), so the
  engine can run warm via the launcher too.
- **Tests.** Engine suite is now **25** `node --test` cases (new: attach-server
  healthy startup + ambient-auth stripping, and the hung-health-attempt abort);
  the launcher suite is now **39** (new: engine-run flag forwarding + env
  defaults, and the auto-draft keep-alive/attach command). All packages
  typecheck clean.

Related architecture decision:

- [ADR-027](adr/027-workflow-engine-keep-alive-attach.md): keep-alive attach
  mode — server lifecycle, session isolation, and auth/health-probe handling.

---

## August 2026 - v3.17

### Cross-platform `forge-launcher` fixes for Windows

The `forge-launcher` npm package (`1.0.0-beta.2`) is now reliable on Windows,
where the interactive TUI and CLI spawning previously misbehaved:

- **Directory picker that works on Windows.** `@clack/prompts`' `path`
  autocomplete hardcodes `/` and does case-sensitive full-path prefix matching,
  so on Windows the "Parent directory" step listed nothing and typing a name to
  search found nothing. The launcher now uses its own cross-platform picker
  (a clack `select` list over a directory listing): subfolders show immediately,
  `..` goes up (disabled at a drive root), and a "Type a path…" entry accepts
  either `\` or `/` case-insensitively. The readline/Tab-completion fallback
  shares the fix.
- **No more `spawn opencode ENOENT`.** CLIs installed via `npm install -g`
  (opencode, copilot, claude) are `.cmd` shims on Windows, which plain
  `child_process.spawn` cannot launch. Spawning now goes through `cross-spawn`,
  which resolves shims with correct argument quoting. A failed spawn reports
  `Failed to run '<cmd>': … — is it installed and on PATH?` instead of a cryptic
  ENOENT. The terminal auto-launch code also gets correct PATH detection
  (`;`-delimited, `.exe`/`.cmd`/`.bat`) and Windows Terminal detection via
  `WT_SESSION`.
- **Friendlier pre-publish install guidance.** The README and
  `docs/forge-launcher.md` document a simple local install
  (`npm install` → `npm pack` → `npm install -g <tarball>`), a dev symlink
  (`npm link`), and the matching uninstall/unlink cleanup — no temp-workspace
  ceremony for day-to-day testing.
- **Update check.** On startup, `forge-launcher` checks the npm registry once a
  day (honoring the configured registry, so a local Verdaccio works) and prints
  a notice when a newer version exists — prereleases check the `beta` tag,
  releases check `latest`. The result is cached in a user-level file, the
  fetch is timeout-bounded and fails silently offline, and it can be disabled
  with `--no-update-check` or `FORGE_SKIP_UPDATE_CHECK=1` (also skipped in CI).

### Cross-platform `forge-workflow-engine` fixes

The workflow engine (the separate package bootstrapped into target repos) had
the same Windows blind spot as the launcher:

- **Engine tasks spawn correctly on Windows.** The engine's per-task harness
  (`opencode`, `copilot`, and flowforge-kernel adapters) now spawns through
  `cross-spawn`, resolving npm-installed `.cmd`/`.bat` shims — so `opencode run`
  tasks no longer fail with `spawn opencode ENOENT` during an engine run.
- **The Forge Board dashboard renders and connects.** The vendored PixiJS v8
  build exposes the `PIXI` global, but `app.js` referenced `Pixi`, so the
  dashboard script aborted with `ReferenceError: Pixi is not defined` before
  opening the SSE connection. `index.html` now normalizes the global
  (`window.Pixi = window.PIXI || window.Pixi`), so the board renders and the
  dashboard connects.
- **Kanban dashboard theme.** The oak-tree-and-squirrel metaphor is gone. The
  build now renders as a **kanban board** — renamed **The Forge Board** — one
  band per phase stacked top-to-bottom (bands **auto-size** so stacked cards
  never overlap the next band), with tasks as cards flowing left-to-right
  through **To Do · In Progress · Done · Failed**. Cards are colored by their
  owning agent (deterministic accent + legend), re-position themselves smoothly
  as their status changes, and dependency/artifact edges connect them
  (brightening on hover) with artifact hand-offs shown as dots. Long titles are
  trimmed to fit the card, context-projection and artifact badges sit on each
  card, and the HUD counts *done / total* tasks. Pan/zoom (from the
  board/background), hover tooltips, and the click detail panel all work as
  before; the fireflies, leaves, and squirrel animations were removed in favor
  of a calm, legible board.
- **Cards are name tags with agent faces.** Each task renders as a **name tag**
  badge: a status-colored header ribbon, an avatar circle holding a
  procedurally-drawn **agent face** (deterministic skin/hair tinted per agent,
  with a mouth that reacts — neutral, working, smiling on complete, frowning on
  failure), the agent's readable name, the task title, and the task id. Agent
  identity is the ring/border color, so the legend and the cards agree at a
  glance.
- **In Progress is live, not stale.** The engine now **persists a task's
  `running` status when it starts**, so snapshots and dashboard reconnects show
  in-flight work instead of a stale "pending" (previously the state was only
  saved after a task finished). A crash that leaves a task "running" is
  recovered on restart: `runEngine` resets such tasks to `pending` so they run
  instead of deadlocking.
- **Tests.** The engine suite is now **23** `node --test` cases (kanban layout
  replaces the whorl-tree layout, squirrel-name module removed, plus a crash-
  recovery regression test); the launcher suite remains at **36**.

Related architecture decisions:

- [ADR-026](adr/026-forge-board-kanban-dashboard.md): the Forge Board — kanban
  redesign, name-tag cards with agent faces, and the running-status
  persistence/crash-recovery behavior.
- [ADR-025](adr/025-squirrel-forge-live-workflow-viz.md): the original Squirrel
  Forge oak-tree visualization (superseded by ADR-026).

---

## August 2026 - v3.16

### Live visualization: The Squirrel Forge

Watching "dark orchestration" used to mean tailing
`docs/WORKFLOW-STATE.json` or the audit log. The workflow engine now ships a
live, localhost **PixiJS dashboard** that renders the build as a single oak
tree which **grows over the course of the run**:

- **`--viz` on `workflow-engine run`.** Starts a dependency-free `node:http`
  server before the main loop, broadcasts every audit event in-process over
  **SSE** (a single hook inside `writeAuditEvent` - no engine rework), auto-opens
  the browser at `http://127.0.0.1:4299` (next free port if busy), and shuts
  down shortly after the run so the finale renders. Pass `--no-open` to skip
  auto-opening.
- **The scene.** Phases are whorls up the trunk; tasks hang from each whorl's
  branch line. Every agent is a **named squirrel** (deterministic names -
  `api-engineer` → Tailor, `qa-engineer` → Nutsy - with a seeded hash fallback
  for arbitrary agents) whose pose maps to status: dozing = pending, scurrying =
  running, celebration bounce = complete, tumble = failed, faded = skipped. On
  `artifact.created` an **acorn rolls up the trunk** to the consuming squirrel,
  and `context.projected` shows a knapsack-arc gauge of token reduction on a
  busy squirrel. The canopy fills with leaves as tasks complete, browns on
  failure, and blooms when all squirrels gather and hoist a golden acorn at the
  end.
- **Interactions.** Hover for a tooltip, click a squirrel for the task panel
  (title, owner, status, duration, output files, artifact), drag to pan, scroll
  to zoom. A snapshot replays on every (re)connect.
- **`workflow-engine viz` attach mode.** Tails `docs/EXECUTION-AUDIT.jsonl` and
  serves the same dashboard, so you can watch an **already-running or detached**
  engine run (e.g. the `forge-auto-build` path) from any terminal.
- **Launcher pass-through.** `forge-launcher engine-run --viz` (and
  `--viz-port <n>` / `--no-open`) forwards to the engine; `FORGE_ENGINE_VIZ=1`
  and `FORGE_ENGINE_VIZ_PORT` set the same defaults.
- **Zero new runtime dependencies.** PixiJS v8 is vendored
  (`viz/dashboard/vendor/pixi.min.js`, ~0.8 MB); events stream over SSE via
  `node:http`; no WebSocket or npm dependency was added to the engine.
- **Tests.** The engine suite grew to **26** `node --test` cases (new:
  whorl-tree layout, deterministic squirrel naming, and the viz server's
  manifest/state/layout endpoints, SSE snapshot + in-process broadcast, tail
  source, `done`-on-shutdown, and port binding). Launcher suite stays at 16.
  All packages typecheck clean.

### Live dashboard: TUI toggle, detached-run logging, and connection feedback

- **Viz option in the engine decision.** The launcher's engine configuration
  now asks whether to **launch the live Squirrel Forge dashboard** during the
  run (default on, optional port), and the detached run / printed command carry
  `--viz` / `--viz-port` (`FORGE_ENGINE_VIZ`, `FORGE_ENGINE_VIZ_PORT`).
- **Detached runs are actually observable.** `spawnDetached` now tees the
  detached child's stdout+stderr into `docs/engine-run.log` even when only a
  log file is configured (previously the streams went to `/dev/null`, so a
  silent failure looked like "it never started"). A no-PRD warning appears
  before starting detached, since the engine can't compile a manifest without
  one. The dashboard starts once the engine starts (after manifest prep) and
  its URL is printed to the log.
- **The dashboard can't look "unconnected" anymore.** The HUD status line is
  now driven by the live connection: `connected · run <id> · <status>` on
  snapshot/state, "connection lost · retrying…" / "disconnected" via an
  `onerror` handler, and "run finished" on shutdown. Render errors are caught
  and surfaced instead of silently killing the event handlers, and the scene
  rebuilds cleanly on reconnect. The engine also starts the dashboard before
  the pre-run gate so the URL is available while you review the summary.

Related architecture decision:

- [ADR-025](adr/025-squirrel-forge-live-workflow-viz.md): the Squirrel Forge
  visualization - design, event streaming, the two launch modes, and the
  zero-dependency PixiJS vendoring.

---

## August 2026 - v3.15

### Feature-based manifest compilation, team validation, and the responsibility matrix

The workflow-engine path previously compiled `docs/EXECUTION-MANIFEST.json`
**only** from the monolithic `docs/PRD.md`, ignoring the decomposed layout and
skipping the team-validation / responsibility-matrix steps that the
prompt-driven path (`forge-orchestrate-build` + `forge-build-agent-team`)
performs. It now matches the original flow:

- **Feature-based compile mode (auto-detected).** When
  `docs/product-vision.md` + `docs/features/*.md` exist, the adapter reads the
  vision's `## 14. Features` dependency table, orders features topologically
  (dependencies first; cycles or a missing table fall back to document order
  with a warning), and compiles each feature's `## 5. Implementation Tasks` /
  `### Phase N:` blocks into manifest phases. Phase ids are feature-tagged
  (e.g. `BUDGETS-2`) so task ids stay globally unique across features. The
  manifest records `sourceLayout: "features"` and `featureOrder`. Features with
  no phase headings get a single phase synthesized from their Functional
  Requirements bullets (warned). Monolithic repos compile exactly as before.
- **Team-validation gate (always at compile).** Every `compile` checks for
  unassigned tasks, output files owned by more than one agent, and orphan
  agents (generated agents that own no task) — mirroring
  `forge-build-agent-team` Step 7 — surfacing any findings as manifest warnings.
- **Responsibility matrix restored.** `compile` writes
  `docs/agent-responsibility-matrix.md` (validation results + an
  agent × phase × task × outputs table + phase execution order) and records its
  path on the manifest (`responsibilityMatrixPath`). The workflow engine's
  pre-run summary prints the source layout, feature order, and matrix path.
- **TUI engine configuration.** Choosing *run the build now (detached)* or
  *print the engine command* in the launcher now opens an engine-configuration
  step (defaults preselected, Esc keeps them): per-task harness, task
  granularity, parallel-agent count, per-task timeout, and max retries. The
  `engine-run` command gained `--granularity`, `--max-retries`,
  `--retry-delay-ms`, and `--heartbeat-ms` (with `FORGE_ENGINE_GRANULARITY`,
  `FORGE_ENGINE_MAX_RETRIES`, `FORGE_ENGINE_RETRY_DELAY_MS`,
  `FORGE_ENGINE_HEARTBEAT_MS` env equivalents). Setting `--granularity`
  recompiles the manifest at that granularity even when one already exists, with
  a note to clear `docs/WORKFLOW-STATE.json` if a previous run is in progress.
- **Tests.** Launcher suite is now 16 `node --test` cases (including the
  engine-config command regression); the execution adapter covers the
  feature-based compile, ordering, feature-tagged ids, team validation, and
  responsibility matrix at 17 cases. All packages typecheck clean.

Related architecture decision:

- [ADR-024](adr/024-feature-based-compilation-and-responsibility-matrix.md):
  feature-based manifest compilation, the deterministic team-validation gate,
  and the generated responsibility matrix.

---

## August 2026 - v3.14

### Forge launcher as a Node npm package with a TUI

The CLI layer (`forge-launcher`, `bootstrap`, `forge-engine-run`) is now a
single cross-platform **`forge-launcher` npm package** at
`scripts/forge-launcher/`, replacing the six dual bash/PowerShell scripts
(which remain as thin delegating wrappers during the transition, then are
removed).

- **One codebase, three subcommands.** `forge-launcher` (9-step onboarding),
  `forge-launcher bootstrap`, and `forge-launcher engine-run` mirror the legacy
  entry points with an unchanged flags/env-var contract. Run it from anywhere
  with `npx forge-launcher` — no forge clone needed (templates are bundled as
  resources).
- **Interactive TUI.** All prompts use `@clack/prompts` — `select` menus
  (harness, PRD, engine decision), `confirm`, `text`, `multiline` (Enter-twice
  submits), and an autocomplete path picker — with a readline fallback for
  piped/CI input and a clean Ctrl+C exit (code 130).
- **Spinners instead of heartbeats.** Long-running steps (repo create,
  bootstrap, push, headless skill runs) show a clack spinner with their output
  tee'd to a per-run log (`/tmp/forge-launcher-<pid>.log`), printed on failure.
  The old "still running… Ns" heartbeat and the bash/PSReadLine Tab-completion
  hacks are gone.
- **Drift fixed.** The "Launch CLI now?" prompts default to `no` everywhere
  (the PowerShell variant had drifted to `yes`).
- **Auto-draft reliability.** Headless skill runs now set `FORGE_HEADLESS=1`
  for the spawned harness CLI so the forge skills' headless gate fires
  deterministically, and pass `--dir "<repo>"` to `opencode run` so the skill
  runs in the **target repository** — `opencode run` resolves its project
  directory from its parent process, not the child's spawn `cwd`, so without
  `--dir` the skill ran in the launcher's own directory and reported its input
  (`docs/IDEA.md`) as missing. The workflow-engine `opencode` adapter passes the
  same `--dir` for the same reason. If an auto-draft stage finishes without its
  artifact, the launcher prints the run-log tail, `git status`, and whether the
  skill file resolved, then offers to run the skill manually. `--debug` /
  `FORGE_LAUNCHER_DEBUG=1` always shows the log tail, and
  `FORGE_RUN_WITH=stub` (with `FORGE_STUB_NOOP=1`) runs the auto-draft stages
  offline against canned artifacts for testing.
- **Detached engine start fixed.** Choosing "Run the workflow-engine build now
  (detached)" re-invoked the CLI via `new URL("./cli.ts")`, which resolves to
  `dist/cli.ts` — a file that does not exist when running the compiled package —
  so the detached child failed to start with ENOENT and no manifest or
  `docs/engine-run.log` ever appeared. The entry now resolves to `dist/cli.js`
  when compiled (and preloads the tsx loader when running from source), and
  `spawnDetached` writes a "failed to start" line to the log if the spawn fails
  instead of failing silently.
- **Tests.** 15 `node --test` cases (bootstrap harness mapping/rewrite/
  gitignore, path expansion, non-interactive E2E layout + queued-command
  selection, the `--dir` pinning of headless skill commands, detached engine
  command resolution, and stub-runner coverage of the auto-draft success and
  failure paths). `scripts/test-forge-launcher.sh` now delegates to the package
  suite. Interactive TUI verified end-to-end under a pty.

Related architecture decisions:

- [ADR-023](adr/023-forge-launcher-npm-package.md): the launcher as a Node npm
  package (supersedes ADR-010's script-first/no-dependency decision).

---

## August 2026 - v3.13

### Finer-grained tasks and a configurable task timeout

Workflow-engine tasks were failing because each harness adapter hardcoded a
per-task timeout (`10 * 60 * 1000`ms); when a task exceeded it, the child was
killed and the task failed after retries. Task granularity was also locked to
one PRD bullet per task, so a large bullet became one long, opaque task. Two
changes fix this.

- **Fine-grained task decomposition (now the default).** `forge-execution-adapter
  compile` expands indented sub-bullets into their own chained tasks and splits
  oversized (multi-sentence) bullets at sentence boundaries. Every task keeps
  owner matching, the linear dependency chain, and artifact `inputs`/`produces`
  wiring. Split tasks are reported as compile warnings. `--granularity coarse`
  reproduces the legacy one-bullet-per-task output exactly, and the manifest
  records `granularity: "coarse" | "fine"`.
- **Configurable per-task timeout.** `--task-timeout-ms <ms>` (or
  `FORGE_ENGINE_TASK_TIMEOUT_MS`) sets the engine-wide budget (default 10 min,
  unchanged). A task's own `timeoutMs` field in the manifest overrides it. The
  `opencode`, `copilot`, and `flowforge-kernel` adapters use the effective
  timeout instead of a hardcoded constant; the `openai` adapter now enforces it
  with an `AbortController` (previously unbounded). The pre-run summary prints
  the effective timeout, and `scripts/forge-engine-run.sh` / `.ps1` pass
  `--task-timeout-ms` / `-TaskTimeoutMs` through.
- **Tests.** Coverage for sub-bullet expansion, long-bullet splitting, `coarse`
  regression equivalence, timeout precedence (per-task beats global), and
  `runCommand` enforcing a custom timeout.

Related architecture decision:

- [ADR-022](adr/022-task-granularity-and-configurable-timeout.md): fine-grained
  task decomposition and the configurable task timeout.

---

## August 2026 - v3.12

### Parallel task dispatch in the workflow engine

The engine previously drained its ready-task frontier **sequentially** (a
documented MVP tradeoff, ADR-014). It now executes that frontier in bounded
**waves**, cutting wall-clock time on multi-agent builds from sum-of-durations to
the critical path.

- **Wave-based dispatch.** Each wave computes `nextReadyTasks` (unchanged), runs
  the ready set through a bounded worker pool, and merges the terminal
  transitions back into state in **manifest order** (deterministic regardless of
  completion order). State is saved once per wave; newly-unblocked tasks are
  picked up on the next wave.
- **Opt-in concurrency.** `--concurrency <n>` (or `FORGE_ENGINE_CONCURRENCY`)
  caps how many ready tasks run in parallel. Default `1` reproduces the previous
  sequential behavior exactly. `<= 1` is treated as sequential.
- **Per-harness safety valve.** `HarnessAdapter` gains a
  `supportsConcurrency` capability flag; the engine only parallelizes harnesses
  that opt in. All current adapters do (`openai`, `stub`, `opencode`, `copilot`,
  `flowforge-kernel`). Repo-editing harnesses still rely on the manifest
  dependency graph for file isolation.
- **`flowforge-kernel` de-synchronized.** Converted from blocking `execFileSync`
  to async `runCommand` (unblocks the event loop, fixes the streaming gap, and
  promise-caches the `validatePackage` preflight).
- **Race-safe artifacts.** `ArtifactStore` ID allocation moved to an in-memory
  reservation counter (seeded from disk), eliminating duplicate artifact IDs
  under concurrency.
- **Drain-on-failure.** In-flight tasks in a wave run to completion; failed
  tasks' dependents never enter a later wave, and the run is marked `failed`
  exactly as before.
- **Runner passthrough.** `scripts/forge-engine-run.sh` / `.ps1` accept
  `--concurrency <n>` / `-Concurrency <n>` (and `FORGE_ENGINE_CONCURRENCY`), so
  the standalone/launcher engine path can opt into parallelism.
- **Bootstrap never ships `node_modules`.** The engine `node_modules` directories
  were accidentally committed to the forge repo and copied into every
  bootstrapped target by `cp -r` (~88MB each). They are now untracked (ignored),
  and `bootstrap.sh` / `bootstrap.ps1` exclude `node_modules/` and `dist/` when
  copying skill templates - the target repo installs engine dependencies on
  demand via `npm install` at engine-prep time. Only `package.json` /
  `package-lock.json` / `scripts/` / `SKILL.md` / `tsconfig.json` ship.

Related architecture decision:

- [ADR-021](adr/021-parallel-task-dispatch.md): wave-based parallel dispatch,
  `supportsConcurrency`, `flowforge-kernel` async conversion, and race-safe
  artifact IDs.

---

## August 2026 - v3.11

### Workflow-engine heartbeat, OpenCode adapter fix, and clearer engine handoff

- **OpenCode adapter no longer passes `--system-prompt`.** `opencode run` (v1.18+)
  has no such flag, so the previous invocation printed the CLI usage and failed
  every task. The agent persona (`agent.rawBody`) is now inlined into the prompt,
  matching the copilot and openai adapters. Docs (SKILL.md, deep-dive) updated.
- **Shell-safe child invocation.** The `opencode` and `copilot` adapters now use
  asynchronous `spawn` (via a shared `harness/run.ts`) instead of `spawnSync`
  with a shell string. This fixes `/bin/sh` interpolation errors from backticks
  and `$` in agent bodies, and keeps the event loop free for the heartbeat.
- **Engine heartbeat.** While a task is executing, the engine prints
  `…still working on task <id> (@<agent>, Ns elapsed)` every
  `--heartbeat-ms <ms>` (default 15s; `0` disables, `FORGE_ENGINE_HEARTBEAT_MS`
  env override) so a quiet terminal doesn't look hung.
- **`--yes` actually skips the pre-run gate.** The boolean flag was parsed with a
  value-expecting helper, so it never matched; added a proper `hasFlag` check
  (alongside `FORGE_ENGINE_YES=1`).
- **Clearer engine handoff in the launcher.** Choosing "Run the workflow-engine
  build now (detached)" now sets an engine-started flag, skips the subsequent
  interactive CLI launch prompt, prints `tail -f` / `Get-Content -Wait` monitor
  commands, and makes the Step 9 summary reflect the running engine instead of
  the manual `@workspace /forge-auto-build` steps. Fixed the `Skip -I will…`
  menu typo. (Bash + PowerShell.)
- **Artifact store on by default.** `forge-execution-adapter compile` now
  auto-declares `produces` (and wires `inputs` to the previous task) for every
  task it emits, so `docs/artifacts/` is populated on every successful run
  without hand-editing the manifest. Semantic types are still available as a
  manual override.
- **New user guide.** Added `docs/workflow-engine.md`, a `forge-launcher.md`-style
  reference for running, resuming, and troubleshooting the workflow engine.
- **Skipped tasks no longer deadlock.** The DAG readiness checks now treat a
  `skipped` task as done (matching `isComplete`), so a skipped task no longer
  blocks the next phase and aborts the run with "Dependency deadlock detected".
- **Every compiled task has an owner.** `forge-execution-adapter compile` now
  falls back to an `*orchestrator`-named agent (else the first agent) when no
  agent confidently matches a task, instead of leaving it `unassigned`.
- **Engine unit tests.** Added `forge-workflow-engine/scripts/engine.test.ts`
  (`node:test`) covering the DAG readiness, deadlock, and completion logic.

---

## August 2026 - v3.10

### Forge launcher: auto-draft flow and friendlier path input

The launcher's interactive and headless paths get three quality-of-life upgrades
for getting from an idea to a reviewable PRD/team to an engine run.

- **Path prompts support Tab completion and shell shorthand.** Parent-directory,
  PRD, and research/seed path prompts now use bash readline (`read -e`) on Bash
  and PSReadLine (`PSConsoleReadLine::ReadLine`) on PowerShell for **Tab
  completion** to existing files/folders. Typed paths also expand `~`, `~/`,
  `~user`, and `$VAR` / `${VAR}` (e.g. `$HOME/docs/prd.md`) before validation -
  so external PRD/seed locations work without typing full absolute paths.
  Validation now normalises paths (`realpath -m`) and reports *"file not found"*
  vs. *"not a regular file"* distinctly.
- **Optional auto-draft flow.** At Step 8, the launcher can run the authoring
  stages non-interactively with **review boundaries**:
  - **Idea → PRD:** runs `forge-auto-build-prd` headless (auto-proceed, every
    unknown recorded as an Open Question), commits `docs: add auto-drafted PRD`,
    then points you at the result (monolithic or decomposed) for review.
  - **PRD → team:** runs `forge-build-agent-team` headless, commits
    `feat: generate auto-drafted agent team`, then points you at the generated
    agents/skills for review. When a decomposed layout exists, the team is built
    from `docs/product-vision.md` + `docs/features/*.md` (Vision + Features
    mode); otherwise from `docs/PRD.md`.
  - **Engine decision:** after the team, choose to run the workflow engine now
    (detached via `forge-engine-run.sh --repo <repo> --harness <h> --yes`), print
    the command to run later, or skip and build manually.
  - Exposed as interactive prompts, pre-answered with `--draft` (`-Draft` on
    PowerShell), or forced headlessly with `FORGE_AUTO_DRAFT=1`.
- **Generalised headless runner.** The queued-skill headless path and the
  auto-draft stages share `headless_cmd_for` / `run_skill_headless` (Bash) and
  `Get-HeadlessCommandFor` / `Invoke-SkillHeadless` (PowerShell), so `--headless`,
  `--draft`, and `FORGE_AUTO_DRAFT=1` all print the same `opencode run --auto` /
  `copilot -p --yolo` command shape under `--dry-run`.
- **"Still running" indicator.** Long-running steps (bootstrap, headless/auto-draft
  skill runs, GitHub repo creation, push) show a periodic `still running… Ns`
  heartbeat (Bash: `run_with_heartbeat`, TTY-only and zombie-safe; PowerShell:
  indeterminate `Write-Progress`) so users don't think the launcher is hung.
  Output stays visible, and the interval is configurable via
  `FORGE_HEARTBEAT_INTERVAL` (default `15`s). Skipped for piped/CI output.

Related architecture decision:

- [ADR-020](adr/020-launcher-auto-draft-and-path-input.md): auto-draft review-boundary flow and path-input handling.

---

## August 2026 - v3.9

### Authoring/execution split, detached engine, and GitHub Copilot harness

The workflow engine no longer runs *inside* the CLI session. Authoring (PRD → team → manifest) stays in the chat; **execution runs detached**, as a standalone process that outlives the terminal and resumes with `run`.

- **Detached engine handoff.** `forge-auto-build`'s engine path (`GO --workflow-engine`) now compiles the manifest, starts the engine with `nohup … >> docs/engine-run.log 2>&1 &`, and polls `docs/WORKFLOW-STATE.json` to completion instead of blocking the session. The build survives the chat and never dies with it.
- **Standalone runner.** New `scripts/forge-engine-run.sh` / `forge-engine-run.ps1` run the engine from outside any CLI (second terminal, CI, or `nohup`): install deps, compile the manifest if missing, then `npm run workflow-engine -- run --harness <h> --yes`. `--dry-run` prints the sequence.
- **GitHub Copilot per-task harness.** New `--harness copilot` adapter invokes `copilot -p "<agent context + task prompt>" --yolo` per task (agent contents inlined -`copilot -p` has no `--system-prompt` flag). Env vars: `COPILOT_BIN`, `COPILOT_EXTRA_FLAGS`. Per-task harness selected with `FORGE_ENGINE_HARNESS` (default `opencode`).
- **Engine dependencies are explicit and never committed.** `bootstrap.sh` / `bootstrap.ps1` ensure the target repo's `.gitignore` excludes `node_modules/` and `docs/engine-run.log`; `forge-auto-build`'s final commit skips `**/node_modules/**`. Docs state the engine needs `node >= 18` + npm at build time.

Related architecture decision:

- [ADR-019](adr/019-authoring-execution-split-and-copilot-harness.md): authoring/execution split, detached engine, Copilot adapter, dependency hygiene.

---

## August 2026 - v3.8

### Automatic PRD quality gates and PRD-prerequisite build execution

Implements CR-001. Two principles: automate deterministic mechanical gates, preserve deliberate human gates.

- **PRD decomposition is automatic.** `forge-build-prd` gains a Step 5 that evaluates the existing criteria (15+ functional requirements or 3+ implementation phases) immediately after the user confirms the PRD. A qualifying PRD automatically invokes `forge-decompose-prd` -no opt-in question. A non-qualifying PRD stays monolithic and the outcome is reported. `forge-decompose-prd` remains independently invokable.
- **`forge-build-prd` absorbs the PRD review checklist.** The review gate from the retired `forge-bootstrap-project` (Scope & intent, Requirements, Technical choices, Plan, Open items) is now part of `forge-build-prd` Step 4.
- **`forge-bootstrap-project` is retired** and its skill directory removed. Its idea-confirmation pattern is reused by the new `forge-auto-build-prd` skill; its PRD review checklist is reused by `forge-build-prd`.
- **New `forge-auto-build-prd` skill.** A meta-skill that confirms an idea, invokes `forge-build-prd` (review + automatic decomposition), verifies the outputs, and stops before team generation - the PRD-creation fast path.
- **`forge-auto-build` requires an existing PRD.** It no longer generates a PRD or interviews for a one-line idea. Its pre-flight check requires `docs/PRD.md` or the decomposed `docs/product-vision.md` + `docs/features/*.md`; if neither exists it stops and directs the user to `forge-auto-build-prd` / `forge-build-prd`. Stages are reduced to team generation → optional model assignment → build execution (`forge-orchestrate-build` or `--workflow-engine`).
- **Launcher handoff updated.** `forge-launcher` (Bash + PowerShell) queues `forge-auto-build` when a PRD was captured in Step 6, or `forge-auto-build-prd` when it was not, so the build pipeline (agent team + build execution, including the workflow-engine path) runs once the PRD exists.
- **`detect-harness.md` relocated** from `forge-bootstrap-project/references/` to `forge-build-agent-team/references/`; all referencing skills updated.

Related architecture decision:

- [ADR-018](adr/018-auto-prd-decomposition-and-build-prerequisite.md): automatic decomposition gate, `forge-bootstrap-project` retirement, and the PRD-prerequisite build pipeline.

---

## August 2026 - v3.7

### Artifact Store and Context Projection in `forge-workflow-engine`

- Added a file-based **artifact store** (`templates/skills/forge-workflow-engine/scripts/artifacts.ts`) that persists every meaningful agent output as a compact, typed JSON artifact under `docs/artifacts/<type-prefix>/<artifact-id>.json`.
- Artifacts are organised into three categories: **decision** (what we are building and why), **work** (what has been done), and **evidence** (how we know it is correct).
- Added **context projection**: before each task is dispatched, the engine resolves the task's declared `inputs`, fetches the relevant artifacts from the store, and builds a minimal markdown `contextBlock` that replaces the full workflow state in the agent prompt — dramatically reducing per-task token consumption.
- Extended `ManifestTask` with two optional fields (`inputs` and `produces`) so workflows can declare the artifact hand-off contract directly in `EXECUTION-MANIFEST.json`.
- Extended the `HarnessAdapter` interface with an optional `contextBlock` parameter; `OpenCodeAdapter` and `OpenAIAdapter` both prepend it when present. Existing adapters that ignore it remain unchanged.
- Added two new audit event actions: `artifact.created` and `context.projected` (with `sourceTokenEstimate`, `projectedTokenEstimate`, and `reductionPercent` fields).
- Added [`docs/artifact-store-deep-dive.md`](artifact-store-deep-dive.md): full walkthrough of the pattern, artifact schema, the three-category taxonomy, projection mechanics, and extension points.

Related architecture decision:

- [ADR-017](adr/017-artifact-store-and-context-projection.md): artifact store design, context projection layer, manifest extension, and adapter interface change.

---

## August 2026 - v3.6

### Workforce compiler + optional FlowForge kernel handoff

- Added `forge-workforce-compiler` (`templates/skills/forge-workforce-compiler/`): portable TypeScript tooling that compiles Forge artifacts into `dist/<package-id>.workforce`, writes FlowForge-style `workforce.json` + workflow files, and emits `docs/KERNEL-BRIDGE.json` for task/node mapping and state/audit bridge metadata.
- Added a FlowForge-compatible schema gate to the compiler (`validate` command and post-compile fail-fast validation).
- Added optional `flowforge-kernel` harness mode to `forge-workflow-engine` so Stage 4 execution can hand off to FlowForge CLI/runtime while preserving existing `opencode`, `openai`, and `stub` modes.
- Added [`docs/workforce-compiler-deep-dive.md`](workforce-compiler-deep-dive.md): deep technical walkthrough of compiler packaging, validation gate, and kernel handoff integration.
- Expanded [`docs/testing-guide.md`](testing-guide.md) with a dedicated manual test path for workforce compilation and FlowForge kernel handoff.
- Updated docs and prompt playbook with the new compile + kernel execution path.

Related architecture decision:

- [ADR-016](adr/016-forge-workforce-compiler-and-kernel-handoff.md): Forge-as-authoring + kernel-as-execution boundary, interop contract v1, and state/audit bridge policy.

---

## August 2026 - v3.5

### Dynamic Workflow Orchestration via `forge-workflow-engine`

- `forge-workflow-engine` (`templates/skills/forge-workflow-engine/`): runtime layer that reads `docs/EXECUTION-MANIFEST.json`, builds a live task DAG, dispatches agent invocations through a pluggable harness adapter, retries failed tasks, and syncs `docs/PROGRESS.md` and `docs/EXECUTION-AUDIT.jsonl` after every state transition.
- `workflow-orchestrator` (`templates/agents/workflow-orchestrator.md`): human-facing companion agent that handles pre-run verification, CLI invocation, blocker escalation, and post-run summaries.
- Three harness adapters ship in MVP: `OpenCodeAdapter` (shells out to `opencode run`), `OpenAIAdapter` (direct API), and `StubAdapter` (synthetic results for testing).
- Machine-readable run state is stored in `docs/WORKFLOW-STATE.json`; `docs/PROGRESS.md` stays in sync so existing `project-orchestrator`-style resume flows remain compatible.
- CLI supports `run`, `status`, `replay`, and `pause` operations.
- `forge-auto-build` now supports either/or build execution: the default Stage 4 path uses `forge-orchestrate-build`, while `GO --workflow-engine` switches Stage 4 to manifest compilation plus autonomous execution with `workflow-engine run --harness opencode`.
- Auto-deployed by bootstrap scripts; no bootstrap changes required.

Related architecture decision:

- [ADR-014](adr/014-dynamic-workflow-orchestration.md): engine architecture, harness adapter interface, DAG ordering, retry policy, and integration with `forge-auto-build`.

### Manual Testing Guide

- [`docs/testing-guide.md`](testing-guide.md): step-by-step manual verification guide covering (1) skill creation from the team builder - confirming `skill-creator` and `skill-review` are invoked and the quality gate is enforced - and (2) workflow engine dark orchestration - verifying manifest compilation, the pre-run gate, autonomous task dispatch, state sync, resume, retry, and replay. Includes a plain-language explanation of "dark orchestration" (background/autonomous execution, not anything security-related) and a troubleshooting section.

---

## August 2026 - v3.4

### Auto-build input auto-detection and launcher handoff alignment

- `forge-auto-build` Step 0 now supports resolving input from repository context when invoked without an explicit argument.
- Input resolution flow now prioritizes explicit user input, then checks `docs/PRD.md`, `docs/IDEA.md`, and `IDEA.md`.
- If multiple candidate sources are present, the skill asks the user to choose one source for that run.
- Launcher handoff guidance now points to `docs/IDEA.md` as the canonical source.

Related architecture decision:

- [ADR-013](adr/013-auto-build-input-auto-detection.md): Auto-detect input source in `forge-auto-build` Step 0.

---

## August 2026 - v3.3

### Forge Execution Adapter - contract-driven bridge for external runners

- `forge-execution-adapter` (`templates/skills/forge-execution-adapter/`): portable TypeScript tooling that discovers a Forge repo, normalizes harness roots, compiles `docs/EXECUTION-MANIFEST.json`, synchronizes `docs/PROGRESS.md`, and appends `docs/EXECUTION-AUDIT.jsonl` for FlowForge-style backends.

Related architecture decision:

- [ADR-011](adr/011-forge-execution-adapter.md): Adapter architecture, MVP scope, and rationale for keeping the bridge separate from Agent Forge authoring.

---

## August 2026 - v3.2

### Forge Launcher - interactive CLI for the full lifecycle

- `forge-launcher` (`scripts/forge-launcher.sh` and `scripts/forge-launcher.ps1`): one terminal command guides users from zero to auto-build by creating a repo, selecting a harness, bootstrapping Agent Forge, capturing project idea context, committing, and optionally spawning the harness CLI.
- Terminal launch hardening and fallback guidance for CLI harnesses.
- PRD-first guidance and seed-document recommendations added to launcher flow docs.

Related architecture decisions:

- [ADR-010](adr/010-forge-launcher.md): launcher design rationale and lifecycle structure.
- [ADR-012](adr/012-launcher-terminal-handoff-and-prd-guidance.md): terminal handoff hardening and PRD-first guidance.

---

## August 2026 - v3.1

### Full auto build, end-to-end pipeline in one command

- `forge-auto-build` meta-skill: one command from one-liner idea (or existing PRD) to fully built, validated, and committed project.
- Single pre-flight gate followed by autonomous execution: PRD -> agent team -> optional model assignment -> all build phases, with validation and commits after each phase.

Related architecture decision:

- [ADR-009](adr/009-full-auto-build-meta-skill.md): rationale and relationship to `forge-bootstrap-project`.

---

## August 2026 - v3.0

### Skill-Forge integration and framework-agnostic skill creation

- Added three integrated skills from skill-forge: `skill-creator`, `skill-review`, and `skill-review-updater`.
- `forge-build-agent-team` now invokes `skill-creator` for project-specific skill generation and validation.
- `skill-review` includes portable TypeScript tooling and CI providers (GitHub Actions, GitLab CI, Azure DevOps).
- Removed `forge-build-agent-framework-solution` to keep the forge framework-agnostic.

Related architecture decision:

- [ADR-008](adr/008-skill-forge-integration.md): integration rationale and expected outcomes.

---

## June 2026 - v2

### Harness-agnostic structure, leaner skills, and built-in best practices

- `.agents/` migration: default bootstrap now targets `.agents/` for harness portability.
- Progressive disclosure adoption: forge skills moved large details to `references/` content.
- Added `## Gotchas` and `## Validation` sections to forge skills and generated skills.
- Added `forge-optimize-skills` for skill quality audits and improvement guidance.

Related architecture decisions:

- [ADR-006](adr/006-agents-directory-migration.md)
- [ADR-007](adr/007-skill-best-practices-adoption.md)

For measured efficiency changes and before/after detail:

- [docs/research/forge-optimization-value.md](research/forge-optimization-value.md)
