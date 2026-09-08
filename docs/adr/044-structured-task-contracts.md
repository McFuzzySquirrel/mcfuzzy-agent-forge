# ADR-044: Structured Task Execution and Completion Contracts

Status: Accepted

## Context

Task bullets were treated as executable specifications, while ownership,
outputs and commands were inferred from prose. Requirements and acceptance
criteria were lost, human activities became model tasks, and synthesized
handoffs described intentions rather than verified outcomes.

Requiring seven result fields encouraged redundant reporting. Three WALK-1
attempts returned fenced JSON with summary lists, successful harness execution,
expected files and no unresolved blockers, but the string-only summary parser
rejected them. A compact, explicit completion contract avoids this ambiguity.

## Decision

Use versioned `forge-task` JSON blocks in canonical feature documents, as defined
by [ADR-045](045-prd-readiness-and-task-sizing.md).
Preserve explicit specialist ownership, requirements, acceptance criteria,
constraints, input references, output paths, dependencies and validation commands
through the manifest. Structured tasks bypass text splitting and owner scoring.

Structured implementation tasks require expected outputs, successful authored
validation commands and a fenced `forge-result` JSON report before completion,
independent of the legacy opt-in validation flag. A successful harness envelope
alone is not completion. Dependency artifacts describe actual outcomes and
distinguish engine-verified commands from agent-reported checks; do not invent
confidence scores.

Require only `summary` and `unresolved` in the result. Accept a nonempty summary
string or nonempty list of strings, normalizing lists into a string. Preserve the
16000-character report limit. Optional string arrays `decisions`, `interfaces`,
`tests`, `warnings` and `validationLimitations` retain compatibility with rich
reports. Prompts show a minimal example; rejection diagnostics identify missing
fields, invalid types, malformed JSON, missing fences and oversized reports.

Keep `unresolved` as the blocking field: completion requires it to be empty.
Unmet requirements, acceptance criteria and unverified required checks are
blockers. Environmental observations, non-required checks and changes awaiting
engine auto-commit may be nonblocking caveats. Never reinterpret older notes
automatically or claim an unrun check passed. Caveats survive downstream
projection without weakening output or validation gates.

Human-review tasks pause until task-bound operator evidence is attested, never
dispatching to a model. Changed task, selected reference content or evidence
invalidates approval. `--yes` does not approve human work. Attestations are local
audit records, not authenticated identities or authorization.

Reference transport and file lifecycle belong to
[ADR-046](046-task-execution-files.md); durable gate diagnostics and retry
feedback belong to [ADR-047](047-task-completion-diagnostics.md).

## Alternatives Considered

- Inferring executable scope from bullets loses requirements and ownership;
	retain that behavior only for legacy feature tasks with migration warnings.
- Requiring every rich report field adds boilerplate without stronger evidence.
	Keep a minimal required schema and optional structured detail instead.
- Treating all caveats as blockers or accepting harness success alone either
	rejects verified work unnecessarily or bypasses meaningful completion gates.

## Consequences

Planning authors must make task boundaries and test evidence explicit. Team
generation must create the planned specialist names and review suitability.
Structured contracts add mandatory validation cost and can stop unattended runs
at genuine human gates. Schema checks cannot prove semantic acceptance coverage,
meaningful test discovery, honest blocker classification or human judgment.

Legacy version-1 feature contracts and rich result reports remain supported;
monolithic sources require conversion under ADR-045. References and evidence
are bounded local files. Existing completed implementation state requires
explicit review/reset after migration. Updating source does not retrofit target
engines, rerun bank validations or change previously recorded task status.

See [Task Contracts](../task-contracts.md) for schema examples, migration,
verification limits, and operator commands.