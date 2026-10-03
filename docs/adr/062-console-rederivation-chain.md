# ADR-062: Re-derive the team and project skills as one chain

Status: Accepted

Relates to: ADR-060 (requirements authoring is always interactive), ADR-051
(interactive authoring from the Console), ADR-026 (the Forge Board),
`docs/forge-board-and-rederive-plan.md`.

## Context

Editing a PRD or a feature document makes the agent team and the project skills
stale, and the user has to regenerate both. That was a five-hop scavenger hunt
spread over three Console views, and the affordances were hidden at exactly the
moment they were needed:

1. Overview → Controls → **Reset changed tasks for review**.
2. The Overview Manifest panel printed `reconciliation.changedTaskIds` as one
   comma-joined mono string.
3. Plan & Team → Team → **Regenerate TEAM** — a button `hidden` unless the stage
   had failed or the server named it as `authoringNextStage`.
4. Wait for the team job; the Skills button then appeared under the same
   conditional. Nothing indicated that it was now possible.
5. Compile the manifest again, then reset changed tasks again.

The cause was not the UI alone. `authoring-state.ts` already records each
stage's `inputFingerprint`, `outputFingerprint` and `completedAt`, and
`authoringStageIsCurrent()` compares them — but `authoringReadiness()` collapsed
all of that into `{ ready, reason, nextStage }`. The Console therefore learned
only *that* authoring was not ready plus one free-text blocker, never *which*
input had changed, *when*, or that a single action could fix it. Meanwhile the
launcher CLI already chained team → skills → manifest
(`launcher.ts`, `autoDraftTeam`), and the Console had no route into it.

## Decision

Add a **re-derivation chain**: one background job that regenerates the team,
then the project skills, then recompiles the manifest, with its progress
persisted to `docs/rederive-state.json`.

- **A persisted step machine.** `docs/rederive-state.json` records the run id and
  each of the three steps with its status, message and timestamps. A client that
  reloads mid-run resumes the step machine instead of showing an undifferentiated
  spinner. A malformed file throws rather than reading as "never run": silently
  resetting it would leave the UI claiming a stage is fine to re-derive while it
  is being regenerated.
- **Retry from a named step.** `--from team|skills|manifest` restarts the chain
  at that step, re-running it and its tail. Starting a step returns every later
  step to pending, because a regenerated team invalidates the skills and manifest
  derived from the previous one.
- **Two hard limits.**
  - *No PRD step.* ADR-060 makes requirements authoring interactive, so the chain
    starts at the first derivation and refuses to run without a committed
    `docs/PRD.md` plus `docs/features/*.md` — pointing at the interactive
    session rather than authoring requirements headlessly.
  - *No task reset.* `resetChangedCompletedTasks` clears completed tasks'
    outputs and artifacts. Automating it as the tail of a background job would
    destroy finished work without a deliberate confirmation, so the chain ends at
    the manifest and then *offers* the reset.
- **Staleness is explained by deriving it.** `explainStaleness()` compares the
  stored fingerprints against fresh ones and then names the offending files by
  comparing each stage input's mtime against the stage's `completedAt`. The
  fingerprint scheme is unchanged, so nothing migrates, and the named files are
  always a subset of what the decision actually covers. A recorded reason would
  be missing for every stage authored before this change and would itself go
  stale.
- **A blocked action is visible, not absent.** Every stage action stays rendered
  and is disabled with a stated reason ("already up to date with its inputs",
  "save authoring model changes first", "another authoring job is running")
  rather than hidden.
- **The destructive action moves to its data.** **Reset changed tasks for review**
  moves into the Manifest panel beside the reconciliation it acts on, behind a
  confirmation naming every task it will reset.

## Consequences

Positive:

- One click fixes the common case, with per-step progress that survives a reload
  and a retry that starts where it failed.
- The Console names the file that changed and when, on both Overview and Plan &
  Team, instead of reporting only "not ready".
- Requirements authoring stays interactive (ADR-060 intact), and completed work
  is never discarded without an explicit confirmation.

Negative:

- A new persisted artifact (`docs/rederive-state.json`) and a new job type to
  recognise. It is deliberately separate from `authoring-state.json`: that file
  records stage *results* and is written by the stage runners, whereas this
  records the progress of the chain that runs them.
- The chain regenerates a whole team. It is deliberately not automatic and not
  offered for the `prd` stage.

## Alternatives considered

- **A client-side loop over three `api.control()` calls.** Loses all progress on
  reload, cannot express per-step failure, and races with the "a job is already
  running" guard as soon as the user clicks twice.
- **Including the reset behind a flag.** A flag does not create consent at the
  moment of the click.
- **Storing a human-readable staleness reason at authoring time.** Absent for
  every pre-existing stage, and it would go stale on its own.