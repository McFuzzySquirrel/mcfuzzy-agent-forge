# ADR-028: Launcher as the Single Entry Point — `resume`, Review Links, and `forge-auto-build` Demotion

**Date:** 2026-08-27
**Status:** Accepted
**Relates to:** ADR-009 (`forge-auto-build` meta-skill, now superseded as an entry point), ADR-010/023 (forge-launcher), ADR-014 (workflow engine), ADR-018 (PRD as a deliberate prerequisite)

---

## Context

MyForge grew multiple overlapping entry points: `forge-launcher`,
`forge-auto-build`, `forge-auto-build-prd`, `@project-orchestrator`, and
`@workflow-orchestrator` were all presented as peer ways to start a build. A user
"just thinking about when to use what" hit three concrete problems:

1. **Two parallel plans.** `project-orchestrator` re-derived the execution plan
   from the PRD at runtime, while the workflow engine consumed the deterministically
   compiled `docs/EXECUTION-MANIFEST.json`. Discussed (and deliberately *not* merged)
   separately: making the orchestrator follow the manifest. This ADR does **not**
   change that — the orchestrator keeps building its own plan.
2. **No resume.** `forge-launcher` was a linear 9-step run. Walking away at a
   review boundary (drafted PRD, generated team, paused engine run) left no way to
   re-enter — "it may take some time for the users to review and make changes."
3. **In-harness overlap.** `forge-auto-build` was queued by the launcher as the
   in-harness command (`/forge-auto-build … GO`), so users *inside a chat harness*
   ran a chaining meta-skill, even though the two real in-harness execution modes
   are interactive (`@project-orchestrator`) and autonomous (`@workflow-orchestrator`).

## Decision

Make **`forge-launcher` the single terminal entry point** and give it a resume
path; demote `forge-auto-build` to a terminal/headless fast-path instead of
removing it.

- **`forge-launcher resume [--repo]`** re-enters an existing project at its
  current stage (idea → PRD → team → build) as a full interactive wizard. It
  detects the harness root, reads what exists (`docs/IDEA.md`, PRD/decomposed
  layout, generated agents, `docs/EXECUTION-MANIFEST.json`,
  `docs/WORKFLOW-STATE.json`), prints where the user is with clickable review
  links, and offers the right next action: capture an idea, auto-draft the PRD /
  team headlessly, resume a paused or failed engine run, tail logs, or open the
  harness CLI. `--non-interactive` prints the state plus the exact next commands.
- **Review links.** The review boundaries (drafted PRD, generated team) and the
  engine summary emit OSC 8 terminal hyperlinks (`\x1b]8;;file://…`), falling
  back to plain paths on non-TTY output (`format.ts` `hyperlink`/`link`).
- **Conditional in-harness command.** When the launcher opens the CLI (or prints
  next steps) **and the agent team already exists**, it queues
  `/forge-orchestrate-build` (project-orchestrator). When no team exists yet it
  keeps queueing `/forge-auto-build` (which generates the team in-chat). Headless
  runs keep `/forge-auto-build` as the terminal fast-path.
- **`forge-auto-build` is demoted, not removed.** It stays installed but is
  repositioned as the terminal/headless fast-path (launcher-driven,
  `opencode run --auto` / `copilot -p --yolo`), explicitly *not* the in-harness
  entry point. `project-orchestrator` and `workflow-orchestrator` now document
  their in-harness roles and point at `forge-launcher engine-run` / `resume` as
  the canonical terminal entry.

### When to use what (the resulting mental model)

| Situation | Tool |
|---|---|
| New project | `forge-launcher` (terminal) |
| Interactive build in the harness | `@project-orchestrator` |
| Autonomous build | `forge-launcher engine-run` or `@workflow-orchestrator` |
| Lost your place | `forge-launcher resume` |
| Terminal/headless fast-path | `forge-launcher --headless` (drives `forge-auto-build`) |
| Authoring only | `/forge-build-prd`, `/forge-auto-build-prd`, `/forge-build-agent-team` |

## Consequences

Positive:

- One on-ramp, two execution modes, one resume path — the "when to use what"
  question collapses to a single decision (interactive vs. autonomous).
- Reviewing takes time again: `resume` makes every stage a safe stopping point.
- Review links make the review boundaries immediately openable from the terminal.
- No breaking change to `forge-auto-build`'s mechanics (its headless/terminal
  path is unchanged); existing bootstrapped repos keep a working copy.
- The interactive launcher flow is lighter: it only changes what gets queued when
  a team already exists — no forced auto-draft on users who prefer in-chat review.

Negative:

- `forge-auto-build` remains in the tree, so a determined user could still invoke
  it in a harness; the demotion is enforced by docs/recommendations, not code.
- `resume`'s state detection is heuristic (presence of files), so a partially
  cleaned repo could be mischaracterized — the wizard always prints the raw
  "where you are" summary before acting.
- The conditional queue adds a branch to the launcher's command selection
  (team-exists vs. not), increasing test surface.

Trade-offs considered:

- **Retire `forge-auto-build` outright** (ADR-009 superseded) — cleanest mental
  model, but loses a genuinely useful terminal/CI chaining tool; the user chose
  to keep it "in case it's useful later".
- **Make `project-orchestrator` follow `docs/EXECUTION-MANIFEST.json`** — decided
  against separately (see Context); the orchestrator keeps building its own plan.
- **Force team auto-draft by default in the interactive launcher** — rejected:
  it would run a headless skill per launch and move the team-review gate out of
  the chat; the conditional queue keeps the current behavior when no team exists.

## References

- ADR-009: `forge-auto-build` meta-skill (entry-point role superseded by this ADR).
- ADR-010/023: forge-launcher design and npm-package implementation.
- ADR-014: workflow engine / dark orchestration.
- Implementation: `scripts/forge-launcher/scripts/launcher.ts` (`resume`,
  `autobuildCommand`), `resume.ts` coverage in `scripts/forge-launcher/scripts/resume.test.ts`,
  `format.ts` (`hyperlink`/`link`), and the skill/agent templates.
