# ADR-059: Spawn Children With `PWD` Aligned to `cwd`

**Date:** 2026-09-30
**Status:** Accepted
**Amends:** [ADR-058](058-opencode-v2-project-resolution.md) (the `PWD` claim in its Context and Consequences)

---

## Context

[ADR-058](058-opencode-v2-project-resolution.md) established that OpenCode v2
removed `run --dir` and that the correct project pin is the spawn `cwd`, which
both call sites already set. It also recorded, as verified fact, that v2
"resolves the project from `process.cwd()`" and that the `PWD` claim was
**false**, warning that recording it "invites a future maintainer to delete the
`cwd` that does the work."

That premise is inverted. On **opencode v2.0.20**, when the inherited `PWD` and
the spawn `cwd` name different projects, **`PWD` decides, every time.**

Read out of the shipped CLI bundle rather than inferred from behaviour:

```js
// opencode v2.0.20, the `run` handler
async function be(e, n) {
  ...
  let d = n.root ?? process.env.PWD ?? process.cwd(),   // <-- PWD first
      w = resolvePath(d),
      g = n.useServerDirectory ? undefined : n.directory ?? w,
  ...
}
```

`run` invokes this with an empty options object, so `n.root` and `n.directory` are
undefined and the resolved directory is exactly `PWD ?? cwd`. That directory is
what travels to the background service as `location.directory`, so it decides
the project for the session. The TUI path does the same
(`process.env.PWD ?? process.cwd()`), so this is not specific to `run`.

Consequence in the engine: `harness/run.ts` passes `env: opts.env` to the child,
and no caller sets `env`, so every harness CLI inherited the `PWD` of whatever
shell launched the engine. The engine is normally launched from its own package
directory (`.opencode/skills/forge-workflow-engine`), so that `PWD` names a
different project than the task's. `cwd` was set correctly and irrelevant.

**Why the original verification could not see it.** ADR-058 lists three
measurements. `opencode debug config` does not exercise the session-creation path
the real binary takes, and measurements 2 and 3 both launched from a *neutral*
directory. In all three the inherited `PWD` already agreed with `cwd`, so the
question was never asked. The adapter test hardened the wrong belief rather than
catching the bug: it asserted `PWD` was **not** the repo root, so a corrected
`PWD` would have failed it. The existing suite had no case where the two
disagreed.

**Why it shipped as a default.** The failure is silent at `--concurrency 1` and
fatal above it. Sequentially, the execution file is written to the engine root,
which is exactly where the misdirected session already sits, so the task finds
it by accident. The mode that actually isolates tasks was the only mode that
broke. In parallel mode every task ran against the engine's package directory
instead of its sandbox worktree, could not find its own execution file, produced
nothing, and surfaced as a *missing-`expectedOutputs`* error — which points at the
task rather than at the harness.

The launcher had the same exposure. `runLoggedStep` spawns with
`cwd: state.repoDir` and merges `state.env` (itself `{ ...process.env, ... }`) into
the child environment, so invoking the launcher from outside the repository it
targets misresolves the same way.

## Decision

A child is never launched with a `PWD` that disagrees with the `cwd` it was
given. `cwd` fixes the filesystem; `PWD` is corrected to match it. The two are
set from the same value, so they cannot disagree and neither is relied on alone.

This is enforced at the spawn choke points rather than at individual call sites,
so no caller can reintroduce the disagreement:

- **Engine** — `harness/run.ts` `runCommand` builds every child environment as
  `{ ...process.env, ...opts.env, PWD: resolve(cwd) }`. This covers the opencode,
  copilot and claude adapters plus every `git` / `npm` spawn.
- **Launcher** — `format.ts` applies the same rule in `runCommand`, `runLogged`,
  `runTee` and `spawnDetached`, covering headless skill runs, `engine-run`, and
  the console's detached engine.

Consequences of the shape:

- `RunCommandOptions.env` now genuinely merges over `process.env`, as its
  documentation already claimed. It previously replaced the environment
  wholesale, which would have left a caller passing `env` with no `PATH` or
  `HOME`. No caller passed `env` before this change, so nothing observable moves.
- An explicitly supplied `PWD` in `opts.env` is **overridden** by `cwd`. There is
  no supported way to make them disagree, which is the point.

## Consequences

- Parallel runs select the right project again: each task's `opencode run`
  resolves to its own worktree, and the execution file the engine writes there is
  visible.
- Copilot and Claude tasks get the same protection, whether or not their CLIs
  consult `PWD` today. The failure was never opencode-specific; only opencode's
  project resolution was verified to depend on it.
- No flag, environment variable, or configuration changes. Nothing to migrate,
  and nothing to remove from existing scripts.
- `cwd` remains the mechanism that fixes the filesystem. **Do not drop it on the
  theory that `PWD` covers it** — ADR-058's warning survives in inverted form:
  `PWD` alone is insufficient, exactly as `cwd` alone was.
- Windows behaviour is unchanged in practice: `PWD` is not normally present
  under cmd.exe or PowerShell, so the correction is a no-op there. Under MSYS /
  Cygwin shells, which do set `PWD`, the stale-value hazard was real and is now
  closed.

## Alternatives considered

- **Correct `PWD` only in the opencode adapter and `runLoggedStep`** (the narrow
  fix). Rejected: it leaves copilot, claude, and every non-harness spawn exposed
  to the same inherited value, and the next call site added would have to
  remember the rule.
- **Delete `PWD` from the child environment** so `cwd` is the only signal.
  Rejected: it works, but it makes the child's `$PWD` disagree with its actual
  working directory, which is its own hazard for any tool that expands it.
- **Pass `--standalone` or `--server` to dodge the background service's own
  project resolution.** Rejected: the directory travels to the service either
  way, so this would not change which project a session lands in.

## References

- Issue [#121](https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge/issues/121)
- `templates/skills/forge-workflow-engine/scripts/harness/run.ts`
- `templates/skills/forge-workflow-engine/scripts/harness/opencode-adapter.ts`
- `scripts/forge-launcher/scripts/format.ts`
- [ADR-056](056-parallel-execution-task-sandboxes.md),
  [ADR-058](058-opencode-v2-project-resolution.md)
