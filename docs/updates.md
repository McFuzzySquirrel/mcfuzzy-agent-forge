# Updates

Detailed release and change notes for MyForge.

---

## September 2026 - v3.36

### Forge Board: clearer expanded cards and fixed avatar moods

- **Expanded cards get wider.** Clicking a task card now widens it (+150px) in
  addition to growing taller, so the expanded detail (full title, description,
  status/owner/phase/timeout/inputs/outputs rows) has room to breathe; the
  card floats over its right neighbor on an opaque backdrop.
- **Detail rows no longer overlap.** The key/value rows previously drew the
  label and value at the same spot, so "Status · complete" rendered on top of
  itself. Labels now sit in their own column with the value indented beside
  them, and row spacing was increased.
- **Avatars smile when done.** The face's mouth had the smile/frown arcs
  reversed, so completed cards looked cross and failed ones grinned. Completed
  cards now smile, failed ones frown (running = dot, pending/skipped = neutral).
- **Long task ids are trimmed** to fit the card instead of spilling over the
  edge.

### Engine heartbeat default raised to 60s

- The engine's per-task heartbeat line (`…still working on task <id> (@<agent>, Ns elapsed)`)
  now prints every **60 seconds** by default instead of 15, so `docs/engine-run.log`
  stays quieter during long tasks. Override with `--heartbeat-ms` /
  `FORGE_ENGINE_HEARTBEAT_MS` (or `0` to disable).

### Auto-commit after each completed task (default on)

- **One commit per completed task.** The workflow engine now commits the
  working tree after each task completes, sequenced after the wave merge so it
  is safe at any concurrency level. The commit includes the task's work **and**
  the engine-owned files (`docs/WORKFLOW-STATE.json`, `docs/EXECUTION-AUDIT.jsonl`,
  `docs/PROGRESS.md`), producing a clear, attributable history aligned with the
  manifest's task decomposition.
- **Default on** (per product decision). Existing runs change behaviour by
  default. Disable with `--no-auto-commit` (`FORGE_ENGINE_AUTO_COMMIT=0`) —
  for example when mid-rebase or with pre-existing uncommitted changes you
  don't want mixed with agent output.
- **Custom message template.** `--commit-message-template "<tmpl>"` (or
  `FORGE_ENGINE_COMMIT_MESSAGE_TEMPLATE`) with `{taskId}` / `{taskTitle}`
  placeholders; default is `feat(forge-engine): complete task {taskId} - {taskTitle}`.
- **Non-fatal failures.** A repo without `.git`, an empty diff, or a failed
  commit (e.g. no git identity) is logged/skipped and never fails the task or
  the run. A new `task.committed` audit event records the commit SHA.
- **Wired through the CLI and console.** `forge-launcher engine-run` accepts
  `--auto-commit|--no-auto-commit` and `--commit-message-template`; the setting
  persists in `docs/engine-config.json` (new `autoCommit` field) and appears as
  a checkbox on the console **Overview** (Controls panel). The interactive
  launcher's engine configuration also asks about it (default yes).

### Forge Console: add an existing PRD and research/seed documents in the New Project wizard

- **Mirrors the CLI's Step 6.** The New Project wizard now has a **Project
  documents** section (after the idea) where you can add an existing PRD and
  research/seed documents (design specs, market research, technical notes) —
  exactly like the terminal flow. Docs are copied to `docs/PRD.md` and
  `docs/research/`, so the later PRD build (`forge-auto-build-prd`) reads the
  research context and a supplied PRD is used as-is instead of being drafted.
- **Browse by file picker or absolute path.** Both fields support a file-picker
  browse (upload) **and** a typed absolute path (comma-separated for multiple
  research docs). Picked files are staged server-side (`POST /api/uploads`) and
  the launcher is handed the paths via `FORGE_PRD_FILE` / `FORGE_RESEARCH_FILES`.
- **Research docs are visible afterwards.** The console's Plan & Team view now
  lists `docs/research/*.md` entries (kind `research`), so the docs you added
  are browsable in the browser.

### Forge Console: launch the harness CLI from a task

- **"Launch <harness> CLI"** button on the **Tasks** view header and the
  **Overview** header opens the project's harness CLI (opencode / copilot /
  claude, chosen from the repo's harness root) in a new terminal window in the
  project folder — so you can watch the live run and take over at any point.
  Backed by `POST /api/launch-cli` (injectable in tests); when no desktop
  terminal emulator is found the UI shows the exact command to run manually.

---

## August 2026 - v3.35

### Forge Console: skills shown as cards, grouped Forge vs Project

- **Skills render as cards in Plan & Team.** The Skills section of the console's
  Plan & Team view previously listed skills as a plain bulleted list. They now
  use the same card layout as the agent team, with the skill name, a category
  badge, description, its location under the harness, and an **Open** button
  (opens the skill directory in your file manager).
- **Skills are grouped into Forge skills and Project skills.** Skills
  bootstrapped from the forge templates (the `forge-*` skills plus
  `skill-creator`/`skill-review`/`skill-review-updater`) are classified as
  **Forge skills**; skills the generated team wrote for the project are grouped
  under **Project skills**. Each group renders its own card grid with a count
  in its heading, and empty groups are omitted.
- **Classification is derived, not stored.** The console matches a skill's
  directory against the forge template set it bootstraps from, so the grouping
  stays in sync as forge skills are added or renamed, and no re-bootstrap of
  existing projects is required.

---

## August 2026 - v3.34

### Agent/skill descriptions: single-line, double-quoted frontmatter

- **No more block scalars.** Generated agents and skills sometimes used a YAML
  folded/literal block scalar (`description: >` / `|`), which harnesses with
  simple frontmatter readers render as just `>` — the agent/skill looked
  undecorated (e.g. the Forge Console's Plan & Team view). Descriptions must
  now be **single-line and double-quoted** (`description: "..."`).
- **The `validate-frontmatter.mjs` gate now rejects them.** It flags block
  scalars (`>`/`|` and their `-`/`+` variants), multi-line values, unquoted
  descriptions, and the existing unquoted `: ` / `#` hazards — so
  `forge-build-agent-team` fails the gate instead of shipping broken files.
- **Templates and instructions updated.** `forge-build-agent-team` and
  `skill-creator` callouts/checklists/templates now mandate the single-line
  double-quoted form; the bootstrapped agent/skill template files were swept to
  match, so fresh teams pass the gate cleanly.
- **Parsers now tolerate block scalars anyway.** The Forge Console
  (`forge-launcher`) and the workforce compiler read folded/literal
  descriptions correctly, so pre-existing or third-party files written with
  `>`/`|` still display properly.

---

## August 2026 - v3.33

### Forge Console: restore Copilot harness for pre-existing GitHub repos

- The console **Run** action now infers the engine harness from the repo's
  harness root when `docs/engine-config.json` is absent, so projects bootstrapped
  before engine-config persistence existed run with `copilot` again instead of
  silently defaulting to `opencode`. New projects (bootstrapped via the launcher
  or console) are unaffected: their harness is already persisted during
  bootstrap.
- Setting the engine-wide default timeout (`set all` / Controls) on a repo
  without a config now writes the inferred harness too, instead of pinning
  `opencode`.
- The engine execution harness for Claude and generic `.agents` repos remains
  `opencode` — the workflow engine currently ships opencode, Copilot, OpenAI,
  stub, and FlowForge kernel adapters only.

---

## August 2026 - v3.32

### Forge Console: edit task timeouts

- **Per-task timeout editor.** Each task's detail drawer in the **Tasks** view
  now lets you set that task's `timeoutMs` override (a number input + Apply),
  and the Overview **Controls** panel has a matching task picker + Set control.
  This is the "bump the timeout on a failed task, then Replay it" flow: builds
  and tests that exceed the default can be given a larger budget and retried.
- **Set every task's timeout at once.** The Tasks view header and the Overview
  Controls panel both offer a "set all" control that writes `timeoutMs` to every
  manifest task *and* updates the engine-wide default in
  `docs/engine-config.json`, so the whole run gets a longer budget in one step.
- **How it's stored.** Per-task values are written back to
  `docs/EXECUTION-MANIFEST.json` (`ManifestTask.timeoutMs`); the "all tasks"
  action also writes `taskTimeoutMs` into `docs/engine-config.json`. Edits are
  preserved by `replay` and by `run`/`resume` unless a granularity is explicitly
  set (which recompiles the manifest from the PRD, regenerating `timeoutMs`).
- New token-gated `POST /api/tasks/timeout` endpoint (`{ taskId?, timeoutMs }`)
  validates the value and broadcasts a snapshot refresh.
- **Enter timeouts in minutes.** The timeout inputs (Tasks detail, "Set all",
  and Overview Controls) accept minutes with decimals (`1.5` = 90s) and convert
  to/from the millisecond values stored in the manifest and `engine-config.json`.
- **Finished tasks are read-only.** Completed/skipped tasks show their timeout
  as plain text instead of an editor - the task's own `timeoutMs`, or the
  effective default (`default · 10 min`) when it never had an override. Failed,
  pending, and running tasks stay editable so a failed task can be bumped and
  replayed.

### Forge Console: Manifest panel links to Plan & Team

- The Overview **Manifest** panel now shows a single **Open Plan & Team** link
  (replacing the IDEA/PRD-only links) - the Plan & Team view lists every
  document (IDEA, PRD, vision, features, progress, model plan) plus the agent
  team and skills.
- Added a practical [Forge Console user guide](forge-console-user-guide.md) for
  launching the console, creating or opening projects, switching repos, and
  monitoring runs from the browser.

---

## August 2026 - v3.31

### Forge Console: a local web UI over the launcher and workflow engine

- **`forge-launcher console`** opens a self-contained web UI that fronts both
  `forge-launcher` (authoring) and `forge-launcher engine-run` →
  `workflow-engine` (build) from one browser app. It is TypeScript compiled with
  `tsc`, served on `127.0.0.1` (default port `4300`, next free port if busy).
- **Project picker** landing page lists your projects and lets you add an
  existing repo.
- **New Project wizard** creates a repo by spawning
  `forge-launcher --non-interactive` with `FORGE_REPO_NAME` / `_PARENT_DIR` /
  `_DESCRIPTION` / `_VISIBILITY` / `_HARNESS_CHOICE` / `_IDEA` (plus optional
  `FORGE_AUTO_DRAFT=1`).
- **Resume a setup** - draft the PRD (`forge-launcher --draft`), generate the
  team (headless `forge-build-agent-team`), or start the build.
- **Start / resume a build** - `forge-launcher engine-run --harness <h> --yes`,
  detached, logged to `docs/engine-run.log`.
- **Views** - Overview (run header, progress, counts, blockers), **Board** (the
  existing PixiJS Forge Board embedded full-screen at `/board`), Tasks
  (filterable/sortable table + detail), Logs (`engine-run.log` tail + audit
  stream), Documents (read-only IDEA/PRD/vision/features/progress/model-plan +
  agent team, "open externally"), Artifacts (browse by type/task + preview), and
  Timeline (audit events, failure-highlighted).
- **Run controls** - Pause / Stop (write `docs/engine-control.json` + SIGTERM
  `docs/engine.pid`), Replay a failed task (`workflow-engine replay <task>`), and
  Run / Resume.

### Project registry

- Projects are remembered in a registry at `~/.myforge/projects.json` (honoring
  `FORGE_HOME` / `XDG_CONFIG_HOME`).

### TypeScript client + loopback security

- The console client is plain TypeScript compiled with `tsc` (no bundler),
  served loopback-only, and state-changing POST endpoints require an
  `X-Forge-Token` header (a per-server random token embedded in the served HTML)
  to block cross-origin drive-by requests; file reads are path-traversal
  guarded.

### `forge-launcher engine-run` tees engine output to a log

- `forge-launcher engine-run` tees engine output to `docs/engine-run.log`, so a
  detached run is tail-able from the terminal and the console alike.

- See [ADR-034](adr/034-forge-console-web-ui.md).

---

## August 2026 - v3.30

### Branding: "Agent Forge" is now "MyForge"

- Rebranded the project from **McFuzzy Agent Forge** to **MyForge** across the
  README, `docs/`, `plan.md`, `AGENTS.md`, agent templates, and skill templates.
- Technical identifiers are unchanged: the `forge-*` package/CLI/skill names
  (`forge-launcher`, `forge-workflow-engine`, `forge-execution-adapter`,
  `forge-workforce-compiler`), `FORGE_*` environment variables, and the
  **FlowForge** kernel name all keep their existing names.
- The workforce compiler's default package ID root changed from
  `dev.agent-forge.*` to `dev.myforge.*` (for example
  `dev.myforge.my-project`), so freshly compiled workforce packages use the new
  branding. See `docs/adr/033-brand-rename-to-myforge.md`.

---

## August 2026 - v3.29

### Research/docs: Forge Console feature plan

- Added `docs/research/forge-console-desktop-frontend-plan.md`, a proposed plan
  for introducing a desktop/web front end for `forge-launcher` and
  `forge-workflow-engine`.
- The plan compares desktop-first vs. web-first approaches and recommends
  evolving the existing local Forge Board dashboard into a broader **Forge
  Console** first, then evaluating desktop packaging later.
- The phased roadmap covers MVP observability (status/tasks/logs/output), run
  controls (pause/stop/replay), artifact/history views, and optional desktop
  wrapping after adoption is validated.

---

## August 2026 - v3.28

### Workflow engine: same-owner task serialization under parallelism

- **Same-owner tasks never run concurrently.** With `--concurrency > 1`, the
  engine previously dispatched the whole ready frontier in parallel - including
  tasks owned by the same agent, which share a subsystem (project dir, build
  outputs, ports) and can collide even when the dependency graph sees them as
  independent (e.g. a port-`Address already in use` clash between an Edge
  scaffold task and an Edge build task).
- The wave dispatcher now keeps **at most one task per owning agent** per wave
  (`ownerUniqueReady`); same-owner tasks drain one per wave while cross-owner
  tasks still parallelize up to `--concurrency`. Sequential runs (`--concurrency
  1`) are unchanged. Unassigned tasks are bucketed together conservatively.
- This is a dispatch-layer guard; the manifest dependency graph and the
  responsibility matrix are untouched. Cross-owner tasks on shared paths (one
  task scaffolding a directory while another builds inside it) remain the
  operator's responsibility - a future file-overlap gate would close that.
- New tests: `ownerUniqueReady` (per-owner first-wins, unassigned bucketing,
  empty), same-owner serialization under concurrency 2, and different-owner
  concurrency under concurrency 2. See ADR-021 (amended).

### Execution-adapter: framework names no longer mistaken for expected outputs

- **`extractPaths` no longer treats framework/runtime names as file paths.**
  A PRD bullet like "Build **ASP.NET** Core minimal API …" previously declared
  `ASP.NET` as an expected output file, which can never exist on disk - so the
  engine's output-verification gate failed the task on **every** attempt (and
  each retry spawned a fresh identically-titled opencode session, looking like a
  collision). A `NON_PATH_DOTTED_TOKENS` blocklist (`asp.net`, `.net`, `dotnet`,
  `nuget`) now excludes these; real paths such as `src/HumanGateway.Core` are
  still extracted.
- Regression test added; recompiling a manifest drops the bogus `ASP.NET`
  expected output, so affected tasks pass the output gate on the next
  `replay`/`run`.

---

## August 2026 - v3.27

### Engine pause & stop (graceful), launcher config persistence

- **`workflow-engine stop`** (and a fixed `pause`) now actually stop a running
  detached engine. The engine polls `docs/engine-control.json` at the top of
  each task wave and writes its PID to `docs/engine.pid` at startup. `stop`
  writes a stop request **and** SIGTERMs the PID; Ctrl+C / SIGTERM on the engine
  process triggers the same graceful stop via an in-process flag. Either way the
  in-flight task finishes, state is saved as `paused`, and `run` resumes from the
  last completed task. Previously `pause` only flipped the state file and the
  loop never re-read it, so a live run could not be stopped.
- **`forge-launcher engine-run --stop` / `--pause`** request the same graceful
  stop/pause from the launcher (no manifest or recompile needed) - the terminal
  counterpart to `workflow-engine stop`.
- **`forge-launcher resume`** offers **"Stop the engine after the current task"**
  when it detects a live run, and its resume/monitor commands now reuse the last
  configured engine options instead of the minimal `--harness`-only command.
- **Engine options persist**: the launcher writes the menu choices
  (harness, granularity, concurrency, timeout, retries, viz, keep-alive, attach)
  to `docs/engine-config.json`; resume loads them (explicit env vars still win).
- New tests: control-file round-trip, stop-before-any-task, stop-mid-run after
  the current task, the SIGINT/SIGTERM flag path, launcher `--stop`/`--pause`
  delegation, resume carrying persisted config, and env-overrides-persisted.
  See ADR-032.

---

## August 2026 - v3.26

### Workflow engine: adaptive keep-alive default + timeout/retry surfacing

- **Keep-alive is now the adaptive default.** The opencode harness boots a warm
  `opencode serve` and attaches every task to it when **more than one task
  remains**, and cold-starts per task when ≤1 remains (short resumes don't pay a
  server boot). This replaces the previous all-cold-start default for multi-task
  dark runs (see ADR-027 for the keep-alive mechanics).
- **New escape hatches.** `--no-keep-alive` (or `FORGE_ENGINE_ATTACH=0`) forces
  cold start per task; `--keep-alive` / `FORGE_ENGINE_ATTACH=1` still force
  keep-alive; `--attach <url>` / `FORGE_ENGINE_ATTACH_URL` still reuse an
  existing server. Precedence: attach → no-keep-alive → keep-alive → adaptive.
- **Pre-run summary** now shows max retries, retry delay, concurrency, and the
  keep-alive mode (not just the per-task timeout).
- **Agents learn their execution budget.** `HarnessAdapter.invoke` now receives
  `maxRetries`, and the opencode/copilot adapters render an **Execution budget**
  hint (per-task timeout in seconds + retry count + "don't rely on retries to fix
  hollow output") in the task prompt.
- `forge-launcher engine-run` forwards `--no-keep-alive` (flag and
  `FORGE_ENGINE_ATTACH=0`).
- New tests: `shouldKeepAlive` precedence table, `remainingTaskCount` (fresh /
  complete / skipped / leftover-running), engine→harness `maxRetries` threading,
  and budget-hint rendering. See ADR-031.

---

## August 2026 - v3.25

### Launcher: "stop and resume later" checkpoints + post-team execution plan

- **Stop here and resume later.** After each launcher checkpoint - idea captured,
  PRD added/drafted, team generated, execution plan drafted, build configured -
  the interactive flow asks "Stop here and resume later?" and, when you say yes,
  prints `forge-launcher resume --repo "<path>"` and stops at the "where to pick
  up" summary. Pick the run back up any time with `forge-launcher resume`.
- **Post-team plan & validate step.** After the agent team is generated, the
  launcher now runs project-orchestrator (via `forge-orchestrate-build`, headless)
  with the prompt-playbook 5a prompt to produce the **execution plan** in
  `docs/PROGRESS.md`, commits it (`docs: add execution plan`), and stops for
  review before the build. It selects the monolithic vs. feature-based 5a prompt
  from the repo layout; if the headless run fails or writes no plan, it prints
  the manual `@project-orchestrator` command instead.
- Non-interactive auto-draft (`FORGE_AUTO_DRAFT=1`) runs the plan step
  automatically; stub mode writes a canned `docs/PROGRESS.md` so the flow is
  testable offline.
- Covered by new launcher tests (plan step + checkpoints are interactive-only,
  so non-interactive coverage asserts the plan doc, commit, and engine decision).
  Launcher suite green.

---

## August 2026 - v3.24

### Copilot harness selects the forge agent natively via `/agent`

The copilot adapter previously inlined every agent file into the `copilot -p`
prompt. The Copilot CLI supports an inline `/agent <name>` directive that loads
a repo agent natively - the same idea as opencode's `--agent <name>` (v3.21).

- **Native selection.** When the owning agent's file lives under the project's
  `.github/agents/` directory, the adapter now prepends `/agent <name>` to the
  prompt and lets Copilot load the persona itself; the persona is no longer
  inlined. For other harness roots (`.agents`, `.claude`, `.opencode`) Copilot
  cannot discover the agent files, so the inline-persona fallback is kept.
- **Shared escape hatch.** `FORGE_ENGINE_NATIVE_AGENT=0` forces the inline
  fallback on the copilot harness too (already supported by opencode).
- Covered by a new `harness/copilot-adapter.test.ts` (native, fallback, no-name,
  env-escape, and the execute-now directive). Engine suite green.

- [ADR-030](adr/030-copilot-native-agent-selection.md): copilot `/agent` selection.

---

## August 2026 - v3.23

### Workflow engine output verification gate (no more hollow "complete" runs)

A run could previously report **complete** with no code: every harness adapter
returned `success` on a zero-exit call, and the engine marked the task complete
without checking that anything was produced. A model replying "Ready for the
task." exited 0, the engine synthesized an artifact with `filesChanged: []` for
every task, and the run finished "successfully" with no solution.

- **Expected-output gate.** A task declaring `expectedOutputs` now requires every
  one to exist after the harness call. Missing → the attempt fails, retries, then
  the task is marked `failed` with the missing list.
- **No-op detection.** Tasks declaring no `expectedOutputs` must show evidence of
  work: a git working-tree diff before/after the call (engine-owned `docs/` files
  excluded) or a substantive agent response. "Ready for the task." with no file
  changes is a failed attempt, never a completion.
- **`--allow-noop` / `FORGE_ENGINE_ALLOW_NOOP=1`** relaxes the no-op heuristic
  (the expected-output check stays).
- **`--run-validation` / `FORGE_ENGINE_RUN_VALIDATION=1`** executes each task's
  manifest `validationCommands` (cwd = repo root) and requires them all to pass
  before the task completes. Tasks with validation are gated on it.
- **Hollow-run visibility.** The final summary and `status` flag tasks completed
  with no recorded output files; `forge-launcher resume` does too.
- **Prompt hardening.** Both the opencode and copilot adapters append an explicit
  "perform the task now, then list the files you changed" directive, so agents
  stop merely acknowledging tasks.
- **`FORGE_ENGINE_NATIVE_AGENT=0`** restores the pre-v3.21 opencode behavior
  (inline the persona instead of `--agent <name>`) for `.opencode/` harnesses.
- New `scripts/verify.ts` (gate + git-diff + validation runner) with unit tests;
  engine tests cover the gate, `--allow-noop`, and validation-command failure.
  Engine suite green; `forge-launcher engine-run` passes the new flags through.

- [ADR-029](adr/029-output-verification-gate.md): the engine's output-verification gate.

---

## August 2026 - v3.22

### Launcher as the single entry point: `forge-launcher resume`, review links, conditional in-harness command

The launcher becomes the one terminal on-ramp, and "when to use what" collapses
to a single mental model: **`forge-launcher` starts you, then you either drive
the build interactively in the harness (`@project-orchestrator`) or hand it to
the autonomous engine (`@workflow-orchestrator` / `forge-launcher engine-run`).**

- **`forge-launcher resume [--repo]`** - re-enters an existing project at its
  current stage (idea → PRD → team → build) as a full interactive wizard. It
  detects what's already drafted, prints where you are with clickable review
  links, and offers the right next action: capture an idea, auto-draft the PRD /
  team headlessly, resume a paused or failed engine run, tail logs, or open the
  harness CLI. `--non-interactive` prints the state plus the exact next commands
  to run. This covers the "walk away to review and make changes, come back
  later" gap in the previous linear 9-step flow.
- **Review links** - the review boundaries (drafted PRD, generated team) and the
  engine summary now emit OSC 8 terminal hyperlinks (Ctrl/Cmd+click to open the
  file), falling back to plain paths on non-TTY output.
- **Conditional in-harness command** - when the launcher opens the CLI (or prints
  next steps) and the agent team already exists, it now queues
  `/forge-orchestrate-build` (project-orchestrator) instead of
  `/forge-auto-build`, honouring "in the harness = project-orchestrator". When
  no team exists yet it keeps queueing `/forge-auto-build` (which generates the
  team in-chat); headless runs keep using `/forge-auto-build` as the terminal
  fast-path.
- **`forge-auto-build` demoted, not removed** - it stays installed but is
  repositioned as the **terminal/headless fast-path** (launcher-driven,
  `opencode run --auto`), explicitly *not* the in-harness entry point. The
  `project-orchestrator` and `workflow-orchestrator` agents now document their
  in-harness roles and the launcher's `engine-run` / `resume` as the canonical
  terminal entry.
- **When to use what:**
  - New project → `forge-launcher` (terminal).
  - In the harness, interactive build → `@project-orchestrator`.
  - Autonomous build → `forge-launcher engine-run` or `@workflow-orchestrator`.
  - Lost your place → `forge-launcher resume`.
  - Authoring only → `/forge-build-prd`, `/forge-auto-build-prd`,
    `/forge-build-agent-team`.
- New tests: `resume.test.ts` (state detection + next-action branches) and
  conditional-queue coverage in `launcher.test.ts`; `format.test.ts` covers the
  OSC 8 `hyperlink` helper. Launcher suite green.

- [ADR-028](adr/028-launcher-entry-resume-and-auto-build-demotion.md): entry-point
  consolidation, `forge-launcher resume`, and the `forge-auto-build` demotion.

---

## August 2026 - v3.21

### OpenCode harness selects the forge agent natively

`opencode run` supports an `--agent <name>` flag, but the workflow engine's
opencode adapter never passed it - every task ran under opencode's **default
agent**, with the forge persona inlined into the prompt. Session lists in
opencode showed default "build" sessions instead of the forge agents
(`discovery-engineer`, `qa-engineer`, …).

- **`--agent` when possible.** When the owning agent's file lives under the
  project's `.opencode/agents/` directory, `OpenCodeAdapter` now passes
  `--agent <name>` and lets opencode load the persona itself. The persona is no
  longer inlined into the prompt, so sessions are attributed to the real forge
  agent and per-task prompts carry no duplicated system text.
- **Graceful fallback.** For other harness roots (`.agents`, `.claude`,
  `.github`) opencode cannot discover the agent files, so the adapter keeps the
  previous inline-persona behavior and passes no `--agent`.
- Covered by new adapter tests (`opencode-adapter.test.ts`) asserting the
  `.opencode` vs non-`.opencode` split and the no-name case.

---

## August 2026 - v3.20

### Generated-team frontmatter quoting guard

Auto-drafted teams could break the build: `forge-build-agent-team` generated
`description:` frontmatter without quotes, and LLM prose routinely contains
`: ` (colon-space), which YAML treats as a nested mapping. `gray-matter` - used
by `forge-execution-adapter compile` to parse every agent/skill file - then
threw, the manifest was never written, and the engine failed with a confusing
"EXECUTION-MANIFEST.json not found".

- **Always-quoted templates.** `forge-build-agent-team`'s agent and skill
  templates now mandate double-quoted `description:` values, with a Gotcha
  explaining the `: ` footgun.
- **Mechanical gate.** A new dependency-free
  `forge-build-agent-team/scripts/validate-frontmatter.mjs` scans the harness
  agents/skills (the same files the adapter parses) and fails deterministically
  on unquoted `: ` values, `#` inside an unquoted value, missing `name` /
  `description`, or unterminated frontmatter. Step 7 of the skill now requires
  it to pass instead of relying on self-report.
- **Clear compile errors.** `forge-execution-adapter` discovery wraps frontmatter
  parsing and rethrows `Invalid YAML frontmatter in <path>: <message> - hint:
  wrap description values in double quotes`, naming the offending file instead
  of a bare js-yaml error.
- **Launcher fail-fast.** `forge-launcher engine-run` aborts immediately when the
  manifest compile exits non-zero (surfacing the compile output) instead of
  continuing to a misleading "manifest not found".
- **Tests.** Adapter suite 17, launcher suite 40, engine suite 25 - all green;
  the validator was exercised against a clean team and a deliberately broken
  fixture.

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
  never leaks into the next - the server only keeps the shared project instance
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
  mode - server lifecycle, session isolation, and auth/health-probe handling.

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
  `Failed to run '<cmd>': … - is it installed and on PATH?` instead of a cryptic
  ENOENT. The terminal auto-launch code also gets correct PATH detection
  (`;`-delimited, `.exe`/`.cmd`/`.bat`) and Windows Terminal detection via
  `WT_SESSION`.
- **Friendlier pre-publish install guidance.** The README and
  `docs/forge-launcher.md` document a simple local install
  (`npm install` → `npm pack` → `npm install -g <tarball>`), a dev symlink
  (`npm link`), and the matching uninstall/unlink cleanup - no temp-workspace
  ceremony for day-to-day testing.
- **Update check.** On startup, `forge-launcher` checks the npm registry once a
  day (honoring the configured registry, so a local Verdaccio works) and prints
  a notice when a newer version exists - prereleases check the `beta` tag,
  releases check `latest`. The result is cached in a user-level file, the
  fetch is timeout-bounded and fails silently offline, and it can be disabled
  with `--no-update-check` or `FORGE_SKIP_UPDATE_CHECK=1` (also skipped in CI).

### Cross-platform `forge-workflow-engine` fixes

The workflow engine (the separate package bootstrapped into target repos) had
the same Windows blind spot as the launcher:

- **Engine tasks spawn correctly on Windows.** The engine's per-task harness
  (`opencode`, `copilot`, and flowforge-kernel adapters) now spawns through
  `cross-spawn`, resolving npm-installed `.cmd`/`.bat` shims - so `opencode run`
  tasks no longer fail with `spawn opencode ENOENT` during an engine run.
- **The Forge Board dashboard renders and connects.** The vendored PixiJS v8
  build exposes the `PIXI` global, but `app.js` referenced `Pixi`, so the
  dashboard script aborted with `ReferenceError: Pixi is not defined` before
  opening the SSE connection. `index.html` now normalizes the global
  (`window.Pixi = window.PIXI || window.Pixi`), so the board renders and the
  dashboard connects.
- **Kanban dashboard theme.** The oak-tree-and-squirrel metaphor is gone. The
  build now renders as a **kanban board** - renamed **The Forge Board** - one
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
  with a mouth that reacts - neutral, working, smiling on complete, frowning on
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

- [ADR-026](adr/026-forge-board-kanban-dashboard.md): the Forge Board - kanban
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
  agents (generated agents that own no task) - mirroring
  `forge-build-agent-team` Step 7 - surfacing any findings as manifest warnings.
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
  with `npx forge-launcher` - no forge clone needed (templates are bundled as
  resources).
- **Interactive TUI.** All prompts use `@clack/prompts` - `select` menus
  (harness, PRD, engine decision), `confirm`, `text`, `multiline` (Enter-twice
  submits), and an autocomplete path picker - with a readline fallback for
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
  runs in the **target repository** - `opencode run` resolves its project
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
  `dist/cli.ts` - a file that does not exist when running the compiled package -
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
- Added **context projection**: before each task is dispatched, the engine resolves the task's declared `inputs`, fetches the relevant artifacts from the store, and builds a minimal markdown `contextBlock` that replaces the full workflow state in the agent prompt - dramatically reducing per-task token consumption.
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

- [ADR-011](adr/011-forge-execution-adapter.md): Adapter architecture, MVP scope, and rationale for keeping the bridge separate from MyForge authoring.

---

## August 2026 - v3.2

### Forge Launcher - interactive CLI for the full lifecycle

- `forge-launcher` (`scripts/forge-launcher.sh` and `scripts/forge-launcher.ps1`): one terminal command guides users from zero to auto-build by creating a repo, selecting a harness, bootstrapping MyForge, capturing project idea context, committing, and optionally spawning the harness CLI.
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
