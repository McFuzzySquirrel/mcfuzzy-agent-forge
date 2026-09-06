# Executable Task Authoring Contract

New implementation phases use one fenced `forge-task` JSON object per task,
not checkbox summaries or nested metadata bullets. Legacy plans remain readable
but compile with migration warnings. Do not rewrite a supplied legacy plan or
renumber completed work without the user's authorization.

## Task sizing and wording

- One task has one bounded, observable outcome and one accountable specialist.
- Start the description with an action. Name the behavior, integration boundary,
  decisive limits/invariants, and what is out of scope. Avoid "required fields",
  "the four capabilities", or "appropriate validation" without defining them.
- Carry requirement IDs AND their decisive meaning, acceptance criteria, and
  cross-cutting security, accessibility, and architectural constraints.
- Split unrelated identity, telemetry, UI, infrastructure, and CI deliverables.
  Keep inseparable atomic invariants together; never split merely at punctuation.
- Include tests in the task that implements the behavior. Specify repository-root
  commands that actually exist or are created by this task. Never invent passing
  results, tool availability, deployed resources, human review, or compliance.
- References are input files, outputs are concrete deliverable files. Existing
  files can be outputs when intentionally modified, but a path cannot be both an
  input reference and an output in the same task. Reference another requirements
  document when changing the planning document itself.
- Choose stable, globally unique task IDs using letters, digits, dots,
  underscores and hyphens, beginning with a letter or digit. Dependencies are exact task IDs;
  feature-table dependencies must exactly match full feature names (no aliases
  or "all other features"). Do not rely on document order for same-phase tasks.
- Plan stable specialist `ownerAgent` names before the team exists. Team generation
  must create matching specialists and verify ownership against requirements;
  a coordinator is not an implementation owner. Do not guess owners by keywords.

## Execution-sized tasks

A delivery phase or feature is a work package, not automatically one executable
task. Decompose it until every task can be completed, tested, reviewed, and retried
without reopening the whole feature. Do not target a fixed task count or split
sentences mechanically. A few related files and one observable behavior are a
useful default, not a hard cap.

Before writing blocks, make a task table with: ID, observable outcome, owner,
prerequisite interface, concrete output/test files, acceptance-to-check mapping,
and exclusions. Keep this review table in the planning document outside phase
task blocks. It is authoring evidence, not a replacement for the JSON contracts.

Split whenever a task contains independently testable outcomes or unrelated
ownership boundaries. Examples:

| Work package (too large for one task) | Candidate execution units |
|---|---|
| Hosted walking skeleton | Runnable scaffold; balanced posting plus idempotency/concurrency tests; outbox dispatch; revision reconciliation; hosted access/network boundary; CI; telemetry |
| Invoice processing | Upload quarantine/validation; extraction normalization; field-correction UI and audit; beneficiary mismatch blocking; retention cleanup |
| Banking capabilities | Registry contract; each supported capability; atomic confirmation and deduplication; stale handling; review UI |
| Presenter console | Presenter controls; read-only playback; replay capture; reset/deletion; dashboards; fault recovery |
| Locale parity | Each locale profile; Arabic resources/RTL flows; isolation checks; cost evaluation; separate human review |

Keep atomic safety guarantees together: posting, authorization, revision checks,
and duplicate-confirmation protection must not be split into unsafe intermediate
implementations. Extract unrelated infrastructure or presentation work instead.
Shared foundation interfaces should be explicit prerequisites; do not chain every
task to the previous task merely because it appears earlier in the document.

Every changed surface needs a check: domain tests for invariants, UI interaction
tests for views and confirmation flows, configuration/IaC validation for hosting,
and documentation/evidence checks for release materials. A .NET category filter
does not validate a React view. Name exact test files in outputs where tests are
created or modified; directories such as `src/web` are not deliverables.

Commands are planned before code exists, so the prerequisite task must establish
the test runner and its filtering convention. Require test discovery to find the
intended tests and fail on zero selected/executed tests. Do not use `echo passed`,
an unconditional exit-zero command, or a build alone to prove behavioral acceptance.
During execution use the runner's fail-on-no-tests option or inspect its structured
test report with a repository validation script; do not assume exit zero proves
any tests ran. Acceptance criteria must map to named checks, not generic categories.

Keep focused tests with implementation. Put expensive statistical simulations,
hosted integration, performance matrices, and release-wide evaluation in explicit
integration/evaluation tasks after their prerequisites, with report files and
threshold-checking commands. Do not make an early task pass the entire release suite.
Human rubric scores, native-language approval, and stakeholder judgments belong
only to dependent human-review tasks. Implementation produces reviewable evidence;
it cannot claim "native-reviewed" or human-approved before that gate runs.

## JSON format

Place this inside a `### Phase 1: ...` section. Use ordinary JSON, no comments.
Every field below is required except `timeoutMs`; empty constraints/dependencies
are valid. Adapt paths, commands, names, and requirements to the actual project.

```forge-task
{
  "id": "UPLOAD-1",
  "title": "Validate invoice uploads",
  "description": "Implement upload validation before extraction. Accept one PDF/JPEG/PNG up to 10 MB and 10 pages. Reject declared/detected type mismatches without forwarding bytes to extraction. Do not implement payment execution.",
  "ownerAgent": "invoice-engineer",
  "dependencies": ["PLATFORM-1"],
  "expectedOutputs": ["src/upload.ts", "tests/upload.test.ts"],
  "validationCommands": ["npm test -- tests/upload.test.ts"],
  "contract": {
    "version": 1,
    "kind": "implementation",
    "requirements": ["INVC-FR-01: One supported invoice, at most 10 MB and 10 pages", "INVC-FR-05: Reject invalid input before extraction"],
    "acceptanceCriteria": ["Boundary tests cover valid, oversized, over-page-limit, and mismatched-type input", "Rejected bytes never reach the extractor"],
    "constraints": ["Use the existing private quarantine storage boundary"],
    "references": ["docs/features/invoice-payment.md", "docs/product-vision.md"]
  }
}
```

Reference files are read in full at execution, limited to 128 KiB each and
256 KiB total. Use focused source documents when these limits are exceeded;
never silently omit constraints. Paths must be normalized, repository-relative,
forward-slash file paths with no traversal or external symlink targets.

## Human work

Preparation and human sign-off are separate tasks. Human tasks use
`contract.kind: "human-review"`, `contract.reviewFile` (for example
`docs/reviews/arabic-accessibility.json`), empty `expectedOutputs` and
`validationCommands`, and omit `ownerAgent`. They retain requirements,
acceptanceCriteria, constraints, references, and explicit dependencies on the
preparation/implementation tasks. Never represent a rehearsal or native-language
review as autonomous code generation. Headless PRD approval does not approve
later human work. Agents must never run `approve-task` or fabricate attestations.

## Review before saving

Check every task independently: can a fresh specialist identify its requirements,
scope, exact owner, prerequisite interfaces, files, and observable completion?
Does the union of task requirements cover the PRD without dropping safety rules?
Are test commands meaningful (not placeholders such as `echo passed`)? Are human
gates explicit? If not, repair the task before approving the plan. Preserve these
fields and IDs during decomposition, review, and incremental changes.

The compiler validates structure, owners, dependencies and required evidence
fields; it cannot prove that a model chose good boundaries or meaningful tests.
Human review remains necessary for those judgments.

## Deterministic authoring gate

From the installed `forge-execution-adapter` skill directory, install its tooling
dependencies if necessary, then run:

```bash
npm run validate-prd -- /absolute/path/to/project
```

For an additive feature use `--feature docs/features/new-feature.md` (repeat for
multiple files). Existing structured source tasks supply external dependency IDs.
The read-only command needs no generated agents and never runs task commands or
compiles a manifest. It checks canonical decomposition, task JSON/contracts,
planned owners, concrete output paths, local reference limits, and dependency IDs
and cycles. Correct every reported error before declaring authoring complete.
JSON parsing alone is not this gate. The launcher runs its bundled validator too.
For legacy inspection only, `--allow-legacy` permits checkbox plans; new authoring
must not use that flag to bypass contracts or required decomposition.