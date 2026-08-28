# ADR-031: Adaptive Keep-Alive Default + Timeout/Retry Surfacing

**Date:** 2026-08-28
**Status:** Accepted
**Relates to:** ADR-027 (keep-alive attach mode), ADR-022 (task granularity and configurable timeout), ADR-029 (output verification gate)

---

## Context

ADR-027 made keep-alive attach mode available but **opt-in** (`--keep-alive` /
`FORGE_ENGINE_ATTACH=1`), so multi-task dark runs still defaulted to cold-starting
a fresh `opencode run` per task — re-booting config, skills, agents, and every
MCP server for each task. Real runs paid the price: a 40-task manifest re-pays
the full harness boot N times, and the audit log's `durationMs` is dominated by
subprocess boot even for trivial tasks.

Two gaps surfaced while measuring this:

1. **Keep-alive was opt-in, so the common case missed the win** — and when
   forced on globally it became a *net loss* for short resumes (1 task remaining
   pays a server boot it does not need).
2. **The configured execution budget was invisible to the agent.** The pre-run
   summary showed only the per-task timeout — never `maxRetries`, retry delay, or
   concurrency. And the per-task prompt (`buildPrompt`) hinted at expected outputs
   and validation commands but never told the agent its time budget or that hollow
   results are retried, so the model could not self-manage (e.g. pick a faster
   approach under a 10-minute cap).

## Decision

### 1. Adaptive keep-alive default (opencode harness)

`cmdRun` decides server lifecycle with a precedence chain:

1. `--attach <url>` / `FORGE_ENGINE_ATTACH_URL` — reuse an existing server.
2. `--no-keep-alive` / `FORGE_ENGINE_ATTACH=0` — **new flag/env value**, force
   cold start per task.
3. `--keep-alive` / `FORGE_ENGINE_ATTACH=1` — force keep-alive.
4. **Adaptive (default):** keep-alive when **more than one task remains**, cold
   start when ≤1 remains.

"Remaining" is computed from the manifest against `WORKFLOW-STATE.json`:
tasks with no record (fresh run) or a record whose status is not
`complete`/`skipped` count as remaining, so a leftover `running` task from a
killed run keeps the server warm for the recovery pass (matching `runEngine`'s
normalization). The decision is extracted as pure functions
(`shouldKeepAlive`, `remainingTaskCount` in `scripts/keepalive.ts`) and the
chosen mode is surfaced in the pre-run summary.

### 2. Timeout/retry surfacing

- **Pre-run summary** now shows max retries, retry delay, concurrency, and the
  keep-alive mode alongside the per-task timeout.
- **Agent prompt**: `HarnessAdapter.invoke` gains an optional `maxRetries`
  parameter (the engine already passed `timeoutMs`). The opencode and copilot
  adapters render an **Execution budget** hint — per-task timeout in seconds and
  retry count — plus a directive not to rely on retries to fix hollow output.

## Consequences

Positive:

- Multi-task runs warm up once and attach; single-task resumes cold-start — no
  flag needed for the right behavior in either case.
- `--no-keep-alive` / `FORGE_ENGINE_ATTACH=0` is the explicit escape hatch for
  environments where `opencode serve` cannot boot (CI/headless boxes), avoiding
  the ADR-027 fail-fast risk becoming the default for everyone.
- Agents see their execution budget, which should reduce hollow/incomplete
  attempts that the output gate (ADR-029) would otherwise catch and retry.

Negative:

- Adaptive mode adds a server boot when the manifest changes between runs
  (remaining recomputed at each `run` invocation, so this stays accurate).
- Non-opencode harnesses are unaffected — the adaptive branch only ever selects
  `opencode`, and a forced `--keep-alive` on another harness still warns+ignores
  as before.
- The prompt hint is informational; agents are free to ignore it.

Trade-offs considered:

- **Always keep-alive by default** — simpler, but single-task resumes pay a
  server boot for no benefit, and a non-bootable `opencode serve` would break
  runs that currently degrade gracefully.
- **Server-SDK session lifecycle** (ADR-027 alternative) — unchanged; `--attach`
  still delivers the cold-boot win and session isolation is preserved.

## References

- ADR-027: keep-alive attach mode; ADR-029: output verification gate; ADR-022:
  configurable per-task timeout.
- Implementation: `templates/skills/forge-workflow-engine/scripts/keepalive.ts`,
  `cli.ts` (`shouldKeepAlive`, `remainingTaskCount`, pre-run summary), `types.ts`
  (`HarnessAdapter.invoke` `maxRetries`), `engine.ts` (threads `opts.maxRetries`),
  `harness/opencode-adapter.ts` and `harness/copilot-adapter.ts` (`buildPrompt`
  budget hint), launcher `engine-run.ts` (`--no-keep-alive` pass-through).
