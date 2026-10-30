# Retirement Inventory

Load this file when reading the inventory output, when a path is ambiguous, or
when the user asks why a file is being removed or kept.

## Categories

| Category | Meaning | Action |
|---|---|---|
| `delete` / `forge-artifact` | Requirements, authoring state, execution state, engine files | Remove after approval |
| `delete` / `forge-skill` | A `forge-*` skill under the harness skills directory | Remove, unless protected |
| `delete` / `forge-agent` | `forge-team-builder.md`, `workflow-orchestrator.md` | Remove |
| `rewrite` / support lead | `project-orchestrator.md` | Rename to `support-lead.md` and rewrite |
| `rewrite` / agents | Generated specialists | Keep the file, rewrite the role |
| `rewrite` / skills | Project-authored skills | Keep the package, rewrite the procedure |
| `rewrite` / docs | Active docs referencing Forge | Remove the references |
| `rewrite` / config | `package.json`, CI, Makefile, Dockerfile | Remove or replace Forge commands |
| `review` | Forge-specific guides | Decide with the user: project doc or leftover |

## Protection rules

- A skill named in `docs/SKILL-CANDIDATES.json` with `action: create` or
  `extend`, or with `action: reuse` when its name does not start with `forge-`,
  is a **project skill**. It survives even when its name starts with `forge-`.
- A non-`forge-` skill directory always survives, even if it is not in the
  candidate handoff. The handoff may be missing in older repositories.
- `forge-retire-project` itself is never part of the delete list. It removes
  itself only after verification.
- Source code, tests, CI, manifests, `LICENSE`, `README.md`, `ARCHITECTURE.md`,
  ADRs, research notes, and changelogs are never deleted by the script.
- `.forge-archive/` is excluded from every later scan.

## Explicit Forge artifacts

Files:

- `docs/PRD.md`, `docs/prd.md`, `docs/IDEA.md`, `IDEA.md`
- `docs/requirements-source.md`, `docs/prompt-playbook.md`
- `docs/SKILL-CANDIDATES.json`, `docs/authoring-config.json`,
  `docs/authoring-state.json`, `docs/AUTHORING-EVENTS.jsonl`
- `docs/SKILL-AUDIT.md`, `docs/MODEL-PLAN.md`, `docs/model-overrides.json`,
  `docs/research/model-inventory.json`
- `docs/EXECUTION-MANIFEST.json`, `docs/WORKFLOW-STATE.json`,
  `docs/ENGINE-STATE.json`, `docs/PROGRESS.md`, `docs/EXECUTION-AUDIT.jsonl`
- `docs/agent-responsibility-matrix.md`, `docs/engine-config.json`,
  `docs/engine-control.json`, `docs/engine.pid`, `docs/engine-run.log`,
  `docs/rederive-state.json`, `docs/TEAM.md`

Directories:

- `docs/features/`
- `docs/artifacts/`
- `docs/task-executions/`
- `docs/reviews/`

`docs/reviews/` contains human-review evidence. It is Forge-managed, but it can
be valuable evidence. Recommend `--archive` when it exists and the user has not
explicitly said to discard review history.

## Ambiguous documents

The inventory flags a document for review when its filename is a known Forge
guide or when its body references a retired artifact. For each review item:

1. Read the document.
2. If it only describes Forge, remove it. Use `--archive` when the history
   matters.
3. If it documents the project but contains a Forge section, rewrite the
   section and keep the document.
4. If it is a historical record (ADR, research note, changelog, post-mortem),
   keep it. Do not rewrite history; add a one-line note that the Forge tooling
   has been retired when the document would otherwise mislead.

## What is not a retirement item

- `node_modules/`, `dist/`, build output, and caches. They are not Forge
  artifacts; leave them to the project's normal ignore rules.
- `.gitignore` itself. The script removes only `docs/engine-run.log` and
  `docs/artifacts/`; other entries belong to the project.
- The `docs/research/` directory. Only the model inventory file inside it is
  Forge-owned.
- A surviving agent's `model:` value. Model assignment is still useful after the
  build; keep it.
- `.github/workflows/` files. They are rewritten, never deleted by default.
