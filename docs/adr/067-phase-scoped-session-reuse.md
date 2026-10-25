# ADR-067: Phase-Scoped Session Reuse

## Status

Accepted

## Context

Running the same work natively in a harness CLI is observably faster than running
it through MyForge. The cause is context cold-start, not orchestration overhead:
a native session accumulates one conversation across the whole task, while the
engine had dispatched each task as a fresh, isolated `opencode run` / `copilot -p`
/ `claude -p` (ADR-058: "every run still receives a fresh, isolated session").
Every task therefore re-derived the repository and shared no reasoning with its
siblings.

All three CLI harnesses support resuming a conversation, but in different ways:

- **OpenCode** `run --session <id>` continues a session or creates it if absent,
  so the caller can choose the ID.
- **Claude Code** assigns its own `session_id`, returned in the
  `--output-format json` envelope, and resumes with `--resume <id>`.
- **GitHub Copilot** accepts `--session-id <id>` (resume, or set the UUID for a
  new session).

## Decision

The engine gains an opt-in **phase-scoped session mode**
(`--session-scope phase` / `FORGE_ENGINE_SESSION_SCOPE=phase`). When enabled, all
tasks in a phase share one harness conversation; a new conversation begins at
each phase boundary. The default remains `task`: one fresh, isolated session per
task.

A `SessionResumeStrategy` on the `HarnessAdapter` interface abstracts the
per-CLI difference:

- `deterministic` — the harness accepts a caller-chosen ID (OpenCode, Copilot);
  the engine generates a UUID once per phase and passes it through the adapter's
  `resumeFlags`.
- `capture` — the harness assigns its own ID (Claude); the engine reads it back
  from the first task's result and reuses it for the rest of the phase.

Adapters without a strategy (OpenAI, Stub) run one fresh session per task, as
before.

A phase usually contains tasks owned by different agents, and the running
`--agent` must stay stable across a session. Phase scope therefore runs every
task under a single **phase lead** (`project-orchestrator`), which delegates each
task to its owner specialist as a sub-agent via the harness's native sub-agent
mechanism. The owner's persona travels inline in the task instructions.

Phase sessions require `--concurrency 1`: session lookup is project-scoped, and
a parallel run gives every task its own git worktree (a different project), which
would fragment the conversation. The CLI and the engine both refuse this
combination loudly.

## Consequences

- Tasks in a phase inherit one another's context, removing the dominant
  per-task cold-start cost within a phase. Cross-phase continuity is bounded by
  the phase boundary (a phase is a coherent chunk, so context stays bounded).
- The engine keeps per-task dispatch, per-task commits, validation gates,
  retries, replay, and audit unchanged. Only the session and the running agent
  differ.
- `project-orchestrator` becomes a required agent for phase-scoped runs; a
  missing one fails preflight with migration guidance.
- Session IDs are persisted in `WORKFLOW-STATE.json` under `sessions` (phase id
  → native ID), so a resumed run rejoins its phase conversations.
- Replay remains per-task and runs a fresh session today; rejoining a phase
  conversation on replay is future work.
- `opencode`/`copilot` are deterministic; `claude` is capture; `openai`/`stub`
  are unchanged. Phase scope is rejected for harnesses without a strategy.

## Alternatives considered

1. **Warm server keep-alive** (revisit ADR-058's `serve` + `run --server`):
   removes process cold-boot but not the fresh-session context rebuild, so it
   recovers far less than session reuse.
2. **Per-owner sessions**: bounded by owner rather than phase, but a phase's
   owner interleaving would still reset context mid-phase.
3. **Whole-run single session**: maximal continuity but unbounded context growth
   and no natural reset point; the phase boundary is the correct unit.
4. **Inject a repo map / decisions digest only** (no session reuse): lower risk
   but a strict ceiling — it cannot match real conversation continuity.

## References

- `templates/skills/forge-workflow-engine/scripts/types.ts`
- `templates/skills/forge-workflow-engine/scripts/engine.ts`
- `templates/skills/forge-workflow-engine/scripts/request.ts`
- `templates/skills/forge-workflow-engine/scripts/harness/{opencode,copilot,claude}-adapter.ts`
- [ADR-058](058-opencode-v2-project-resolution.md)
