# ADR-023: Forge Launcher as a Node npm Package

**Date:** 2026-08-26
**Status:** Accepted
**Supersedes:** ADR-010 §1 "Script-first, zero new dependencies (Tier 1)" clause and its "Tier 2" deferral

---

## Context

ADR-010 introduced `forge-launcher` as a pair of pure shell scripts
(`scripts/forge-launcher.sh` + `scripts/forge-launcher.ps1`) with an explicit
decision that the launcher introduce **no new runtime dependencies** so it
"works anywhere the bootstrap scripts already work". A "Tier 2" interactive
frontend was deferred.

Since then the CLI surface has grown to **six** dual-implemented scripts -
`forge-launcher`, `bootstrap`, and `forge-engine-run`, each as a `.sh` and a
`.ps1` (~1100, ~190, and ~140 lines respectively). Every feature added since
ADR-010 (auto-draft stages, headless terminal mode, detached engine decision,
parallel dispatch, configurable task timeouts) had to be implemented twice, in
two languages, by hand-rolled I/O: bash readline + `tput` for Tab-complete
paths and spinners, PSReadLine `PSConsoleReadLine` hacks for the same.

Meanwhile the forge's actual workload is already Node/TypeScript: the workflow
engine, execution adapter, and workforce compiler all live as npm packages
under `templates/skills/`. Node is a *de facto* runtime for the forge already.

The dual maintenance has produced real behavioral drift. Example: the
"Launch GitHub Copilot CLI / claude / opencode now?" prompts default to **no**
in `forge-launcher.sh` but **yes** in `forge-launcher.ps1`. Two platforms,
two different behaviors, one undocumented.

---

## Decision

Replace the six shell scripts with a single **`forge-launcher` npm package**
implemented in Node/TypeScript with **one runtime dependency:
`@clack/prompts`** for the interactive TUI (clack `select`/`confirm`/`text`/
`multiline`/`path` prompts and spinners). Everything else uses Node built-ins
(`child_process`, `fs`). It exposes three subcommands that mirror the legacy
entry points:

| Legacy | New |
|--------|-----|
| `scripts/forge-launcher.sh` / `.ps1` | `forge-launcher` |
| `scripts/bootstrap.sh` / `.ps1` | `forge-launcher bootstrap` |
| `scripts/forge-engine-run.sh` / `.ps1` | `forge-launcher engine-run` |

The package bundles `templates/` and `docs/prompt-playbook.md` as resources so
it can bootstrap a new repo standalone (no forge clone required). During
development it resolves the live `templates/`/`docs/` first and falls back to
the bundled resources.

The legacy shell scripts are retained as **thin delegating wrappers** for one
release (so existing CI and docs paths keep working), then removed in the
following release.

---

## Consequences

### Positive

- **One codebase instead of six.** Features are written and tested once.
  Behavioral drift (e.g. the launch-prompt default divergence) is eliminated;
  the port fixes these to match the documented contract.
- **Cross-platform in a single file tree.** Windows users no longer need
  PowerShell 5.1+; macOS/Linux users get identical behavior.
- **Distribution without a clone.** `npx forge-launcher` from anywhere,
  versioned releases, no requirement to have the forge repository checked out.
- **Better interactive UX with less code.** A full clack TUI (`select`,
  `confirm`, `text`, `multiline`, autocomplete `path`, spinners) replaces the
  bash readline / PSReadLine hacks - the "Tier 2" frontend ADR-010 deferred is
  delivered in the same runtime, at the cost of a single small dependency.
- **One test suite.** `node --test` across the package replaces the bespoke
  bash test harness and the (never written) PowerShell equivalent.

### Negative

- **Node.js becomes a hard prerequisite.** This reverses ADR-010's "zero new
  dependencies" stance. Justification: forge users are software developers who
  already require Node to run the engine skills; the marginal cost is small and
  the maintenance saving is continuous. Users without Node can still install
  it, or use a legacy shell wrapper during the transition.
- **Interactive terminal still required.** The port keeps the prompt-based
  Tier-1 UX; a full-screen TUI remains future work (now trivial to add via the
  same runtime).
- **Path-resolution subtlety.** The package must know whether to read the live
  forge `templates/` or its bundled resources; this is a new packaging
  concern that the shell scripts never had.
- **Transition churn.** Tests, docs, and the testing guide all reference the
  shell scripts and must be updated.

### Neutral

- The interactive flow, flags, and environment-variable contract
  (`FORGE_HARNESS_CHOICE`, `FORGE_REPO_*`, `FORGE_IDEA`, `FORGE_PRD_FILE`,
  `FORGE_RESEARCH_FILES`, `FORGE_AUTO_DRAFT`, `FORGE_RUN_WITH`,
  `FORGE_WORKFLOW_ENGINE`, `FORGE_ENGINE_*`, `FORGE_YN_DEFAULT`,
  `FORGE_HEARTBEAT_INTERVAL`) are preserved unchanged, so automation and
  scripts keep working.
- Target repositories are unaffected: they still receive the skill packages
  (including their own Node engine) exactly as before.

---

## References

- Plan: [plan.md](../../plan.md)
- Superseded: [ADR-010 Forge Launcher](010-forge-launcher.md)
- Docs: [docs/forge-launcher.md](../forge-launcher.md)
- Legacy scripts: `scripts/forge-launcher.sh`, `scripts/forge-launcher.ps1`,
  `scripts/bootstrap.sh`, `scripts/bootstrap.ps1`,
  `scripts/forge-engine-run.sh`, `scripts/forge-engine-run.ps1`
- Engine packages (Node precedent):
  `templates/skills/forge-workflow-engine/package.json`,
  `templates/skills/forge-execution-adapter/package.json`,
  `templates/skills/forge-workforce-compiler/package.json`
