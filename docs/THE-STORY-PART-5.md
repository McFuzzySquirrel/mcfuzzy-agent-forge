---
layout: post
title:  "The Story of MyForge, Part 5: The Workbench Becomes the Product"
date:   2026-11-09 10:00:00 +0200
categories: personal update
---

# The Story of MyForge, Part 5: The Workbench Becomes the Product

> *Part 4 ended with a framework other people could change. Part 5 is about the
> stretch where the work moved into the Console: authoring stopped being a
> headless guess, the project got a state, the board learned to be read, and the
> run got a price tag.*

Part 4 ended with a framework other people could extend. Part 5 is about what
happened when the people using it wanted to do the work in one place.

The Console had been a projection of the engine. It showed the manifest, the
tasks, the logs, and the controls, and it did that by reading the same files the
CLI read. In this stretch it became the place a project is authored, approved,
prepared, started, watched, reviewed, and paid for. That is more than a redesign,
and it started with a decision to take autonomy away.

---

## Chapter 36: The PRD That Should Never Have Been Auto-Drafted

The most dangerous feature MyForge shipped was the one that let it write a PRD
without asking anyone anything.

The value of the whole pipeline rested on one claim: the PRD and its features
are correct before anything is built. Everything after them is mechanical. The
team derives from the requirements, the manifest compiles from them, the engine
executes the result. That is a strength because quality is concentrated in the
one artifact a person can judge. It is a liability when the artifact is wrong.

A headless requirements stage inferred scope, technology choices, and acceptance
criteria from defaults, and the rest of the pipeline implemented them
faithfully. The build passed. The tests passed. The product was wrong. Nothing
downstream could detect it, because every downstream stage was doing exactly
what it had been told. The cost was the whole project, not one stage.

By then the path had three independent doors. The skill contracts had opt-outs
that skipped the interview and recorded assumptions under Open Questions.
`forge-build-prd`, `forge-auto-build-prd`, `forge-decompose-prd`, and
`forge-grill-idea` each honored `FORGE_HEADLESS=1`, embedded "auto-proceed" text,
or a non-interactive invocation. The launcher had `--draft`,
`FORGE_AUTO_DRAFT`, `--headless`, and the `draft-prd` family of subcommands,
plus a `resume` menu that defaulted to the headless option. The Console offered
the headless run as a secondary button beside the interactive one.

Removing the visible toggle would have closed one door and left two open. Any
caller with `FORGE_HEADLESS=1` could still self-authorize the same failure.

v3.90 removed all three. The rule became one sentence: **authoring requirements
is interactive; deriving from a reviewed PRD is headless.** Idea to PRD,
existing repository to PRD, feature documents, legacy decomposition, and idea
sharpening all became conversations. Team generation and project-skill
generation stayed headless, because their output is cheap to review and wrong in
ways that are obvious.

The capability loss was deliberate. A run can no longer go from `FORGE_IDEA` to
a finished build unattended. That had been the headline of Part 2. It produced
false confidence rather than throughput, so it went. Unattended operation now
begins at the team stage, on a PRD someone has already reviewed. The only
remaining non-interactive requirements path is `FORGE_RUN_WITH=stub`, which is
test-only.

The follow-up mattered as much as the decision. **Author PRD** was dead on the
default runner. OpenCode v2's root command accepts `--prompt` but has no
`--model`; that flag lives on `run`. The Console sent `opencode --prompt ...
--model ...`, so argument parsing failed before the session opened. It looked
intermittent because with the model set to `inherit` there was no `--model` to
reject. OpenCode was also the default authoring runner for every harness except
Copilot, so Claude and generic `.agents` repositories hit the same dead button.

The command was built in four places: the Console button, the launcher's printed
handoff, `forge-launcher resume`, and the model-planning terminal. Four copies,
no test that the argv parsed. The fix was `opencode mini`, the one interactive
surface that takes both a queued prompt and a model, plus one exported builder,
`interactiveAuthoringArgv`. A test now asserts that no OpenCode argv carries
`--model` unless its subcommand is `run` or `mini`.

### The Takeaway for Builders

> **A confident specification is still a guess. Automate what derives from a
> reviewed decision; never automate the decision.** And test the command the
> button actually runs, not the one you think it runs.

---

## Chapter 37: The Workbench Gets an Authoring Desk

Once requirements authoring became a conversation, the question changed from
"what does the pipeline do next?" to "where does the conversation happen?"

For anyone using the Console in a browser, the answer had been: somewhere else.
It started a terminal on the user's desktop and handed off. That worked on a
laptop with a terminal emulator and failed for everyone else.

v3.102 added a Terminal view. The browser renders an xterm.js terminal, a
WebSocket carries input, output, and resize events, and a server-side PTY runs
the selected harness CLI in the selected project. The Console exposes fixed
start requests: a harness session or one of the authoring targets. It does not
accept arbitrary commands, arguments, or working directories from the browser.
The WebSocket requires the Console token and the exact local origin. One PTY per
Console process, loopback only, bounded input and dimensions. The external
terminal stayed as a fallback.

Then the authoring buttons started opening that terminal pre-seeded with the
right target, so "Author PRD (interactive)" no longer meant "author PRD somewhere
outside this window."

The other half of the authoring desk was the work that happens after the
conversation. Editing a PRD made the team, the skills, and the manifest stale.
Regenerating them was a five-hop hunt across three views: reset changed tasks,
read a comma-joined list of task IDs, click Regenerate Team, wait, click
Regenerate Skills, compile the manifest, reset again. The buttons were hidden
until the stage failed or the server named it as the next stage, so the
affordance appeared exactly when you had already given up.

The underlying state was not missing. `authoring-state.ts` recorded each stage's
input fingerprint, output fingerprint, and completion time, and
`authoringStageIsCurrent()` compared them. But `authoringReadiness()` collapsed
all of it into `{ ready, reason, nextStage }`. The Console learned that authoring
was not ready and one free-text blocker. It never learned which input changed,
when, or which action would fix it.

v3.94 added a re-derivation chain: one background job that regenerates the team,
then the project skills, then recompiles the manifest. Progress is persisted to
`docs/rederive-state.json`, so a reload mid-run resumes the step machine instead
of showing a spinner. A failure names the step and offers "Retry from a step."
The explanation is derived, not recorded: `explainStaleness()` compares stored
fingerprints against fresh ones and names the offending files with their age. A
blocked action stays rendered and disabled with a reason instead of
disappearing.

Two things the chain refuses to do: author requirements, because v3.90 made that
interactive, and reset completed tasks, because that destroys finished work.
Reset moved into the Manifest panel beside the reconciliation it acts on, behind
a confirmation that names every task it will discard.

### The Takeaway for Builders

> **Put the work where the user already is, and have the workflow explain its
> own state.** "Regenerate" is not a workflow. Name the input that changed, the
> stage it blocks, and the action that fixes it.

---

## Chapter 38: The Project That Had a State

The Console had been organized around the pipeline: Plan & Team, Manifest, Run,
Review. That is a good map of the engine and a poor map of a project. A
returning user does not want to know which stage is stale. They want to know
what to do next.

ADR-081 reorganized the Console around Projects. Home and Projects are global
destinations; the current project has its own destinations and a persistent
context bar; technical controls live under Advanced. Every project is mapped to
a lifecycle state: new, partially authored, in review, preparing, ready to
start, running, blocked, failed, completed. The Projects list and the project
switcher use the same rule, so a project is reachable through the same next
action wherever you find it.

The Console also stopped collapsing separate decisions into one. Approving a
Project brief authorizes preparation only. Preparation produces a plan. Starting
the build is a separate action, and it is the only one that sends the run
request. Runtime human review stays task-bound. Stop asks for confirmation before
it sends anything.

That sounds like extra clicks, and it is. It also prevents two mistakes that
look identical in a UI that merges them: approving a plan because you wanted to
see it, and starting a build because you approved it. The Console now says which
decision you are making, and a stale authoring state routes to review instead of
exposing a generic Run button.

v3.124 added the rest of the surface: guided Idea and Project brief authoring,
explicit brief approval, Project files, and a focused Human review queue. The
review queue is not the Board. It is the list of tasks waiting on a person,
which is a different question from what the build is doing.

### The Takeaway for Builders

> **Approval is not authorization. Preparation is not execution.** If a user
> cannot tell which decision a button makes, the button makes the wrong one.

---

## Chapter 39: The Board That Could Not Be Read

The Forge Board was a canvas. It was also an iframe around a standalone PixiJS
dashboard, with a table toggle beside it and a toolbar in the parent frame. Task
summaries and details depended on a visual renderer being available. A keyboard
or screen-reader user could reach none of it.

The board also collapsed states it should have kept apart. "Cannot reach the
Console server," "no execution manifest yet," and "ready to build" all looked
like a board with nothing on it. A dropped event stream said "disconnected" and
left you to guess whether the build had stopped or the browser had.

ADR-063 added chrome and honesty: a Kanban | Gantt switch and status filters
above the frame, a Table view over the same data, a proper tablist for the mode
control, and links from a card or bar to Tasks, Logs, and Artifacts. Filters dim
nonmatching tasks instead of hiding them, so the shape of the build stays
visible. Failures persist in a corner list instead of a one-off screen tint.
Reduced motion is honored.

ADR-064 added the Gantt. Its forecast comes from the engine's own rules: direct
dependencies plus every task of a depended-on phase, scheduled under the
configured concurrency. It will not promise a sequence the engine will not run.
Durations are inferred from observed attempts, then the same agent's other
tasks, then a default, and they are labeled as estimates. Phase rollups,
human-review milestones, a critical path, and a moving now line came with it.
Mode and filters are remembered per project.

ADR-080 replaced the iframe baseline. The Console Board is now semantic HTML and
CSS over the existing Task API and workflow-engine layout API. Kanban and Gantt
consume the same task summary, selection, attention cues, filters, and details.
The standalone PixiJS visualization still exists; it is no longer the thing the
Console depends on for a task's name. Loading, empty, failed, and stale-data
states each say what they are and offer a next action. The Board is a projection
only; it does not change contracts, dependency rules, or scheduling.

v3.128 added color-coded workflow and attention states, with a pulse only when
something actually changes and no pulse under reduced motion.

### The Takeaway for Builders

> **Accessibility is a data model.** If the board has no text a screen reader
> can reach, it is not a view; it is a picture of one. And a status that
> collapses three states into "disconnected" is a lie with good intentions.

---

## Chapter 40: The Console That Outgrew Its Sidebar

Settings had accumulated in the places where they were first needed. Authoring
models lived beside the authoring cards. Execution preferences lived in the
Overview Controls panel. Model overrides lived in Plan & Team. Global defaults
did not exist, so every project repeated the same choices.

v3.108 consolidated them into a Settings view with three sections: Authoring
(runner and stage models), Execution (build mode, concurrency, auto-commit,
activity logging, timeouts), and Models (per-agent primary and fallback, the
planning terminal, inventory refresh). Overview kept run controls. Plan & Team
kept documents, cards, and the re-derivation footer.

Then the defaults got a hierarchy. The Console reads a system-level
`settings.json` from `FORGE_HOME` (`~/.myforge` by default). The effective
authoring model now resolves explicit override, environment, saved project
recommendation, system default, runner default, and records `system` as
provenance when a global default supplied the value. Execution defaults are
inherited only when a project has not set its own; the project wins. Corrupt
settings fall back to defaults and are never clobbered on read; writes are
atomic and validated.

The theme went through the same treatment. v3.113 added System, Light, and Dark,
stored as `ui.theme`, cached so the saved palette paints before the app loads,
and reconciled at startup. The light theme covers the page, bar, panels, tables,
dialogs, markdown, badges, buttons, forms, and the terminal's ANSI palette, with
the semantic colors tuned for AA contrast.

Two bugs in that work explain the rule. Saving Global defaults dropped unrelated
settings such as `ui.theme`, and changing the theme rewrote authoring and
execution defaults. Both are the same mistake: treating a partial write as a
full document. The fix was to preserve every key the form did not own.

Navigation moved too: flat top nav, then a grouped sidebar, then top categories
(Start, Pipeline, Monitor, Review, Settings), then the lifecycle-driven
Home/Projects/Advanced model. The page stopped capping everything to a prose
column, panels reflowed to the window, and narrow screens got a horizontally
scrolling category row and a full-width menu panel.

### The Takeaway for Builders

> **Configuration is a ladder. Say which rung supplied the value, and never let
> one setting rewrite another.** A default that silently overwrites unrelated
> state is not a default; it is a bug with a friendly label.

---

## Chapter 41: The Run With No Price Tag

For most of its life the Console could tell you what a run did and how long it
took. It could not tell you what it cost.

The harnesses do not agree on how to report usage. OpenCode prints nothing on
`run --format default`, but `opencode session export <id>` returns
`info.tokens` and `info.cost`. Claude Code's `-p --output-format json` may
include `usage` and `total_cost_usd`, and older versions omit them. Copilot
prints a stats block to stderr with AI credits and token counts. A single
"tokens" number cannot represent all three, and reporting a missing value as
zero would say the run was free.

v3.110 added a `TaskUsage` model with optional input, output, cache-read,
cache-write, reasoning, cost, and credit fields, plus
`source: "harness" | "unavailable"`. A harness that reports nothing yields
`unavailable` with a note, never zeros. Credits are stored as credits and never
shown as dollars. Each attempt's usage is merged onto the task record, so a
retried task reports its total. Usage is written to `WORKFLOW-STATE.json` and to
the attempt, complete, and failed audit events.

The Console sums reported usage into the run summary with a coverage count,
because a total over three of eight tasks is not the same claim as a total over
eight. The Overview shows tokens in and out, cost, and credits. The Tasks table
has a Tokens column, and the detail drawer shows the full breakdown or an
explicit "not reported."

One case is deliberately unavailable: phase-scoped sessions. The export is
cumulative across the phase, so attributing it to one task would over-count. The
honest answer is that the per-task number does not exist.

Measurement has a cost. OpenCode usage takes one extra `session export` process
per task, bounded at 15 seconds and 32 MiB, and a failure degrades to
unavailable. That is the price of not making up a number.

### The Takeaway for Builders

> **A missing number is information. Reporting it as zero is a lie the UI can
> keep for months.**

---

## Chapter 42: The Whole Picture - What the Console Knows

The Console stayed a projection of the engine, and the redesign made that rule
explicit. Every surface reads the same files and contracts the CLI reads.

```
                 reviewed documents
Idea → brief → PRD + features ──────────────┐
                                             │
                     derivation (headless)   ▼
                    team → skills → manifest
                                             │
                                             ▼
                runtime: dispatch → sandbox → verify
                         → human review → audit
                                             │
                                             ▼
   Console: Home/Projects · Board · Review · Terminal · Settings
          (a projection over the same files and contracts)
```

| Surface | Reads | Must not do |
|---------|-------|-------------|
| Home / Projects | Lifecycle state and authoring readiness | Invent a state the files do not have |
| Board | Task API and workflow-engine layout API | Schedule work or change task contracts |
| Review queue | Task-bound review evidence | Approve on behalf of the reviewer |
| Terminal | Fixed harness sessions | Accept arbitrary commands or directories |
| Settings | System and project settings with provenance | Rewrite keys the form does not own |
| Usage | Harness-reported values or `unavailable` | Turn a missing value into zero |

The rule survived because each surface was built over the artifacts that already
existed. The Console can be replaced. The contracts cannot, and that is what
keeps the projection honest.

---

## Chapter 43: The New Principles - What Part 5 Taught

Part 5 adds six to the twenty-six from Parts 1 through 4.

**27. Automate derivation; never automate the decision.** A headless PRD is a
confident guess, and everything downstream implements it faithfully. If a stage
requires judgment, make the judgment visible, even when that costs the
unattended path.

**28. A workflow must explain its own state.** "Regenerate" is not a workflow.
Name the input that changed, the stage it blocks, and the action that fixes it.
Persist the progress so a reload does not erase the explanation.

**29. Separate approval from authorization.** Approving a plan is not permission
to execute it. Preparing a build is not starting it. If two decisions share a
button, users will make one of them by accident.

**30. Collapsed states lie.** "Disconnected," "no manifest," and "ready" are
different. So are "zero tokens" and "not reported." Every state a UI merges is a
question it refuses to answer.

**31. Accessibility is a data model.** A canvas with a table toggle is still a
canvas. If the semantic representation is not the default, keyboard and
screen-reader users get a fallback, not a view.

**32. Configuration is a ladder.** Say which rung supplied the value: explicit,
environment, project, system, default. A partial write that clears unrelated
keys is a bug, no matter how good the defaults are.

---

## Epilogue for Part 5: The Autonomy That Was Given Back

Part 4 ended with a framework other people could change. Part 5 ends with a
workbench those people can use.

Part 2's promise was idea to shipped build without a human in the loop. Part 5
removed that promise at the requirements stage and moved the human back into the
only place where a wrong answer costs the whole project. The pipeline became
less autonomous and more trustworthy at the same time. The Console became the
place that trust is exercised: authoring, approving, preparing, starting,
reviewing, watching, and paying for the run.

Part 1 asked: *"What if AI could work like a real team?"*

Part 2 asked: *"What if that team could build the next team without you in the
loop for every step?"*

Part 3 asked: *"What if that team could come back to yesterday's work and keep
going without losing the thread?"*

Part 4 asked: *"What if the framework could apply those same disciplines to
itself, survive what that exposes, and become something other people can build
on?"*

Part 5 asks:

**"What if the place a project is authored, approved, watched, and paid for
could also keep it honest after the build?"**

---

*This is the continuation of the story. Part 5 covers the stretch where the work
moved into the Console: the autonomy that was removed at the requirements stage,
the authoring desk that replaced a terminal handoff, the project lifecycle that
separated approval from execution, the board that became readable, the settings
that learned provenance, and the run that got a price tag.*

*The workbench is now the product. The project still has to survive it.*

---

**Made with ❤️ and a lot of research documents by
[McFuzzySquirrel](https://github.com/McFuzzySquirrel)**
