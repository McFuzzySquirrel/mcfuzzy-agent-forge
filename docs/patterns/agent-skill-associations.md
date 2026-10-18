# Portable Pattern: Agent-to-Skill Associations

This guide describes a portable pattern for systems that combine specialized agents with reusable procedural skills. It is independent of MyForge and can be adapted to OpenCode, Claude Code, GitHub Copilot, custom orchestrators, CI workers, or other multi-agent systems.

## The design problem

Global skill discovery is convenient when there are only a few skills. As a system grows, every agent must infer which procedures apply to its current task. That creates three problems:

1. Relevant procedures are easy to overlook.
2. Full skill catalogs waste context and tokens.
3. There is no durable answer to “which agents should use this skill?”

The pattern solves this with a lightweight association layer between agents and skills.

## Separate the responsibilities

```text
Agent = domain ownership, boundaries, collaboration, and output responsibility
Skill = reusable procedure, checks, references, and operational gotchas
Association = relevance metadata connecting an agent to a skill
Task = the concrete work request that activates the agent and possibly a skill
```

Do not turn an agent into a copy of every skill it might use. Do not turn a skill into a second agent persona. Keep ownership and procedure separate.

## Minimal metadata model

An agent can declare two association levels:

```yaml
---
name: frontend-engineer
description: "Builds frontend features and client-side components."
skillsRequired: [component-testing]
skillsRecommended: [design-system, accessibility-review]
---
```

A skill should expose a stable name and an activation-oriented description:

```yaml
---
name: component-testing
description: "Tests UI components using project accessibility and state-isolation conventions."
---
```

Use single-line arrays if metadata must work across multiple YAML readers or harnesses. If your platform supports nested YAML reliably, an equivalent shape is:

```yaml
skills:
  required: [component-testing]
  recommended: [design-system, accessibility-review]
```

Choose one canonical representation for a real implementation and validate it consistently. Do not silently support two conflicting sources of truth.

## Association semantics

### Recommended

`recommended` means:

- the procedure is likely to help with this agent's work;
- the orchestrator should surface it in task context;
- absence should produce a diagnostic, not a failure;
- the agent may still use other skills.

This should be the default association level.

### Required

`required` means:

- the task should use the procedure when its triggering condition applies;
- the orchestrator should surface it prominently;
- an unavailable package may be a configuration problem;
- blocking completion requires reliable evidence from the target harness.

Do not make required associations blocking until the system can verify usage consistently across all supported execution paths.

## Three runtime strategies

### 1. Harness-native discovery

The harness discovers all skills globally, while agent metadata provides relevance hints:

```text
agent file → harness agent selection
skill files → harness skill discovery
association → model-facing relevance guidance
```

This is the least invasive approach and works well when the harness already understands skill descriptions.

### 2. Orchestrator prompt context

The orchestrator resolves associations and injects only names and short descriptions:

```typescript
const agent = loadAgent(ownerAgent);
const skills = resolveSkills([
  ...agent.skillsRequired,
  ...agent.skillsRecommended,
]);

const prompt = [
  taskPrompt,
  renderRelevantSkills(skills),
].filter(Boolean).join("\n\n");
```

This makes behavior consistent across harnesses without copying complete skill documents into every prompt.

### 3. Explicit procedural loading

The agent receives a relevance hint and loads the skill only when needed:

```text
If this task changes database schemas, load the database-migration skill before
editing files and follow its validation procedure.
```

This is useful when skills contain substantial references or scripts and the harness supports explicit file or tool loading.

These strategies can be combined. A common default is native discovery plus a short orchestrator-provided context block.

## Validation rules

Validate the association graph before execution:

- Agent names are stable and unique.
- Skill names are stable and unique.
- Association names use the same canonical spelling as skill names.
- Required and recommended lists do not overlap.
- Candidate consumers resolve to existing agents.
- Missing local skills are distinguishable from globally reused skills.
- Legacy agents without associations remain valid.

Example diagnostic output:

```text
warning: frontend-engineer recommends accessibility-review, but no local
skill package was discovered; continue if the skill is globally installed.
```

## Keep prompts small

Do not inject every `SKILL.md` into every task. Prefer this order:

1. Inject the skill name.
2. Inject its one-line description.
3. Load the skill body only when the task matches its trigger.
4. Load references, scripts, and assets only when the procedure requires them.

This preserves progressive disclosure and prevents a large skill catalog from overwhelming the agent's actual task requirements.

## Security and trust boundaries

Treat skills as executable guidance, not automatically trusted policy:

- Review third-party skills before installing them.
- Do not let an unrelated skill expand the task's scope.
- Keep task requirements and acceptance criteria authoritative.
- Do not allow skill references to bypass repository or harness permissions.
- Record unavailable, malformed, or conflicting associations explicitly.
- If skills contain scripts, validate their execution boundaries separately.

An association should help an agent find a procedure; it should not grant permissions that the task or harness did not already grant.

## Migration strategy

The pattern can be introduced without rewriting existing agents:

1. Make association metadata optional.
2. Parse absent metadata as empty lists.
3. Add associations only when an agent is changed.
4. Validate new metadata and report stale references.
5. Add required-skill evidence only after the execution harness supports it.

This allows incremental adoption and avoids breaking teams generated by older versions of the system.

## When not to use this pattern

Do not add associations when:

- the system has only one or two universally applicable skills;
- the agent and skill are actually the same reusable persona;
- task ownership is not stable enough to support durable metadata;
- the harness has no way to discover or load procedures at runtime.

In those cases, a simple skill catalog or direct prompt instruction may be clearer.

## MyForge mapping

| Pattern concept | MyForge implementation |
|---|---|
| Agent | Generated Markdown under the active harness `agents/` directory |
| Skill | `SKILL.md` under the active harness `skills/` directory |
| Planned consumers | `docs/SKILL-CANDIDATES.json` |
| Agent associations | `skillsRequired` and `skillsRecommended` |
| Resolution | Forge execution-adapter discovery |
| Runtime context | Forge workflow-engine task instructions |

See the [MyForge-specific guide](../agent-skill-associations.md) for exact commands, validation behavior, and directory conventions.
