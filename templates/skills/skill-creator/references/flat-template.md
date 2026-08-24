# Flat Skill Template

Use this template for simple skills: ≤3 steps, no branching, no supporting reference material.

Replace every `{placeholder}` with content from the interview answers before saving.

---

```markdown
---
name: {skill-name}
description: {One-sentence description. Include trigger keywords. Be specific about what the skill does and when to use it.}
---

# Skill: {Title Case Name}

{Opening paragraph: state exactly what this skill does and when to invoke it. 1–3 sentences.
No generic preamble. No "this skill helps you..." fluff.}

---

## Process

### Step 1: {Step Name}

{How to approach this step - not just what to produce. Include decision criteria if any.}

**Inputs needed:**
- {input 1}
- {input 2}

**Output:**
- {concrete deliverable}

### Step 2: {Step Name}

{How to approach this step.}

**Inputs needed:**
- {input}

**Output:**
- {concrete deliverable}

### Step 3: {Step Name} (if applicable)

{How to approach this step.}

**Output:**
- {concrete deliverable}

---

## Gotchas

- **{Specific edge case 1}.** {Concrete explanation of what goes wrong and how to avoid it.}
- **{Specific edge case 2}.** {Concrete explanation.}
- **{Specific edge case 3 - optional but recommended}.** {Concrete explanation.}

---

## Validation

After completing the process, verify:

- [ ] {Concrete observable outcome 1 - something the agent can check}
- [ ] {Concrete observable outcome 2}
- [ ] {Run command or inspect output: e.g., `npm test`, `cat output.json | jq '.status'`}

If any item fails: {specific recovery action}.
```

---

## Notes for Using This Template

- **Context economy:** Remove any placeholder sections that genuinely do not apply. An empty `## Gotchas` with no real content scores worse than omitting the section.
- **Procedural clarity:** Each step must describe *how to approach* the work, not just *what to produce*. "Generate the migration file" is a declaration. "Run `npm run db:diff`, inspect the output for unintended drops, then save to `migrations/`" is procedural.
- **Calibration:** For destructive steps, include the exact command. For creative steps, give a default approach and an escape hatch.
- **Validation:** At least one item in the checklist must be a command or observable artifact - not just "make sure it works."
