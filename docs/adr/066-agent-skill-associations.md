# ADR-066: Explicit Agent-to-Skill Associations

## Status

Accepted

## Context

Generated agents and project skills are discovered independently. The team
handoff records candidate consumers, but that relationship was not present in
agent metadata or autonomous task prompts. Agents therefore had to infer which
project procedures were relevant from global skill discovery.

## Decision

Generated agents may declare relevant project skills using the single-line
frontmatter arrays `skillsRequired` and `skillsRecommended`. Candidate
consumers become recommended associations by default; required associations
need an explicit authoring decision.

The execution adapter resolves declared names against discovered local skills
when possible and records availability metadata. The workflow engine includes
only concise names and descriptions in task instructions. It does not inject
complete skill bodies and does not treat associations as an allowlist.

Agents without association metadata remain valid and continue to execute as
before. Missing recommended or globally reused skills are diagnostic metadata,
not execution-blocking failures.

## Consequences

- The intended agent-to-skill relationship is visible and testable.
- Autonomous tasks receive more focused procedural guidance without loading all
  skill content into every prompt.
- The design remains portable across OpenCode, Claude, Copilot, OpenAI, and
  stub harnesses.
- Existing repositories require no migration because association metadata is
  optional.
- Required-skill enforcement is intentionally deferred until cross-harness
  reporting can prove that a skill was actually used.

## Alternatives considered

1. **Global discovery only:** rejected because it leaves ownership ambiguous as
   project skill counts grow.
2. **Strict per-agent allowlist:** rejected because cross-cutting skills and
   legitimate task-specific procedures should remain usable.
3. **Inject every `SKILL.md`:** rejected because it increases prompt size and
   defeats progressive disclosure.
