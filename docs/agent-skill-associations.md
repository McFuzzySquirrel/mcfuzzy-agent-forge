# Agent-to-Skill Associations

This guide explains how MyForge tells generated agents which project skills are relevant to their work.

## The short version

An **agent** owns a domain of work. A **skill** is a reusable procedure. An agent-to-skill association tells the agent which procedures are especially relevant; it does not prevent the agent from using other applicable skills.

Generated agent frontmatter may contain optional, single-line arrays:

```yaml
skillsRequired: [component-testing]
skillsRecommended: [design-system, accessibility-review]
```

Single-line arrays are intentional: MyForge supports several agent harnesses, and its frontmatter validator avoids multiline YAML values for portability.

## How the relationship is created

The relationship begins during team generation. The `forge-build-agent-team` stage analyzes the PRD and writes a durable handoff at `docs/SKILL-CANDIDATES.json`.

Each candidate can list its intended agent consumers:

```json
{
  "version": 1,
  "candidates": [
    {
      "name": "component-testing",
      "description": "Tests UI components using project conventions.",
      "consumers": ["frontend-engineer", "qa-engineer"],
      "action": "create",
      "reason": "The same testing process repeats across UI features."
    }
  ]
}
```

The independent `forge-build-project-skills` stage then creates, extends, or reuses the skill package. The team stage owns the consumer relationship; the skills stage owns the package itself.

Candidate consumers become recommended associations by default. A skill should be marked required only when the work cannot be completed safely without the procedure.

## How runtime discovery works

At execution time, the execution adapter:

1. Discovers agent files under the active harness directory.
2. Parses `skillsRequired` and `skillsRecommended`.
3. Discovers `SKILL.md` packages under the corresponding skills directory.
4. Resolves each association against the discovered skill names.
5. Records the skill description and whether the package is locally available.

Supported layouts are:

| Harness | Agents | Skills |
|---|---|---|
| GitHub Copilot | `.github/agents/` | `.github/skills/` |
| Claude Code | `.claude/agents/` | `.claude/skills/` |
| OpenCode | `.opencode/agents/` | `.opencode/skills/` |
| Generic | `.agents/agents/` | `.agents/skills/` |

An unavailable association is diagnostic metadata. This is important for `reuse` candidates, which may refer to a globally installed skill that is not present in the repository's local skills directory.

## How autonomous tasks receive the guidance

When the workflow engine prepares a task, it adds a concise block similar to:

```text
Relevant project skills (advisory; use required skills when applicable):
Required:
- component-testing — Tests UI components using project conventions.
Recommended:
- design-system — Applies the shared visual system.
- accessibility-review (unavailable)
```

The engine passes names and descriptions, not the complete contents of every `SKILL.md`. The agent or harness can load a skill when its normal activation rules indicate that it applies. This keeps prompts small and preserves progressive disclosure.

Native agent selection and inline-persona fallback receive the same guidance, so the behavior does not depend on one specific harness.

## The curated toolbox model

The current design is best understood as a **curated toolbox**, not a strict
capability registry:

```text
Agent
 ├── required procedures
 ├── recommended procedures
 └── broader skill catalog available when needed
```

Associations give an agent a useful starting toolbox for its domain while
preserving access to legitimate cross-cutting procedures. They improve
discoverability and reduce prompt context without turning every association
into a permission boundary.

This is valid for MyForge because project skills are currently procedural
guidance. The harness still controls actual tool and file permissions, and task
requirements remain authoritative. A skill association does not grant access,
expand task scope, or prove that a procedure was followed.

### Curated toolbox versus strict capability registry

| Model | Meaning | Best fit |
|---|---|---|
| Curated toolbox | Relevant skills are surfaced, but other applicable skills remain available. | General software work, cross-cutting skills, mixed harnesses, incremental adoption |
| Strict capability registry | An agent may use only explicitly granted capabilities, with enforcement at runtime. | Production operations, sensitive tools, regulated workflows, strong isolation |

A strict registry provides stronger isolation and auditability, but requires
more configuration and reliable enforcement from every execution harness. It
can also block legitimate work when a shared procedure was not declared in
advance. MyForge intentionally uses the curated toolbox model until skill usage
can be verified consistently across all supported harnesses.

## Required versus recommended

### Recommended skills

Use `skillsRecommended` when a procedure is useful but the agent can still complete the task without it. Recommended associations:

- help the agent find relevant procedures;
- appear in autonomous task context;
- do not block execution when unavailable;
- do not form an allowlist.

### Required skills

Use `skillsRequired` sparingly, for example when a migration procedure contains mandatory safety checks. In the current implementation, required means “the agent should use this when applicable”; it is not yet a cross-harness proof that the skill was loaded or followed.

Required-skill enforcement should only become blocking after every supported harness can report reliable skill usage. Until then, the association is strong guidance rather than a completion gate.

## Authoring checklist

- Use stable, lowercase kebab-case skill names.
- Add the candidate consumer to `docs/SKILL-CANDIDATES.json`.
- Add the association to every affected generated agent.
- Do not list the same skill in both arrays.
- Prefer `skillsRecommended` unless omission would create a safety or quality risk.
- Keep skill descriptions specific enough to activate the procedure.
- Do not create a skill package during the team-generation stage.
- Preserve unaffected agents during feature-increment work.

## Troubleshooting

### The skill is shown as unavailable

Confirm that its frontmatter `name` exactly matches the association and that the package is under the active harness's `skills` directory. For a `reuse` candidate, verify that the skill is installed in the harness or model environment.

### The candidate consumer fails validation

The `consumers` entry must exactly match a generated agent name. Check the agent's `name` frontmatter and filename, then rerun team validation.

### A legacy agent has no skill context

That is valid. Add `skillsRecommended` or `skillsRequired` when the agent is next affected; no migration is required for existing agents.

### The agent uses another skill anyway

That is expected. Associations identify relevant procedures; they are not a restriction on legitimate skill use.

## Related documents

- [Portable agent-to-skill association pattern](patterns/agent-skill-associations.md)
- [ADR-066: Explicit Agent-to-Skill Associations](adr/066-agent-skill-associations.md)
- [Skill candidate handoff](../templates/skills/forge-build-agent-team/references/skill-candidates.md)
- [Workflow engine guide](workflow-engine.md)
