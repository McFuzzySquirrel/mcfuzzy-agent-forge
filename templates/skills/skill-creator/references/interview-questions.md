# Interview Questions

Use these questions during Step 1. Ask them in order. Every answer drives a specific scaffolding decision - record them all.

---

## Block A: Identity

**A1. What is the skill name?**
- Must be lowercase kebab-case (e.g., `deploy-service`, `generate-migration`)
- Must match the directory name exactly
- Drives: frontmatter `name`, install path, all internal references

**A2. What does this skill do in one sentence?**
- Must be specific enough to activate the skill without ambiguity
- Example: "Generates a database migration file from a schema diff and applies it safely."
- Drives: frontmatter `description`, opening paragraph

**A3. What phrase or request triggers this skill?**
- The exact or approximate words a user would say
- Example: "create a migration", "run the migration workflow"
- Drives: `description` keywords, opening paragraph framing

---

## Block B: Scope and Complexity

**B1. How many steps does the workflow have?**
- A "step" is a distinct phase with its own action and output
- ≤3 steps → flat template candidate; ≥4 steps → modular template candidate

**B2. Does the workflow branch or have conditional logic?**
- Examples: "if the user wants X, do Y; otherwise do Z"
- Any branching → modular template (branching logic belongs in references/)

**B3. Is there supporting material (schemas, templates, checklists, reference tables)?**
- Examples: SQL templates, API error tables, configuration schemas, decision matrices
- Any supporting material → modular template

---

## Block C: Gotchas and Edge Cases

**C1. What mistakes do agents (or humans) typically make when doing this task?**
- Be specific: wrong table name, missing flag, wrong order of operations
- Drives: `## Gotchas` section (minimum 2 entries required)

**C2. Are there environment-specific quirks to warn about?**
- Examples: "only works on Node 18+", "the `users` table uses soft deletes", "rate limit is 100 req/min"
- Drives: additional `## Gotchas` entries

**C3. What goes wrong silently (no error, wrong result)?**
- These are the highest-value gotchas - failures that look like success
- Drives: highest-priority `## Gotchas` entries

---

## Block D: Validation

**D1. How does the agent know it succeeded?**
- A specific observable outcome: a file exists, a command exits 0, a value appears in output
- Drives: `## Validation` section

**D2. Is there a script or command that verifies the output?**
- Example: `npm run lint`, `psql -c "SELECT 1"`, a checksum comparison
- Drives: concrete validation commands in `## Validation`

**D3. What is the most common failure mode and how is it detected?**
- Drives: validation checklist items, gotchas cross-reference

---

## Block E: Calibration

**E1. Which steps are fragile or destructive?**
- Examples: database writes, file deletions, API calls with side effects
- These steps need exact commands and explicit confirmation gates
- Drives: prescriptiveness level in process steps

**E2. Which steps are variable or creative?**
- Examples: generating prose, choosing a naming scheme, picking a color
- These steps need defaults + "if that doesn't work, try X" escape hatches
- Drives: flexibility markers in process steps

---

## Block F: Progressive Disclosure

**F1. Is there bulk content (>50 lines) that only applies in specific situations?**
- Examples: full error code tables, long configuration schemas, exhaustive checklists
- This content belongs in `references/` with a specific load trigger
- Drives: references/ file list and load triggers

**F2. What is the specific condition that triggers loading each reference file?**
- Must be a precise moment: "when the API returns a non-200", "if the user asks about rollback"
- Drives: load trigger wording in SKILL.md

---

## Decision Summary (fill in after the interview)

| Signal | Value | Decision |
|--------|-------|----------|
| Step count | ___ | flat / modular |
| Branching | yes / no | flat / modular |
| Reference material | yes / no | flat / modular |
| Fragile steps | ___ (list) | prescriptive |
| Variable steps | ___ (list) | flexible |
| Gotchas identified | ___ (count) | ≥2 required |
| Validation command | ___ | concrete / checklist |
