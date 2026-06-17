# Feature Increment Mode

Complete process for extending an existing agent team with minimal, targeted changes when a Feature PRD is added.

## Load Trigger

Load this file when: the source document is a Feature PRD (has "Feature Overview", "Context: Existing System State", "Agent Impact Assessment") and existing agent files already exist in `.agents/agents/`.

## Feature Increment Mode — Incremental Steps

When Step 0 detects a Feature PRD, use the following incremental process instead of Steps 1–8. The goal is to extend the existing agent team with minimal, targeted changes rather than regenerating the entire team.

### Step 1i: Analyze the Feature PRD and Existing Team

1. **Read the Feature PRD**, focusing on:
   - Section 5 (Technical Approach) — What changes and what's new
   - Section 6 (Functional Requirements) — What needs to be built
   - Section 8 (Agent Impact Assessment) — The Feature PRD's own analysis of agent impact
   - Section 9 (Implementation Phases) — F-prefixed phases for the feature

2. **Read ALL existing agent files** in `.agents/agents/`:
   - List each agent's name, role, and owned responsibilities
   - Note each agent's collaboration dependencies
   - Identify the boundaries between agents

3. **Read the original PRD** to understand:
   - The full project context and architecture
   - Established conventions and constraints
   - What was already built in completed phases

4. **Build a map** of existing agent domains and their boundaries.

### Step 2i: Evaluate Agent Impact Assessment

Review the Feature PRD's Section 8 (Agent Impact Assessment) as a starting point, then validate:

- For each "extended responsibility" — Does it actually fit within the agent's existing expertise? Would adding this responsibility keep the agent focused, or would it overload them?
- For each "new agent required" — Is a new agent truly needed, or can an existing agent cover this work? Is the justification sound?
- For each "no changes" agent — Confirm it genuinely isn't affected by the feature.

Produce a **revised assessment** if the Feature PRD's analysis needs correction.

### Step 3i: Plan Team Modifications

For each change category:

**A. Existing agents with extended responsibilities:**
- Draft updated **Responsibilities** sections (additive — append new items, don't rewrite existing ones)
- Draft updated **Collaboration** sections if new dependencies exist between agents
- Update **Key Reference** to include the Feature PRD path and relevant feature sections
- DO NOT modify Expertise, Constraints, or Output Standards unless the feature introduces fundamentally new technology or patterns that require it

**B. New agents required:**
- Follow the existing Steps 2–5 process for designing and writing new agent files
- Ensure new agents have Collaboration links to existing agents they depend on
- Ensure no boundary overlaps with existing agents
- New agents should reference both the original PRD (for project context) and the Feature PRD (for their specific requirements)

**C. Existing agents with no changes:**
- Leave completely untouched — do not regenerate or modify their files

### Step 4i: Identify New or Extended Skills

- Are there new repeatable patterns introduced by this feature?
- Can existing skills be reused for the feature's tasks?
- Only create new skills if the pattern will be invoked multiple times within or beyond this feature

### Step 5i: Write Only Changed or New Files

- **For modified agents:** Present the specific additions (what's being added to Responsibilities, Collaboration, and Key Reference sections) as a clear diff or addendum. If the agent was created before the Process and Workflow section was added to the template, add this section as well to bring it up to current standards. Present changes for user review and confirmation before applying them to the existing agent files.
- **For new agents:** Write complete agent files at `.agents/agents/{agent-name}.md` following the standard template from Step 5.
- **For new skills:** Write complete skill files at `.agents/skills/{skill-name}/SKILL.md` following the standard template from Step 6.
- **CRITICAL:** Do NOT regenerate or overwrite agents that aren't affected by the feature.

### Step 6i: Validate Incrementally

Before finalizing, verify:

- [ ] Every Feature PRD functional requirement (FT-FR-*) maps to exactly one agent (new or existing).
- [ ] No new boundary overlaps have been introduced between agents.
- [ ] Collaboration sections are updated for all affected agents (both directions).
- [ ] Existing unaffected agents remain completely unchanged.
- [ ] New agents follow all naming and format conventions (lowercase-hyphenated, valid YAML frontmatter).
- [ ] New agents include the currency verification constraint.
- [ ] Feature PRD section references use the correct path and section numbers.

### Step 7i: Present the Changes

Summarize the team modifications in tables:

```markdown
## Modified Agents

| Agent | Changes | Feature PRD Sections |
|-------|---------|---------------------|
| `existing-agent` | Added responsibilities for X, updated collaboration | FT-FR-01, FT-FR-03 |

## New Agents

| Agent | Role | Feature PRD Sections | Phase |
|-------|------|---------------------|-------|
| `new-agent` | Description of role | FT-FR-02, FT-FR-04 | F1 |

## Unchanged Agents

| Agent | Reason |
|-------|--------|
| `unaffected-agent` | Not involved in this feature |

## New Skills

| Skill | Purpose | Used By |
|-------|---------|---------|
| `new-skill` | What it does | Which agents |

## Reused Existing Skills

| Skill | Used For in This Feature |
|-------|--------------------------|
| `existing-skill` | How it applies to the feature work |
```
