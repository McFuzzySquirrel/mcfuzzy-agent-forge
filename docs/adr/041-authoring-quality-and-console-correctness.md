# ADR-041: Authoring quality and Console correctness

- **Status:** Accepted
- **Date:** 2026-09-05
- **Supersedes:** The unfinished portions of the September 2026 modernization checkpoint

## Context

Authoring model selection, project-skill generation, and the Console had
separate contracts that could drift. Copilot inventory refresh previously used
a generative model prompt, the launcher recorded project skills after only a
frontmatter check, and asynchronous Console refreshes could discard user
selections or leave controls without listeners.

## Decision

Use runner metadata only for inventory discovery. Copilot refresh invokes
`copilot --help` and accepts only unambiguous model IDs exposed by that
non-generative interface. A failed or incomplete inventory is explicit; it is
never treated as evidence that an explicit model is available, and inherited
defaults remain unresolved.

Persist New Project authoring selections through the normal project-creation
configuration path, while ordinary stage overrides remain invocation-scoped.
Authoring fingerprints ignore dependency, build, coverage, and cache
directories so installation does not invalidate completed stages.

Keep one canonical JavaScript quality rubric and structural checker shared by
the team validator and `skill-review`. The launcher validates only affected
non-omit project-skill outputs, with structural and per-axis blocking before
the skills stage becomes complete or manifest compilation is allowed. Team
validation is agent-only until the independent skills stage; empty and
all-omit handoffs are explicit successful outcomes.

Make Console controls resilient to superseded async responses and same-project
snapshots. Preserve unavailable explicit model values across inventory or
harness changes, block retry while model settings are dirty or saving, expose
regeneration for stale completed stages, and refresh generated listings when
the selected project changes in place.

## Consequences

The Console may display an unavailable explicit model instead of silently
clearing it, which preserves user intent and produces an actionable save or
refresh decision. A Copilot CLI release that does not expose model IDs through
help metadata cannot provide an authoritative live list; explicit selections
must then use a verified inventory file or fail closed. Quality gates may
reject generated packages that previously passed average-only review, which is
intentional.
