# Research: Efficiency Gains from the `.agents/` Migration and Best Practices Adoption

**Date:** 2026-06-17
**Status:** Implemented

---

## Question

What concrete efficiencies does the Agent Forge gain from migrating to `.agents/` and adopting the [agentskills.io best practices](https://agentskills.io/skill-creation/best-practices)?

---

## Summary of Changes

Two concurrent upgrades were applied:

| Upgrade | What changed |
|---|---|
| **`.agents/` migration** | Canonical paths moved from `.github/agents/` and `.github/skills/` to `.agents/agents/` and `.agents/skills/`. Bootstrap scripts gained `--harness` flag support for GitHub Copilot, Claude Code, and future harnesses. `_model-launch` wrappers removed. |
| **Best practices adoption** | All forge skills refactored with progressive disclosure (`references/` directories), `## Gotchas` sections, `## Validation` loops, trimmed generic content, and calibrated specificity. Generation engine (`forge-build-agent-team`) updated to produce skills that follow these patterns natively. New `forge-optimize-skills` skill added. |

---

## Efficiency 1: Portability - One Bootstrap, Any Harness

### Before
The forge was hard-coupled to GitHub Copilot. Templates referenced `.github/` throughout. Users targeting other harnesses had to manually rewrite paths. The `_model-launch` wrappers were Copilot CLI-specific workarounds that didn't apply elsewhere.

### After
Default bootstrap targets `.agents/` - a harness-agnostic directory. `--harness github` or `--harness claude` adapts paths during copy with a single flag. No manual rewriting, no harness-specific workarounds, no wrappers.

### Concrete gain
- **Zero manual path editing** for any supported harness
- **Future harnesses** added with one line in the bootstrap scripts (add a preset to the case statement)
- **`forge-assign-models` Apply mode simplified** - writes `model:` and `modelFallback:` fields only, no wrapper generation logic

---

## Efficiency 2: Context Economy - Tokens Used Where They Matter

### Before
Every forge skill loaded its full content into context on every activation. `forge-build-agent-team` was 597 lines. `forge-build-prd` included a 220-line template block in the main `SKILL.md`. Generated agent files included a 12-line "Process and Workflow" section - identical boilerplate across every agent - explaining steps the agent already knows (understand the task, implement, verify, commit, report).

### After
Progressive disclosure moves reference material to `references/` directories. The agent loads it only when triggered by a specific condition. Forge skills are 30–50% shorter in `SKILL.md` body content:

| Skill | Before (lines) | After (lines) | Reduction |
|---|---|---|---|
| `forge-build-prd` | 336 | 106 | 68% |
| `forge-decompose-prd` | 435 | 137 | 68% |
| `forge-build-feature-prd` | 342 | 140 | 59% |
| `forge-assign-models` | 375 (post-edits) | 218 | 42% |
| `forge-build-agent-framework-solution` | 433 | 170 | 61% |
| `forge-build-agent-team` | 597 | 127 + 2 references | 79% in main file |
| `forge-bootstrap-project` | 275 | 277 (minor adds) | - |

Generated agent "Process and Workflow" boilerplate is replaced with `## Workflow` and `## Validation` sections - project-specific, not generic.

### Concrete gain
- **Fewer wasted tokens per activation** - reference material loads only when needed
- **More room for conversation history and other active skills** in context windows
- **Generated agents carry project-specific instructions** instead of generic boilerplate that the model already follows

---

## Efficiency 3: Fewer Agent Mistakes - Gotchas Prevent Failures Before They Happen

### Before
No forge skill had a `## Gotchas` section. When an agent made a mistake (fabricating version numbers, colliding FT- prefixes, overwriting untouched agents in Feature Increment Mode), the user had to catch it and correct it. The correction lived only in the conversation - no persistent record.

### After
Every forge skill now has a `## Gotchas` section with environment-specific edge cases. Generated skills and agents include `## Gotchas` sections populated from the PRD. Examples from forge skills:

- **`forge-build-prd`**: "Never fabricate version numbers. Search for the latest stable release."
- **`forge-decompose-prd`**: "FT- prefix is reserved for post-project Feature PRDs. Never assign FT- as a feature ID prefix during initial decomposition."
- **`forge-build-agent-team`**: "Agent `name:` must match the filename exactly. Mismatch silently breaks agent detection."
- **`forge-assign-models`**: "`ollama show` may fail on some quantized models. Use `ollama run <model> 'list your tools'` as fallback."
- **`forge-optimize-skills`**: "Never modify forge meta-skills unless explicitly asked."

### Concrete gain
- **Errors prevented rather than corrected** - gotchas are read before the operation
- **Corrections persist** - adding a gotcha after an agent mistake ensures it never recurs
- **Self-documenting skills** - a new user can read the gotchas and immediately understand the non-obvious pitfalls

---

## Efficiency 4: Self-Verifying Outputs - Validation Loops

### Before
Skills told agents to do work but had no structured way to check it. The PRD skill said "present the draft and ask the user." The agent had no pre-flight checklist before showing work to the user - mistakes were caught by the human, not the agent.

### After
Every forge skill has a `## Validation` section with concrete checkboxes the agent runs before considering work complete. Generated skills include validation loops - "run validator → fix issues → re-validate → only proceed when validation passes."

Example from `forge-build-prd`:
```
- [ ] Every technology choice includes a verified current version (searched, not guessed)
- [ ] Every functional requirement has a priority (Must/Should/Could)
- [ ] Security & Privacy section addresses data handling even if no sensitive data is involved
- [ ] Implementation phases are ordered and each phase is independently shippable
- [ ] Open Questions are populated with every unresolved decision, each with a default assumption
```

### Concrete gain
- **Fewer review cycles** - the agent catches its own mistakes before showing the user
- **Consistent quality across runs** - the same checklist runs every time
- **Cheaper review** - the user inspects a pre-validated artifact, not a first draft

---

## Efficiency 5: Calibrated Specificity - Prescriptive Where It Matters

### Before
Skills used uniform prescriptiveness. Critical steps (exact migration commands, file write operations) and flexible steps (code review patterns, interview questions) were written with the same level of detail. Agents wasted time on flexible tasks from overly rigid instructions, or made mistakes on fragile tasks from overly vague instructions.

### After
Skills calibrate control per section:
- **Fragile operations** (file writes, model assignments, migration sequences) use exact commands, fixed sequences, and imperative language.
- **Flexible tasks** (clarifying questions, code review, team design) use guidelines with escape hatches and defaults rather than rigid checklists.
- **Defaults with alternatives**: "Use pdfplumber for text extraction. For scanned PDFs requiring OCR, use pdf2image with pytesseract instead" - not a menu of equal options.

### Concrete gain
- **Agents follow critical steps exactly** - no variation on fragile operations
- **Agents exercise judgment on flexible tasks** - avoiding wasted exploration when instructions are too rigid
- **Faster execution** - one clear path with an escape hatch, not analysis paralysis from equal options

---

## Efficiency 6: Auditability - Skills Can Be Measured and Improved

### Before
Skill quality was subjective. No structured way to compare skills, identify gaps, or track improvements over time. Users could only judge by whether the skill "seemed to work."

### After
`forge-optimize-skills` audits generated skills against a 6-axis rubric:

| Axis | What it measures |
|---|---|
| Context economy | Is the skill trimming what the agent already knows? |
| Gotchas coverage | Are environment-specific edge cases documented? |
| Procedural clarity | Does it teach *how* (procedure) rather than *what* (declaration)? |
| Progressive disclosure | Is large content split into `references/` with load triggers? |
| Calibration | Is specificity matched to fragility? |
| Validation | Are there concrete self-checks the agent can run? |

Each skill gets a scored audit report (`docs/SKILL-AUDIT.md`) with specific, actionable suggestions - not "improve this skill" but "add gotcha: 'The `users` table uses soft deletes - queries must include `WHERE deleted_at IS NULL`'."

### Concrete gain
- **Measurable quality** - skills have scores, not just feelings
- **Actionable improvements** - the audit tells you exactly what to add, trim, or restructure
- **Improvement tracking** - re-run the audit after changes to see scores improve

---

## Efficiency 7: Smaller Generated Files - Proportional to Need

### Before
The agent template in `forge-build-agent-team` was ~80 lines before any project-specific content. Every generated agent carried 12 lines of identical "Process and Workflow" boilerplate. A 4-agent team wasted ~48 lines of context on generic instructions.

### After
The agent template is leaner - `## Workflow` is project-specific, not generic. `## Validation` checks are concrete. `## Gotchas` are populated from the PRD's actual edge cases, not placeholders. Template boilerplate is ~40 lines, with project-specific sections replacing generic ones.

Generated skills now include progressive disclosure patterns from the start - `references/` for schemas, `assets/` for templates, `scripts/` for deterministic logic - rather than dumping everything into one `SKILL.md`.

### Concrete gain
- **More project-specific content per token** in generated agents and skills
- **Skills scale better** - a large project's skills use progressive disclosure instead of monolithic files
- **Consistent structure** - every generated skill and agent follows the same conventions (gotchas, validation, progressive disclosure)

---

## Summary of Gains

| Efficiency | Concrete Impact |
|---|---|
| Portability | Zero manual editing for any harness. One flag. |
| Context economy | 30–68% smaller `SKILL.md` files. Reference content loads on demand. |
| Fewer mistakes | Gotchas prevent common failures before they happen. Corrections persist. |
| Self-verification | Agents catch their own errors before showing work to the user. Fewer review cycles. |
| Calibrated control | Critical steps followed exactly. Flexible steps allow judgment. |
| Auditability | Skills scored and compared. Improvements are specific and actionable. |
| Lean generation | Generated files carry project-specific content, not generic boilerplate. |

---

## References

- [agentskills.io Best Practices](https://agentskills.io/skill-creation/best-practices)
- [agentskills.io Specification](https://agentskills.io/specification)
- ADR-006: Migrate from `.github/` to `.agents/` Directory
- ADR-007: Adopt agentskills.io Best Practices for Skill Design
