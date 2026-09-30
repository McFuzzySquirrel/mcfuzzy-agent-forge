# OpenCode v2-only harness plan

**Status:** Implemented on `feat/opencode-v2-harness`. Superseded in part by
[ADR-058](adr/058-opencode-v2-project-resolution.md).
**Decision:** The Forge OpenCode harness supports **OpenCode v2 only**.
OpenCode v1.x (`run --dir`, `run --attach`, engine-managed `opencode serve`) is
**retired**, not kept as a compatibility path.
**Related:** ADR-027 (keep-alive attach, superseded), ADR-031 (adaptive
keep-alive, keep-alive half superseded), ADR-056 (parallel task sandboxes),
ADR-058 (this migration).

## Verification results (opencode v2.0.20)

The plan below originally paused pending verification, because it was written
from the v1 help output. It was checked against the installed v2 CLI before any
code changed. Three of its premises turned out to be wrong.

| Assumption | Result |
|---|---|
| v2 removed `run --dir` | Confirmed |
| v2 removed `run --attach` | Confirmed; replaced by `--server <url>` and `--standalone` |
| `serve` gained mandatory auth | Confirmed — HTTP Basic, user `opencode`, password from `OPENCODE_SERVER_PASSWORD` or generated to the log |
| A trailing path is swallowed into the prompt | Confirmed (`run [flags] [<message...>]`) |
| **Project dir travels via `PWD`** | **Inverted — v2 resolves the project from `process.env.PWD ?? process.cwd()`, so `PWD` outranks `cwd`. See [ADR-059](adr/059-pwd-aligned-spawn-environment.md), which corrects this row.** |
| Keep-alive must be fully retired | Flags are dead, but the capability is still buildable on v2 via `serve --port` + `run --server`. Full retirement was a deliberate choice, not a forced consequence. |

### The `PWD` claim was wrong

> **Corrected by [ADR-059](adr/059-pwd-aligned-spawn-environment.md).** The
> conclusion in this section is inverted: all three measurements launched with an
> inherited `PWD` that already matched `cwd`, so they could not distinguish the
> two. v2 prefers `process.env.PWD`. Both are now set together. The text below is
> preserved as the historical record of this migration.

Measured three ways:

1. `opencode debug config` reported a project's `opencode.json` only when `cwd`
   matched that project. Setting `PWD` alone changed nothing.
2. A real `opencode run` launched from a neutral directory stored its session
   under the neutral directory's project, not the target repo's — including when
   the repo path was passed as a trailing argument (it became prompt text).
3. The same held with `--server`: the session landed in the client's `cwd`
   project.

**Both call sites already set `cwd` correctly** — the engine adapter spawns with
`cwd: repoRoot`, and the launcher's `runLoggedStep` spawns with
`cwd: state.repoDir`. `--dir` was redundant on v1 too, so no replacement
mechanism was needed. An in-flight code comment claiming "PWD wins over cwd in
both v1 and v2" was removed, since acting on it would mean deleting the `cwd`
that does the actual work.

### Both removed flags hard-fail

`opencode run --dir <p>` and `--attach <url>` print the usage block and exit 1
rather than being ignored, so the v1→v2 upgrade breakage is loud rather than a
silent wrong-project run.

## What changed

### Engine — `templates/skills/forge-workflow-engine/scripts/`

- `harness/opencode-adapter.ts` — argv is now
  `run [--model …] [--agent …] --auto <prompt>`; no `--dir`, no `--attach`, no
  `PWD` env. The constructor takes no arguments; `OpenCodeAdapterOptions`,
  `prepare`, and `cleanup` are gone. Comments record that v2 selects the project
  from `process.cwd()` and that runs connect to OpenCode's background service.
- `harness/run.ts` — dropped the `bootMs` field and the now-dead `firstOutputAt`
  tracking.
- `harness/opencode-server.ts`, `harness/opencode-server.test.ts`,
  `keepalive.ts` — deleted.
- `cli.ts` — dropped the keep-alive import, the `attachUrl` parameter from
  `resolveHarness` / `buildOptions` / `cmdReplay`, the `Keep-alive:` summary
  line, the retired flag parsing, and the sandbox `--attach` warning.
  `runWithServer` now only constructs `new OpenCodeAdapter()`.
- `cli.test.ts` — removed the nine `shouldKeepAlive` and four `remainingTaskCount`
  tests. `remainingTaskCount` needed no relocation: with the keep-alive decision
  gone, it had no remaining callers.
- `engine.ts` — concurrency doc comment no longer mentions a keep-alive decision.
- `harness/opencode-adapter.test.ts` — three tests added to the existing eight:
  argv carries neither `--dir` nor `--attach`; the recorded `cwd` is the repo
  root and `PWD` is *not* what selects the project; and a sandbox worktree is
  selected by `cwd` without leaking into argv. They use a shim that records argv,
  `cwd`, and `PWD` so project selection is directly observable. **(The second of
  these asserted the inverted invariant and was rewritten by
  [ADR-059](adr/059-pwd-aligned-spawn-environment.md); it now asserts that a
  stale inherited `PWD` is corrected.)**

### Launcher — `scripts/forge-launcher/scripts/`

- `engine-run.ts` — removed `keepAlive` / `keepAlivePort` / `noKeepAlive` /
  `attach` from the options type, resolution, summary line, `engineFlags`, and
  argument parsing.
- `authoring-inventory.ts` — dropped `--dir <repo>` from the opencode argv. The
  `repo` parameter is retained (now `_repo`) so the call signature and the Copilot
  and Claude branches are untouched; the doc comment records that callers must
  spawn with `cwd` set to the repository.
- `engine-config.ts` — dropped `keepAlive` / `attach` from `PersistedEngineConfig`.
- `launcher.ts` — removed the flag pushes and env reads; `console/control.ts`
  and `console/repo.ts` likewise.
- `cli.ts` — removed the four flags from the usage text.

### Tests

Keep-alive and attach assertions were replaced with retirement tests: retired
flags are rejected, retired env vars and stale config keys change nothing, and
the headless command carries no path argument. All 261 launcher tests and 246
engine tests pass (239 passing, 7 pre-existing skips).

### Docs

New [ADR-058](adr/058-opencode-v2-project-resolution.md). ADR-027 marked
Superseded, ADR-031 marked partially superseded (keep-alive half only), ADR-056's
keep-alive note corrected. Updated `docs/workflow-engine.md`,
`templates/skills/forge-workflow-engine/SKILL.md`,
`docs/workflow-engine-deep-dive.md`, `docs/forge-launcher.md`,
`docs/forge-console-user-guide.md`, `docs/parallel-execution-plan.md`,
`docs/prompt-playbook.md`, and `docs/research/claude-authoring-runner.md`.
Changelog section for v3.87; README `**Latest:**` bumped.

`docs/research/claude-code-harness-adapter*.md`, `docs/adr/028`, `032`, `040`,
`042`, and `docs/codebase-review-2026-09-05.md` mention the retired flags but are
historical records of a different harness investigation; they are left intact per
the repository's convention of preserving historical ADRs and research notes.

## Verification

```bash
npm run typecheck && npm test   # in templates/skills/forge-workflow-engine
npm run typecheck && npm test   # in scripts/forge-launcher
```

A literal grep for `--dir` / `keep-alive` does not reach zero across the repo and
is not a useful gate: `console/server.ts` sets the HTTP `Connection: keep-alive`
header, and `sandbox.ts` passes `git ls-files --directory`. Both are unrelated.

## Open items

- **Windows `cwd` behaviour** was not exercised on this machine. The engine
  already used `cwd` before this change, so the risk is unchanged from v1, but the
  shim-based adapter test does exercise a `.cmd` wrapper on Windows in CI.
- **Background service lifecycle** is now OpenCode's responsibility, not the
  engine's. If the service is down, `opencode run` starts it; the engine cannot
  pre-warm or health-check it.
- **A future engine-managed warm server** remains available on v2
  (`serve --port` + `run --server` with a generated `OPENCODE_SERVER_PASSWORD`).
  Verified working, deliberately not adopted.
