# ADR-051: Interactive authoring sessions from the Forge Console

Status: Accepted

## Context

The original value of MyForge's pre-Console workflow was the interactive
interview: the PRD and feature skills ask clarifying questions before drafting,
and the interview is what turns a loose idea into a reviewable plan. The Console
only exposed the headless authoring path (`draft-prd`, `draft-team`, `draft-skills`,
`feature-prd`), so it silently skipped the interview and produced documents from
defaults.

A browser page cannot host a terminal interview. The model planning terminal
already solved the same problem by opening the user's harness CLI in a new
terminal with a message.

## Decision

The Console offers interactive authoring sessions that open the authoring runner
in a terminal with the skill already queued, while keeping the headless path as
an explicit alternative.

- A new read/write endpoint, `POST /api/authoring/session`, maps a target
  (`idea`, `prd`, `feature-prd`) to a forge skill invocation, resolves the
  configured authoring runner and model for the PRD stage, and launches the CLI
  through the existing `launchCli` seam. It is gated by `allowExternalOpen` and
  returns a manual command when no terminal emulator is available.
- The Console UI makes the interactive path the primary action on the **Overview**
  pipeline card for the PRD and Feature PRD phases, with the headless action as a
  secondary button. Interactive authoring is intentionally Overview-only; Plan &
  Team is a read-only document viewer and the new-project wizard only bootstraps.
- A new forge skill, `forge-grill-idea`, runs the pre-PRD interview against
  `docs/IDEA.md`: it grills the idea in rounds of the frontier, then rewrites and
  commits the idea. It is modeled on the stateless `grill-me` / `grilling`
  technique, adapted to a repository.
- Interactive sessions are fire-and-forget. The skill validates and commits its
  output; the Console polls the documents and summary rather than tracking the
  external process. Because `authoringReadiness` treats a valid, untracked PRD as
  ready, no finalize stage is required.
- `POST /api/authoring/validate` exposes the existing read-only PRD validation,
  surfaced on the Overview pipeline card as **Validate PRD**, so the UI can check
  documents authored outside the Console.

## Consequences

- The Console again leads with the interview that made the pre-UI workflow
  valuable, without removing the fast headless path.
- Interactive sessions are not background jobs: they cannot be paused, reported
  on, or committed by the Console. Completion is observed from the repository
  after the skill commits.
- Interactive sessions depend on a desktop terminal and the `allowExternalOpen`
  setting; headless authoring remains the fallback everywhere else.
- Requirement and task blocks are rendered as tables in the document popup. This
  is a Console-only presentation change; the authored documents are untouched.
