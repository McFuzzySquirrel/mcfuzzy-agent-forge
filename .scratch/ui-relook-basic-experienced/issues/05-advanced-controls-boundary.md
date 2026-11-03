# Set the progressive-disclosure boundary

Type: grilling
Status: resolved
Assignee: @McFuzzySquirrel
Blocked by: 01-guided-lifecycle.md

## Question

Which controls belong in the basic path, which belong under Advanced settings, and which should appear contextually for developers without making safe defaults mysterious?

## Comments

- Resolution: Keep project execution preferences (build mode, task selection, concurrency, timeouts, auto-commit, and harness-activity logging), authoring runner/model choices, and per-agent model overrides in Advanced. Keep harness-activity logging off by default and disclose that it may contain repository content. Before **Start build**, briefly explain consequential effective behavior in plain language and link to Advanced for changes; do not turn this summary into a configuration form. Show stage-appropriate actions such as **Start build**, pause/resume, recovery, and **Stop** on Build status when relevant; explain Stop's impact and require confirmation. Keep detailed task controls, direct harness CLI/model-planning tools, and low-level reset/manifest operations in Advanced.
- Keep harness selection visible in Basic project creation under the plain-language label **AI coding tool**, with a short explanation of each choice. Preselect the configured global default but allow changes; if there is no configured default, require an explicit choice rather than silently selecting the first option. Retain the technical term “harness” in Advanced.
- Keep an existing Project's feature-addition flow available contextually to Basic users as **Add a feature**. Preserve interactive feature authoring and review of the generated tasks before they run; do not expose agent-update or manifest-recompilation mechanics as user-facing choices.
