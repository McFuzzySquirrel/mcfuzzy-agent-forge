# ADR-013: Auto-detect input source in forge-auto-build Step 0

**Date:** 2026-08-06
**Status:** Accepted

---

## Context

`forge-auto-build` originally assumed the user always invoked the skill with an explicit argument (idea text or PRD path). In practice, launcher-driven flows and terminal harness workflows often open directly into a session where users run `/forge-auto-build` with no argument.

This created a UX gap:

1. The repository may already contain valid context files (`docs/PRD.md`, `docs/IDEA.md`, `IDEA.md`).
2. The skill still asked for input as if no context existed.
3. Users interpreted this as a failed handoff from launcher to skill.

The launcher now writes canonical idea context to `docs/IDEA.md` (with a compatibility copy at `IDEA.md`), so `forge-auto-build` should consume existing repo context before prompting.

---

## Decision

Update Step 0 of `forge-auto-build` to resolve an effective input source before pre-flight planning.

### Resolution order

1. Explicit user argument (always highest priority).
2. `docs/PRD.md`
3. `docs/IDEA.md`
4. `IDEA.md`

### Multi-source behavior

- If more than one candidate exists and no explicit argument is provided, ask the user to choose the source for that run.

### No-source behavior

- If no explicit argument and no candidate files exist, ask for a one-line idea or PRD path.

### Gate behavior

- Keep the existing single `GO` checkpoint. Do not add another confirmation gate.

---

## Consequences

### Positive

- `forge-auto-build` works naturally in no-argument invocations.
- Launcher handoff is more reliable in terminal harnesses.
- Existing PRD-first and IDEA-first workflows are both supported.

### Negative

- Step 0 becomes slightly more complex.
- Repositories with multiple candidate inputs require one extra selection prompt.

### Neutral

- Core stage execution and commit strategy remain unchanged.
- Explicit user input still overrides repository auto-detection.

---

## References

- Skill: [templates/skills/forge-auto-build/SKILL.md](../../templates/skills/forge-auto-build/SKILL.md)
- Docs: [docs/forge-launcher.md](../forge-launcher.md)
- Scripts: [scripts/forge-launcher.sh](../../scripts/forge-launcher.sh)
- Scripts: [scripts/forge-launcher.ps1](../../scripts/forge-launcher.ps1)
- ADR: [ADR-010: Forge Launcher](010-forge-launcher.md)
- ADR: [ADR-012: Launcher terminal handoff and PRD-first guidance](012-launcher-terminal-handoff-and-prd-guidance.md)
