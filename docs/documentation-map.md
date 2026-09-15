# Documentation Map

This map explains where MyForge documentation belongs, which document is
authoritative, and when an agent should update it. Documentation is part of the
change that introduces or alters the behavior; it is not a follow-up task.

## How to use this map

Before changing code:

1. Identify the behavior, command, package, or architectural decision being
   changed.
2. Find the corresponding document group below.
3. Read the listed source-of-truth documents before editing.

Before completing the change:

- Update every affected document in the same change.
- Check links, filenames, commands, flags, environment variables, and examples.
- Add a changelog entry for user-visible behavior.
- Add or update an ADR for a significant architectural or behavioral decision.
- If no documentation needs changing, state why in the completion summary.

## Document groups

### Repository guidance

| Document | Authority and purpose | Update when |
|---|---|---|
| [`AGENTS.md`](../AGENTS.md) | Instructions for AI coding agents, repository layout, conventions, and verification commands. | Agent workflow, repository-wide conventions, or validation expectations change. Keep this concise. |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | Contributor workflow and contribution expectations. | Contributor-facing workflow or contribution policy changes. |
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | High-level repository architecture. | Component boundaries, data flow, or system structure changes. |
| [`plan.md`](../plan.md) | Project-level planning and direction. | Roadmap, priorities, or planned work changes. |

### Product and user-facing documentation

| Document | Authority and purpose | Update when |
|---|---|---|
| [`README.md`](../README.md) | Public overview, quick start, main components, and top-level usage. | Installation, quick start, major features, commands, or public terminology change. Keep `**Latest:**` synchronized with [`docs/updates.md`](updates.md). |
| [`docs/forge-launcher.md`](forge-launcher.md) | Detailed launcher command and workflow reference. | Launcher commands, options, environment variables, setup flow, or supported harnesses change. |
| [`scripts/forge-launcher/README.md`](../scripts/forge-launcher/README.md) | NPM package and launcher-specific reference. | Package commands, installation, autonomous-build options, or package behavior change. |
| [`docs/forge-console.md`](forge-console.md) | Forge Console capabilities and operation. | Console routes, controls, setup, or user workflows change. |
| [`docs/forge-console-user-guide.md`](forge-console-user-guide.md) | Step-by-step Console walkthrough. | A user-facing Console workflow changes. |
| [`docs/forge-console-screenshots.md`](forge-console-screenshots.md) | Visual tour and current UI captures. | Significant UI layout or interaction changes make screenshots stale. |
| [`docs/prompt-playbook.md`](prompt-playbook.md) | Interactive launcher prompts and expected answers. | Prompt wording, order, defaults, or onboarding behavior changes. |
| [`docs/running-with-local-models.md`](running-with-local-models.md) | Local-model setup and operation. | Local model providers, configuration, or supported execution paths change. |

### Requirements and authoring

| Document | Authority and purpose | Update when |
|---|---|---|
| [`docs/canonical-features.md`](canonical-features.md) | Canonical requirements layout, ownership, references, validation, and migration rules. | PRD/feature structure, requirement ownership, contract resolution, or migration rules change. |
| [`docs/task-contracts.md`](task-contracts.md) | Task contract format and execution requirements. | Task contract fields, validation, ownership, or generated execution instructions change. |
| [`docs/feature...` templates](../templates/skills/forge-decompose-prd/references/feature-document-template.md) | Template for authored feature documents. | Feature-document structure or required authoring fields change. |
| `templates/skills/*/SKILL.md` | Canonical instructions for each bootstrapped Forge skill. | The skill's inputs, outputs, workflow, commands, constraints, or examples change. |
| `templates/agents/*.md` | Built-in Forge agent personas and responsibilities. | Persona responsibilities, boundaries, collaboration, or supported workflow changes. |

The active requirements contract is `docs/PRD.md` plus `docs/features/*.md`.
Generated manifests are execution snapshots, not an additional source of
requirements. Legacy layouts and migration rules are documented in
[`docs/canonical-features.md`](canonical-features.md) and the relevant ADRs.

### Execution and orchestration

| Document | Authority and purpose | Update when |
|---|---|---|
| [`docs/workflow-engine.md`](workflow-engine.md) | Workflow-engine commands, state, execution, controls, and harness behavior. | Engine commands, lifecycle, state handling, retries, timeouts, or harness behavior change. |
| [`docs/workflow-engine-deep-dive.md`](workflow-engine-deep-dive.md) | Detailed engine internals and implementation model. | Engine architecture or non-obvious execution internals change. |
| [`docs/workforce-compiler-deep-dive.md`](workforce-compiler-deep-dive.md) | Workforce compiler and kernel handoff details. | Workforce compilation or handoff behavior changes. |
| [`docs/artifact-store-deep-dive.md`](artifact-store-deep-dive.md) | Artifact storage, projection, and context flow. | Artifact schemas, projection defaults, or context propagation changes. |
| [`docs/testing-guide.md`](testing-guide.md) | Repository testing and validation guidance. | Supported test commands, package setup, or verification practice changes. |
| `templates/skills/forge-workflow-engine/SKILL.md` | Bootstrapped engine usage and operational contract. | Engine CLI, configuration, generated artifacts, or run procedures change. |
| `templates/skills/forge-execution-adapter/SKILL.md` | Bootstrapped manifest compiler usage and contract. | Compilation inputs, options, output manifest, or validation behavior change. |

### Architecture decisions and research

| Document | Authority and purpose | Update when |
|---|---|---|
| [`docs/adr/`](adr/) | Immutable decision records explaining accepted architectural or behavioral decisions. | Add a new ADR for a significant new decision; do not rewrite history to describe a later change. |
| [`docs/research/`](research/) | Exploratory research, design investigations, and evidence. | Add or revise research when a design investigation materially informs implementation. Mark superseded research clearly. |
| [`docs/AI-RESEARCH-WORKFLOW.md`](AI-RESEARCH-WORKFLOW.md) | Research process and review workflow. | Research methodology or review gates change. |

An ADR should record context, the decision, consequences, alternatives, and
references to the implementation and user documentation. Historical ADRs may
describe retired behavior; active documentation must identify the current
behavior.

### Release and change history

| Document | Authority and purpose | Update when |
|---|---|---|
| [`docs/updates.md`](updates.md) | Versioned changelog and release notes. | Every user-visible change. Add a new version section at the top. |
| [`README.md` latest version](../README.md) | Current release indicator. | Whenever the top version in `docs/updates.md` changes. |
| [`docs/cr-001.md`](cr-001.md) | Code-review record or historical review material. | Only when the associated review record is intentionally extended. Do not use it as the active product specification. |

## Generated artifacts versus source documentation

These files are generated in target repositories by Forge skills and should not
be treated as hand-maintained source documentation in this repository:

- `docs/EXECUTION-MANIFEST.json`
- `docs/WORKFLOW-STATE.json`
- `docs/PROGRESS.md`
- `docs/EXECUTION-AUDIT.jsonl`
- `docs/task-executions/`

Update the templates, skills, compiler, or engine that produce them instead.
Only update generated examples or fixtures when a test explicitly requires
them.

## Reference-check checklist

For each changed command, option, or behavior, check:

- The implementation and its tests.
- The relevant `SKILL.md` or package README.
- The user-facing guide or top-level README.
- `docs/updates.md`.
- Related ADRs and deep dives.
- Internal links and referenced paths.
- Examples and environment-variable names.
- Generated-artifact descriptions and migration notes.

Do not update every document mechanically. Update the documents whose readers
would otherwise receive incorrect instructions, and preserve historical records
when they accurately describe past behavior.
