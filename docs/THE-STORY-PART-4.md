---
layout: post
title:  "The Story of MyForge, Part 4: What Broke, and Who Fixed It"
date:   2026-10-01 09:20:00 +0200
categories: personal update
---

# The Story of MyForge, Part 4: What Broke, and Who Fixed It

> *Part 3 ended with a workbench that could rejoin an existing project, preserve
> history, and give operators a real control surface. Part 4 covers the stretch
> where MyForge stopped being designed and started being used — where the things
> that broke were not edge cases, and where other people started fixing them.*

Part 1 asked whether AI could work like a real team. Part 2 turned that team
into a factory. Part 3 built the workbench around the factory. Part 4 is the
part where the tools met reality and lost a few arguments.

This is written for builders who are carving their own path. Not because the
path is reproducible — it is not — but because the failures below are the kind
that reproduce themselves in any system where an agent writes the code, a human
owns the contract, and the two disagree about what was verified.

---

## Chapter 28: The Concurrency That Was Accepted and Ignored

`--concurrency <n>` was documented, parsed, persisted in the Console, and
honored in exactly one configuration.

Everything above `1` ran one task at a time. Not slowly. Not with a warning.
The engine received the number, did not act on it, and reported success.

The reason was attribution. When a task finished, the engine decided what that
task had produced by diffing the working tree against the state it started
from. With one task running, that is unambiguous. With several tasks writing to
one working tree, there is no way to ask "what did *this* task change" without
having already decided the answer.

So the honest description is that concurrency was a promise the architecture
could not keep, and the code papered over it rather than saying so.

The fix was structural rather than clever. Each concurrent task now runs in its
own `git worktree` under `.forge-sandboxes/`. What a task changed is exactly
what its worktree contains, so attribution stops being a question and becomes a
definition. Same-owner tasks still serialize, and a harness that does not
declare concurrency support still falls back to one at a time.

The cost is real and worth stating plainly, because it is the kind of thing
that gets discovered by a user instead of a changelog. A worktree is built from
a commit, so a parallel run now **refuses to start on an unclean tree** and
names the offending paths. `--concurrency > 1` cannot be combined with
`--no-auto-commit`, because a commit per task is what keeps the history
attributable. The requirements documents a task will read have to be committed
too, since a worktree cannot see them otherwise.

So the flag went from *accepted and ignored* to *honored, and demanding*. That
is a better state and a less convenient one, and the second part is the part
that shows up in someone's afternoon.

### The Takeaway for Builders

> **If a feature cannot be made correct under the conditions you document, make
> the conditions stricter rather than the feature louder.** A flag that lies is
> worse than a flag that refuses.

---

## Chapter 29: Two Words That Are Not the Same Thing

Before describing how parallel execution works here, one distinction has to be
made, because the interface got it wrong for a long time and the error is
common enough to be worth naming.

**Multi-agent** describes who does the work. Different tasks are assigned to
different specialist owners.

**Parallel** describes when the work runs. Tasks whose dependencies are
satisfied execute at the same time.

These are independent. A multi-agent workflow can run completely sequentially —
which is exactly what MyForge did for most of its life, with a full agent team
assigned and executed one task at a time. And parallel execution here does not
mean several agents collaborating on a single task. Each concurrent unit is a
separate task attempt, with its own contract, its own owner, and its own
sandbox.

So "parallel agents" is the wrong phrase, and the Console said it anyway. The
concurrency control in the Overview panel, the New Project wizard, and the Help
view were all labeled *"Concurrency (parallel agents)"* for many releases. A user
reading that would reasonably expect three agents cooperating on one piece of
work, and would have no reason to think the feature was actually scheduling
independent tasks. All three now read "parallel tasks", and the Help entry
describes it as running that many independent tasks at once — the fix was
small, and the number of releases the wrong label survived is the point.

The distinction is not pedantry. It changes what a builder has to build. If the
goal is agents collaborating on one task, the hard problems are shared context,
message passing, and conflict resolution between cooperating writers. If the
goal is independent tasks running at once, the hard problems are entirely
different: attribution, isolation, and integration order. MyForge needed the
second set, and for a long time it claimed to offer the first.

### What the Sandboxing Actually Is

The mechanism is a standard Git worktree, wrapped in task lifecycle behavior
that Git does not provide.

For each concurrent task, the engine creates a temporary worktree under
`.forge-sandboxes/<taskId>`, detached at the current `HEAD`. The task's harness,
its output checks, and its validation commands all run there. Forge then adds
what Git will not: ignored top-level directories such as `node_modules` are
linked in rather than copied, current engine metadata from `docs/` is seeded
into the sandbox, and when the task succeeds its changed files are copied back
to the main working directory and committed normally there — no cherry-pick.
The worktrees are swept when the run ends, and any left by a killed engine are
swept before the next one.

Being precise about what this is *not* matters as much as what it is. It is not
a separate repository, and it is not a container or a machine boundary. Ignored
build inputs can be shared into sandboxes through links, so two concurrent tasks
can be looking at the same `node_modules` on disk. Two tasks in one wave that
change the same path do not merge; the second fails with a concurrency error
naming the overlapping files. Same-owner tasks never run concurrently at all,
because tasks sharing an owner share a project directory and build outputs.

The isolation is real but partial, and the honest framing is that it makes
attribution exact rather than that it makes tasks independent of each other.

### The Takeaway for Builders

> **Name your dimensions before you name your features.** "Multi-agent" and
> "parallel" describe different problems and need different architectures.
> When a UI label implies a stronger capability than you built, the label is a
> specification defect, not a cosmetic one.

---

## Chapter 30: The Review That Attested to Nothing

Human review was introduced so a person could stand between a piece of work and
everything downstream of it. It failed in three distinct ways, and the three
failures only became visible after the feature started running in parallel with
real builds.

**The approval was not tied to what was approved.** A review attestation was
fingerprinted over the task and its references — so editing a reference
invalidated the approval, which felt right — but *not* over the reviewed output.
A review approved before the work existed therefore stayed valid, and released
every downstream task against pre-review code. The fingerprint was covering the
things that were easy to hash and missing the thing that mattered.

**The refusal was worse than the failure.** A human review with no operator
attestation used to pause the run the moment it was dispatched. Review
dependencies are declared by the author, and the manifest compiler does not
infer them, so a review whose prerequisites went undeclared parked the run
before the work it was meant to inspect had been built. The operator was then
asked to approve nothing, with no way out of the run except that approval. The
guard designed to protect unreviewed work had become a deadlock.

**The fix fought the preflight.** Approve-and-resume wrote the review record
and the attestation, then started the run. The run's clean-tree preflight
refused the very files the form had just written, so approving a review required
hand-committing the approval. Two correct behaviors, implemented by two
components with no shared model of "generated versus authored state," cancelling
out into a broken button.

The resolutions were structural. Approval now fingerprints the reviewed output,
so a changed output invalidates it. An unapproved review *waits* rather than
pauses: the run keeps dispatching everything else and interrupts the operator
only when nothing else is dispatchable, which means the work is always finished
by the time anyone is asked. And the launcher's clean-tree rule learned that
`docs/reviews/**` is forge-managed, not user-owned.

The part I would point a builder at directly: all three surfaces — the dispatch
gate, the Console row, and the CLI guard — now call the engine's own
`unmetPrerequisites`. They cannot drift apart, because there is only one
implementation to drift from.

### The Takeaway for Builders

> **A trust boundary that cannot see what it is trusting is decoration.** When
> you add a human gate, the first question is what invalidates it — and the
> answer has to be the thing being attested to, not its metadata.

---

## Chapter 31: The Regex That Could Not See the End

The quality rubric scored project skills across several axes, one of them
whether the skill documented its gotchas. A skill whose `## Gotchas` section was
the **last** section in the file scored 1 out of 3 on that axis, regardless of
how many gotchas it contained.

The cause was one character. The section reader used `\Z` to mean "end of
input". JavaScript has no `\Z`. It compiles to a literal `Z`. So the assertion
was "and then a capital Z", which is false at the end of every file.

Two failures came from the same character. A final section read as empty. And a
section containing a capital Z — `Zod`, `Zen` — was truncated at the letter. The
correct end-of-input assertion is `$(?![\s\S])`; bare `$` is not a fix, because
the reader's `m` flag makes it match at every line end.

The bundled `forge-auto-build` skill is exactly the case that exposed it: eight
concrete, hard-won gotchas, in the final section, scoring 1.

The finding that stuck with me is not the bug. It is that the framework's own
quality gate had been scoring its own bundled skills, on every authoring run,
and nobody had looked at the numbers. A gate that is never inspected is a gate
that is not known to work.

### The Takeaway for Builders

> **A check nobody has ever seen fail is not a check.** Read the output of your
> own quality gates occasionally — especially the ones that gate your own
> bundled artifacts, where "passing" is the expected result and therefore never
> surprising.

---

## Chapter 32: The CLI That Kept Moving

Copilot authoring model discovery broke five times in six releases.

Each break was a different output format. The model list came back as a
box-drawn terminal table. Then as a Markdown list under
`Available models include:`. Then on stderr instead of stdout. Then as one bare
model ID per line with no heading at all. Each version shipped a parser fix, a
regression test, and a changelog entry describing the new shape.

The repeated failures share a cause that is worth naming, because it is easy to
walk into: **the integration point was a human-facing surface.** Every one of
those outputs was formatted for a person to read at a terminal. The code was
depending on presentation, and presentation is exactly what a CLI vendor is
free to change without breaking anyone's API — because nobody documented it as
one.

The eventual direction was to stop treating the generative prompt as the
interface at all: probe runner metadata non-generatively, parse per runner, and
fail with an explicit error rather than a silently empty inventory. It is a
better design and it arrived five releases later than it should have.

### The Takeaway for Builders

> **Never parse output that was formatted for a human.** If you have to read it,
> treat the format as unstable, pin what you can, and make an empty result a
> loud failure rather than a quiet one. The cost of this lesson was five
> releases.

---

## Chapter 33: The Assumption That Outranked the Evidence

This is the chapter I would keep if I could only keep one.

OpenCode v2 removed `run --dir`, and the migration work concluded — in an
architecture decision record, in a rewritten plan, in code comments, in user
documentation, and in a test — that the project directory was selected by the
child's `process.cwd()` and that the `PWD` environment variable was ignored.
The reasoning was careful and the conclusion was written down three different
ways, including a warning that recording the opposite belief "invites a future
maintainer to delete the `cwd` that does the work."

Then a user reported that parallel builds were producing nothing, and pointed
at the actual resolution expression in the shipped v2.0.20 binary:

```js
let d = n.root ?? process.env.PWD ?? process.cwd()
```

`run` invokes that with an empty options object. So the resolved directory is
`PWD ?? cwd`, and **`PWD` wins.** The record had it exactly backwards, and it
had it backwards in the one file a maintainer would trust.

The consequence was specific and severe. The engine is normally launched from
its own package directory. It passed no environment to the harness, so every
task inherited the `PWD` of whatever shell started it — naming a different
project entirely. Each task ran in the engine's package directory instead of its
sandbox worktree, could not find the execution file the engine had written for
it, produced nothing, and failed the output gate with a *missing outputs* error
that pointed at the task rather than at the harness.

Three details of that failure are worth more than the bug.

**It was silent in the mode that was supposed to be safe.** At
`--concurrency 1` the execution file is written to the engine root — which is
exactly where the misdirected session already sat. The task found its
instructions by accident and ran fine. Only parallel mode, the mode that exists
precisely to isolate tasks, ever broke. A green sequential run was not evidence
of anything.

**Three measurements had already "verified" the opposite.** One used
`opencode debug config`, which does not exercise the session-creation path the
real binary takes. The other two launched from a neutral directory. In all three
the inherited `PWD` already agreed with `cwd`, so the question — *what happens
when they disagree* — was never asked. The measurements were careful, real, and
structurally incapable of detecting the thing they claimed to rule out.

**The test enforced the wrong belief.** The adapter test asserted that `PWD` was
*not* the repo root, with a comment explaining that `PWD` must not be relied on.
A correct fix — setting `PWD` to match `cwd` — would have failed that test. The
suite was not missing a case; it was actively defending the error.

The fix was one rule, applied where children are spawned rather than at the
individual call sites: a child is never launched with a `PWD` that disagrees
with the `cwd` it was given. `cwd` fixes the filesystem, `PWD` is corrected to
match, and the two cannot disagree. That covers the opencode adapter and now
also copilot and claude, and it prevents the next call site from reintroducing
the same gap.

The decision record was not rewritten. Under the repository's own rule that
decision records are immutable, ADR-058 keeps its text and gained a pointer to
ADR-059, which records the corrected finding. The planning document was likewise
marked superseded rather than edited. The wrong claim stays readable, because
the gap between what the documentation asserted and what the binary did is
itself the most useful thing in this chapter.

### The Same Disease Elsewhere

The failure was not unique, which is why it is a pattern and not an anecdote.

Windows caught two sandbox-teardown failures in the same week. `git worktree
remove --force` can report success and leave the directory behind when a linked
build input is a junction, so the fallback never ran. And a containment check
compared paths with a bare `path.relative`, so a worktree spelled the way git
prints it — forward slashes, different case, a short 8.3 name — was not
recognized as a sandbox, and the worktree leaked silently for the rest of the
run. Both were found by Windows CI, and both had been assumed correct on the
platform nobody was testing.

The common thread: something was written down as true, never re-examined, and
held because the environment that could disprove it was not the environment
being used.

### The Takeaway for Builders

> **A documented conclusion becomes an enforced invariant.** That is why a
> wrong document is more dangerous than no document: it does not sit there being
> wrong, it gets tested into a test suite and defended. When you record a
> conclusion, also record what would have falsified it and what was actually
> varied.

---

## Chapter 34: The Whole Picture - What the Mirror Actually Showed

The mirror idea from the last version of this chapter was that MyForge had
become its own brownfield project. That was true, and it was also the least
interesting thing that happened in this stretch.

The more useful finding is narrower. Between the two versions of this chapter,
the repository went from 1 human contributor to 3, and the most important
change was not the volume of work. It was that contract-level decisions started
arriving from people who had not been in the room when the contracts were
designed.

- `lithiumriver` added Claude Code as an execution harness and as an authoring
  runner, end to end — engine, launcher, Console, model inventory, runner
  selection — and wrote the ADRs for it.
- `nabeelp` landed the structured task contract work and the six decisions that
  reorganized how work is specified, verified, and reported, plus PRD readiness,
  reachability and validation-gap visibility, and Console project removal.

Those are contributions, not corrections, and they were not corrected afterward.
That is the finding. A framework whose conventions are good enough that a
stranger can add a harness — or a normalization — and land it without review
has crossed a line that no amount of self-hosting would have crossed on its own.
A system that maintains itself is still a system with one author. A system other
people can change its contracts is a shared practice.

The layers now stand like this:

| Layer | What it contributes |
|-------|---------------------|
| Authoring | PRD, features, team, project skills, model and runner choices, persisted state |
| Compilation | A stable execution manifest and responsibility boundaries |
| Runtime | Task dispatch, sandboxes, verification, retries, human review, pause/resume, audit |
| Console | A human projection of current state and available controls |
| Packaging | An installable launcher with bundled runtime resources |
| Documentation | Operational instructions, historical decisions, and evidence |
| Validation | Tests, quality gates, package smoke checks, browser captures |

And the boundaries are wider than the table suggests, which is the part worth
keeping visible:

- A passing test is not a live verification. Every shim-based harness test in
  this repository is a shim, and the one bug in Chapter 33 would have been
  invisible to all of them.
- A documented conclusion is not a verified one. Chapter 33 is the proof.
- A local tarball install is not registry publication.
- A deterministic fixture is not proof that every external harness behaves the
  same way.
- Clean tests are not evidence for timing-sensitive behavior. Several tests in
  this repository fail under CPU load and pass on an idle machine, which means
  a red build is not always a real signal and a green one is not always either.

### The Takeaway for Builders

> **The test of a system is not whether it maintains itself. It is whether
> someone else can change its contracts and have the change hold.**

---

## Chapter 35: The New Principles

Part 4 replaces its previous five principles, because two of them described a
project state that no longer exists and one of them turned out to be the
problem.

**22. A project becomes its own subject when someone else can change its
contracts.** The earlier version said the framework is a first-class brownfield
project, which is true of effort rather than of outcome. The version that
matters is about handover: a brownfield project you maintain alone is a burden,
and one that others can safely change is a practice.

**23. Self-hosting means traceability, not magic.** A human stays in the loop,
but the decisions, artifacts, state transitions, and review boundaries are
explicit enough to audit after the fact.

**24. If a feature cannot be correct under the documented conditions, make the
conditions stricter, and name the feature for what it actually does.**
`--concurrency > 1` now refuses an unclean tree, and "parallel agents" in the
UI is "parallel task execution" in the docs. Both are better products than a
flag that lies or a label that oversells.

**25. A trust boundary has to see what it trusts.** An approval that
fingerprints metadata but not the artifact is not a gate.

**26. A documented conclusion becomes an enforced invariant, so verify what
would have falsified it — and check that your tests could have caught the
opposite.** The strongest version of this is the failure mode: a wrong document
does not merely mislead a reader, it gets compiled into a test that defends it.

Two rules that fell out of the previous list deserve to survive as habits rather
than as principles. Evidence needs provenance: a screenshot, a log, or a release
note is trustworthy when you can say which build produced it and what it was
checked against. And packaging is runtime behavior, not a post-development step
— if the artifact users install cannot find its own resources, the feature is
not finished.

---

## Epilogue for Part 4: The Framework That Outgrew Its Author

The question at the beginning was whether AI could work like a real team.

The answer has required more than agents. It has required requirements,
boundaries, execution contracts, durable state, operator controls, evidence, and
a willingness to revisit assumptions when a real project exposed them.

Then the harder question:

**Can the system that teaches projects how to evolve also evolve without
forgetting what it has learned?**

Part 4's answer is more qualified than the last one, and more encouraging. The
framework did not become self-sufficient. It became correct enough, and legible
enough, that other people started landing contract-level changes in it. Two
people who were not the author shipped a second execution harness and a
reorganization of the task contract. Neither needed to be persuaded of the
architecture first.

That is a better outcome than self-hosting, and it is a different one. A
self-hosting framework is still one person's system that happens to maintain
itself. A framework other builders can extend has actually done the thing it
was built for: given someone else a standing start.

For anyone building their own version of this — which is the point of writing it
down — the transferable part is not the architecture. It is the list of ways a
system convinces itself it works:

- a flag that is accepted and ignored
- a label that promises collaboration and delivers scheduling
- a gate that scores a real artifact at zero
- an integration that parses a human's screen
- an approval that does not cover what it approves
- a conclusion that was measured three times without varying the thing that
  mattered
- a test that defends the mistake

None of these announce themselves. All of them are findable, and each one is
cheaper to find than to explain.

Part 1 asked: *"What if AI could work like a real team?"*

Part 2 asked: *"What if that team could build the next team without you in the
loop for every step?"*

Part 3 asked: *"What if that team could come back to yesterday's work and keep
going without losing the thread?"*

Part 4 asks:

**"What if the framework could apply those same disciplines to itself, survive
what that exposes, and become something other people can build on?"**

---

*This is the continuation of the story. Part 4 covers the stretch where MyForge
stopped being designed and started being used: concurrency that had to become
demanding to become real, a feature that was named for a different thing than
it did, a human gate that had to see what it gated, a quality gate scoring the
framework's own bundled skills, an integration parsing a moving CLI, and a
documented conclusion that was confidently wrong until someone read the
source.*

*The framework still needs a human to choose the destination. It has started
getting better at handing the map to other people.*

---

**Made with ❤️ and a lot of research documents by
[McFuzzySquirrel](https://github.com/McFuzzySquirrel)**
