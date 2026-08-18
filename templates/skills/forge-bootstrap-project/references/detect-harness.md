# Harness Detection

Load this file when you need to determine where agent files live (or should be written) in the current repository.

## Why This Matters

No harness reads agents from `.agents/agents/` natively. Each harness has its own conventional directory:

| Harness | Agents directory | Skills directory |
|---------|-----------------|-----------------|
| GitHub Copilot | `.github/agents/` | `.github/skills/` |
| Claude Code | `.claude/agents/` | `.claude/skills/` |
| OpenCode | `.opencode/agents/` | `.opencode/skills/` |
| Generic / default | `.agents/agents/` | `.agents/skills/` |

`.agents/agents/` is the forge's canonical template path and the fallback for unknown harnesses. The bootstrap scripts copy files there by default and adapt the path when `--harness` is set. If none of the harness-specific directories exist yet, use `.agents/agents/` and advise the user to re-run bootstrap with the correct `--harness` flag.

## Detection Algorithm

Check for existing agent directories in this priority order:

1. `.github/agents/` — GitHub Copilot harness
2. `.claude/agents/` — Claude Code harness
3. `.opencode/agents/` — OpenCode harness
4. `.agents/agents/` — generic / default fallback

Use the **first directory that exists** as `HARNESS_AGENTS_DIR`.

If none exist, the project has not been bootstrapped yet. Set `HARNESS_AGENTS_DIR` to `.agents/agents/` and note that the user should run the bootstrap script before agents will be visible in their harness.

The corresponding skills directory (`HARNESS_SKILLS_DIR`) is the sibling `skills/` directory under the same root (e.g., if `HARNESS_AGENTS_DIR` is `.github/agents/`, then `HARNESS_SKILLS_DIR` is `.github/skills/`).

## How to Use This in a Skill

At the start of any skill that reads or writes agent files, perform harness detection:

```
HARNESS_AGENTS_DIR = first of [.github/agents/, .claude/agents/, .opencode/agents/, .agents/agents/] that exists
HARNESS_SKILLS_DIR = sibling skills/ under the same root
```

Use `HARNESS_AGENTS_DIR` wherever the skill refers to agent file locations. When presenting paths to the user in checklists or summaries, always use the detected path, not the hardcoded `.agents/agents/` placeholder.

## Asking the User

If detection is ambiguous (e.g., the project has not been bootstrapped and you cannot infer the harness from the environment), ask:

> "Which agent harness are you using? Options: GitHub Copilot (`.github/agents/`), Claude Code (`.claude/agents/`), OpenCode (`.opencode/agents/`), or generic (`.agents/agents/`)."

Store the answer as `HARNESS_AGENTS_DIR` for the rest of the session.
