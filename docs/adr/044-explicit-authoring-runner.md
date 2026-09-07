# ADR-044: Explicit authoring runner selection

- **Status:** Accepted
- **Date:** 2026-09-07
- **Supersedes:** the "default from harness" sentence in ADR-043

## Context

ADR-043 added `claude` to the authoring axis but left the runner implicit: it
came from `FORGE_RUN_WITH`, else a rule on the harness root. The Console's
`/api/authoring-inventory` returns only the chosen runner's models, so that rule
silently decided which models every stage could offer, and the Console had no
selector to change it. Worse, the Console's create-project path spawned
`forge-launcher --non-interactive` with the stage model flags but no runner at
all, so a wizard choice made against one runner's inventory could be applied by
another. ADR-043's hotfix restored the `opencode` default rather than fix the
axis.

## Decision

Treat the runner the way ADR-039 treats per-stage models. `AuthoringConfig`
gains an optional top-level `runner` of `copilot`, `opencode`, or `claude`.
`version` stays `1`: the field is optional, and older readers ignore it.

`selectAuthoringRunner(repo, harness, options, env)` mirrors
`selectAuthoringModel` and returns the runner with its source. First match wins:
the `--runner` flag on the main `forge-launcher` invocation (`invocation`),
`FORGE_RUN_WITH` (`environment`), the saved `runner` (`project`), else the
harness rule (`inherit`), which stays `copilot` for a GitHub harness and
`opencode` for everything else, including a Claude one. `docs/authoring-state.json`
records the source as `runnerSource` in each stage's invocation provenance.

`forge-launcher --runner <copilot|opencode|claude|inherit>` sets the runner for
one run; `forge-launcher authoring-config --runner <...>` persists it, where
`inherit` removes the key. `authoring-models --runner` is unchanged and stays
per-invocation. The Console's create-project path forwards the wizard's runner
to the spawned launcher as `--runner`, so the new repository persists it.

The Console gains an **Authoring runner** select (Inherit from harness,
OpenCode, Copilot, Claude Code) above the stage model selects in both the New
Project wizard and the project authoring settings panel. The stage dropdowns
follow the effective runner, changing it reloads the inventory without probing,
Save persists it, and Refresh probes the effective runner.
`GET /api/authoring-inventory` with no query resolves through the saved runner.

Stage input fingerprints do not include the runner, the same contract as
per-stage models: changing who authors a stage does not invalidate its output.

## Consequences

The environment still outranks the project, so `FORGE_RUN_WITH` remains the
escape hatch for a one-off run and for CI, and an existing project with no
`runner` key behaves exactly as before.

`stub` stays environment-only. It is an offline test fixture, not a runner a
project should persist or a flag should name, so `--runner stub` and a saved
`"stub"` both fail closed.

See `docs/research/console-authoring-runner-selector.md` for the scoping evidence.
