---
layout: post
title:  "The Story of MyForge, Part 6: The Project Outlives the Build"
date:   2026-11-10 10:00:00 +0200
categories: personal update
---

# The Story of MyForge, Part 6: The Project Outlives the Build

> *Part 5 ended with a workbench that could author, approve, and watch a
> project. Part 6 is about keeping that project honest while it runs and letting
> it go when it is done: phase gates, test ownership, human review, context,
> toolboxes, other platforms, and the exit.*

Part 5 moved the work into the Console. Part 6 is about the parts that only show
up once a project runs long enough to be real.

Verification is the first of them. A build can finish every task and still leave
a phase unfinished. A suite can pass and still prove nothing about the change. A
review can happen and still produce no evidence. Then there is the long run:
context that restarts every task, a skill set that grows into a junk drawer, a
terminal that only works on the machine it was built on, and a project that
eventually has to stop needing the framework that produced it.

---

## Chapter 44: The Phase That Was Never Finished

The engine could tell you a task had finished. It could not tell you a phase had.

Scheduling worked from the manifest dependency graph. A dependent phase was
released when its prerequisite tasks reached a terminal state. Terminal included
skipped. Task-level outputs and validation existed, but no durable check said
that a phase's required work, declared outputs, and phase-level checks had all
passed as one boundary. A downstream phase could start on work nobody had
verified.

v3.114 added strict phase completion gates for newly compiled phases. The
compiler emits an explicit policy. Tasks are required by default; structured
`forge-task` objects can set `required: false`, and legacy bullets can use
`[optional]`. A skipped required task fails the gate. Required task outputs
become phase outputs. Validation commands declared in feature phase content
become phase checks. A dependent strict phase cannot start until every strict
prerequisite passes.

The evidence is durable. Workflow state records phase lifecycle and gate
evidence; audit events record validation, completion, and failure. Contract
changes and replay invalidate affected gates, so a resumed run has to establish
completion again instead of inheriting a stale tick.

Two limits are explicit. The gate enforces declared outputs and commands; it
does not judge whether the requirements were decomposed well or whether the
acceptance criteria were meaningful. That remains an authoring problem. And
dependency-scoped concurrency survives: independent features and phases can
still run at once, using per-task worktrees. What the gate removes is the idea
that "all the tasks ended" is the same as "the phase is done."

Existing hand-authored manifests without the policy keep the old task-terminal
behavior. Compatibility was deliberate; the strict rule is for what the compiler
produces now.

### The Takeaway for Builders

> **Done is not verified. A phase is a delivery boundary, not a pile of finished
> tasks.** Fail closed when the work it promised is missing.

---

## Chapter 45: The Suite That Tested Everything but the Change

Running the full suite after every task is safe and wasteful. Running only
isolated tests is fast and blind. The first hides integration regressions until
the phase; the second never sees them.

ADR-078 split the job. A task combines its declared validation commands with
instructed discovery: inspect the actual changed files, find focused tests from
repository scripts, configuration, neighboring tests, and source/test
references, and run the relevant ones. Carried-forward artifacts contribute
their `filesChanged` so the agent can test interactions with prerequisite
outputs without rerunning unrelated tests that happen to appear in the handoff.
Risky or cross-cutting changes still deserve broader checks.

Discovery is advisory. Artifact text and file lists are data, not instructions;
agents verify paths and never execute commands copied out of an artifact. If a
required acceptance check cannot run, it is unresolved. If no relevant test
exists, add focused coverage when warranted or report the limitation. No tests
found is never success. The declared commands remain the machine-enforced gate;
discovery is not a second scheduler.

Phase checks are the comprehensive ones. They run after task work is integrated
and before the phase gate passes. If optional automated review is enabled, it
reviews the integrated diff against acceptance criteria only after phase checks
pass, and a finding that changes code requires rerunning the affected task
checks and the full phase suite. Human review stays separate; automated review
does not satisfy a human-review task.

A task-level test can pass because it exercises the change in isolation, and the
phase can still fail because two changes interact. The phase suite is where that
interaction is supposed to be caught, and it only works if the phase gate waits
for it.

### The Takeaway for Builders

> **Test the change, then the integration.** Fast feedback at the task, real
> confidence at the phase, and never claim a test you did not run.

---

## Chapter 46: The Review With No Instructions

Human review had the right shape and the wrong briefing. A review task could
pause a build, bind an approval to content, and record an attestation, but the
reviewer was often handed a diff and a general guide and told to decide. That
asks someone to invent a test plan and then call their invention evidence.

v3.117 added a walkthrough: exercise the acceptance criteria, record evidence,
approve through the Console or CLI. v3.118 went further and made the procedure
part of the task. Authors must provide an ordered, task-specific sequence in the
description and observable approval criteria. The Console displays the authored
procedure and criteria. The general Human Review Guide supplements them; it does
not replace them.

A gate is only as good as what it asks you to check. "Review this" is not a
criterion. "Open the
project, create a brief, approve it, confirm the build does not start until
Start build is pressed, and confirm the review task appears in the queue" is a
procedure with observable outcomes.

v3.124 added a focused Human review queue, separate from the Board, so the tasks
waiting on a person are not buried in the tasks that are running. The
attestation remains local and content-bound; it is evidence that a person
approved a specific output, not proof that the output is correct.

### The Takeaway for Builders

> **A human gate without instructions is a request for confidence, not
> evidence.** Tell the reviewer what to do and what counts as done.

---

## Chapter 47: The Conversation That Started Over

Native harness sessions were faster than MyForge, and the difference was not
orchestration overhead. The engine dispatched every task as a fresh, isolated
session. A native session kept one conversation across the whole task. The
engine was rebuilding context for every task and sharing none of it.

ADR-067 added an opt-in phase scope: `--session-scope phase` or
`FORGE_ENGINE_SESSION_SCOPE=phase`. Every task in a phase shares one harness
conversation; a new one begins at each phase boundary. The default stays `task`,
one fresh session per task.

The CLIs disagree about how to resume, so the adapter carries a strategy.
OpenCode and Copilot accept a caller-chosen ID, so the engine generates one per
phase. Claude assigns its own ID and returns it in the JSON envelope, so the
engine captures it from the first task and reuses it. OpenAI and Stub have no
strategy and keep one session per task.

A phase usually contains tasks owned by different agents, and the running agent
has to stay stable across a session. Phase scope therefore runs every task under
a single phase lead, `project-orchestrator`, which delegates to the owner
specialist as a sub-agent. The owner's persona travels inline in the task
instructions. The requirement is real: a missing `project-orchestrator` fails
preflight instead of silently running the wrong agent.

Phase sessions require `--concurrency 1`. Session lookup is project-scoped, and
a parallel run gives every task its own worktree, which is a different project.
The CLI and the engine both refuse the combination loudly.

The first task of a new phase gets a phase-boundary handoff: a digest of earlier
phases' completed work, each task's `forge-result` summary and changed files.
That keeps cross-phase continuity without an unbounded session. Session IDs are
persisted in `WORKFLOW-STATE.json` under `sessions`, so a resumed run rejoins its
conversations. Per-task dispatch, commits, validation, retries, replay, and audit
are unchanged.

Replay is still per-task and starts a fresh session. Rejoining a phase
conversation on replay remains future work.

### The Takeaway for Builders

> **Context is a resource with a shape.** Reuse it inside a phase, summarize it
> at the boundary, and refuse the combination that would fragment it.

---

## Chapter 48: The Toolbox and the Junk Drawer

Generated agents and project skills were discovered independently. The team
handoff recorded candidate consumers, but that relationship never reached the
agent's metadata or the task prompt. Agents inferred which project procedures
mattered from global discovery, and a growing skill set made that inference
worse.

ADR-066 let agents declare `skillsRequired` and `skillsRecommended` in
frontmatter. Candidate consumers become recommended by default; required needs
an explicit authoring decision. The adapter resolves declared names against
local skills and records availability. The engine includes concise names and
descriptions in the task instructions, not full skill bodies, and does not treat
the associations as an allowlist. The harness still owns permissions. Agents
without metadata remain valid, and a missing recommended skill is diagnostic,
not blocking.

That is a curated toolbox, not a capability registry. A registry would need
enforcement and usage evidence below the prompt layer, which the harnesses
cannot provide yet.

The toolbox also had to be cleaned. The template set had grown in layers and
ended up with two overlapping pairs. `forge-optimize-skills` reimplemented the
same six-axis audit as `forge-skill-review` and deferred to it when available,
so it survived as a manual duplicate. `forge-auto-build-prd` was a thin wrapper
that redirected to `forge-build-prd`, which already stops after the PRD, so the
"auto" label sat on the one skill that is always interactive.

ADR-069 deleted both, prefixed the meta-skills with `forge-`, and stopped
bootstrapping the maintainer-only `forge-skill-review-updater` into target
repositories. The template set went from 16 skills to 14. Re-bootstrapping now
prunes the retired and renamed forge skills it copied earlier, while leaving
project-authored skills alone. Every reference had to move in the same change:
skill files, agent personas, launcher commands, tests, Console authoring targets,
the prompt playbook, the testing guide, the repository summary, and CI.

The agent mode was the other naming problem. Generated specialists were landing
as `mode: subagent`, which removed them from the agent switcher. A specialist you
cannot select is a specialist you cannot use as the session's agent, even though
dispatch still works. v3.91 required `mode: all` in generated agents and in the
shipped personas, and normalized the key on the next feature increment. The
frontmatter gate warns rather than blocks because `mode` is OpenCode-specific and
the other harnesses do not define it.

### The Takeaway for Builders

> **A toolbox is curated, and a namespace is a compatibility promise.** Delete
> the wrapper, rename the duplicate, and prune what you retired.

---

## Chapter 49: The Build That Only Ran Where It Was Built

The Console terminal worked on Linux and macOS and failed on Windows with a
not-found error, even though `opencode`, `copilot`, and `claude` ran by bare name
in a normal shell. node-pty's conpty backend resolves a bare filename against
`PATH` with a literal file lookup and never applies `PATHEXT`. `opencode` never
matched `opencode.exe`.

The fix was a shared resolver. It checks explicit overrides (`OPENCODE_BIN`,
`CLAUDE_CODE_BIN` or `CLAUDE_BIN`, `COPILOT_BIN`), then `PATH` with the
platform's executable extensions, then well-known Windows install directories.
The PTY, the external-terminal launcher, and the launcher's availability checks
now use the same resolver instead of three lookups that could drift.

The second Windows failure was not a path problem. Navigating to another Console
view ended the terminal because the view owned the WebSocket and unmounting
closed it. The controller moved to module scope, output is buffered to 256 KiB
with a truncation notice, and returning replays the buffer and resumes live I/O.
A session still ends on Stop, project change, page reload, or Console shutdown.
Background jobs needed the same treatment: they now resolve Windows command shims
such as `npm.cmd`, so replay and other npm-backed jobs start.

Authoring had its own platform failures. Windows Terminal rejected an empty
command with `0x80070002`, so the launcher starts PowerShell directly and avoids
opening a tab when it is already inside Windows Terminal. On macOS, an
npm-installed runner was not found from a login shell unless the discovered
executable was pinned.

v3.121 added the other direction: `forge-launcher console --external-origin
<https-origin>` for serving the loopback Console through Tailscale Serve or
another trusted HTTPS proxy. The browser terminal accepts only the explicitly
configured origin. The Console does not open a network listener, and the setting
is not user authentication. It changes which origin the browser may talk to; it
does not decide who the user is.

### The Takeaway for Builders

> **The environment is part of the contract. "Works on my machine" is a
> hypothesis, and an exposed port is not a login.**

---

## Chapter 50: The Framework That Makes Itself Unnecessary

Forge is a lifecycle, not a permanent dependency.

A completed project still carries `docs/PRD.md`, `docs/features/`, authoring
state, an execution manifest, engine state, and the Forge skills that produced
the build. Those files are correct during the build and misleading after it.
They describe requirements that are already implemented and a process that will
not run again.

Deleting the Forge directories is not enough. The generated agents point at the
PRD and feature documents, own requirement IDs, and frame their work as
implementation phases. Remove the files and you leave dead links and roles with
no repository surface.

ADR-079 turned retirement into a feature. `forge-retire-project` inventories a
completed repository, classifies paths as delete, rewrite, or review, removes the
Forge artifacts and skills, rewrites the surviving agents and project skills,
verifies the result, and then deletes itself.

The generated specialists survive. Their ownership is re-derived from the source
tree: source directories, tests, CI, manifests, and project docs. Roles that own
no area are merged or removed; source areas with no owner are surfaced to the
user. `project-orchestrator` becomes `support-lead`, owning intake, routing,
cross-module coordination, release coordination, and escalation.
`forge-team-builder` and `workflow-orchestrator` are removed because they only
exist for the build.

`docs/SUPPORT.md` records the roster, ownership map, intake and triage flow,
release checklist, escalation path, and the repository's real commands.

Deletion is deterministic and bounded. The inventory classifies every path;
apply removes only classified paths. It refuses a live engine or a dirty
worktree, protects project skills named in `docs/SKILL-CANDIDATES.json`, and
supports `--archive` and `--keep`. Verification runs before the skill deletes
itself and rejects surviving Forge artifacts, dangling PRD/feature/task/engine
references, invalid agent or skill frontmatter, missing scopes, and a missing
`SUPPORT.md`. Coverage gaps are errors under `--strict-coverage`.

The launcher exposes it as `forge-launcher retire`: read-only inventory by
default, with `--apply`, `--archive`, `--keep`, `--allow-dirty`, `--commit`, and
`--run-checks`. It installs the skill from bundled resources when an older
repository predates it, so retirement remains reachable after the in-repo copy
has removed itself.

Historical ADRs, research notes, and changelogs are preserved. Retirement
changes active documentation, not history.

### The Takeaway for Builders

> **A lifecycle, not a dependency. The last feature is the exit.** If the
> framework cannot leave a repository maintainable without it, it was never
> finished.

---

## Chapter 51: The Whole Picture - What Survives the Project

```
Idea → brief → PRD + features → team + skills → manifest
      → build (task → phase gate → human review)
      → run (state, audit, usage)
      → retire (inventory → rewrite → verify → self-delete)
      → support team + SUPPORT.md
```

| What Forge provides | What the project keeps | What retirement removes |
|---------------------|------------------------|-------------------------|
| Reviewed requirements | The implemented product | PRD, features, authoring state |
| Specialist team | Agents rewritten to own repository areas | Build-only roles |
| Project skills | Skills that serve maintenance | Forge-authored skills |
| Execution contract | Nothing; the build is over | Manifest, engine state, task contracts |
| Decisions and research | ADRs, research, changelog | Nothing |
| — | `SUPPORT.md` with roster and process | — |

The durable artifact is the repository and the team that can maintain it.
Everything else was scaffolding. The story spent five parts building the
scaffolding. Part 6 is where the scaffolding gets to be temporary.

---

## Chapter 52: The New Principles - What Part 6 Taught

Part 6 adds seven to the thirty-two from Parts 1 through 5.

**33. Done is not verified.** A phase is a delivery boundary. It passes only
when required tasks, declared outputs, and phase checks do.

**34. Test the change, then the integration.** Targeted checks during a task,
comprehensive checks at the phase boundary. Paths are clues, not an oracle, and
an unrun test is not a pass.

**35. A gate must brief its reviewer.** A human review without a procedure and
observable criteria asks someone to invent a test plan and call it evidence.

**36. Context is a resource with a shape.** Reuse a conversation inside a phase,
summarize at the boundary, and refuse the combination that fragments it.

**37. Curate the toolbox.** Agents declare the skills they need; the framework
prunes what it retired. A namespace is a compatibility promise.

**38. The environment is part of the contract.** A capability you have not run
on the user's platform is a hypothesis, and an exposed port is not a login.

**39. A lifecycle, not a dependency.** The last feature is the exit. Leave the
repository maintainable without you, or you have not finished.

---

## Epilogue for Part 6: The Framework That Learned to Leave

Part 5 ended with a workbench that could keep a project honest while it ran.
Part 6 ends with a project that does not need the workbench afterward.

The two ideas fit together. Verification is what makes a build worth keeping;
retirement is what makes a project worth handing over. A framework that can
verify but cannot leave is a permanent tenant. A framework that can leave but
cannot verify leaves behind work nobody can trust.

Part 6's answer is more qualified than Part 5's. The project can outlive the
build, but only if the framework treats its own artifacts as temporary and the
repository's own surface as durable. The support team is not a smaller version
of the build team. It is a different team, with different ownership, a different
intake, and a different definition of done.

Part 1 asked: *"What if AI could work like a real team?"*

Part 2 asked: *"What if that team could build the next team without you in the
loop for every step?"*

Part 3 asked: *"What if that team could come back to yesterday's work and keep
going without losing the thread?"*

Part 4 asked: *"What if the framework could apply those same disciplines to
itself, survive what that exposes, and become something other people can build
on?"*

Part 5 asked: *"What if the place a project is authored, approved, watched, and
paid for could also keep it honest after the build?"*

Part 6 asks:

**"What if a framework's final measure were the repository it left behind,
running without it?"**

---

*This is the continuation of the story. Part 6 covers the long run: the phase
gate that made "done" mean verified, the test strategy that put fast checks at
the task and real checks at the boundary, the review that learned to brief its
reviewer, the phase session that stopped paying the cold-start tax, the toolbox
that got curated, the platform failures that made "works here" a claim, and the
retirement that turned the framework into a lifecycle.*

*The build is temporary. The repository is not.*

---

**Made with ❤️ and a lot of research documents by
[McFuzzySquirrel](https://github.com/McFuzzySquirrel)**
