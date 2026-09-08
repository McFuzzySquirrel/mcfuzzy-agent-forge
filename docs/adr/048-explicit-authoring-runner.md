# ADR-048: Explicit authoring runner selection

- **Status:** Accepted
- **Date:** 2026-09-07
- **Supersedes:** the "default from harness" sentence in ADR-043

## Context

ADR-043 added `claude` to the authoring axis but left the runner implicit: it
came from `FORGE_RUN_WITH`, else a rule on the harness root. The Console's
`/api/authoring-inventory` returns only the chosen runner's models, so that rule
silently decided which models every stage could offer, and the Console had no
selector to change it. Worse, its create-project path spawned `forge-launcher
--non-interactive` with the stage model flags but no runner at all, so a wizard
choice made against one runner's inventory could be applied by another.

## Decision

Treat the runner the way ADR-039 treats per-stage models. `AuthoringConfig`
gains an optional top-level `runner` of `copilot`, `opencode`, or `claude`.
`version` stays `1`: the field is optional, and older readers ignore it.

`selectAuthoringRunner(repo, harness, options, env)` mirrors
`selectAuthoringModel` and returns the runner with its source. First match wins:
the `--runner` flag on the main `forge-launcher` invocation (`invocation`),
`FORGE_RUN_WITH` (`environment`), the saved `runner` (`project`), else the
harness rule (`inherit`), which stays `copilot` for a GitHub harness and
`opencode` for everything else, including a Claude one. `FORGE_RUN_WITH=stub` is
the one exception to that order: an offline lock that even `--runner` cannot
override. `docs/authoring-state.json` records the source as `runnerSource` in
each stage's invocation provenance.

`forge-launcher --runner <copilot|opencode|claude|inherit>` sets the runner for
one run; `authoring-config --runner <...>` persists it, where `inherit` removes
the key. `authoring-models --runner` stays per-invocation. The Console's
create-project path forwards the wizard's runner as `--runner` so it persists.

The Console gains an **Authoring runner** select (Inherit from harness,
OpenCode, Copilot, Claude Code) above the stage model selects in the New Project
wizard and the authoring settings panel. Stage dropdowns follow the effective
runner and reload without probing when it changes, Save persists it, Refresh
probes it, and `GET /api/authoring-inventory` with no query uses the saved one.

Stage input fingerprints do not include the runner, the same contract as
per-stage models: changing who authors a stage does not invalidate its output.

## Consequences

The environment still outranks the project, so `FORGE_RUN_WITH` remains the
escape hatch for a one-off run and for CI, and an existing project with no
`runner` key behaves exactly as before. `stub` stays environment-only: an
offline test fixture, not a runner a project should persist or a flag should
name, so `--runner stub` and a saved `"stub"` both fail closed.

An older launcher that rewrites `docs/authoring-config.json` (for example
`authoring-config --prd-model x`) rebuilds it without `runner` and so drops a
saved choice; the Console and the current launcher preserve it.

See `docs/research/console-authoring-runner-selector.md` for the scoping evidence.
