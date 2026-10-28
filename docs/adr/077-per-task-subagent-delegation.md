# ADR-077: Per-Task Sub-Agent Delegation

## Status

Accepted

## Context

Every forge agent is generated with `mode: all` (`forge-build-agent-team`), which
means the same file serves as a primary agent *and* as a subagent. The engine
invokes one owner per task (`--agent <owner>`), so that owner is a **primary**
agent for its invocation and can already reach its teammates through the
harness's Task tool.

In other words, per-task fan-out was possible all along — unbounded, unguided,
and invisible. Operators had no way to cap it, no way to turn it off, and no
statement of what the engine expected from a delegated task. Meanwhile ADR-067
shipped phase-scoped session reuse as the answer to per-task latency, but that
answer is serial-only (it requires `--concurrency 1`) and spends its single
delegation hop on the phase lead → owner handoff.

Two independent ceilings remained:

- `ownerUniqueReady` dispatches at most one task per owner per wave, so
  `--concurrency N` cannot exceed the number of distinct owners with ready work.
- Phase scope forbids parallel tasks entirely.

Fan-out raises both from inside a task: one owner, one contract, one commit, many
teammates.

## Decision

The engine gains an explicit, capped, capability-gated delegation policy for the
task owner.

1. **`--subagents off|auto|0-4`** (`FORGE_ENGINE_SUBAGENTS`). `auto` is the
   default and caps at `MAX_SUBAGENTS_PER_TASK = 4`; `0` withholds the
   instruction; values above the hard limit are clamped with a notice. The CLI
   rejects a typed value above the limit so a typo is not silently reduced.
2. **`HarnessAdapter.supportsSubagents`** gates the instruction. All three CLI
   harnesses declare it — OpenCode (owner runs as a primary agent; `mode: all`
   agents are reachable through the Task tool), Copilot (`copilot -p` is a full
   agent loop over `.github/agents`), and Claude Code (native subagents in
   `.claude/agents`). Delegation is policy text, so no transport flag is involved
   and the experiment "tell the coding agent to use sub-agents" works as-is. The
   OpenAI API adapter has no tool surface and receives no policy — a notice,
   never an error. The stub declares it so policy is exercised in tests.

   Enabling a harness means "the engine may instruct delegation here", not
   "delegation is guaranteed": whether a task fans out, and how many sub-agents
   it uses, remains the model's decision, and no harness enforces the cap.
3. **Always off under `--session-scope phase`.** The lead already delegates to
   the owner; telling the owner to delegate again would be a depth none of the
   three harnesses document. Withholding it keeps ADR-067's contract intact and
   keeps `auto` from changing phase-scope behaviour on upgrade.
4. **The instruction lives in the engine-generated execution file**, so it is
   harness-agnostic and identical across adapters: delegate only independent
   sub-work, disjoint file scopes, read-only teammates for analysis, and the
   owner is the sole author of the final `forge-result`. It also carries a
   **named roster** of the teammates the engine discovered (excluding the
   running agent and forge's meta-agents), so "use sub-agents" is concrete
   rather than left to the harness's own tool description.
5. **The default timeout widens with the cap** (`base × (1 + cap)`, ceiling 60
   minutes) because a fan-out task runs several invocations inside one attempt. A
   manifest `timeoutMs` still wins.
6. **The Console exposes the policy** per project (`docs/engine-config.json`) and
   as a system default, disabled with a reason when the selected harness does not
   declare sub-agent support (in practice the `openai` adapter).

## Consequences

- Cross-owner parallelism is no longer the only way to shorten a build;
  decomposable tasks overlap their own work without worktrees, a clean-tree
  preflight, or a session-scope constraint.
- The engine keeps per-task dispatch, verification, retries, per-task commits,
  replay, and audit unchanged. Delegation is invisible to all of them.
- Sub-agents share the task's working tree (including its sandbox worktree under
  `--concurrency > 1`), so their changes are attributed and committed as that
  task's work. Two sub-agents writing the same file is a **silent lost edit the
  engine cannot detect**; the instruction requires disjoint scopes, and this
  limitation is documented rather than papered over.
- **Narrated, not just filed.** The one-line launch prompt names the cap, and the
  Tasks detail drawer reports what each task's execution snapshot actually
  instructed. Neither substitutes for harness-level observation: the engine never
  counts real fan-out, so the Console reports policy only.
- The audit records the delegation *policy* (cap, auto/explicit, degradations),
  not the observed number of sub-agent invocations: the engine never sees child
  sessions. The Console summary likewise shows the policy.
- Token cost rises with the cap. `auto` + `--concurrency 4` can mean up to 20
  concurrent invocations (4 parents + 16 children); both remain opt-in per
  project and the run summary states the multiplication.
- Delegation and concurrency stay orthogonal: fan-out overlaps work *inside* a
  task, concurrency overlaps *different owners'* tasks. Neither replaces the
  other, and phase scope remains the narrow answer for context-heavy,
  non-decomposable phases.

## Alternatives considered

1. **Leave fan-out implicit.** It already worked, so shipping nothing was
   possible — but then it stays unbounded, undiscoverable, and impossible to turn
   off. Capping and instructing it is strictly safer than the status quo.
2. **Engine-side sub-agent scheduling** (the engine spawns teammates itself into
   per-sub-agent worktrees). This duplicates the harness's own orchestration,
   requires the engine to reason about sub-task contracts it was never given, and
   breaks the "one task = one verification + one commit" invariant.
3. **Allow fan-out under phase scope.** Would need a documented depth-2 chain and
   a way to attribute a grandchild's work inside an already-delegated task. Not
   worth the ambiguity; the phase lead can still sequence owners.
4. **Auto-enable `--concurrency N` when the tree is clean** to chase the same
   speed. Rejected: N worktrees and N cold starts behind the operator's back, and
   a preflight failure they need to see.
5. **Use Copilot's `--fleet` (parallel subagent orchestration) for delegation.**
   Rejected: fleet mode decides parallelism on its own terms, competing with the
   task's named roster and cap, and it is Copilot-only. The instruction works
   without it, so the transport stays untouched.

## References

- `templates/skills/forge-workflow-engine/scripts/engine.ts` (`resolveSubagents`, `taskTimeoutFor`)
- `templates/skills/forge-workflow-engine/scripts/request.ts` (`subagentPolicyBlock`)
- `templates/skills/forge-workflow-engine/scripts/types.ts` (`supportsSubagents`, `MAX_SUBAGENTS_PER_TASK`)
- `templates/skills/forge-workflow-engine/scripts/harness/opencode-adapter.ts`
- `scripts/forge-launcher/scripts/engine-config.ts`
- [ADR-035](035-auto-commit-after-task.md), [ADR-056](056-parallel-task-execution.md), [ADR-058](058-opencode-v2-project-resolution.md), [ADR-067](067-phase-scoped-session-reuse.md)
