---
name: skill-review-updater
description: "Check for updates in agentskills.io for skill-review by comparing latest best practices against the skill-review rubric, then produce a prioritized plan for new checks that keep skill-review relevant and accurate."
---

# Skill: Skill Review Updater

Use this skill when asked to check for updates in agentskills.io for skill-review and produce a concrete update plan. It gathers evidence from current best-practice guidance, compares it to the current skill-review rubric, and outputs prioritized, confidence-scored additions without editing skill-review directly unless explicitly requested.

Load [quality baseline](references/quality-baseline.md) now. It defines the evidence standard, confidence thresholds, and output contract used across all steps.

---

## Process

### Step 1: Capture the current skill-review baseline

Start from local ground truth before collecting external guidance. Read the current `skill-review` skill files and extract the checks that are already enforced today. Use an explicit baseline scan command such as `rg -n "Context Economy|Gotchas Coverage|Procedural Clarity|Progressive Disclosure|Calibration|Validation" .agents/skills/skill-review` and then normalize the findings into rule labels with one primary axis each.

**Inputs needed:**
- Path to the current `skill-review` skill (`.agents/skills/skill-review/`)
- Current rubric/check logic from that skill

**Output:**
- A baseline list of existing checks mapped to rubric axes

### Step 2: Collect latest best practices from agentskills.io

Fetch the most recent, relevant agentskills.io guidance that affects skill quality evaluation, especially guidance tied to context economy, gotchas coverage, procedural clarity, progressive disclosure, calibration, and validation. Use explicit retrieval calls like `web_fetch("https://agentskills.io")` (and additional best-practice pages discovered from there), then capture citation URLs and short evidence quotes for every candidate insight.

Load [offline fallback](references/offline-fallback.md) when agentskills.io is unreachable, blocked, or structurally changed enough that direct extraction is unreliable.

**Output:**
- Evidence set of candidate best-practice updates with citations

### Step 3: Compute rubric deltas

Compare the Step 2 evidence against the Step 1 baseline and identify gaps: missing checks, weak checks, or outdated checks. Keep only actionable deltas that can be expressed as clear pass/fail review criteria.

Load [rubric mapping](references/rubric-mapping.md) when you need the normalization rules and the delta-mapping table format.

**Output:**
- Normalized delta table (evidence item → current coverage → gap type → proposed check)

### Step 4: Branch by confidence and impact

Classify each proposed check using evidence confidence and expected review impact.

- If confidence is **high** and implementation is straightforward: include as a recommended new check.
- If confidence is **medium**: include as a candidate with explicit assumptions and required follow-up validation.
- If confidence is **low** or evidence conflicts: do not recommend adoption yet; add to a watchlist with a re-check trigger.

**Output:**
- Prioritized proposals split into recommended checks, conditional candidates, and watchlist items

### Step 5: Produce the update plan

Convert prioritized proposals into a concrete implementation plan for maintaining skill-review relevance. For each recommended check, include rationale, exact rubric location to update, acceptance criteria, and an estimate of review noise risk.

For variable choices (ranking and rollout), use this default: sort by impact first, then confidence. If two items tie, prefer the one with lower reviewer ambiguity.

**Output:**
- A plan with phased changes, acceptance criteria, and sequencing

### Step 6: Validate completeness and handoff

Validate that the plan is traceable end-to-end: every proposed check maps to evidence and a rubric location, and every deferred item has a stated reason. Then deliver the plan in a format the maintainer can execute without re-analysis.

Load [validation checks](references/validation-checks.md) when any completeness check fails or confidence rationale is missing.

**Output:**
- Final handoff plan with evidence links, rubric mappings, and decision rationale

---

## Gotchas

- **Stale guidance masquerading as latest guidance.** If you do not capture publication/update recency, you may introduce outdated checks; always record a recency signal (updated date, change note, or explicit "current" indicator) with each source.
- **Coverage inflation from duplicate guidance.** Multiple pages often restate the same principle; deduplicate by normalized rule intent before counting new checks, or you will over-prioritize one theme.
- **Silent rubric mismatch.** A proposal can look valid but target a rubric axis that already has equivalent coverage under different wording; require a baseline-to-proposal mapping row before labeling anything as "new."
- **Evidence-free recommendations.** Plan items without citation-backed rationale create reviewer churn and drift; every recommended check must include at least one direct source reference and one explicit acceptance criterion.

---

## Validation

After completing the process, verify:

- [ ] The output includes three sections: recommended checks, conditional candidates, and watchlist.
- [ ] Every proposed check has: source citation, mapped rubric axis, gap statement, and acceptance criteria.
- [ ] No proposed check is marked "new" without a baseline comparison row.
- [ ] At least one command-backed sanity check was run against local skill-review content, such as `rg -n "Context Economy|Gotchas Coverage|Procedural Clarity|Progressive Disclosure|Calibration|Validation" .agents/skills/skill-review`.
- [ ] The final plan clearly states whether it is **plan-only** or includes direct edit instructions.

If any item fails: fix traceability first (citation and baseline mapping), then rerun the checklist before handoff.
