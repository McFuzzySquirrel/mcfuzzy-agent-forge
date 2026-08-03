# Quality Axes for Skill Creation

These are the six axes from the skill-review rubric, reframed as **creation guidance** rather than audit criteria. Use them throughout Steps 1–4 to build each section of the new skill intentionally.

Scoring reference: 1 = missing, 2 = partial, 3 = strong.

---

## 1. Context Economy

**Creation goal:** Every sentence must earn its place. Remove anything the agent already knows or that adds no decision-relevant information.

**How to apply during scaffolding:**
- Do not explain what the technology is. The agent knows what a database migration is - explain what *this project's* migration workflow is.
- Cut the opening paragraph to 1–3 sentences. No "This skill will help you..." or "In this guide we will..."
- If a section could appear in any skill for any tool, it is generic and should either be cut or made project-specific.

**Score 3:** Specific, project-focused instructions. No "what is X" explanations.
**Score 1:** Long generic passages, explanations of fundamentals the agent knows.

---

## 2. Gotchas Coverage

**Creation goal:** Document the specific mistakes that agents (or humans) make without being explicitly told - not generic advice.

**How to apply during scaffolding:**
- Every `## Gotchas` entry must name a specific failure, not generic advice.
- Minimum 2 entries. Aim for 3–5 for complex workflows.
- Prioritize silent failures - mistakes that produce no error but a wrong result.
- Source gotchas from interview answers to Block C.

**Score 3:** Concrete gotchas that correct real mistakes. "The `orders` table uses soft deletes - always include `WHERE deleted_at IS NULL`."
**Score 1:** No gotchas section, or entries like "handle errors appropriately" or "make sure to test."

---

## 3. Procedural Clarity

**Creation goal:** Teach *how to approach* each step (procedure), not just *what to produce* (declaration).

**How to apply during scaffolding:**
- For each process step, ask: "Does this tell the agent *how to do the work*, or just *what the output should be*?"
- Declarations: "Generate the migration file." → Procedural: "Run `npm run db:diff`, review the output for unintended DROP statements, then save to `migrations/YYYYMMDD_description.sql`."
- Include decision criteria at branching points: "If the diff contains a DROP, pause and confirm with the user before proceeding."

**Score 3:** Step-by-step process with decision criteria.
**Score 1:** Steps that only declare what output should look like without teaching the process.

---

## 4. Progressive Disclosure

**Creation goal:** Keep `SKILL.md` lean. Move bulk content to `references/` with specific load triggers. Load only what is needed, when it is needed.

**How to apply during scaffolding:**
- If a section is >50 lines and only needed in specific situations → move to `references/`.
- If `SKILL.md` will exceed 500 lines → move bulk tables, checklists, or schemas to `references/`.
- Every load trigger must state *when* to load: "Load `references/rollback-procedure.md` if the migration fails mid-run."
- Never use vague triggers like "see references/ for more details."

**Score 3:** `references/` used with specific load triggers. SKILL.md under 500 lines.
**Score 1:** Everything in one SKILL.md. No subdirectories. Or references exist but have vague load triggers.

---

## 5. Calibration

**Creation goal:** Match prescriptiveness to the fragility of the operation. Fragile/destructive steps get exact commands. Variable/creative steps get defaults and escape hatches.

**How to apply during scaffolding:**
- Identify fragile steps from interview Block E1. For those, include exact command syntax, flag names, and expected output.
- Identify variable steps from interview Block E2. For those, give a recommended default and at least one alternative: "If the default port 3000 is in use, try 3001 or set `PORT` explicitly."
- Do not make every step equally prescriptive. Uniform prescriptiveness (everything rigidly exact, or everything vaguely flexible) scores a 2 at best.

**Score 3:** Clear defaults with escape hatches. Exact commands for destructive operations.
**Score 1:** Uniform prescriptiveness - either everything is rigid with no flexibility, or important steps are left too vague.

---

## 6. Validation

**Creation goal:** Provide concrete, runnable checks the agent can use to verify success - not generic "make sure it works" instructions.

**How to apply during scaffolding:**
- The `## Validation` section must include at least one command or observable artifact, not just a checklist of vague items.
- Source validation checks from interview Block D.
- For complex skills: include a specific failure-recovery path ("if `npm test` fails with `ECONNREFUSED`, the database is not running - start it with `docker compose up db -d`").
- For modular skills: consider a `references/validation-detail.md` for deep diagnosis steps triggered only on failure.

**Score 3:** Checklist with concrete commands or observable artifacts. Specific failure-recovery paths.
**Score 1:** No validation section, or only generic items like "make sure it works" or "test thoroughly."
