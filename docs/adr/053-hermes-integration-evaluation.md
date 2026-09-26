# ADR-053: Hermes Agent integration evaluation

- **Status:** Proposed
- **Date:** 2026-09-26

No decision has been made and no forge behavior changes with this record. It
establishes the evaluation frame, the five candidate integration depths, the
spike gates that would settle the choice, and the open questions the team must
resolve before any of it is built.

Evidence and citations live in
[`docs/research/hermes-agent-integration.md`](../research/hermes-agent-integration.md).

## Context

The forge's `HarnessAdapter` contract
(`templates/skills/forge-workflow-engine/scripts/types.ts:114-123`) is a
transport that executes **one task per subprocess call** and returns a
`TaskResult`. Four are registered today — `opencode`, `copilot`, `claude`, and an
HTTP `openai` — selected by a hardcoded switch (`scripts/cli.ts:172-185`), with
all three CLI adapters funneling through the single primitive `runCommand()`
(`scripts/harness/run.ts:57-222`).

[Hermes Agent](https://github.com/NousResearch/hermes-agent) (Nous Research,
MIT, Python; surveyed at `v0.21.5` / `v2026.9.24`) was proposed as a harness
for the forge. The proposal is attractive because Hermes fronts ~20 messaging
platforms from a single gateway process, keeps durable cross-session memory, and
runs a multi-profile agent board with a dependency DAG and per-task git
worktrees.

Those are not harness capabilities. Hermes is a full agent runtime with its own
gateway, memory, skills, cron, profiles, subagent delegation, and task board. The
mismatch between "transport that runs one task" and "autonomous runtime" is the
central fact of this evaluation: it means the request contains several distinct
projects with very different costs, and the cheapest of them is not the one
literally named.

The forge also has no execution isolation of any kind. `--concurrency` is parsed
and persisted but functionally inert, because the wave loop is serial
(`engine.ts:769-794`) and output attribution compares repo-wide git worktree
snapshots (`engine.ts:725-727`). The engine deep dive names task sandboxing or
per-task diff isolation as the prerequisite for making concurrency real
(`docs/workflow-engine-deep-dive.md:587`).

## Decision

**Defer. Adopt no integration depth yet, and gate the choice behind spikes.**

The five candidate depths, cheapest first:

| Depth | Shape | Forge code | Primary value |
|---|---|---|---|
| **L0** | Hermes reads the forge's skills; its terminal tool calls `forge-launcher` | ~0 | Messaging over a real build |
| **L1** | Hermes cron polls `PROGRESS.md` and reports state | ~0 | Remote build visibility, no push channel needed |
| **L2** | `hermes-adapter.ts` calling `chat -q --format stream-json` | ~200 LOC | Hermes as a 4th execution backend |
| **L3** | Forge registered as a Hermes `model-provider` plugin | ~1 week | Hermes's loop driven by the forge's engine |
| **L4** | Manifest compiler emits kanban cards; forge gates become a lifecycle hook | ~3–4 weeks | Hermes as the execution substrate |

Two decisions are recorded now, independent of which depth is eventually chosen:

**Containers stay on the Hermes side.** Isolation is to be obtained through
Hermes' own `TERMINAL_ENV=docker` support rather than a new forge-side
container layer, because podman is already first-class in Hermes
(`tools/environments/docker.py:213-237` resolves `HERMES_DOCKER_BINARY` →
`docker` → `podman`).

The boundary this actually produces must be stated honestly rather than
summarized as "the forge is containerized":

| Depth | Container contains | Stays on the host |
|---|---|---|
| L0/L1 | Everything transitively, if the image carries node, git, the repo, and the forge toolchain | Nothing, at the cost of a heavy image |
| L2 | Only the agent's tool calls | The engine, its git snapshots, its `expectedOutputs` checks, its auto-commits |
| L4 | The worker's tool calls | The dispatcher, the worktree host-path, the parent repo |

This leaves the better long-term answer — a `podman run` wrapper at the
`runCommand()` choke point, which would sandbox every CLI harness at once and
unblock real concurrency — explicitly out of scope, with the concurrency roadmap
consequently still blocked.

**Spikes gate the expensive depths.** Sequencing is S0 → S1 → S2 → (S3 ∥ S4):

- **S0 (L0, evening, ~0 forge code)** — can a real build be started and its
  state read from a messaging app? *Pass:* yes.
- **S1 (L2, 1 day)** — can Hermes execute a real forge task? *Pass:* at least
  two tasks complete with `expectedOutputs` on disk.
- **S2 (L4, 2 days) — the decision gate.** — can a lifecycle hook enforce the
  completion gates? *Pass:* a deliberately failing `validationCommands` entry
  actually prevents completion.
- **S3 (L3, half day, after S1)** — can Hermes's agent loop drive the engine?
- **S4 (1 day, after a depth is chosen)** — does isolation actually *contain* a
  task? Deliberately not "does podman work" — that is already verified — but
  does an escape attempt outside the mount fail, in the regime that will be
  used?

S2 is the fork. Hermes has no output-correctness story:
`agent/verification_evidence.py:1-6` states its evidence ledger "never runs a
suite, never blocks completion", and there is no `validationCommands`
equivalent, no `expectedOutputs` manifest, and no declarative
`approvalRequired` field. Hermes's lifecycle hook fires *after* commit, so it is a
post-hoc veto rather than a pre-completion gate. If that ordering proves
unusable, L4 is foreclosed as a *replacement* and the ceiling becomes L3 with
L0/L1.

## Consequences

- **No forge behavior changes.** `docs/updates.md` and the README's
  `**Latest:**` line are untouched, because the changelog records user-visible
  change and this is research. That trigger fires if any depth ships.
- **The recommendation is to start at L0, not L2.** The stated motivation was
  communication, and L0/L1 capture nearly all of that value at effectively zero
  forge code. L2 is worth building mainly because it is the prerequisite for L3
  and L4 — not because Hermes is a better execution backend. It is heavier than
  what the forge already has: a Python runtime and managed venv cold start, a
  per-task `state.db` write, and no hard timeout of its own.
- **If L2 is ever built, three verified constraints shape it.** `hermes -z` must
  not be used (unbounded tool iterations, no JSON on stdout) — `chat -q
  --format stream-json` is the correct surface. A per-task `HERMES_HOME` is
  mandatory, not optional, because one-shot always writes `state.db` and memory
  with no disable switch. And `HERMES_YOLO_MODE=1` must be set in the subprocess
  environment, because `approvals.single_query_mode` defaults to `deny`. Adding
  a Hermes agents directory would additionally require widening the hardcoded
  three-member root union in `canSelectAgentNatively` (`run.ts:251-260`).
- **If L4 is ever built, the verification layer is the cost.** The manifest
  compiler, a phases layer, an approval model, a `forge-result` parser, and a
  work-push path (`hermes kanban create --parent …`; there is no
  `POST /v1/kanban/tasks`) all have to be written. Durable state, a
  cycle-checked DAG, and concurrency-safe worktrees are what the forge gets in
  exchange.
- **Operational hazards are recorded, not solved.** Any adoption must pin a tag:
  v0.21.5 absorbed 460 PRs and +164,132 lines in nine days. Profiles share one
  managed venv, so `hermes update` can silently disable plugins whose dependency
  union stops resolving. SQLite WAL corrupts *silently* over podman bind mounts,
  so any `state.db` or `kanban.db` must live off a bind mount. Kanban is
  single-host only, so a board cannot be distributed across machines. The
  derived concurrency cap assumes 512 MB per worker, which under-counts real
  build and test workloads, so `max_in_progress` must be set explicitly.
- **Documentation obligations are deferred, not waived.** If a depth ships, the
  update set mandated by `docs/documentation-map.md` applies: `docs/
  workflow-engine.md`, `docs/workflow-engine-deep-dive.md`, the workflow-engine
  and execution-adapter `SKILL.md` files, `docs/forge-launcher.md` ("supported
  harnesses" changes), a new ADR superseding this one, plus `docs/updates.md`
  and the README's `**Latest:**` line.

## Open questions

Unresolved, and for the team rather than for this record.

1. **Windows and CI.** Validation runs on ubuntu *and* windows
   (`.github/workflows/validation.yml:14-20`) while podman is linux-only. Does
   container isolation remain optional with the uncontainerized path as
   first-class, or is a stated reduction in portability acceptable? This
   constrains L4 adoption and any future forge-side container work.
2. **Version pin policy.** Which tag, and at what upgrade cadence?
3. **Which depth is the ceiling worth building?** L0+L1 is cheap and safe; L4 is
   expensive and may be foreclosed by question 1.
4. **Where does the L3 boundary sit?** Hermes treating the engine as its model
   means two orchestrators with overlapping authority. That failure mode has to
   be designed against before, not after, any code exists.
5. **Engine or artifacts?** Driving only the manifest compiler would be far
   cheaper than driving the engine, and would sidestep most of the circularity
   risk in question 4.

## Alternatives considered

- **Adopt Hermes as a fifth harness now (L2 directly).** Rejected as a starting
  point: it is the most expensive way to learn whether the direction is viable,
  and it delivers the least standalone value.
- **Use Hermes' OpenAI-compatible API server as the task transport.** Rejected:
  it requires a long-lived gateway (breaking the one-subprocess-per-task
  model), has no per-request working directory, no exit code, and no per-request
  hard timeout. Viable for dashboards and third-party chat frontends only.
- **Use ACP as the task transport.** Rejected: Hermes' ACP server is a
  long-lived stdio JSON-RPC server rather than a batch call, and the reverse
  direction exists only for GitHub Copilot, hardcoded with no general API.
- **Build the forge-side `runCommand()` podman wrapper now.** Rejected for this
  effort by the containers decision above, and recorded as the better long-term
  answer. It is the prerequisite for real concurrency.
- **Rewrite the forge's flat-file state on SQLite independently of Hermes.**
  Not pursued; it would duplicate what L4 already offers if L4 is adopted, and
  is a large change if it is not.

## References

- `docs/research/hermes-agent-integration.md` — full evidence, verification
  method, and the rejected transports
- [ADR-040](040-native-adapter-contracts.md) — adapter request and lifecycle
  contracts
- [ADR-042](042-claude-code-execution-harness.md) — the recipe an L2 adapter
  would follow
- `docs/workflow-engine-deep-dive.md` — engine internals, concurrency gap
- `docs/documentation-map.md` — documentation authority and update triggers
