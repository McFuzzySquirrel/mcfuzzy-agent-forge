# Scoping: Hermes Agent as a MyForge harness, and MyForge inside Hermes

**Date:** 2026-09-26
**Status:** Research only. No decision made. See
[ADR-053](../adr/053-hermes-integration-evaluation.md) (Proposed).
**Subject:** [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent),
MIT, Python.
**Version surveyed:** `v0.21.5`, tag `v2026.9.24`, published 2026-09-24 (commit
`f97608f`).

## Summary

Hermes is not a harness in the forge's sense of the word. The forge's
`HarnessAdapter` contract
(`templates/skills/forge-workflow-engine/scripts/types.ts:114-123`) is a
transport that executes **one task per subprocess call** and returns a
`TaskResult`. Hermes is a full agent runtime with its own gateway, memory,
skills, cron, profiles, subagent delegation, and a durable task board.

That mismatch is the whole finding, and it means "add Hermes as a harness" and
"use Hermes as the runtime" are different projects with different costs. This
document maps five integration depths, prices the gaps in each, and defines
spikes that can kill the expensive ones before they are built.

**Recommendation: do not start with the harness adapter.** Spike the cheapest
depth first; it either validates or kills the direction in one evening at
effectively zero forge code cost.

## Verification method

Hermes ships 15,075 files and moves fast. Claims below were checked against a
blobless clone at tag `v2026.9.24`, not against third-party articles. This
matters: public coverage of Hermes is largely low-quality generated content
that quotes v0.9.0, v0.14.0, v0.18.2, and v0.21.5 all as "current", and reports
star counts that change between two searches in the same session. Where a claim
is inferred rather than read in source, it is marked **[inference]**.

## What Hermes is

Verified from the repository at the surveyed tag.

| Property | Value |
|---|---|
| License | MIT |
| Language | Python (Node/TypeScript TUI, Rust rewrite exists separately) |
| Latest release | `v0.21.5` (`v2026.9.24`), 2026-09-24 |
| Repository activity | last push 2026-09-26; v0.21.5 rolled up **460 PRs / 1,610 non-merge commits / +164,132 −149,440 lines in nine days** |
| Open issues | ~43,631 |

Capabilities relevant here:

- **Messaging gateway.** One process fronts Telegram, Discord, Slack, WhatsApp,
  Signal, Matrix, Mattermost, DingTalk, Feishu, WeCom, Weixin, iMessage via
  BlueBubbles, Email, SMS, Home Assistant, Line, SimpleX, QQBot, and a generic
  webhook adapter, routing all of them into a single `AIAgent` conversation
  loop (`gateway/run.py`).
- **Profiles.** A profile is a separate `HERMES_HOME` with its own `config.yaml`,
  `.env`, `SOUL.md`, skills, memories, sessions, cron, and `state.db`. Each gets
  a command alias (`hermes profile create coder` → `coder chat`).
- **Skills.** agentskills.io-compatible `SKILL.md`, same format the forge
  already ships.
- **Kanban.** A SQLite-backed board shared across profiles, with a
  cycle-checked dependency DAG, per-task git worktrees, claim leases, an event
  log, and a dispatcher that spawns workers as headless subprocesses.
- **Terminal backends.** `local`, `docker`, `ssh`, `singularity`, `modal`,
  `daytona`, `vercel_sandbox`.
- **Pluggability.** `register(ctx)` for tools, commands, hooks, platforms;
  model-provider plugins for external processes; ACP server; an OpenAI-compatible
  API server.

## The forge side: what "harness" means here

Recorded so the comparison is not read as two similar things.

`HarnessAdapter` (`types.ts:114-123`) is five members —
`prepare?`, `cleanup?`, `invoke`, plus `name`, `supportsConcurrency`,
`capabilities`, `defaultModel`. The engine owns scheduling, preflight, request
construction, verification, retries, and durability; the transport owns wire
formatting, model-ID translation, process execution, and run-resource cleanup
(ADR-040).

All four implementations are registered by a hardcoded switch, not plugin
discovery (`scripts/cli.ts:172-185`): `opencode` (`opencode run`), `copilot`
(`copilot -p --yolo`), `claude` (`claude -p --output-format json
--permission-mode bypassPermissions`), `openai` (an HTTP `POST`), and `stub`.
Every CLI adapter funnels through one primitive, `runCommand()`
(`scripts/harness/run.ts:57-222`).

Two consequences the forge already lives with:

- **`canSelectAgentNatively` has a hardcoded three-member root union**
  (`run.ts:251-260`: `.github`, `.claude`, `.opencode`). A new harness with its
  own agents directory is a compile error until that signature is widened.
- **`--concurrency` is inert.** It is parsed and persisted, but the wave loop is
  a serial `for` (`engine.ts:769-794`) because output attribution compares
  repo-wide git worktree snapshots (`engine.ts:725-727`). The deep dive names
  task sandboxing or per-task diff isolation as the prerequisite for making it
  real (`docs/workflow-engine-deep-dive.md:587`).

## The five integration depths

Ordered by cost. "Forge code" is the estimate for the adapter itself, excluding
the verification layer at L4.

| Depth | Shape | Forge code | Primary value |
|---|---|---|---|
| **L0** | Hermes reads the forge's skills; its terminal tool calls `forge-launcher` | ~0 (symlink) | Messaging over a real build |
| **L1** | Hermes cron polls `PROGRESS.md` and reports state | ~0 | Remote build visibility with no push channel |
| **L2** | `hermes-adapter.ts` calling `chat -q --format stream-json` | ~200 LOC | Hermes as a 4th execution backend |
| **L3** | Forge registered as a Hermes `model-provider` plugin | ~1 week | Hermes's agent loop driven by the forge's engine |
| **L4** | Manifest compiler emits kanban cards; forge gates become a lifecycle hook | ~3–4 weeks | Hermes as the execution substrate |

### L0 / L1 — the communication win, at near-zero cost

This is where the value the request describes ("being able to communicate")
actually lives, and it is the cheapest thing on the list.

Hermes skills are agentskills.io `SKILL.md` with `name` + `description`
frontmatter (`agent/skill_utils.py:105-125`), which is exactly what the forge
emits. The 18 skills under `templates/skills/` are format-compatible as-is.

**One wrinkle.** Project skill discovery is limited to `.hermes/skills` and
`.agents/skills` (`agent/skill_utils.py:437`, `PROJECT_SKILLS_SUBDIRS`), and
project skills additionally require `hermes skills trust` — a persistent config
write, and a `skills_guard` scan that can **quarantine** a skill on a
"dangerous" verdict (`skill_utils.py:476-484`, `:535-549`). The forge's
`<root>/skills/` layout is not auto-discovered. Options, in order of preference:
a `.hermes/skills` symlink to the repo's `skills/`, or `skills.external_dirs` in
the profile's `config.yaml`.

L1 needs no outbound channel from the forge because the forge emits **nothing**
network-facing today: no webhooks, no notifications, no push. A Hermes cron job
reading `PROGRESS.md` is sufficient and requires no forge change.

### L2 — harness adapter: feasible, and lower value than it looks

`hermes_cli/stream_json.py` is a genuine Claude-Code-shaped transport: one JSON
object per stdout line, flushed, with a terminal `{"type":"result"}` envelope
carrying `exit_code`, `text`, and token stats. `tool_progress_callback` is live
in that path (`cli_single_query.py:469-489`). This is the strongest fit in the
whole repository.

The adapter would follow ADR-042's recipe exactly — new
`harness/hermes-adapter.ts`, a `case "hermes"` in `cli.ts:172-185`, a static
import, and the `harness-rules.ts` enum on the launcher side.

Verified traps, all of which shape the design:

- **`hermes -z` is the wrong surface.** It has unbounded tool-calling
  iterations (no `max_iterations` is passed — `oneshot.py:574-594`) and no JSON
  on stdout. Use `hermes chat -q "<prompt>" --format stream-json`.
- **One-shot always writes `state.db` and memory**, with no disable switch
  (`oneshot.py:524`; `run_agent.py:347-377`). A **per-task `HERMES_HOME` is
  mandatory** — not optional — because two writers on one home compound each
  other's memory, which Hermes' own docs warn about explicitly.
- **No hard timeout or process-group kill.** `--run-budget` is a soft budget
  that emits a wrap-up notice; it does not terminate. The adapter must implement
  the kill itself, exactly as it already does for `claude -p`. This is not
  Hermes-specific, but it is the forge's job, not Hermes's.
- **Approvals block by default.** `approvals.single_query_mode` defaults to
  `deny` (`approval_context.py:281-298`), so `chat -q` silently blocks dangerous
  commands unless `HERMES_YOLO_MODE=1` is set **in the subprocess environment**
  (it is frozen at import — `approval.py:45`).
- **`-q` on a TTY seeds an interactive session** rather than exiting
  (`cli.py:847-854`). `--format stream-json` forces quiet and avoids the
  ambiguity.

Net assessment: **Hermes is a heavier execution backend than what the forge
already has.** L2's real value is that it is the prerequisite for L3 and L4, not
that it improves execution quality.

### L3 — forge as Hermes's brain

`providers/base.py:105-114` supports `auth_type="external_process"` with
`process_command`, `process_args`, and a custom `create_client()`. The
copilot-acp provider's own docstring states that an out-of-tree provider "uses
the same three lines without touching core"
(`plugins/model-providers/copilot-acp/__init__.py:1-6`). The forge's engine can
therefore be registered as a Hermes model provider.

The simpler alternative is to skip the plugin entirely and expose
`/v1/chat/completions` from the engine, which Hermes consumes as a stock custom
endpoint.

**The risk is circularity, and it is structural.** Hermes would believe it is
calling a model while the engine dispatches to opencode/claude — two
orchestrators with overlapping authority. The spike must fix where the boundary
sits before any code exists.

### L4 — Hermes as the execution substrate: the real prize, and the real cost

What the forge would gain, which its flat-file design cannot cheaply provide:

- A **durable ACID store**: `tasks` / `task_runs` / `task_events` / `task_links`
  in SQLite with `WAL` + `BEGIN IMMEDIATE` + `synchronous=FULL`
  (`kanban_db.py:867-1075`, `kanban_db_connect.py:644-661`), replacing
  `WORKFLOW-STATE.json` + `EXECUTION-AUDIT.jsonl` + `PROGRESS.md`.
- A **real, cycle-checked DAG**, enforced at promotion, at claim, *and* at
  completion (`_parents_satisfied`, `recompute_ready`, `_claim_and_open_run`,
  and a completion-time re-check "even for human review approval" —
  `kanban_db.py:2746-2766`).
- **Concurrency-safe git worktrees** with a hard guarantee that no two sibling
  tasks share a checkout (`kanban_db_graph.py:176-182`, `:507-517`).
- **An execution model that is already the forge's**: the dispatcher spawns
  `hermes -p <profile> --cli --accept-hooks chat -q "work kanban task t_…"` —
  one headless subprocess per task, stateless agent, per-task model, provider,
  reasoning, and skills overrides (`kanban_db_dispatch.py:2676-2711`).
- **Better failure semantics.** Exit-code classification separates rate limiting
  (`75`, which never counts against the retry budget) from terminal provider
  faults (`78`, which trips the circuit breaker on first occurrence)
  (`kanban_db_dispatch.py:249-258`), with PID-plus-start-time fingerprints so a
  recycled PID is never mistaken for a live worker.

**What the forge would have to build.** This is the integration cost, and the
first item dominates:

1. **A verification layer.** Hermes has no output-correctness story.
   `agent/verification_evidence.py:1-6` states it "never runs a suite, never
   blocks completion". There is no `validationCommands` equivalent and no
   `expectedOutputs` manifest; the artifact check applies only to files a worker
   chose to declare. The lifecycle hook fires *after* commit, so a hook is a
   post-hoc veto rather than a pre-completion gate — the spike must measure
   whether that latency and ordering is usable.
2. **A phases layer.** No first-class phase entity exists; only two reserved v2
   columns that the v1 kernel ignores (`kanban_db.py` schema comments).
3. **An approval gate.** There is no `approvalRequired` field — grep across all
   `kanban*.py` returns zero matches. Model it as `blocked(kind="needs_input")`
   or `review` with `kanban.review_dispatch: false`.
4. **A `forge-result` parser.** The handoff is prose plus free-form JSON; nothing
   validates its shape.
5. **A work-push path.** There is no `POST /v1/kanban/tasks`; the engine would
   shell out to `hermes kanban create --parent …` per task or build a shim.
6. **Explicit concurrency config.** See risks below.

**The strategic read:** if the forge's differentiator is the *validated* DAG,
then Hermes supplies the durable DAG and the execution substrate but not the
validation. That gap is the moat, and it is also the cost.

## Containers

### Hermes supports podman, first-class

`tools/environments/docker.py:213-237` resolves the container CLI as
`HERMES_DOCKER_BINARY` → `docker` → `podman`, and `runtime_label()` reports
which is in use. Rootless-Podman handling exists in `docker/stage2-hook.sh`, the
setup wizard names the resolved runtime, and `nix/nixosModules.nix` ships podman
in the service package. Setting `TERMINAL_ENV=docker` containerizes the agent's
tool calls.

### The boundary depends on depth — this must not be glossed over

`TERMINAL_ENV=docker` only contains processes the agent's own terminal tool
spawns. That is a different boundary at each depth:

| Depth | What the container contains | What stays on the host |
|---|---|---|
| **L0/L1** | Everything transitively — but only if the image carries node, git, the repo, and the forge's toolchain | Nothing, at the cost of a heavy image |
| **L2** | Only the agent's tool calls | The engine itself, its git worktree snapshots, its `expectedOutputs` checks, its auto-commits |
| **L4** | The worker's tool calls | The dispatcher, the worktree host-path, the parent repo |

At L2 and L4 the engine runs unconfined on the host. That is a defensible
boundary, but it is **not** "the forge is containerized", and any plan that
implies otherwise is wrong.

Two configuration facts:

- `terminal.docker_mount_cwd_to_workspace` **defaults to `false`**
  (`cli-config.yaml.example:417`). Without enabling it the worker sees no code
  at all — a silent, confusing failure.
- Under L4 the mount must be the **worktree** path, not the repo root, so the
  image needs `git` plus whatever the target repo's build requires.

### Forge-native containerization was considered and deferred

`runCommand()` (`harness/run.ts:57-222`) is the single choke point all three CLI
adapters pass through, so one `podman run --rm -v <repo>:/workspace -w
/workspace <image> …` wrapper would sandbox every harness at once (the OpenAI
adapter uses `fetch` and is unaffected). That is a clean, well-scoped change and
it is the prerequisite for making `--concurrency` real.

**It is explicitly out of scope for this effort**, per the decision to keep
isolation inside the Hermes integration. It is recorded here because it is the
better long-term answer, and because leaving it out means the concurrency
roadmap stays blocked.

## Risks

- **Upstream velocity is the dominant integration risk.** 460 PRs and +164k
  lines in nine days, ~43k open issues. Any adoption must pin a tag and treat
  upgrades as a deliberate, tested chore. [inference: the practical upgrade
  window is likely measured in weeks, not months, given this rate.]
- **Silent plugin loss on update.** All profiles share **one** managed venv.
  `hermes update` rebuilds it from the lock and reinstalls per-profile plugin
  dependencies; if the union stops resolving, non-memory plugins are dropped one
  at a time with a warning (`website/docs/developer-guide/plugins/index.md:351-372`).
  Conflicting plugin dependencies force `python_runtime: external` sidecars. For
  a long-lived deployment this is an operational hazard.
- **SQLite WAL corrupts silently over podman bind mounts.**
  `hermes_state_wal.py` refuses WAL across the VM boundary because shared memory
  is not coherent. Any `state.db` or `kanban.db` must live **off** a bind mount.
  This is a silent failure mode, not a loud one.
- **Kanban is single-host only.** `~/.hermes/kanban.db` is local SQLite, the
  dispatcher spawns workers on the same machine, and crash detection assumes
  host-local PIDs (`features/kanban.md:1433`). Podman-per-worker on one host is
  fine; a board cannot be distributed across machines.
- **The derived concurrency cap under-counts real workloads.**
  `MEMORY_GUARD_MB_PER_WORKER = 512` with a floor of 2 and a ceiling of 8
  (`kanban_db_dispatch.py:1776-1812`). Agents running compilers, test runners,
  and bundlers will exceed 512 MB comfortably. Set `max_in_progress` and
  `max_in_progress_per_profile` explicitly rather than trusting the default.
- **No retry backoff.** A quota-exhausted task is retried on a fixed cooldown
  forever, never backing off and never giving up — a deliberate trade-off, but
  different from the forge's bounded retry with delay.
- **Profiles do not sandbox.** Stated plainly in `features/profiles.md`: "A
  profile gives Hermes its own state directory… A sandbox is what limits
  filesystem access. Profiles do not sandbox the agent."

## Open questions

Recorded rather than guessed, for team resolution.

1. **Windows and CI.** The forge's validation workflow runs ubuntu *and* windows
   (`.github/workflows/validation.yml:14-20`). Podman is linux-only. Does
   container isolation stay optional, with the uncontainerized path as
   first-class? Or is a stated reduction in portability acceptable? This
   constrains any forge-side container work and any L4 adoption.
2. **Version pin policy.** Which tag, and what is the upgrade cadence?
3. **Which depth is the ceiling worth building?** L0+L1 is cheap and safe; L4 is
   expensive and may be foreclosed by question 1.
4. **Where does the L3 boundary sit?** Two orchestrators with overlapping
   authority is the failure mode to design against.
5. **Is the forge's engine, or only its artifacts, the thing Hermes should
   drive?** Shipping a manifest-compiler-only integration would be far cheaper
   than shipping the engine and would sidestep most of the circularity risk.

## Spikes

Each is designed to be killable. A cheap experiment that fails is worth more
than an expensive one that succeeds.

| ID | Depth | Question | Pass criterion | Cost |
|---|---|---|---|---|
| **S0** | L0 | Can a real build be driven from Telegram? | A build is startable and its state readable from a messaging app | Evening, ~0 forge code |
| **S1** | L2 | Can Hermes execute a real forge task? | ≥2 tasks complete with `expectedOutputs` landing on disk | 1 day, throwaway |
| **S2** | L4 | Can a hook enforce the completion gates? | A deliberately failing `validationCommands` prevents completion | 2 days — **the decision gate** |
| **S3** | L3 | Can Hermes's loop drive the engine? | Hermes's agent loop drives the engine as its brain | Half day, after S1 |
| **S4** | any | Does isolation actually *contain* a task? | An escape attempt outside the mount fails, in the regime that will be used | 1 day, after the depth is chosen |

Sequencing: **S0 → S1 → S2 → (S3 ∥ S4)**. S2 is the fork. If the post-hoc veto
proves unusable, L4 is foreclosed as a *replacement* and the ceiling becomes
L3 + L0/L1. S4 deliberately does not test that podman works — that is already
verified — but that it contains a real task in the chosen regime.

## What was ruled out

- **The OpenAI-compatible API server as a task transport.** It needs a
  long-lived gateway (breaking "one batch subprocess per task"), has **no
  per-request working directory**, no exit code, and no per-request hard
  timeout. Viable for dashboards and third-party chat frontends; not viable as
  an adapter transport.
- **ACP as a task transport.** Hermes's ACP server is complete and first-class,
  but it is a long-lived stdio JSON-RPC server, not a batch call. The reverse
  direction (Hermes driving an ACP agent) exists only for GitHub Copilot and is
  hardcoded, with no general API.
- **Hermes's `-w` worktree flag from an adapter.** It parses but is silently
  ignored on the one-shot path, mutates the user's repo (branch, `.gitignore`,
  `.worktrees/`), and costs ~120s of git I/O. Create worktrees with plain `git
  worktree add` and pass the path via `--in` or subprocess `cwd`.

## References

- [ADR-053](../adr/053-hermes-integration-evaluation.md)
- [ADR-040](../adr/040-native-adapter-contracts.md) — adapter request and
  lifecycle contracts
- [ADR-042](../adr/042-claude-code-execution-harness.md) — the recipe a Hermes
  adapter would follow
- `docs/workflow-engine-deep-dive.md` — engine internals, including the
  concurrency and sandboxing gap
- `docs/documentation-map.md` — documentation authority and update triggers
