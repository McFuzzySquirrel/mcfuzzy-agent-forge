# ADR-046: File-Based Execution and Generated-Artifact Lifecycle

Status: Accepted

## Context

A banking task produced a 25,228-character prompt before artifact context,
mostly because complete reference documents were embedded. Copilot resolved to
VS Code's BAT wrapper, exceeding the Windows command interpreter's 8,191-character
limit. Bypassing that wrapper would not eliminate the larger native process
argument limit. A multiline native-agent directive also loses the task prompt
through a batch wrapper.

Random request/result filenames made current task instructions and outcomes hard
to find. Storing traces separately from typed handoffs left multiple generated
directories and inconsistent Git exclusions. These files can contain sensitive
project context and are not authored deliverables.

## Decision

### Execution Transport

Copilot, OpenCode and Claude repository-tool tasks use the same short,
single-line CLI instruction pointing to a task execution file under
`docs/artifacts/`. The engine derives it from
the validated task request, preserving scope, criteria, constraints, outputs,
validation commands, prerequisite context and attempt metadata. Fallback personas
live in the file; native personas use `--agent`. Do not ask the model to discover
its task by reading the entire PRD or execution manifest.

References remain validated local paths for selective reading. Decisive rules
must be explicit in the task contract. Reference existence, containment and size
checks are retained; the engine does not silently truncate content or infer
optional requirements. Text-only requests retain inline content, including the
OpenAI API path. Human-review tasks are never sent to the model.

Claude retains [ADR-042](042-claude-code-execution-harness.md)'s JSON-envelope
parsing, native selection, model normalization and permission-denial
classification. Its result text enters the shared completion gates in
[ADR-044](044-structured-task-contracts.md); envelope success is not completion.
[ADR-043](043-claude-code-authoring-runner.md)'s authoring runner is unchanged.
This amends [ADR-030](030-copilot-native-agent-selection.md)'s Copilot `/agent`
prompt directive to use the `--agent` argument.

### Generated Files

Use the shared writer and consolidate generated task records under
`docs/artifacts/`:

- `<task-id>.md`: current execution input, including fallback persona and retry context.
- `<task-id>.result.json`: latest settled output and completion-gate trace.
- `<task-id>.<timestamp>.attempt-<number>.result.json`: immutable attempt archive.
- Typed handoffs retain their type-specific subdirectories.

Refresh instructions before every repository CLI invocation. Use atomic
replacement for current files and exclusive creation for archives, handling
timestamp collisions without overwriting evidence. State, audit and retry links
target archives. [ADR-047](047-task-completion-diagnostics.md) defines their
diagnostic contents and recording lifecycle.

Generate bounded, collision-resistant filenames for IDs unsuitable as portable
filenames, including case-distinct IDs on Windows. Refuse linked/non-regular
destinations and linked execution directories. Keep SHA-256 input digests in
logs for diagnosis, not as authentication or tamper prevention.

### Git and Retention Policy

Bootstrap adds `docs/artifacts/` to `.gitignore` idempotently, preserving user
rules including old extraction-results exclusions. Do not add that obsolete
exclusion to new repositories. Exclude both `docs/artifacts/` and legacy
`docs/task-executions/` from task attribution and auto-commit, even if not ignored
or already tracked. Neither directory may be declared as a task deliverable.
Pre-staged generated records prevent auto-commit without changing the user's
index.

Generated artifacts are local diagnostics by default, not versioned project
sources. This amends [ADR-017](017-artifact-store-and-context-projection.md)'s
normal generated-output Git policy and
[ADR-035](035-auto-commit-after-task.md)'s automatic staging scope.
Retention and backup are operator-managed.

## Alternatives Considered

- Bypassing a Windows wrapper alone leaves native argument limits. File-based
	transport bounds CLI arguments regardless of task context or persona size.
- Content-digest or UUID input filenames retain every request but obscure the
	current task. Keep current task-ID inputs and immutable result archives instead.
- Separate execution and handoff directories complicate discovery and exclusion
	policy. Use one generated-artifact root without changing typed subdirectories.
- Versioning generated diagnostics by default adds sensitive context and churn
	to task commits. Keep them local and leave deliberate backup to operators.

## Consequences

CLI prompt size no longer grows with repository task context or persona size.
Agents pay a file-read tool call and read supporting references as needed.
The generated file is an execution snapshot, not a second authored specification.
Digests aid diagnosis but are not authentication or tamper prevention; referenced
documents remain live. Retained snapshots may contain sensitive project context
and need operator-managed cleanup after active invocations finish.

CLI harnesses need repository read access; attached servers must share the
repository filesystem. Copilot native selection requires a CLI supporting
`--agent`, with `FORGE_ENGINE_NATIVE_AGENT=0` as a persona fallback. Large text-only
CLI requests remain subject to argument limits and should use a text API.

No migration renames, deletes or rewrites existing files, state or audit links.
Legacy task-executions paths and UUID-named records remain valid evidence.
Operators update installed templates and rerun bootstrap for the writer and
ignore entry. Already tracked files require an explicit operator decision to
untrack. Ignoring diagnostics does not make them private.

The input file is current-only. Archives retain outcomes, not a historical copy
of every input or live reference. A hard crash can leave an input snapshot
without a settled result. Updating MyForge does not overwrite installed engine
templates in target repos.

See [Task Contracts](../task-contracts.md) for operational details.