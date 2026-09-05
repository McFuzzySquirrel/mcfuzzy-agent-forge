---
name: forge-build-project-skills
description: "Independently generate and review project skill packages from docs/SKILL-CANDIDATES.json. Use for full, headless, incremental, or reconciliation skill stages that must preserve stable IDs, unaffected files, and per-axis quality gates."
---

# Skill: Build Project Skills

Coordinate the independent project-skill stage after `forge-build-agent-team`.
This stage consumes `docs/SKILL-CANDIDATES.json`, reuses `skill-creator` for
scaffolding and `skill-review` for review, and writes only the packages
selected by the handoff. It never regenerates the team or creates an execution
manifest.

Load [`references/mode-contract.md`](./references/mode-contract.md) when
resuming, reconciling legacy packages, or deciding whether an input fingerprint
invalidates an existing candidate.

## Process

### Step 1: Resolve the stage contract

Load and validate the immutable team-owned handoff. A missing or malformed
handoff fails. Only a valid `{ "version": 1, "candidates": [] }` handoff, or a
valid candidate list whose actions are all `omit`, completes explicitly as
`no-skills-required` without model generation. Legacy projects without a
handoff keep the old build path until an explicit draft-team stage adopts them.
Resolve explicit harness, headless, authorization, supplied-answer, and
skills-model arguments before invoking a runner. Explicit incompatible settings
fail with diagnostics; do not silently substitute a model or harness.

Support these modes:

- **Full:** create or reconcile every planned candidate.
- **Headless:** run the same steps without prompts, using explicit authorization
  and supplied answers.
- **Incremental:** process only candidates whose inputs changed; preserve all
  unaffected packages and manifest IDs.
- **Reconciliation:** adopt valid existing packages and repair only missing or
  invalid outputs.

### Step 2: Decide reuse, extension, creation, or omission

For each changed candidate, inspect the existing package and its references.
Choose the handoff action deterministically:

1. `reuse` when the existing package satisfies the responsibility and review
   gate.
2. `extend` when it satisfies the identity but needs additive guidance.
3. `create` when no suitable package exists.
4. `omit` when the team responsibility is no longer justified; preserve the
   package unless reconciliation explicitly marks it retired.

Use `skill-creator`'s interview/template/preflight flow for `create` and
substantial `extend` work. Do not copy a generated package over an unaffected
file.

### Step 3: Review and enforce quality

Run `skill-review` against the changed package set with structural and per-axis
blocking enabled:

```bash
cd <skill-review-package>
npm run skill-review -- --files <affected-skill>/SKILL.md --provider stdout \
  --min-score 2 --fail-below --min-axis 2 \
  --fail-axis-below --fail-structural
```

Every axis must meet the threshold; a strong average cannot offset a failing
axis. Invalid frontmatter, missing required sections, missing referenced files,
and malformed Markdown structure are blocking. Keep heuristic scores separate
from behavioral evidence and report both. Never scan every bootstrapped
`forge-*` tooling skill as a newly generated project skill; pass only the
affected handoff candidate files.

### Step 4: Persist and reconcile

Leave `docs/SKILL-CANDIDATES.json` unchanged; it is immutable team-owned input
and participates in backend fingerprints. Write review evidence to separate
skill-review artifacts and report stage status through the launcher-owned
`docs/authoring-state.json`. A failed candidate is retryable without
regenerating a valid team. Changed team inputs invalidate readiness only for
affected candidates.

## Required outputs

- Validated packages under the active harness skills directory.
- Separate skill-review evidence artifacts.
- Launcher-owned `docs/authoring-state.json` skills-stage status.
- No `docs/EXECUTION-MANIFEST.json` creation or replacement.

## Gotchas

- **Team-stage boundary.** `forge-build-agent-team` writes agents and candidates,
  not skill packages; creating packages there breaks independent model routing.
- **Average-only review is unsafe.** One axis below threshold or one structural
  error blocks even when the overall score is high.
- **No-skills is success only when explicit.** Missing or malformed handoffs
  fail; only an empty candidate list or all-omit list completes without model
  generation.
- **References are files.** A Markdown link to a missing reference is a
  structural failure, not an advisory warning.

## Validation

- [ ] Handoff exists and validates as immutable version 1.
- [ ] Full/headless/incremental/reconciliation mode was recorded.
- [ ] Every changed candidate has a stable name and valid action.
- [ ] Unaffected packages and manifest IDs are byte-for-byte unchanged.
- [ ] `skill-review` passes with `--fail-axis-below --fail-structural`.
- [ ] No execution manifest was created or modified.
