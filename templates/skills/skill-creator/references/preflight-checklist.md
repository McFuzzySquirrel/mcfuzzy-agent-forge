# Pre-flight Checklist

> Load during Step 4, before running the formal `skill-review` audit.

Work through every item. For each failure: state what is wrong, fix it immediately, mark it resolved. Do not proceed to Step 5 until all **[BLOCKER]** items are cleared.

---

## Section 1: File Structure

- [ ] `SKILL.md` exists in the skill directory **[BLOCKER]**
- [ ] YAML frontmatter is present and valid (no parse errors) **[BLOCKER]**
- [ ] `name` in frontmatter exactly matches the parent directory name **[BLOCKER]**
- [ ] `description` is present and at least one sentence long **[BLOCKER]**
- [ ] If modular: `references/` directory exists with at least one `.md` file
- [ ] No circular references (a reference file does not load another reference file)
- [ ] All file paths referenced in load triggers exist on disk

---

## Section 2: Identity and Activation

- [ ] `name` is lowercase kebab-case
- [ ] `description` contains the trigger keywords from the interview (Block A3)
- [ ] The opening paragraph states *what the skill does* and *when to use it* in ≤3 sentences
- [ ] The skill can be distinguished from other skills in the repo by its description alone

---

## Section 3: Context Economy

- [ ] No sections explain what a technology or concept *is* (the agent already knows)
- [ ] No "this skill will help you..." or "in this guide we will..." preamble
- [ ] Every sentence in `SKILL.md` is specific to this skill's workflow - not generic
- [ ] `SKILL.md` is under 500 lines

---

## Section 4: Gotchas Coverage

- [ ] A `## Gotchas` section exists **[BLOCKER if skill has any fragile steps]**
- [ ] At least 2 gotcha entries are present
- [ ] Every entry names a *specific* failure, not generic advice
- [ ] At least one entry covers a silent failure (wrong result, no error)

---

## Section 5: Procedural Clarity

- [ ] Every process step describes *how to approach* the work (not just *what to produce*)
- [ ] Steps with branching logic include explicit decision criteria
- [ ] Steps with fragile operations include exact commands (not just descriptions)
- [ ] The sequence of steps is complete - no gaps where the agent would have to guess

---

## Section 6: Progressive Disclosure

- [ ] No section in SKILL.md is >50 lines of dense table or reference content that is only situationally needed
- [ ] If modular: all load triggers state *when* to load (not just *what* exists)
- [ ] If modular: load triggers use this pattern - "Load `references/{file}.md` when {specific condition}"
- [ ] If modular: no vague triggers like "see references/ for more details"

---

## Section 7: Calibration

- [ ] Fragile/destructive steps include exact commands with flag names
- [ ] Variable/creative steps include a default approach and at least one alternative
- [ ] Prescriptiveness is not uniform - different steps have different levels based on fragility

---

## Section 8: Validation

- [ ] A `## Validation` section exists **[BLOCKER]**
- [ ] At least one validation item is a concrete command or observable artifact
- [ ] At least one validation item is a checkable file or output (not just "make sure it works")
- [ ] If the skill has failure modes: at least one recovery path is documented

---

## Pre-flight Summary

After working through all sections, summarize:

```
[BLOCKERS resolved]: {count}
[Warnings remaining]: {count}
[Ready for skill-review]: yes / no
```

If "no": state which items remain open and why. Do not proceed to Step 5 until all blockers are cleared.
