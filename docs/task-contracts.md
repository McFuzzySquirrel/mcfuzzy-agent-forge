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
  be existing repository-local files when execution begins; the engine reads
  their contents into the prompt. Traversal and external symlink targets fail.
  Limits are 128 KiB per reference and 256 KiB combined, with no silent truncation.
- Dependency IDs are explicit. Compilation rejects cycles and unknown structured
  task dependencies, and projects artifact types from task and prerequisite-phase
  dependencies. Feature table dependency names must match the full feature names.
- Structured implementation tasks require outputs and nonempty validation
  commands. Commands run from the repository root after each successful harness
  invocation, regardless of `--run-validation` or `--allow-noop`. Failed checks
  prevent completion. These are trusted executable commands: review authored
  commands before running a plan, as with any build script.
- Required acceptance criteria are included in the prompt; they are not a
  formal proof. A vacuous test can still pass, so command relevance and coverage
  remain authoring/review responsibilities.
- Structured tasks must return a fenced `forge-result` JSON report containing
  `summary`, `decisions`, `interfaces`, `tests`, and `unresolved`. All but summary
  are string arrays; tests must be nonempty, unresolved must be empty to complete,
  and the JSON report is limited to 16000 characters. Missing/invalid reports
  fail verification. The engine records actual successful command executions
  separately from model-reported tests in the artifact.
- Artifacts carry actual outcome reports and changed files rather than repeating
  the task specification. No default confidence score is manufactured.
- On Windows, standard npm shims for Node CLIs are resolved to their scripts and
  invoked directly to preserve multiline prompts. Native executables retain their
  normal launch path; custom batch wrappers should be tested for prompt fidelity.

## Human review

A `human-review` contract is not dispatched to Copilot or another model.
The engine pauses at the review task, leaving it pending. `--yes` and headless
PRD approval do not bypass this gate. The Console displays the paused run;
operator attestation currently uses the engine CLI, not a Console approval form.

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

PRD authoring plans specialist names before team generation. Team generation
creates matching owners and checks their domain fit; it reports a required plan
correction rather than silently rewriting the plan. PRD/decomposition/feature
skills share the contract reference. Human quality checks remain necessary for
task size, requirement coverage, and meaningful tests; structural compilation
does not replace these judgments.

The launcher stages the live templates through its existing `prepack` process.
Bootstrap/install the updated templates into target repositories through the
normal workflow before using contracts; source updates do not patch an already
bootstrapped engine automatically.