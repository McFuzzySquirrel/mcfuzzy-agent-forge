# Structured Task Contracts

MyForge supports version-1 task contracts from planning through compilation,
prompt construction, verification, and artifact handoff. New PRD/feature authoring
uses fenced `forge-task` JSON objects inside implementation phase headings.
See the [authoring contract and example](../templates/skills/forge-build-prd/references/task-contract.md).

## Guarantees and limits

- Structured tasks preserve their titles and descriptions without heuristic
  splitting. Authors must choose one bounded outcome, name the integration
  boundary, and carry decisive requirements, limits and acceptance criteria.
- Implementation owners are explicit generated specialist names. Compilation
  rejects missing owners and Forge coordinators. Semantic suitability is reviewed
  during team generation; the compiler cannot prove specialist competence.
- Reference inputs and deliverable outputs are separate fields. References must
  be existing repository-local files when execution begins; repository tasks
  receive their paths for on-demand reading, while text-only requests retain
  inline contents. Traversal and external symlink targets fail.
  Limits are 128 KiB per reference and 256 KiB combined, with no silent truncation.
- Dependency IDs are explicit. Compilation rejects cycles and unknown structured
  task dependencies, and projects artifact types from task and prerequisite-phase
  dependencies. Feature table dependency names must match the full feature names.
- Structured implementation tasks require outputs and nonempty validation
  commands. Commands run from the repository root after the harness, output and
  report gates pass, regardless of `--run-validation` or `--allow-noop`. Failed checks
  prevent completion. These are trusted executable commands: review authored
  commands before running a plan, as with any build script.
- Required acceptance criteria are included in the task execution instructions; they are not a
  formal proof. A vacuous test can still pass, so command relevance and coverage
  remain authoring/review responsibilities.
- Structured tasks must return a fenced `forge-result` JSON report containing
  only two required fields: `summary` and `unresolved`. Summary is a nonempty
  string or nonempty list of strings (normalized to one string). `unresolved`
  is a string array and must be empty to complete. Optional `decisions`,
  `interfaces`, `tests`, `warnings` and `validationLimitations` are string arrays.
  The JSON report is limited to 16000 characters. Missing/invalid reports fail
  with specific field or format errors. The engine records successful command
  executions separately from optional model-reported tests in the artifact.
- `unresolved` means blocking unmet requirements or acceptance criteria, including
  unverified required checks. Optional `warnings` and `validationLimitations`
  string arrays preserve nonblocking observations and non-required checks not run.
  Older reports omitting these two fields remain valid. Caveats are retained in
  artifacts and downstream projections; they do not bypass any completion gate.
- Artifacts carry actual outcome reports and changed files rather than repeating
  the task specification. No default confidence score is manufactured.
- Copilot/OpenCode repository tasks use short, single-line CLI prompts pointing
  to engine-generated task execution files. Large references and fallback
  personas no longer consume command-line space. Copilot native selection uses
  `--agent`; standard npm Node shims also retain their direct-launch support.

## Completion and retry diagnostics

An agent saying "all validations pass" is not the completion decision. For a
structured task, the engine checks successful harness execution, expected output
existence, a valid fenced `forge-result`, an empty `unresolved` list, then zero exit
codes from every manifest validation command. Only then is the task marked complete;
engine auto-commit follows. The engine does not execute commands described only in
the report's `tests` strings or prove semantic acceptance-criterion coverage.

The minimal response is:

```forge-result
{"summary":"Implemented the task and verified required checks.","unresolved":[]}
```

Replace the summary with the actual outcome. Omit empty optional lists and
redundant validation narratives; do not omit genuine blockers. Plain prose is
not a structured report, and a report alone never bypasses engine validation.

Use `warnings` for a resolved dependency-installation issue or changes awaiting
engine auto-commit. Use `validationLimitations` for hosted CI not run only when it
is not required to establish the task's acceptance criteria. If a required zero-test
guard has not been verified, that belongs in `unresolved`, even if other tests pass.
The engine validates the schema, not the semantic classification of these notes;
authors and reviewers must not move genuine blockers into caveat fields.

Every settled model invocation updates `docs/artifacts/<task-id>.result.json`
and writes a timestamped `<task-id>.<timestamp>.attempt-<number>.result.json`
archive before a retry or terminal task result. For example, `WALK-1.result.json`
is the latest result and `WALK-1.2026-09-07T17-00-00-000Z.attempt-2.result.json`
is an archived attempt. A numeric suffix prevents timestamp collisions. Each includes run/task/attempt identity,
timestamp, outcome, the harness result (stdout, stderr, files, duration and failure
kind when supplied), the parsed handoff when valid, and five completion gates:
`harness`, `outputs`, `handoff`, `requirements`, `validation`. Gate statuses are
`passed`, `failed` or `skipped`; checks not reached are not reported as passing.
Successful validation gates list engine-verified commands; failed gates retain
their rejection reason. The requirements gate means no blockers were reported,
not that the engine independently proved all natural-language requirements.

`WORKFLOW-STATE.json` stores lightweight `attemptHistory` entries pointing to
immutable archives, not the replaceable latest result. `task.attempt.finished` audit events record each settled invocation,
and `task.retrying` carries the previous reason and result path. Retry requests
include up to 4000 characters of the reason and the full evidence path, instructing
the agent to address the failure while preserving completed work and scope.
Harness failures and cancellation also retain diagnostics. A hard process crash
before recording finishes cannot guarantee a result file; request snapshots may
be the only evidence for such an interrupted invocation.

Result files share the protected execution directory's local-only retention and
commit rules below. They can contain sensitive output, are not authenticated,
and require operator-managed cleanup. There is no automatic retention policy.
Existing saved state without attempt history remains readable. Updating the
templates does not reconstruct old reports, reinterpret old `unresolved` entries,
rerun checks or mark previously failed tasks complete.

## Execution files and reference reading

Repository-task CLI invocations reuse `docs/artifacts/<task-id>.md`, such
as `WALK-1.md`. Before each invocation, the engine atomically replaces its contents
with the current task and attempt instructions, including retry feedback. It includes the compiled task's mandatory
requirements, criteria, constraints, deliverables and validation commands, plus
dependency context, attempt metadata and the specialist persona when native
selection is unavailable. The launch prompt tells the agent to read that file
first and execute only that task. It does not ask the agent to reconstruct a task
from the entire manifest or PRD. This is generated execution context, not a second
hand-maintained specification.

Copilot, OpenCode and Claude share this transport. Claude unwraps the CLI's JSON
envelope before the engine validates its `forge-result`; a successful envelope
alone does not complete a structured task.

Supporting documents stay on disk. Put decisive rules explicitly in the task
contract; include useful requirement IDs or section headings in its description
when directing reference reading. Reference paths remain plain file paths, not
fragment URLs. The engine does not extract sections or decide which requirements
can be omitted. Missing, escaping and oversized references still fail preflight.

The engine logs the instruction path and current SHA-256. The Markdown file
contains only the latest attempt, not a separate request history. Result archives
are retained after success, failure and cancellation and are never overwritten.
Simple uppercase task IDs are used verbatim; unsafe, reserved, long or
case-distinct IDs receive a bounded readable filename plus a hash. Latest-file
replacement refuses symlinks, hard links and non-files; linked execution
directories remain prohibited. These protections do not authenticate evidence.
Treat these files as read-only local diagnostics, not authenticated or tamper-proof
records. Reference documents are read live, not frozen into these snapshots.
They may contain sensitive project context: do not publish or commit them, and
remove them after a run when no active invocation needs them. There is no automatic
retention policy. OpenCode attach mode requires the server to see the same
repository and execution files; the engine does not upload them to remote hosts.

Execution files are not evidence of implementation. The engine excludes the
directory from worktree attribution and auto-commit staging; it declines to
auto-commit if execution files are already staged, without unstaging user work.
Task outputs must not target this reserved directory. A CLI must have repository
read access to follow the file prompt. Explicit text-only requests retain inline
instructions and references; large text-only CLI requests remain subject to CLI
limits and should use an appropriate text API instead. Human-review tasks never
create model execution files.

Bootstrap adds `docs/artifacts/` to the target `.gitignore`. Task inputs, latest
outputs and archived attempt traces live at its root; typed handoffs retain their
type-specific subdirectories. All are generated local records, excluded from
auto-commit even if already tracked. Pre-staged records stop auto-commit without
changing the index. Existing ignore rules are preserved, and already tracked
files are not automatically untracked.

Existing `docs/task-executions/` files and their saved audit/state/retry links are
not renamed, deleted or rewritten. That legacy directory remains excluded from
task attribution and auto-commit and may not be used for deliverables. Update
installed templates and rerun bootstrap to adopt the new writer and ignore rule.
See [ADR-046](adr/046-task-execution-files.md).

## Human review

A `human-review` contract is not dispatched to Copilot or another model.
The engine pauses at the review task, leaving it pending. `--yes` and headless
PRD approval do not bypass this gate. The Forge Console task detail now offers
**Complete human review** for these tasks. The form shows the task criteria,
captures the reviewer's name and notes, requires an explicit attestation, writes
repository-local Markdown evidence, records the canonical engine attestation,
and resumes the build through the normal background engine controller. The CLI
approval flow remains available as a fallback.

After performing the review, an operator writes a repository-local evidence file
and runs the following from the installed workflow-engine skill directory:

```bash
npm run workflow-engine -- approve-task ACCESSIBILITY-REVIEW --repo /path/to/project --reviewer "Reviewer Name" --evidence docs/reviews/accessibility-evidence.md --confirm-human-review
npm run workflow-engine -- run --repo /path/to/project --harness copilot --yes
```

Repeat `--evidence` for multiple files. The command writes the contract's
`reviewFile`, recording reviewer, timestamp, task/reference fingerprint and
evidence hashes. Resume verifies these before completing the task. Changes to
the task, references or evidence invalidate approval. A resumed run reopens
stale completed human gates and their dependents; replay rejects invalid human
prerequisites. Keep references/evidence narrowly scoped to avoid unnecessary
invalidation.

When using the Console, expand the paused human-review task on the Tasks view,
select **Complete human review**, enter the reviewer identity and findings, and
confirm the attestation. The Console resumes automatically; if the engine is
already running, it leaves the approval recorded and reports the resume error
without starting a second run.

This is a local operator attestation, **not authenticated identity or a security
boundary against an agent with write access to the repository**. Agents are
instructed not to create attestations. Strong separation requires external
approval storage/identity and filesystem permissions, outside this feature.
Do not treat this record as regulatory or independent third-party certification.

## Legacy migration

Existing checkbox plans and manifests without `contract` remain supported and
retain opt-in validation behavior. Compilation emits per-task migration warnings.
Their heuristic owner/output inference is not upgraded to strict guarantees.
Version numbers and explicitly referenced backtick paths following `per`, `from`,
`see`, `consult`, `read`, or `reference(s)` are no longer inferred as outputs;
other prose remains ambiguous. Use structured fields to remove that ambiguity.

Do not mix structured blocks and task checkboxes in one phase. Migrate a bounded
phase, preserve global task IDs, review ownership and dependencies, then recompile
and inspect the responsibility matrix and reconciliation warnings. Review/reset
affected completed tasks explicitly before running changed implementation work.
Installing this update does not rewrite existing target-project PRDs, manifests,
agent files, or state.

## Authoring and packaging

The launcher validates authored PRDs before marking the stage complete and
revalidates on draft reuse, resume and team generation. Every solution must have
`docs/PRD.md` and non-empty `docs/features/*.md` with an exact feature
dependency table. There is no size threshold or standalone source-document build
path. Author directly into this layout; convert historical sources before use.

Run the same read-only check from the installed adapter directory:

```bash
npm run validate-prd -- /absolute/path/to/project
npm run validate-prd -- /absolute/path/to/project --feature docs/features/new.md
```

It runs no authored validation commands and needs no generated team. Planned
owner names are checked structurally and against the coordinator denylist; the
compiler later checks that actual generated specialists exist. The gate rejects
invalid contracts, empty phases, missing/oversized references, duplicate IDs,
unknown dependencies and cycles. Output paths must name files (with an extension,
or `Dockerfile`, `Makefile`, `LICENSE`), not directories. References are limited to
128 KiB each and 256 KiB of resolved context per task. Dependency
IDs come from canonical feature tasks, not historical sources or a stale manifest;
legacy prerequisites require deliberate migration or a documented interface.

Errors leave the PRD stage failed and block team generation. Repair the documents
and retry `draft-prd`, `draft-existing-prd`, or `feature-prd` as applicable. Existing
completion flags are not sufficient evidence. `--allow-legacy` supports inspection
of existing checkbox plans, but does not waive required decomposition; new
authoring must use contracts. Installation alone changes no target documents or
completed task state.

PRD authoring plans specialist names before team generation. Team generation
creates matching owners and checks their domain fit; it reports a required plan
correction rather than silently rewriting the plan. PRD/decomposition/feature
skills share the contract reference. Human quality checks remain necessary for
task size, requirement coverage, and meaningful tests; structural compilation
does not replace these judgments.

Use the shared authoring reference's task/check table to review one observable
outcome per task, actual prerequisites, concrete test files and acceptance-to-check
mapping. A phase is not one task by default. Keep atomic invariants together;
split unrelated UI, infrastructure and domain work. Broad statistical/hosted
evaluation belongs in explicit integration tasks, while rubric scores and native
language approval belong in human-review tasks. The validator does not prove
test discovery, semantic requirement coverage or that the chosen boundary is
small enough; authors and reviewers must assess these explicitly.

The launcher stages the live templates through its existing `prepack` process.
It includes a runtime `tsx` loader so the bundled validator works before target
tooling installation, including from paths with spaces on Windows.
Bootstrap/install the updated templates into target repositories through the
normal workflow before using contracts; source updates do not patch an already
bootstrapped engine automatically.
