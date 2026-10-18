# Implementation Plan: Explicit Agent-to-Skill Associations

## Objective

Make the relationship between generated agents and project skills explicit and
inspectable while preserving cross-harness compatibility. Associations are
advisory by default; they are not a restrictive skill allowlist.

## Scope

1. Define `required` and `recommended` skill associations for generated agents.
2. Parse and validate associations while discovering agents and skills.
3. Carry concise relevant-skill context into autonomous task prompts.
4. Validate candidate consumers and preserve compatibility with legacy agents.
5. Document the model and add focused tests across team validation, discovery,
   request construction, and harness execution.

## Proposed contract

Generated agent frontmatter may contain single-line arrays (to remain
compatible with the repository's harness frontmatter validator):

```yaml
skillsRequired: [database-migration]
skillsRecommended: [testing-conventions]
```

The team handoff remains the source for intended consumers:

```json
{
  "name": "release-validation",
  "consumers": ["release-engineer"],
  "action": "create"
}
```

Candidate consumers become recommended associations initially. Required skills
need an explicit authoring decision and are not enforced in the first release.
Existing agents without metadata continue to work unchanged.

## Implementation phases

### 1. Contract and discovery

- Extend execution-adapter agent types with normalized skill references.
- Parse `skills.required` and `skills.recommended` from agent frontmatter.
- Resolve references against discovered local skills where possible.
- Preserve global/reused skills as warning-level or unavailable metadata rather
  than failing discovery.
- Add parser and legacy-compatibility tests.

### 2. Team generation and validation

- Update `forge-build-agent-team` instructions and references to emit relevant
  skill metadata from `docs/SKILL-CANDIDATES.json`.
- Validate candidate consumers and stale agent references.
- Preserve unaffected agents byte-for-byte during feature increments.
- Keep project skill package creation in `forge-build-project-skills`.

### 3. Autonomous execution

- Add concise required/recommended skill context to workflow task requests.
- Include names and descriptions/availability, not full `SKILL.md` bodies.
- Keep prompt behavior equivalent across OpenCode, Claude, Copilot, OpenAI,
  and stub adapters.
- Do not block execution for recommended or unavailable legacy associations.

### 4. Observability and documentation

- Expose associations and missing-skill diagnostics in the Console team view
  if the existing model makes this low-risk.
- Update affected skill documentation and workflow/compiler deep dives.
- Add an ADR if the association contract becomes an architectural boundary.
- Add changelog/release notes for the user-visible behavior.

## Acceptance criteria

- Generated agents clearly identify required and recommended project skills.
- Candidate consumers resolve to generated agents or produce actionable errors.
- Legacy agents without associations continue to execute normally.
- Autonomous execution receives relevant skill context without excessive token
  growth or full skill-body injection.
- Associations remain advisory by default and do not become an allowlist.
- Tests cover parsing, validation, prompt construction, harness dispatch, and
  compatibility.
- Documentation describes the source of truth, semantics, and migration path.

## Verification

Run focused tests and typechecks for:

- `templates/skills/forge-build-agent-team`
- `templates/skills/forge-execution-adapter`
- `templates/skills/forge-workflow-engine`
- `scripts/forge-launcher`

Then run the team/skill validators and confirm the pre-existing launcher
package changes remain untouched by this work.
