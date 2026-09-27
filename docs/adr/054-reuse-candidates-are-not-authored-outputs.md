# ADR-054: `reuse` Candidates Are Not Authored Outputs

Status: Accepted

Refines: [ADR-039](039-independent-authoring-models-and-stages.md)

## Context

The team stage writes `docs/SKILL-CANDIDATES.json`, where each candidate
carries one of four actions: `reuse`, `extend`, `create`, or `omit`. The
project-skill stage then derives its required outputs from that handoff.

`validateAuthoringOutputs` filtered candidates with `action !== "omit"`, so a
`reuse` candidate was treated exactly like `create`/`extend`: the stage had to
produce a non-empty `<harness-root>/skills/<name>/SKILL.md` and that package
had to pass the structural and quality checkers. The offline stub runner in the
same file already disagreed, skipping both `omit` and `reuse`.

The two semantics are not compatible. A `reuse` candidate exists precisely
because the package resolves *outside* this repository — a globally installed
package or an upstream one. Requiring a project-local copy reintroduces exactly
the version drift `reuse` exists to prevent, so any project whose team
legitimately reused an existing package could not complete the skills stage.
This was found in practice while authoring a project whose handoff marked a
globally installed guidance package as `reuse`.

ADR-039 established that `no-skills-required` is an explicit successful terminal
outcome, but did not say how the flag relates to the count of authored outputs.
Deriving it from that count silently overloading two different facts: "no skill
was authored here" and "no skill is required". For an all-`reuse` handoff both
are distinguishable, and conflating them would misreport required skills as
unnecessary.

## Decision

- Derive the project-skill stage's required outputs from **authored** actions
  only: `create` and `extend`. `omit` and `reuse` are not outputs, are not
  existence-checked, and are not passed to the structural or quality checkers.
  This aligns the validator with the stub runner.
- Do not verify `reuse` targets. The launcher knows no harness's global skill
  roots, so a resolution check would either be skipped or produce false
  warnings. A `reuse` name that resolves nowhere is a team-owned assertion the
  launcher does not confirm; a team that needs a package actually validated
  should choose `extend`. Documented as a known limit rather than left
  accidental.
- Derive `noSkillsRequired` from the handoff, not from the output count: it is
  true only for an empty candidate list or an all-`omit` list, matching the
  existing no-model fast path and the `forge-build-project-skills` contract.
- Record the reused names in a new optional `reusedSkills` field on the
  skills-stage state, so an all-`reuse` completion is distinguishable and
  auditable from an all-`omit` one without adding another overloaded boolean.
- Keep invoking the model for an all-`reuse` handoff. It is not an
  empty-success fast path: the stage's reconciliation mode adopts and checks
  existing packages, which is real work.

## Consequences

- A handoff containing `reuse` candidates can now reach `ready: true` with no
  project-local package, unblocking the skills stage for reuse-driven projects.
- Because `reusedSkills` is advisory, a reused package that is later removed
  from its global root is not detected by readiness. There is nothing authored
  locally to fingerprint, and the input fingerprint does not cover global roots.
- A project that relied on the old behavior to be forced to vendor a local copy
  of a reused package will no longer get that copy. Such a team should be
  revised to `extend` if the project genuinely owns the package.
- `outputs` for the skills stage now means "packages authored in this
  repository". Consumers that display an output count for an all-`reuse` stage
  see zero authored packages alongside a `complete` status; `reusedSkills`
  carries the rest of the picture.

## Alternatives considered

- **Vendor a stub package for every `reuse` candidate.** Keeps the output count
  nonzero, but a project-local package shadows the global one in harness
  resolution order and reintroduces the drift `reuse` prevents. Rejected.
- **Add a second boolean such as `allReused`.** Works, but grows the state
  surface with another flag that must be kept consistent with `outputs` and
  `noSkillsRequired`. A named list of reused skills is both more informative
  and self-describing.
- **Verify `reuse` against a hardcoded list of known global skill roots.**
  Catches typos in team handoffs, but the list goes stale as harnesses change
  their layouts and would emit false warnings for any harness using another
  one. Rejected as a warning-producing heuristic with a maintenance cost.
- **Block all-`reuse` handoffs like all-`omit`.** Saves a model session, but
  skips the reconciliation pass and contradicts the stage's documented contract.
  Rejected.
