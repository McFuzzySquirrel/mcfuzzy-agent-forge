# ADR-012: Launcher terminal handoff and PRD-first guidance

**Date:** 2026-08-06
**Status:** Accepted

---

## Context

The original launcher experience was effective at bootstrapping a repo and starting the onboarding flow, but the handoff to the actual agent harness was fragile in practice. In early testing, the launcher could appear to have launched the harness CLI even when the process was not behaving correctly, and the guidance did not clearly explain that better results come from starting with a stronger PRD or spec.

Two practical issues emerged:

1. **Harness CLIs were launched too implicitly.** The launcher used a background shell pattern that made it look like the harness had started, even when the session was not usable or the user needed a clearer fallback.
2. **The workflow underplayed the value of a spec-first approach.** A rough idea can work, but a PRD or seed documents produce better downstream results for the build pipeline.

This became particularly important for GitHub Copilot CLI, opencode, and Claude Code because each one benefits from a dedicated terminal session and a clear manual fallback when the launcher cannot open one automatically.

---

## Decision

We harden the launcher so that it:

1. Detects GitHub Copilot CLI (`copilot`) alongside the existing harness CLIs.
2. Launches Copilot CLI, opencode, and Claude Code in a separate terminal session when possible, instead of relying on a background shell job in the current terminal.
3. Provides explicit fallback instructions when no terminal emulator is available or when the CLI cannot be launched automatically.
4. Documents a PRD-first workflow in the launcher docs and README, recommending that users run `/forge-build-prd` separately and optionally add seed documents before running `/forge-auto-build`.

### Why this approach

- It makes the launcher more reliable for both interactive use and first-time users.
- It reduces ambiguity about whether the harness actually opened.
- It helps users understand that a stronger spec improves build quality without making the initial experience more complicated.
- It keeps the launcher lightweight and script-driven rather than introducing a new UI framework.

---

## Consequences

### Positive

- The launcher now gives a clearer launch experience for GitHub Copilot CLI, opencode, and Claude Code.
- Users get actionable recovery instructions if the harness does not open automatically.
- The docs now strongly encourage PRD-first and seed-document-first workflows for more reliable project generation.

### Negative

- The launcher now has a slightly more complex launch path because it needs to detect terminal emulators and fall back cleanly.
- Some environments still may not expose a suitable terminal emulator, in which case the launcher must fall back to manual instructions.

### Neutral

- The core forge workflow remains unchanged. The launcher is still a thin orchestration layer; it does not replace the underlying skills or agents.

---

## References

- Scripts: [scripts/forge-launcher.sh](../../scripts/forge-launcher.sh)
- Scripts: [scripts/forge-launcher.ps1](../../scripts/forge-launcher.ps1)
- Docs: [docs/forge-launcher.md](../forge-launcher.md)
- README: [README.md](../../README.md)
