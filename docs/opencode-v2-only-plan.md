# OpenCode v2-only harness plan

**Status:** Paused — waiting for OpenCode v2 to be installed before any code is changed.
**Decision:** Going forward the Forge OpenCode harness supports **OpenCode v2 only**.
OpenCode v1.x (`run --dir`, `run --attach`, engine-managed `opencode serve`) is
**retired**, not kept as a compatibility path.
**Branch:** `feat/parallel-agents` (last commit `bade4cc`).
**Related:** ADR-027 (keep-alive attach), ADR-031 (adaptive keep-alive),
ADR-056 (parallel task sandboxes), planned ADR-058 (this decision).

## Why this is paused

The work started from the premise that **OpenCode v2 removed `run --dir` and
`run --attach`, and `serve` gained mandatory auth**. That premise is currently
**unverified against the CLI on this machine**:

```
$ opencode --version
1.18.33
$ opencode run --help
      --attach     attach to a running opencode server (e.g., http://localhost:4096)
      --dir        directory to run in, path on remote server if attaching
```

The only `opencode` on the box is `/home/mcfuzzysquirrel/.opencode/bin/opencode`,
**v1.18.33**, and it still exposes both flags. **Do not implement the plan
below until v2 is installed and its `run --help` has been checked.** The plan may
need adjusting if v2's actual surface differs.

## Verification gate (run this first once v2 is installed)

```bash
opencode --version
opencode run --help          # confirm --dir and --attach are gone
opencode serve --help        # confirm auth requirements
```

Confirm all three, then update the assumptions section below before editing:

- [ ] v2 removed `run --dir`.
- [ ] v2 removed `run --attach` (and `serve` requires auth).
- [ ] A child process with `PWD=<repo>` (and any `cwd`) makes `opencode run`
      operate on `<repo>`. Test on both Linux and, if it is a target, Windows.
- [ ] Confirm whether v2 accepts any positional project argument at all — the
      in-flight comment claims a trailing path is swallowed into the prompt.

## Repository state at pause (from the crashed session)

Working tree is dirty and **does not typecheck**. Do not commit as-is.

Staged deletions:
- `templates/skills/forge-workflow-engine/scripts/harness/opencode-server.ts`
- `templates/skills/forge-workflow-engine/scripts/harness/opencode-server.test.ts`
- `templates/skills/forge-workflow-engine/scripts/keepalive.ts`

Unstaged edits:
- `templates/skills/forge-workflow-engine/scripts/harness/opencode-adapter.ts`
  — removed `OpenCodeAdapterOptions`/attach/`prepare`/`cleanup`; argv is now
  `run [--model …] [--agent …] --auto … <prompt>`; spawns with
  `env: { ...process.env, PWD: resolve(repoRoot) }`; constructor takes no args.
- `templates/skills/forge-workflow-engine/scripts/harness/run.ts`
  — removed `bootMs` from `RunCommandResult`.

`npm run typecheck` in `templates/skills/forge-workflow-engine` currently fails:

```
cli.test.ts(9): Cannot find module './keepalive.ts'
cli.ts(164):   Cannot find module './keepalive.ts'
cli.ts(184):   Expected 0 arguments, but got 1   (new OpenCodeAdapter({ attachUrl }))
cli.ts(385):   Expected 0 arguments, but got 1   (new OpenCodeAdapter({ attachUrl, startServer, port }))
run.ts(128):   'bootMs' does not exist in type 'RunCommandResult'
```

Either finish the change, or revert the staged deletions and unstaged edits to
return to a green tree before doing anything else.

## Project-directory resolution (the actual v2 fix)

`opencode run` resolves its project from its **parent process** rather than the
child's spawn `cwd`. In v1 the engine pinned this with `--dir <repo>`. With
`--dir` gone in v2, the one portable mechanism is the child's `PWD`:

- Engine: `harness/opencode-adapter.ts` passes `env: { ...process.env, PWD: resolve(repoRoot) }`.
- Launcher headless: the authoring runner must set `PWD` when spawning
  `opencode run`, and the displayed command should show the pinned directory
  (e.g. `PWD=<repo> opencode run …`) since it is no longer visible in argv.

In parallel mode the sandbox worktree path is the `PWD`, which keeps each task
pinned to its own worktree.

## Implementation plan (execute only after the verification gate)

### 1. Engine — `templates/skills/forge-workflow-engine/scripts/`

- `harness/run.ts:127-128` — delete the `bootMs` computation (interface already
  dropped the field).
- `cli.ts`
  - Remove the `keepalive.ts` import (line 164) and all
    `shouldKeepAlive` / `remainingTaskCount` / `KeepAliveDecision` usage.
  - Drop the `attachUrl` parameter from `resolveHarness` (182) and
    `buildOptions` (201, 220).
  - Delete the `keepAlive` parameter and the `Keep-alive:` line from
    `confirmPreRun` (248, 256–266, 287).
  - Delete `--attach` / `--keep-alive` / `--no-keep-alive` parsing and the
    sandbox `--attach` warning in `cmdRun` (343–372).
  - Collapse `runWithServer` (375–389) to `opts.harness = new OpenCodeAdapter()`.
  - Remove `attachUrl` from `cmdReplay` (504–505).
  - Relocate `remainingTaskCount` (still used at `cli.ts:360`) into `cli.ts` or a
    small module, since `keepalive.ts` is deleted.
- `cli.test.ts:9,49-112` — drop the `keepalive` import and the nine
  `shouldKeepAlive` tests.

### 2. Launcher — `scripts/forge-launcher/scripts/`

- `engine-run.ts` — remove `keepAlive` / `keepAlivePort` / `noKeepAlive` /
  `attach` from `EngineRunOptions` (24–27), resolution (62–65), the summary line
  (147), `engineFlags` (200–203), and `engineRunCli` cases (244–247).
- `cli.ts:26` — remove `--keep-alive` / `--keep-alive-port` / `--no-keep-alive` /
  `--attach` from the usage text.
- `engine-config.ts:8,20-21` — drop `keepAlive` / `attach` from
  `PersistedEngineConfig`.
- `console/control.ts:75-76` and `console/repo.ts:272-273` — remove those fields.
- `launcher.ts:971-972, 1788-1789, 2126-2127` — remove the flag pushes/env reads.

### 3. Launcher headless `--dir` (same v2 breakage)

- `authoring-inventory.ts:286` — drop `--dir repo` from the opencode argv.
- `launcher.ts` `runSkillHeadless` (627–665) — pass `PWD: state.repoDir` in the
  child env; `headlessCmdFor` (525) and `cmdStr` (629) must display the pinned
  directory another way.
- Tests: `authoring.test.ts:405,408`, `launcher.test.ts:409-427`,
  `resume.test.ts:76,98`.

### 4. Tests to remove/update

- `templates/skills/forge-workflow-engine/scripts/cli.test.ts` — keep-alive tests.
- `scripts/forge-launcher/scripts/engine-run.test.ts:33-71`,
  `launcher.test.ts:298-318`, `resume.test.ts:130-195`.
- Add: `harness/opencode-adapter.test.ts` asserting **no `--dir` in argv** and
  that the child env `PWD` equals the repo root (currently untested).

### 5. Docs and ADR (full retirement)

- New `docs/adr/058-opencode-v2-pwd-project-resolution.md`: v2 dropped `--dir`
  and `--attach`; `serve` requires auth; project dir travels via `PWD`;
  keep-alive/attach retired; **v2-only support**; migration note.
- Mark ADR-027 and ADR-031 **Superseded by ADR-058**; correct the keep-alive note
  in ADR-056:174-177.
- Update `docs/workflow-engine.md` (242, 264, 371–394, 530, 724),
  `templates/skills/forge-workflow-engine/SKILL.md` (145–157, 374, 570–572),
  `docs/workflow-engine-deep-dive.md` (240), `docs/forge-launcher.md` (107, 589),
  `docs/forge-console-user-guide.md`, `docs/parallel-execution-plan.md`
  (24, 122–141), the two `docs/research/claude-code-harness-adapter*.md` docs.
- Add a new `## September 2026 - v3.87` section at the top of `docs/updates.md`
  and bump the README `**Latest:**` line to v3.87.

## Verification (after implementation)

```bash
npm install && npm run typecheck && npm test   # in templates/skills/forge-workflow-engine
npm install && npm run typecheck && npm test   # in scripts/forge-launcher
```

Grep to zero across the repo: `--dir`, `--attach`, `keep-alive`, `keepAlive`,
`keepAlivePort`, `noKeepAlive`, `bootMs`, `opencode-server`, `keepalive`.

## Risks and open questions

- **Unverified v2 surface.** Everything depends on the v2 `run`/`serve` help
  output; confirm it before coding.
- **`PWD` cross-platform.** On POSIX `PWD` is normally set by the shell; on
  Windows it may be absent, so setting it explicitly is the safer direction, but
  v2's actual lookup order (`PWD` vs `process.cwd()`) must be confirmed.
- **Breaking CLI change.** Removing `--keep-alive` / `--attach` breaks scripts and
  persisted `docs/engine-config.json` files that set them; the ADR and changelog
  must say so plainly.
- **Windows path handling** for `PWD` and any remaining `--dir` assumptions.

## References

- `templates/skills/forge-workflow-engine/scripts/harness/opencode-adapter.ts`
- `templates/skills/forge-workflow-engine/scripts/cli.ts`
- `scripts/forge-launcher/scripts/engine-run.ts`
- `scripts/forge-launcher/scripts/authoring-inventory.ts`
- `docs/adr/027-workflow-engine-keep-alive-attach.md`
- `docs/adr/031-adaptive-keep-alive-and-budget-hints.md`
- `docs/adr/056-parallel-execution-task-sandboxes.md`
