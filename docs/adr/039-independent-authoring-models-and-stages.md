# ADR-039: Independent authoring models and staged project authoring

**Date:** 2026-09-05
**Status:** Accepted

## Context

MyForge authoring previously coupled PRD, team, and project-skill generation.
That made it difficult to retry one stage, assign different models to each
stage, or distinguish an incomplete skills result from a valid project that
requires no project-specific skills. Execution-agent overrides and authoring
settings also lacked a separate persisted contract.

## Decision

Authoring is a staged pipeline with independent model selection:

1. `prd` - create or update the project requirements.
2. `team` - generate agents, ownership metadata, and skill candidates.
3. `skills` - reuse, extend, create, or omit project skill packages.

The team stage writes `docs/SKILL-CANDIDATES.json`:

```json
{
  "version": 1,
  "candidates": [
    {
      "name": "project-skill-id",
      "description": "Skill responsibility",
      "consumers": ["agent-id"],
      "action": "reuse",
      "reason": "Existing package satisfies the responsibility"
    }
  ]
}
```

The project-skill stage consumes that handoff and never creates or replaces the
execution manifest. `no-skills-required` is an explicit successful terminal
outcome. Missing, failed, or stale stage state blocks the next dependent stage
instead of being treated as an empty success.

Project authoring settings are stored separately from engine and
implementation-agent settings in `docs/authoring-config.json`:

```json
{
  "version": 1,
  "models": {
    "prd": "provider/model-id",
    "team": "provider/model-id",
    "skills": "provider/model-id"
  }
}
```

Each model is optional. Saving the config validates its versioned schema but
does not require live runner availability; unavailable saved choices are
preserved until invocation. Selection precedence is invocation override, stage
environment override, saved project setting, then runner inheritance.
`FORGE_PRD_MODEL`, `FORGE_TEAM_MODEL`, and `FORGE_SKILLS_MODEL` provide the
stage environment overrides. `inherit` clears a lower-level selection.
Explicit unavailable or incompatible models fail clearly; authoring does not
silently substitute another model or fall back to another authoring stage.

Authoring progress is persisted independently in
`docs/authoring-state.json`. Each stage may be `pending`, `running`, `complete`,
or `failed` and records input/output fingerprints, outputs, timestamps, errors,
and invocation provenance including runner, requested/effective model,
selection source, and the invoked argv/skill. The team-to-skills handoff is
immutable for the receiving stage: missing required handoff data fails closed,
while an empty or all-`omit` candidate list is a valid explicit
`no-skills-required` result. Authoring does not write compiler- or
engine-owned artifacts such as the execution manifest or workflow progress.
The launcher exposes separate `draft-prd`, `draft-existing-prd`, `draft-team`,
`draft-skills`, `compile-manifest`, `authoring-config`, and
`authoring-models` commands. Direct stage commands are headless; the optional
full `--headless` launcher flow also starts the native engine after preparation.
Supplying an existing PRD skips PRD drafting.
Readiness is an active authoring transaction gate, not a complete project
validation: legacy projects with no authoring markers remain eligible, while
callers still require the real PRD, team, and manifest prerequisites. Harness
selection uses the manifest pin before the shared fallback selector.

## Consequences

- PRD, team, and skills stages can use distinct models and be retried
  independently.
- A valid team does not need to be regenerated when project-skill generation
  fails.
- Legacy projects can retain their existing build path while entering staged
  authoring when new inputs require it.
- Console and CLI consumers can project persisted stage state without guessing
  readiness from directory existence.
- Authoring configuration remains independent from execution transport and
  implementation-agent model overrides.

## References

- [Forge Launcher](../forge-launcher.md)
- [Prompt Playbook](../prompt-playbook.md)
- [ADR-040: Native adapter request and lifecycle contracts](040-native-adapter-contracts.md)
