# ADR-057: An unapproved human review waits for the run, it does not stop it

- **Status:** accepted
- **Date:** 2026-09-29
- **Amends:** [ADR-056](056-parallel-execution-task-sandboxes.md)
- **Relates to:** [ADR-049](049-human-review-evidence-and-console-completion.md)

## Context

A `human-review` task is not dispatched to a model. When it had no operator
attestation, the engine paused the run at that task, leaving it pending, and the
operator was expected to record evidence and resume. That was the original design
in [ADR-049](049-human-review-evidence-and-console-completion.md), and it is
correct when the review's dependencies are declared.

The engine dispatches a review based on its declared `dependencies` and its
phase's dependencies, and the compiler never adds any: they are whatever the
feature document wrote. A review that references a file some other task produces
but declares no dependency on that task is therefore ready immediately.

Under `--concurrency 1` this was merely awkward. Under the parallel execution of
[ADR-056](056-parallel-execution-task-sandboxes.md) it becomes a deadlock. The
review dispatched in the first wave, paused the run on the spot, and the wave
loop exited before any sibling task started. The run then sat waiting for an
approval of work that had not been done — and the only way forward was the
approval it was waiting for.

The dependency was under-declared rather than absent, which is the authoring
mistake the PRD guidance asks authors to avoid, and which the compiler has no way
to detect today.

## Decision

An unapproved human review is a **wait, not a stop**.

The wave loop partitions the ready frontier into tasks that can run and human
reviews that are waiting for approval. It dispatches only the first set, leaves
the waiting reviews pending, and records why on their task records so the Console
row and `PROGRESS.md` explain a pending review that is not merely waiting its
turn.

The run pauses only when nothing is dispatchable and reviews are still
unapproved. Two consequences follow:

- The operator is interrupted at the point where the reviewed work has finished,
  even if the manifest under-declared the dependency. The deadlock is unreachable
  regardless of what the feature document says.
- A review no longer defers unrelated work that happened to share its wave.

`executeTask` no longer requests a pause for an unapproved review. The loop owns
that decision, which is what keeps the two paths from disagreeing. Each break in
the loop supplies its own pause note, so a review gate records
`Human review required` in the `run.paused` audit event rather than inheriting
the generic "Stop/pause requested (control file or signal)" note that would send
an operator looking for a control file that does not exist.

Phase bookkeeping follows what actually starts, so a phase whose only task is a
held review does not emit `phase.started` until it can begin.

`replayTask` is a single task with nothing to hold back, so it still reports an
unapproved review as a pause rather than returning with the task pending.

A review that is the only ready task still pauses immediately, so `--yes` still
cannot approve human work and single-task behaviour is unchanged.

## Compile-time warning

The engine can only be correct if it does not trust the manifest, but the
authoring mistake is worth surfacing where it is made. `validateManifestSafety`
now matches each human-review task's `references` against every task's
`expectedOutputs` and warns when the producing task is not in the review's
transitive prerequisite closure. References are split on `#` first, so a review
citing a line range of a produced file is recognised, and a producer reachable
through an intermediate task is not reported.

This is a **warning, not an error**. A review may legitimately reference a file
no task produces; existing feature documents must keep compiling; and because the
engine now holds an unapproved review rather than stopping the run, a missed
dependency delays a review rather than preventing one.

## Alternatives considered

- **Fail the run when a review is ready.** Rejected: it makes the engine's
  correctness depend on manifest authoring, and turns a documentation mistake into
  a stop with no remedy.
- **Auto-add the missing dependency to the review at compile time.** Rejected:
  inferring a dependency from a path overlap is a guess, and a wrong guess delays
  work that the author sequenced deliberately. A warning asks the author; a
  silent rewrite does not.
- **Leave the pause behavior and rely on the warning alone.** Rejected: the
  warning is advisory, so the deadlock would remain reachable for anyone who
  ignores or has not yet recompiled with it.

## Consequences

- A parallel run does more work before pausing than it used to. That is the
  point: the operator is only interrupted once there is nothing left to do.
- A feature document with an undeclared review dependency now produces a compile
  warning. Silence is the only way to keep the old behavior, and silence is what
  produced the deadlock.
- The compiler's review check matches file references against declared outputs. A
  review that verifies a command's exit status or a live system, rather than
  reading a file, has no path to match and is not covered by the warning. It is
  still correct at run time; only the authoring hint is missing.
- The Console row for such a review reads **ready**, because the dependency list
  is empty. The compile warning is the only signal for that case. The row is
  addressed separately in
  [issue #112](https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge/issues/112).

## References

- [Workflow engine](../workflow-engine.md)
- [Structured task contracts](../task-contracts.md)
- [Workflow engine deep dive](../workflow-engine-deep-dive.md)
