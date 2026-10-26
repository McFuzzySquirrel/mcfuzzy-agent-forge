# ADR-071: System-level console defaults

**Date:** 2026-10-26
**Status:** Accepted
**Relates to:** ADR-034 (Forge Console web UI), ADR-003 (per-agent model assignment), ADR-062 (console re-derivation chain)

## Context

Authoring and execution preferences are stored per project: authoring runner and
stage models in `docs/authoring-config.json`, agent overrides in
`docs/model-overrides.json`, and execution prefs (concurrency, auto-commit,
harness-activity logging, build mode) in `docs/engine-config.json`. A user who
wants every new project to author with Claude, or to default to a higher
concurrency, has to repeat those choices in each repository. There is no single
place to set a default that projects inherit.

The Forge registry directory (`FORGE_HOME`, or `~/.myforge`) already exists as
the user-level Forge state directory, and project removal already treats a
`settings.json` there as shared state that must be preserved.

## Decision

1. **Store system-level defaults in `settings.json` in the registry directory.**
   A new `settings.ts` module owns the path, a strict `validateSettings` (used by
   writes), a lenient `loadSettings` (used by the resolution ladder), and an
   atomic `saveSettings`. The shape is `{ version, authoring, execution, harness,
   ui }`.
2. **Extend the authoring ladder with a "system" source.** `selectAuthoringModel`
   and `selectAuthoringRunner` consult the global default after the project value
   and before inheritance, so the effective order is: invocation override →
   environment → saved project recommendation → system default → runner default.
   A new `"system"` provenance value records when a global default supplied the
   model or runner. The global settings are an optional trailing parameter,
   defaulting to `loadSettings()`, so callers and tests can inject them.
3. **Inherit execution defaults beneath the project config.** `effectiveExecution`
   merges the global `execution` defaults under `docs/engine-config.json`, with
   each unset field falling back to the system default and then the engine's own
   default. Selection and execution-mode are deliberately excluded: they describe
   the current run's chosen task set and are never inherited.
4. **Expose `GET`/`PUT /api/settings`** on the Console, token-gated for writes and
   consistent with the existing authoring/engine config endpoints. Saving
   broadcasts a snapshot so the Settings and Overview surfaces reflect the new
   defaults immediately.
5. **Pre-fill the New Project wizard** from the global harness, authoring runner,
   and concurrency defaults.

## Consequences

- A user sets defaults once and every new project inherits them; any explicit
  per-project value still wins, so no existing repository changes behavior
  unless it had no explicit value.
- The system default is a new provenance source, so diagnostics and the CLI
  summary can tell a global default from a project or environment choice.
- A corrupt `settings.json` degrades to defaults rather than breaking authoring
  or a run, and is never clobbered on read; writes are atomic and validated.
- `ui` preferences (theme, board mode) are reserved in the schema for the
  follow-on Settings view and are not yet consumed by the UI.

## References

- Settings module: `scripts/forge-launcher/scripts/settings.ts`.
- Ladder: `scripts/forge-launcher/scripts/authoring-config.ts`.
- Execution merge: `scripts/forge-launcher/scripts/engine-config.ts`.
- API: `scripts/forge-launcher/scripts/console/server.ts`.
- Changelog: [updates.md](../updates.md), v3.107.
- Plan: [forge-console-ui-overhaul-plan.md](../forge-console-ui-overhaul-plan.md).
