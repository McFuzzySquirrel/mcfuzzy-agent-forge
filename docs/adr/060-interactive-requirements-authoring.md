# ADR-060: Requirements authoring is always interactive

Status: Accepted

## Context

MyForge's core value driver is that the PRD and its canonical features are
*correct* before anything is built. Everything downstream of them is
deterministic and mechanical: team generation derives agent personas and
ownership from the requirements, the execution adapter compiles
`docs/EXECUTION-MANIFEST.json` from them, and the workflow engine executes the
resulting tasks. That is a strength, because it means quality is fully
determined by the one artifact a human can meaningfully judge.

It is also a liability when the input is wrong. A headless requirements stage
that infers scope, technology choices, and acceptance criteria from defaults
produces a *confidently incorrect* specification, and the rest of the pipeline
then implements it faithfully. The result is a green, passing, entirely wrong
build — the one failure mode nothing downstream can detect or recover from.
The cost of that failure is the whole project, not one stage.

MyForge nevertheless offered non-interactive requirements authoring through
three independent doors:

1. **Skill contracts.** `forge-build-prd` had an explicit opt-out that skipped
   the clarifying interview entirely and recorded default assumptions under
   **Open Questions**, plus a second opt-out that presented the review
   checklist without blocking for approval. `forge-auto-build-prd`,
   `forge-decompose-prd` and `forge-grill-idea` propagated equivalent
   allowances. Each fired on any of three triggers: `FORGE_HEADLESS=1`, embedded
   "headless / auto-proceed" text in the invocation, or a non-interactive
   invocation.
2. **The launcher.** `--draft` and `FORGE_AUTO_DRAFT` pre-answered a
   yes/no "Generate the PRD automatically now (headless)?" prompt;
   `forge-launcher --headless` chained PRD → team → skills → manifest → engine
   unattended; and `draft-prd` / `draft-existing-prd` / `feature-prd` /
   `feature-increment` subcommands plus `FORGE_IDEA` completed the unattended
   path from a one-line idea. In `resume`, the PRD menu defaulted to the
   headless option, so pressing Enter authored an unreviewed PRD.
3. **The Console.** The Overview pipeline card offered the headless run as a
   secondary `autoLabel` beside the interactive session, and the authoring
   stage buttons in the documents view dispatched headless jobs.

The three doors were independent, so removing only the visible toggle would
have left the others open: any caller invoking `/forge-build-prd` with
`FORGE_HEADLESS=1` still self-authorized a non-interactive run.

## Decision

**Requirements authoring is always interactive. Derivation from a reviewed PRD
stays headless.**

The line is drawn between authoring requirements and deriving from them. Team
generation and project-skill generation are mechanical derivations of documents
a human has already reviewed; their output is cheap to review, easy to
regenerate, and wrong in ways that are obvious. They remain headless so
unattended operation still works for CI and for rebuilding a project whose
requirements are already settled.

Every operation that writes requirements is now interactive:

| Operation | Skill | Path |
|---|---|---|
| Idea → vision + features | `forge-auto-build-prd` → `forge-build-prd` | new projects |
| Existing repository → project PRD | `forge-build-prd` | bootstrapping an existing repo |
| Feature PRD / increment | `forge-build-feature-prd` | adding a feature |
| Legacy document conversion | `forge-decompose-prd` | importing an older PRD |
| Idea sharpening | `forge-grill-idea` | pre-PRD grilling |

`forge-decompose-prd` is not in the new-project path — new solutions author
vision and features directly through `forge-build-prd`, and features are
mandatory at every size. Decomposition only fires when importing or
reorganizing pre-existing source documents. It is included because it makes the
same class of decision (feature boundaries, task partitioning) and its only
headless allowance was a single clause, so the rule is exception-free at
negligible cost.

Enforcement is layered so that no single caller can reopen the path:

- **Skill contracts are the enforcement.** `forge-build-prd`, `forge-auto-build-prd`,
  `forge-decompose-prd` and `forge-grill-idea` no longer contain a headless
  authoring allowance. A non-interactive invocation records the missing decisions
  as blocking questions rather than default assumptions. A shared rule states
  that requirements authoring must not proceed without a conversational session.
- **The launcher stops offering it.** The PRD branches of the auto-draft flow,
  `PRD_HEADLESS_MSG`, `EXISTING_PROJECT_PRD_MSG`, `runDraftPrdInternal`,
  `runDraftExistingPrdInternal` and the unattended PRD step in the `--headless`
  chain are removed. `--draft` and `FORGE_AUTO_DRAFT` are retargeted to the team
  and project-skill stages only, and the `resume` PRD menu defaults to opening
  the interactive session. `runSkillHeadless` no longer exports
  `FORGE_HEADLESS=1` for a requirements stage.
- **The Console drops the secondary action.** The Overview pipeline card and the
  documents authoring buttons route the requirements stages to the existing
  `POST /api/authoring/session` interactive sessions, which were already the
  primary action.

`--non-interactive` remains supported for bootstrapping and for the
team-and-beyond stages, but it can no longer author requirements. When a
project has no PRD it stops with a loud, explicit handoff rather than authoring
one, so unattended use degrades visibly instead of silently.

Offline test coverage is preserved through the existing stub-runner convention
rather than a new escape hatch: `authoring-config.ts` already designates `stub`
as the test-only offline runner, so `FORGE_HEADLESS=1` continues to be honored
**only** when `FORGE_RUN_WITH=stub` is set. That lock is an offline lock the
invocation runner cannot override, which is exactly the guarantee the automated
suite needs and exactly the guarantee production must not have.

## Consequences

- A PRD is only ever produced by a conversation, so "reviewed by a human before
  anything is built" becomes a structural property rather than a convention.
  `forge-auto-build` already required reviewed features and refused to
  manufacture requirements; this extends the same rule upstream to the stage
  that was the exception.
- The failure mode of a bad PRD becomes a visible authoring session rather than
  a green build of the wrong product.
- Unattended operation begins at the team stage, gated on a reviewed PRD already
  existing. CI that previously went from `FORGE_IDEA` to a finished build must
  now author requirements in a session first. This is a real capability loss and
  is accepted deliberately: the flow it removes produced false confidence, not
  throughput.
- Requirements-stage authoring state is produced by an external interactive
  session rather than a Console background job, so it cannot be paused,
  cancelled or reported on by the Console. Completion is observed from the
  repository after the skill commits, which `authoringReadiness` already
  supports.
- The offline stub-runner lock is the single sanctioned non-interactive
  requirements path. It is test-only, and widening it would silently remove this
  guarantee.

## Relationships

- Amends [ADR-051](051-interactive-authoring-from-console.md), which made
  interactive sessions the primary Console action but deliberately retained the
  headless path "as an explicit alternative." That alternative is now removed for
  the requirements stages.
- Amends [ADR-020](020-launcher-auto-draft-and-path-input.md) and
  [ADR-018](018-auto-prd-decomposition-and-build-prerequisite.md), which
  introduced the launcher auto-draft flow and automatic decomposition.
- Amends [ADR-037](037-existing-repository-incremental-authoring.md), which
  sanctioned inferring a project PRD from an existing repository's source without
  questions.
- Consistent with [ADR-009](009-full-auto-build-meta-skill.md): `forge-auto-build`
  already refused to author requirements and treated the PRD as a quality gate.
  That "quality gate, not an input to be manufactured" principle now covers
  every upstream stage.
- Refines [ADR-002](002-prd-decomposition-into-features.md): features are
  authored with the vision in one interactive pass, so decomposition is a
  conversion tool rather than a stage.
