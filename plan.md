# Plan: Consolidate Forge CLI Scripts into a Single `forge-launcher` npm Package

**Branch:** `optimization/task-breakdown`
**Status:** Complete
**Decision:** [ADR-023: Forge Launcher as a Node npm Package](docs/adr/023-forge-launcher-npm-package.md)

## Problem

The forge CLI surface is implemented twice, once per platform, for every entry
point:

| Entry point | Bash | PowerShell | Approx. lines each |
|-------------|------|-----------|--------------------|
| `forge-launcher` | `scripts/forge-launcher.sh` | `scripts/forge-launcher.ps1` | ~1100 |
| `bootstrap` | `scripts/bootstrap.sh` | `scripts/bootstrap.ps1` | ~190 |
| `forge-engine-run` | `scripts/forge-engine-run.sh` | `scripts/forge-engine-run.ps1` | ~140 |

Every feature since ADR-010 (auto-draft, headless, engine decision, parallel
dispatch, task timeouts) must be written twice in two languages. The two
implementations have already drifted on behavior - e.g. the "Launch GitHub
Copilot CLI / claude / opencode now?" prompts default to **no** in
`forge-launcher.sh` (`prompt_yn`, default `n`) but **yes** in
`forge-launcher.ps1` (`Read-YesNo ... "y"`). The interactive UX (Tab-complete
path input, spinners, heartbeats) is hand-rolled with bash readline / PSReadLine
hacks and `tput`.

The heavy-lifting tooling (workflow engine, execution adapter, workforce
compiler) is already Node/TypeScript under `templates/skills/`. The CLI layer is
the only part that isn't.

## Goal

1. A single **`forge-launcher` npm package** (Node/TypeScript) that replaces
   all six shell scripts.
2. Cross-platform in one codebase; Windows users stop needing PowerShell 5.1+.
3. Installable/runnable anywhere: `npx forge-launcher`, versioned releases -
   no need to clone the forge repo first.
4. Bundle `templates/` + `docs/prompt-playbook.md` as package resources so the
   package bootstraps standalone.
5. Keep `scripts/*.sh|.ps1` as legacy wrappers that delegate to the Node
   package until parity is proven, then remove them.
6. **Interactive TUI** (full) built on `@clack/prompts` - the only runtime
   dependency - replacing the hand-rolled bash/PSReadLine UX with clack
   `select`/`confirm`/`text`/`multiline`/`path` prompts and clack spinners for
   long-running steps (output tee'd to a per-run log).

## Design

Single package at `scripts/forge-launcher/` with three subcommands:

```
forge-launcher                          # full 9-step interactive flow
forge-launcher --non-interactive
forge-launcher --headless [--dry-run]
forge-launcher --draft
forge-launcher bootstrap [TARGET] [--harness H] [--force]
forge-launcher engine-run --repo R [--harness H] [--concurrency N]
                             [--task-timeout-ms M] [--yes] [--dry-run]
```

Structure:

```
scripts/forge-launcher/
  package.json          # name: forge-launcher, bin: forge-launcher
  tsconfig.json
  resources/            # copies of templates/ + docs/prompt-playbook.md
    templates/agents/…
    templates/skills/…
    prompt-playbook.md
  scripts/
    cli.ts              # entry; arg parsing + subcommand dispatch
    paths.ts            # expandPath, resolveInputFile, detectRepoRoot
    prompts.ts          # TUI prompts (clack select/confirm/text/multiline/path
                        #   when TTY; readline fallback when piped), cancel handling
    terminal.ts         # spawn CLI in a separate terminal (cross-platform)
    format.ts           # colors + step/ok/warn/fail/info + spinner + runLogged
    launcher.ts         # the 9-step flow (port of forge-launcher.sh)
    bootstrap.ts        # template deployment (port of bootstrap.sh)
    engine-run.ts       # standalone engine runner (port of forge-engine-run.sh)
  scripts/*.test.ts     # node --test, mirrors test-forge-launcher.sh surface
```

Runtime dependency: `@clack/prompts` (interactive TUI). Compiled `dist/` ships
to consumers; `tsx`/`typescript` remain devDependencies.

Dev-time resolution order for resources: `../../templates`, `../../docs` (the
live forge repo) first; fall back to bundled `resources/`. Published package
ships `resources/` only.

## Phases

### Phase 1 - Decision

- Write **ADR-023** superseding ADR-010's "zero new dependencies / Tier 1"
  clause. Justification: Node is already the forge runtime (engine skills), the
  drift between the two implementations is a real defect, and a single
  language + test suite beats two. Document the trade-offs (Node becomes a
  prerequisite; interactive terminal still required for Tier-1 UX).

### Phase 2 - Scaffold the package

- `scripts/forge-launcher/` with `package.json` (bin `forge-launcher`),
  `tsconfig.json` (mirror the engine package: ES2022, strict, tsx), and empty
  module skeletons.
- `resources/` staging script or `files` field wiring to bundle
  `templates/` + `docs/prompt-playbook.md` for the published package.

### Phase 3 - Port `bootstrap`

- `bootstrap.ts`: harness→root mapping (agents→`.agents`, github→`.github`,
  claude→`.claude`, opencode→`.opencode`), copy agents + skills +
  prompt-playbook, exclude `node_modules`/`dist`, `.agents/` → `ROOT/` path
  rewrite in `.md` files for non-default harnesses, `.gitignore` hygiene
  (`node_modules/`, `docs/engine-run.log`), overwrite confirmation honoring
  `--force`.
- Legacy `scripts/bootstrap.sh|.ps1` become thin wrappers that exec
  `forge-launcher bootstrap`.

### Phase 4 - Port `forge-launcher` (9-step flow)

Faithful port of `forge-launcher.sh`:
1. Pre-flight (git/gh/copilot/opencode/claude; exit if git missing).
2. Harness selection (numbered menu; `FORGE_HARNESS_CHOICE`).
3. Repo creation (`gh repo create --clone` or `git init` + optional remote;
   `FORGE_REPO_*`).
4. Bootstrap delegation → `bootstrap.ts`.
5. Idea capture (multi-line; `FORGE_IDEA`; `docs/IDEA.md` + `IDEA.md`).
6. PRD + research/seed docs (`FORGE_PRD_FILE`, `FORGE_RESEARCH_FILES`, paste).
7. Commit + push (`chore: bootstrap MyForge`).
8. Auto-build launch: auto-draft menu (`--draft` / `FORGE_AUTO_DRAFT=1`),
   headless mode (`--headless` / `FORGE_RUN_WITH` / `FORGE_WORKFLOW_ENGINE`),
   engine decision (detached run / print command / skip), CLI spawn
   (`copilot`/`opencode`/`claude` in a separate terminal).
9. Completion summary.

**Drift fixes while porting:**
- Launch-CLI prompt default becomes `n` everywhere (matches bash / documented
  `[y/N]`), fixing the ps1 `y` divergence.
- The engine command printed in Steps 8/9 references the new
  `forge-launcher engine-run` (not the shell script).
- Long-running steps show a clack **spinner** (elapsed message honours
  `FORGE_HEARTBEAT_INTERVAL`); output is tee'd to a per-run log in
  `os.tmpdir()` (`forge-launcher-<pid>.log`) so nothing is lost, with the log
  tail printed on failure. When stdout is not a TTY (CI/piped) the step runs
  directly with no spinner, keeping output clean.

### Phase 5 - Port `forge-engine-run`

- `engine-run.ts`: repo detection (walk up for `.git`), locate bootstrapped
  `forge-workflow-engine` / `forge-execution-adapter` under the harness dirs,
  adapter install + manifest compile, engine `npm install`, then
  `npm run workflow-engine -- run` with harness/concurrency/task-timeout/yes
  flags; `--dry-run` prints only. Honor `FORGE_ENGINE_*` env vars.
- Detached engine start (used by launcher Step 8 choice 1) uses
  `child_process.spawn(..., { detached: true, stdio: [log] })`.

### Phase 6 - Interactive TUI (full)

- Add `@clack/prompts` as the package's **single runtime dependency**.
- `prompts.ts`: clack `select` (harness, PRD menu, engine decision), `confirm`
  (all yes/no), `text` (repo name/description/visibility), `multiline` (idea /
  PRD paste, Enter-twice submits), and `path` (autocomplete file/dir picker
  replacing hand-rolled Tab completion) - each with a readline fallback for
  piped/non-TTY stdin and `isCancel` → clean exit (code 130).
- `format.ts`: `runWithHeartbeat` becomes a clack **spinner** (message updates
  honour `FORGE_HEARTBEAT_INTERVAL`); new `runLogged` tees child output to a
  per-run log; `printLogTail` surfaces the log on failure.
- Long-running steps (gh repo create, bootstrap, git push, headless skill
  runs) route through spinner + tee-log.
- Verified end-to-end under a pty (pexpect): full interactive run completes
  with idea captured, templates bootstrapped, and the bootstrap commit created.

### Phase 7 - Tests

- Port the `test-forge-launcher.sh` acceptance surface to `node --test`
  (consistent with the engine packages): static content checks move to
  unit tests on the TS modules; non-interactive end-to-end runs assert the
  created directory layout per harness.
- `scripts/test-forge-launcher.sh` stays as the legacy oracle until parity is
  confirmed, then is retired.
- Bootstrap and engine-run get focused unit tests (harness mapping, path
  rewrite, gitignore hygiene, repo-root detection).
- Interactive TUI is covered by the non-interactive suite (clack is bypassed
  when stdin/stdout are not TTY) plus the pexpect-driven pty smoke run.

### Phase 8 - Docs

- Rewrite `docs/forge-launcher.md` usage to `npx forge-launcher …`;
  document subcommands, flags, and env vars (unchanged contract).
- Update `docs/testing-guide.md` commands and `README.md` quick-start.
- Mark `scripts/*.sh|.ps1` as legacy delegating wrappers.

### Phase 9 - Deprecate / remove shell scripts

- Convert `scripts/forge-launcher.sh|.ps1`, `bootstrap.sh|.ps1`,
  `forge-engine-run.sh|.ps1` into thin wrappers delegating to the package
  (kept for CI/scripts that invoke them), or delete them once docs + tests no
  longer reference them. Decision: **keep as delegating wrappers** for one
  release, delete in the following release.

### Phase 10 - Verify

- `npm test` (all packages) and `npm run typecheck` in the new package.
- Run the launcher `--non-interactive --dry-run` and a full non-interactive
  bootstrap smoke test into a temp repo.
- `npm pack` → install the tarball globally → run the bundled-resources path
  standalone from outside the forge repo.
- Interactive pty run (pexpect) exercising every prompt type.

## Out of scope

- Bundling `bootstrap`/`forge-engine-run` from target repos - the launcher only
  bootstraps *from* the package; target repos keep their skill packages.
- Publishing to npmjs.org in this plan (local `npm pack` + `npx` smoke only).

## Future work

Open items deliberately not done in this plan - candidates for a follow-up.

### Publish the package

- Publish `scripts/forge-launcher/` to npmjs.org (or a private registry) as
  `forge-launcher` v1.0.0. `npm pack` + a `prepack` staging step are verified;
  actual publishing (auth, scoping, CI release) is not.
- Add a release workflow (GitHub Actions on tag → `npm publish`).
- Decide whether a repo-side `scripts/` entry point is still needed once
  published, or if `npx forge-launcher` fully replaces it.

### Delete the legacy shell wrappers (next release)

- `scripts/forge-launcher.sh|.ps1`, `bootstrap.sh|.ps1`,
  `forge-engine-run.sh|.ps1` are kept as thin delegating wrappers for one
  release. Once docs + tests no longer reference them, delete them.
- Retire `scripts/test-forge-launcher.sh` and
  `scripts/smoke-test-launcher-terminal-support.sh` (currently delegating
  runners) when the wrappers go.

### Full-shell wrapper robustness

- The bash wrappers prefer `dist/cli.js` (built), then `tsx`. In a fresh clone
  without `npm install` they print a build hint. Consider compiling on
  install (postinstall) or committing `dist` so wrappers always work offline.

### Behavioural parity checks (minor)

- Multi-line idea/PRD capture uses clack `multiline` (Enter-twice submits) in a
  TTY and a blank line in the readline fallback; bash used Ctrl+D. Confirm the
  documented interaction matches.
- The detached engine start in Step 8 writes to `docs/engine-run.log` via
  `child_process` spawn; verify `.out`/`.err` split used by the ps1 variant is
  not needed by consumers.
- Spinner steps require a TTY on stdin **and** stdout; bash only checked
  stdout. Confirm CI behaviour is identical.

### Web / richer frontend

- The interactive layer is now a clack TUI. A separate web UI (e.g. a local
  `localhost` wizard) or full-screen terminal UI could be layered on top of
  the same prompt functions.

### Package hygiene

- The package ships compiled `dist/`; runtime deps are just `@clack/prompts`.
  `tsx`/`typescript`/`@types/node` remain devDependencies. Revisit whether the
  `bin` should point at a compiled entry (already `dist/cli.js`) once the
  publish workflow exists.
- Consider splitting `bootstrap`/`engine-run` into their own bin entries
  (`forge-bootstrap`, `forge-engine-run`) if subcommand discoverability
  becomes an issue.
