# ADR-027: Keep-Alive Attach Mode for the Workflow Engine

**Date:** 2026-08-27
**Status:** Accepted
**Relates to:** ADR-014 (workflow engine), ADR-021 (parallel dispatch), ADR-022 (task granularity and configurable timeout)

---

## Context

The opencode harness adapter cold-starts a fresh `opencode run` process for
**every task** (`OpenCodeAdapter.invoke`). Each process re-boots the entire
project instance before any model work happens:

- parses config (`opencode.json`, global + project)
- reads every `AGENTS.md` (global + project)
- reads and parses every agent file and skill (`SKILL.md`) on disk
- launches and handshakes every MCP server (e.g. CodeGraph's SQLite index)

These are small reads individually, but they are paid **once per task** (and per
retry), and with the default `--concurrency 1` they serialize. On a multi-task
manifest the accumulated cold-boot time can rival the actual LLM work — the
`durationMs` recorded in `docs/EXECUTION-AUDIT.jsonl` for every `task.complete`
includes the full subprocess boot even for tasks with trivial model output.

The opencode CLI documents the intended remedy: attach each `opencode run` to a
long-lived `opencode serve` instance "to avoid MCP server cold boot times on
every run".

## Decision

Add a **keep-alive attach mode** to the opencode harness:

- **`--keep-alive`** (or `FORGE_ENGINE_ATTACH=1`): the engine boots one headless
  `opencode serve --hostname 127.0.0.1 --port <n>` bound to the target repo,
  waits until `GET /global/health` reports healthy, runs every task via
  `opencode run --attach <url>` (keeping the existing `--dir`/`--auto`/`--model`
  flags), and tears the server down when the run finishes — including on error.
  `--keep-alive-port <n>` pins the port; otherwise a free port is chosen.
- **`--attach <url>`** (or `FORGE_ENGINE_ATTACH_URL`): reuse an already-running
  server (e.g. one started by the TUI or a long-lived `opencode serve`) with no
  lifecycle management. A warning (not an error) is printed if `--keep-alive` is
  passed with a non-opencode harness, and the flag is ignored.
- **Sessions stay isolated.** Each `opencode run --attach` invocation creates a
  **fresh session** (no `--continue`/`--session`/`--fork` is passed), so a
  task's context never contaminates the next task — the server keeps only the
  shared project instance (config, skills, agents, MCP connections) warm.
- **Server hygiene.** The engine-spawned server is loopback-only and short-lived,
  so the engine strips any ambient `OPENCODE_SERVER_PASSWORD`/`OPENCODE_SERVER_USERNAME`
  from its environment — otherwise the engine's own health probe and attach
  calls get 401s. Attaching to a user-managed, authenticated server continues to
  work (the client auto-sends credentials from the environment).
- **Robust readiness.** `opencode serve` binds its port *before* it finishes
  booting (config, skills, MCP), so a health request in that window can connect
  but hang. Each health probe gets its own `AbortSignal.timeout` (default 2s) so
  the readiness deadline loop always advances.
- **Measurable win.** `run.ts` reports `bootMs` (ms from spawn to first output)
  and the adapter prints `[opencode] task <id>: boot=…ms total=…ms` when
  attaching, so the per-task durations in the audit log expose the cold-boot
  removal directly (task 1 pays the one-time server boot; tasks 2..N attach warm).

## Consequences

Positive:

- Multi-task opencode runs skip N−1 full harness boots; the big MCP/config/skill
  re-read disappears from every task after the first.
- No change to session semantics — isolation is preserved, so task ordering and
  the artifact projection contract are unaffected.
- Applies cleanly alongside `--concurrency` (multiple `run --attach` clients hit
  the same warm server concurrently).
- Default behavior is unchanged: without `--keep-alive`/`--attach`, tasks
  cold-start exactly as before.

Negative:

- The engine-managed server is unauthenticated on loopback for the duration of
  the run (an accepted trade-off for a per-run, loopback-only process).
- Attach sessions accumulate in the server's session store until opencode prunes
  them (cosmetic; does not affect the run).
- `--auto` permission semantics under attach may be governed by server policy
  rather than the run flag — should be re-verified on upgrade.

Trade-offs considered:

- **opencode Server SDK instead of subprocess attach** — the server exposes
  `POST /session` + `POST /session/:id/message` + `DELETE /session/:id`, giving
  explicit per-task session lifecycle. Rejected for now: a larger rewrite, and
  `--attach` already delivers the cold-boot win. Revisit if per-task session
  disposal becomes important.
- **flowforge-kernel single-process harness** — already exists as the escape
  hatch for per-task process churn (ADR-016); attach mode is the lighter,
  opencode-specific path.

## References

- ADR-014: workflow engine; ADR-021: parallel dispatch; ADR-022: configurable
  task timeout.
- opencode CLI docs: `opencode serve` + `opencode run --attach` to "avoid MCP
  server cold boot times on every run".
- Implementation: `templates/skills/forge-workflow-engine/scripts/harness/opencode-server.ts`,
  `opencode-adapter.ts`, `run.ts`, and `scripts/cli.ts`.
