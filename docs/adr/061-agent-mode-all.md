# ADR-061: Generated agents declare `mode: all`

Status: Accepted

## Context

MyForge writes one agent file per specialist and expects the same file to serve
two roles. A specialist is dispatched by `project-orchestrator` or by the
workflow engine (which passes `opencode run --agent <name>`, see
[ADR-028](028-native-agent-selection-opencode-harness.md)), and a human also
wants to pick that specialist directly as the agent driving the session.

OpenCode is where those two roles are expressed in one field. `mode` accepts
`primary`, `subagent`, or `all`; `subagent` removes the agent from
primary-agent cycling and `@` discovery, leaving dispatch as the only way in.
The docs state that an omitted `mode` defaults to `all`, but relying on an
implicit default is not a contract the forge can hold: `forge-build-agent-team`
never constrained the field, so the writing model chose it. Emitting
`mode: subagent` for a specialist is the natural prior for a generated
"specialist agent", and that is what teams ended up with — agents that vanished
from the agent switcher and could only be reached programmatically.

Nothing else in the pipeline was affected, which is why this went unnoticed:
discovery (`forge-execution-adapter`), the Console team view, and
`forge-assign-models` all read specific frontmatter keys (`name`, `description`,
`model`, `modelFallback`) and ignore the rest.

## Decision

**Every agent MyForge generates declares `mode: all` explicitly, and no
generated agent is subagent-only.**

Enforcement is at the instruction layer, with an advisory signal:

- **`forge-build-agent-team` requires it.** Steps 2 and 3 state that each agent
  declares `mode: all` and that `mode: subagent` / `mode: primary` are never
  written; the Gotchas section explains why a specialist is not a subagent; the
  Validation checklist checks it.
- **Both alternate paths inherit the rule.** `feature-increment-mode.md` gives
  new agents `mode: all` and makes normalizing the `mode` key the one permitted
  frontmatter edit on an otherwise untouched agent, so a team generated before
  this decision converges on the next increment instead of being frozen at its
  old value. `vision-features-mode.md` defers to the parent step.
- **The shipped personas comply.** `forge-team-builder`,
  `project-orchestrator`, and `workflow-orchestrator` all declare `mode: all`,
  as do the launcher's offline stub agent and the Console screenshot fixture.
- **`validate-frontmatter.mjs` warns, it does not block.** Agent files that omit
  `mode` or declare anything other than `all` are reported with a `⚠` line and
  a summary count; the exit code is unchanged, so an existing repository keeps
  building.

## Rationale for warning rather than gating

`mode` is an OpenCode-specific key. GitHub Copilot and Claude Code agent
frontmatter does not define it, so a hard gate would either impose an OpenCode
concept on every harness or make the contract depend on which root the repository
uses. The forge already takes this position for `modelFallback` (see
[ADR-003](003-per-agent-model-assignment.md) and
[ADR-006](006-agents-directory-migration.md)): write the portable, useful field
and let harnesses that do not understand it ignore it. Making that a blocking
rule — on any root — would fail every already-bootstrapped repository the first
time it re-ran the team stage, for a purely cosmetic difference.

The advisory warning keeps the drift visible at the one moment it is cheap to
fix (the team stage that just wrote the files) without turning a legacy team into
a build failure.

## Consequences

- Generated agents are selectable as the session agent *and* dispatchable as
  specialists, so one file per specialist is genuinely enough.
- The rule is stated rather than proven. A model can still ignore it; the
  warning is the detection mechanism, and the increment path is the repair.
- Repositories generated before this decision keep working unchanged and pick up
  `mode: all` on their next team or feature-increment run.
- `forge-assign-models` Apply mode is unaffected: it rewrites only `model:` and
  `modelFallback:` and preserves other keys, so `mode` survives model
  assignment.

## Relationships

- Extends [ADR-028](028-native-agent-selection-opencode-harness.md): native
  `--agent` selection only works well if the target agent is selectable at all.
- Consistent with [ADR-003](003-per-agent-model-assignment.md) and
  [ADR-006](006-agents-directory-migration.md) on writing portable frontmatter
  fields that non-honoring harnesses ignore.
- Extends the `validate-frontmatter.mjs` gate that
  [ADR-041](041-authoring-quality-and-console-correctness.md) added to the team
  stage, which already blocks on frontmatter that some harness parsers cannot
  read.
