# Modular Skill Template

Use this template for complex skills: ≥4 steps, OR branching logic, OR supporting reference material.

The modular structure keeps `SKILL.md` lean (under 500 lines) by moving bulk content to `references/` with specific load triggers.

Replace every `{placeholder}` with content from the interview answers. Create the referenced files in `references/` as part of the scaffold.

---

## `SKILL.md`

```markdown
---
name: {skill-name}
description: >
  {One-sentence description. Include trigger keywords. Be specific about what the skill does
  and when to use it.}
---

# Skill: {Title Case Name}

{Opening paragraph: state exactly what this skill does and when to invoke it. 1–3 sentences.
No generic preamble.}

Load `references/{primary-reference}.md` now. {Explain what it contains and why it's needed up front.}

---

## Process

### Step 1: {Step Name}

{How to approach this step. Decision criteria if any.}

{If this step has complex supporting content:}
Load `references/{step1-detail}.md` when {specific condition that makes the detail relevant}.

**Inputs needed:**
- {input 1}
- {input 2}

**Output:**
- {concrete deliverable}

### Step 2: {Step Name}

{How to approach this step.}

{Branching example:}
- If {condition A}: {do X}
- If {condition B}: {do Y} - load `references/{branch-b-detail}.md` for the full procedure

**Output:**
- {concrete deliverable}

### Step 3: {Step Name}

{How to approach this step.}

**Output:**
- {concrete deliverable}

### Step 4: {Step Name}

{How to approach this step.}

Load `references/{step4-detail}.md` if {specific triggering condition}.

**Output:**
- {concrete deliverable}

### Step 5: {Step Name} (if applicable)

{How to approach this step.}

**Output:**
- {concrete deliverable}

---

## Gotchas

- **{Specific edge case 1}.** {Concrete explanation.}
- **{Specific edge case 2}.** {Concrete explanation.}
- **{Specific edge case 3}.** {Concrete explanation.}

---

## Validation

After completing the process, verify:

- [ ] {Concrete observable outcome 1}
- [ ] {Concrete observable outcome 2}
- [ ] {Run command: e.g., `npm test`, `curl -s localhost:3000/health | jq '.status'`}

If any item fails: {specific recovery action}.

Load `references/{validation-detail}.md` if the standard checks fail and you need deeper diagnosis.
```

---

## `references/` Files to Create

For each load trigger in `SKILL.md`, create the corresponding file. Use this pattern:

```markdown
# {File Title}

> Load when: {exact condition from the load trigger in SKILL.md}

{Content - this is where the bulk material goes: tables, long checklists, schemas, templates,
error code listings, etc.}
```

**Common reference file types:**

| File name pattern | When to create |
|-------------------|----------------|
| `step-N-detail.md` | A step has >30 lines of supporting content |
| `branch-{name}.md` | A branch in the workflow has its own multi-step sub-procedure |
| `schema.md` | The skill generates or validates structured data |
| `error-codes.md` | The skill handles API/tool errors with specific codes |
| `checklist.md` | A validation or pre-flight checklist with >10 items |
| `examples.md` | Example inputs/outputs that would bulk up SKILL.md |

---

## Notes for Using This Template

- **Load triggers must be specific.** "Load `references/api-errors.md` if the API returns a non-200 status code" is correct. "See `references/` for details" scores a 1 on progressive disclosure.
- **Don't over-reference.** If a section is under 30 lines and always needed, keep it inline. References are for content that is situationally needed or would bulk up SKILL.md past 500 lines.
- **Max one level of reference chain.** A reference file should not load another reference file. All chaining must be explicit from `SKILL.md`.
- **Keep the first ~100 lines of SKILL.md inline.** That content defines the skill's trigger and purpose - the agent must read it before deciding whether to load references.
