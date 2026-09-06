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

## Format

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