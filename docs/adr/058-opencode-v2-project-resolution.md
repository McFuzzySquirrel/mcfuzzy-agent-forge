# ADR-058: OpenCode v2 Only — Project Resolution via `cwd`, Keep-Alive Retired

**Date:** 2026-09-30
**Status:** Accepted
**Supersedes:** [ADR-027](027-workflow-engine-keep-alive-attach.md) (engine-managed keep-alive attach mode), the keep-alive half of [ADR-031](031-adaptive-keep-alive-and-budget-hints.md)
**Amends:** [ADR-056](056-parallel-execution-task-sandboxes.md) (per-task project selection in sandbox mode)
**Amended by:** [ADR-059](059-pwd-aligned-spawn-environment.md) — the `PWD` claim recorded below is **inverted**; see that ADR's Context. `cwd` is still necessary, but on its own it is not sufficient.

---

## Context

The Forge OpenCode harness targeted OpenCode v1.x, which exposed two flags the
engine depended on:

- `opencode run --dir <path>` to pin the project directory, and
- `opencode run --attach <url>` to route a task into a warm, engine-managed
  `opencode serve` instance.

ADR-027 and ADR-031 built the keep-alive feature on top of those flags. The
premise for migrating was that OpenCode v2 removed both and made `serve`
authenticated, which would retire the feature. That premise needed verification
against the installed CLI before any code changed, because the project's own
plan document (`docs/opencode-v2-only-plan.md`) was written from the v1 help
output and asserted a specific replacement mechanism.

Verified against **opencode v2.0.20**:

```
$ opencode run --help
USAGE
  opencode run [flags] [<message...>]
FLAGS
  --standalone            Run with a private server instead of the background service
  --server string         Connect to a server URL instead of the background service
  --model, -m string      Model to use in the format provider/model#variant
  --agent string          Agent to use
  --auto                  Auto-approve permissions that are not explicitly denied
```

- `--dir` is gone. `run` accepts only `message...`, so there is **no positional
  path argument**: a trailing path is swallowed into the prompt as text while the
  project stays wherever the process was launched. Confirmed by running
  `opencode run <repo-path> "prompt"` and observing the path treated as prompt
  content.
- `--attach` is gone, replaced by `--server <url>` plus `--standalone`.
- `serve` now requires HTTP Basic authentication (user `opencode`, password from
  `OPENCODE_SERVER_PASSWORD` or generated and written to the log). `/api/*`
  returns 401 without credentials.
- **Both removed flags now hard-fail.** `opencode run --dir <p>` and
  `--attach <url>` print the usage block and exit 1 rather than being ignored.
  The breakage is loud, not silent.

The migration plan also asserted that the project directory would have to travel
in the child's `PWD`, on the theory that v2 resolves the project from its parent
process rather than the spawn `cwd`. **This is false.** Measured three ways:

> **Superseded by [ADR-059](059-pwd-aligned-spawn-environment.md).** The
> measurements below are preserved as written, but they could not have detected
> the claim: each one launched with an inherited `PWD` that already agreed with
> `cwd`. In fact v2 resolves the project from `process.env.PWD ?? process.cwd()`,
> so `PWD` outranks `cwd`. The warning at the end of this section is inverted for
> the same reason: `cwd` alone is insufficient, and both must be set together.

1. `opencode debug config` reported a project's `opencode.json` only when `cwd`
   matched that project — setting `PWD` alone to the project changed nothing.
2. A real `opencode run` launched from a neutral directory stored its session
   under the neutral directory's project, not the target repo's, even when the
   repo path was passed as a trailing argument.
3. The same held with `--server`: the session landed in the client's `cwd`
   project.

OpenCode v2 resolves the project from `process.cwd()`. Critically, **both call
sites already set `cwd` correctly** — the engine adapter spawns with
`cwd: repoRoot`, and the launcher's `runLoggedStep` spawns with
`cwd: state.repoDir`. `--dir` was therefore redundant on v1 as well, and no
replacement mechanism is needed: the correct pin is the one already in place.
Recording the `PWD` claim as authoritative would have been actively harmful,
since it invites a future maintainer to delete the `cwd` that does the work.

## Decision

The Forge OpenCode harness supports **OpenCode v2 only**. v1.x is retired, not
kept as a compatibility path.

1. **Project directory travels in the spawn `cwd`, not in argv.** No path
   argument is passed to `opencode run`. In parallel mode each task's worktree is
   the `cwd`, which is what keeps per-task project isolation exact.
2. **The engine no longer manages a warm server.** `opencode-server.ts` and
   `keepalive.ts` are deleted along with `--keep-alive`, `--keep-alive-port`,
   `--no-keep-alive`, and `--attach`. Each `opencode run` connects to OpenCode's
   own background service, which is warm by default; every run still receives a
   fresh, isolated session. Operators who want a private server per run can set
   `OPENCODE_EXTRA_FLAGS=--standalone`.
3. **The retired flags fail loudly rather than being silently ignored.** A
   persisted `docs/engine-config.json` carrying `keepAlive` / `attach` is ignored
   on read, and passing a retired flag to `forge-launcher engine-run` is an
   `Unknown option` error. Silence here would be worse than the v1→v2 hard
   failure, because an operator could believe a warm server was in play.
4. **`--standalone` is the documented isolation escape hatch** rather than a
   rebuilt keep-alive mode, keeping the engine out of server lifecycle management.

## Consequences

- The per-task `boot` / `total` startup split disappears from the audit log; it
  existed only to quantify attach-mode cold-boot removal.
- Engine and launcher CLI surfaces lose four flags, and two environment
  variables (`FORGE_ENGINE_ATTACH`, `FORGE_ENGINE_ATTACH_URL`) become inert.
  Scripts and persisted configs that set them need updating.
- The engine no longer controls server lifetime or can health-check a warm
  server. It depends on OpenCode's background service being up; if it is not,
  `opencode run` starts it.
- Parallel isolation now rests entirely on `cwd` correctness. This is covered by
  adapter tests asserting the recorded `cwd`, the absence of `--dir` / `--attach`
  in argv, and that the worktree path never leaks into argv.
- A future engine-managed warm server is still possible on v2 via
  `serve --port` + `run --server` with a generated `OPENCODE_SERVER_PASSWORD`;
  that path was verified to work and is deliberately not taken now.
- Windows path handling for `cwd` is unchanged by this decision (the engine
  always used `cwd`), so the v1-only `PWD` risk does not apply.

## Migration

- Remove `--keep-alive`, `--keep-alive-port`, `--no-keep-alive`, and `--attach`
  from any script or CI invocation of the engine or `forge-launcher engine-run`.
- Delete `keepAlive` and `attach` from `docs/engine-config.json`; they are now
  ignored if present.
- Drop `FORGE_ENGINE_ATTACH` and `FORGE_ENGINE_ATTACH_URL` from the environment.
- Nothing is required for project selection: `cwd` was already correct.

## References

- `templates/skills/forge-workflow-engine/scripts/harness/opencode-adapter.ts`
- `templates/skills/forge-workflow-engine/scripts/harness/opencode-adapter.test.ts`
- `templates/skills/forge-workflow-engine/scripts/cli.ts`
- `scripts/forge-launcher/scripts/authoring-inventory.ts`
- `scripts/forge-launcher/scripts/engine-run.ts`
- `docs/opencode-v2-only-plan.md`
