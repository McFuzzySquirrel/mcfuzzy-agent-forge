# AGENTS.md

Guidance for AI coding agents working in this repository (MyForge).

## Repository layout

- `templates/skills/` — the forge skills. Each is a small TypeScript/Node package
  (own `package.json`, `tsconfig.json`, `scripts/`) that gets bootstrapped into
  target repos. Notable ones: `forge-workflow-engine` (autonomous execution)
  and `forge-execution-adapter` (manifest compiler). `templates/agents/` holds
  forge agent personas.
- `scripts/` — the `forge-launcher` npm package (`scripts/forge-launcher/`) plus
  thin bash/PowerShell wrapper scripts that delegate to it.
- `docs/` — human documentation: `updates.md` (the versioned changelog),
  `adr/` (architecture decision records), deep-dive guides, `research/`, and
  `documentation-map.md`. Generated artifacts (`EXECUTION-MANIFEST.json`,
  `PROGRESS.md`, …) are written by the skills into target repos and are not
  source-controlled hand-edits here.
- `plan.md`, `README.md` — project overview and usage. The README opens with a
  `**Latest: v3.x**` line that tracks the top section of `docs/updates.md`.

## Conventions

- **Changelog:** every user-visible change adds a new
  `## <Month> <Year> - v<ver>` section at the top of `docs/updates.md` and bumps
  the README's `**Latest:**` line. Notable features also get a new ADR under
  `docs/adr/NNN-*.md` (increment the number; ADR-050 is the latest).
- **Documentation and reference checks:** use
  [`docs/documentation-map.md`](docs/documentation-map.md) to identify the
  authoritative documents and update triggers before changing code. Update
  affected `SKILL.md`, README, guide, deep-dive, ADR, and changelog files in
  the same change as the behavior they describe. Check links, filenames,
  commands, flags, environment variables, examples, and migration guidance.
  If no documentation needs changing, state why in the completion summary.
  Retirement docs must distinguish active commands from preserved historical
  records.
- **Requirements:** the active contract is `docs/PRD.md` plus
  `docs/features/*.md`, as described in [`docs/canonical-features.md`](docs/canonical-features.md).
  Treat generated manifests as execution snapshots, not a second source of
  requirements. Preserve historical ADRs and changelog entries when behavior
  is retired.
- **Commit style:** short `feat:`, `fix:`, `docs:`, `refactor:` prefixes,
  imperative mood, matching the existing history. Only commit/push when asked.
- **Never commit `node_modules/` or `dist/`** — they are gitignored in every
  package and excluded from bootstrap copies; target repos install deps via
  `npm install` at prep time.

## Build & verify

Each skill package and the launcher has its own scripts (run from that package's
directory):

```bash
npm install          # first time; installs deps locally (never committed)
npm run typecheck    # tsc --noEmit
npm test             # node --test suite
```

Package test globs: the workflow engine runs `scripts/**/*.test.ts`; the
execution adapter and launcher run `scripts/*.test.ts`.
Each package also exposes its own entry script (e.g.
`npm run workflow-engine -- run`).

## Tools

- CodeGraph indexes this repo (`.codegraph/`). Prefer `codegraph_explore` before
  grepping/reading when locating or understanding code.
