# Forge Console - Implementation Plan

**Status:** Approved - implementing
**Branch:** `feat/forge-console-web-ui`
**Relates to:** [forge-console-desktop-frontend-plan.md](research/forge-console-desktop-frontend-plan.md) (research), ADR-034 (to be written)

---

## Objective

A self-contained `forge-launcher console` web app that is the front door over
the existing `forge-launcher` (authoring) and `forge-launcher engine-run` →
`workflow-engine` (build) commands, plus the Forge Board (staged from templates).
Frontend is TypeScript compiled with `tsc` (full typechecking, native browser
ESM, no bundler). The board stays staged JS for now.

## Decisions (locked)

1. TypeScript frontend, **tsc-only** (full typechecking, no bundler).
2. **Full-flow** new project (repo → bootstrap → idea → optional PRD+team auto-draft).
3. **Self-contained** console in the launcher package (`forge-launcher console`).
4. Board stays staged JS (not converted to TS this pass).

## Entry-point map

| Goal | Console action | Drives (detached) |
|---|---|---|
| New project | New Project wizard | `forge-launcher --non-interactive` + `FORGE_REPO_NAME/_PARENT_DIR/_DESCRIPTION/_VISIBILITY/_HARNESS_CHOICE/_IDEA` (+ `FORGE_AUTO_DRAFT=1`) |
| Resume (no PRD) | Draft PRD | `forge-launcher --draft` |
| Resume (no team) | Generate team | headless `forge-build-agent-team` |
| Start build | Run | `forge-launcher engine-run --harness <h> --yes` (→ `docs/engine-run.log`) |
| Resume build | Resume | same engine invocation; resumes from `WORKFLOW-STATE.json` |
| Monitor/control | Board·Tasks·Logs·Artifacts·Timeline + Pause/Stop/Replay | reads `docs/*`; control via `engine-control.json` + `engine.pid` |

## Tasks

### 1. Board embed refactor (templates)
- [x] `templates/skills/forge-workflow-engine/scripts/viz/dashboard/app.js` - wrap `main()` in `window.ForgeBoard = { init(hostEl) }`; legacy `index.html` calls it unchanged.
- [x] Add "Open Forge Console" link to legacy board HUD.

### 2. Console server (launcher package)
- [x] `scripts/forge-launcher/scripts/console/paths.ts` - registry at `~/.myforge/projects.json` (honor `FORGE_HOME`/`XDG_CONFIG_HOME`).
- [x] `scripts/forge-launcher/scripts/console/server.ts` - `node:http`, `127.0.0.1`, mutable `RepoContext`, registry, SSE, control spawning (injectable spawner).
- [x] `scripts/forge-launcher/scripts/console/server.test.ts` - endpoints, SSE, pause/stop, replay, path-traversal, registry.
- [x] Static serving: console client dir + staged board assets (`/board/*`).

### 3. Server API
- [x] `GET /api/projects` · `POST /api/projects/select|add|create`
- [x] `GET /api/summary|tasks|audit|logs?lines=|artifacts|artifacts/:id|artifact/content?path=|docs|docs/content?path=|team|team/content?path=|actions`
- [x] `GET /api/manifest|state` (no `/api/layout`; board fallback renders)
- [x] `GET /api/events` - SSE: snapshot + audit + log + done
- [x] `POST /api/control` - run|resume|pause|stop|replay
- [x] `POST /api/open` - open whitelisted file externally

### 4. Console client (TypeScript)
- [x] `tsconfig.client.json` (esnext/DOM; `.js` specifiers; outDir `resources/console/client`)
- [x] `scripts/console/dashboard/index.html`, `style.css`
- [x] `main.ts` (router + SSE client), `api.ts` (typed client), `render/md.ts`
- [x] `views/projects.ts`, `overview.ts`, `tasks.ts`, `logs.ts`, `documents.ts`, `artifacts.ts`, `timeline.ts`
- [x] Board view lazy-loads staged `app.js` + `pixi.min.js`

### 5. CLI + build wiring (launcher package)
- [x] `scripts/console` subcommand in `scripts/cli.ts` + `launcher.ts` (`--repo`, `--port`, `--no-open`)
- [x] Record projects in registry from `createRepo`/`bootstrap`
- [x] `scripts/engine-run.ts` - tee output to `docs/engine-run.log`
- [x] `scripts/stage-resources.mjs` - stage board assets
- [x] `package.json` - `build` + `typecheck` (both tsconfigs)

### 6. Security
- [x] Loopback-only bind
- [x] `X-Forge-Token` CSRF guard on `POST`
- [x] Path-normalization + prefix checks on all file reads

### 7. Docs & changelog
- [x] `docs/adr/034-forge-console-web-ui.md`
- [x] `docs/forge-launcher.md` + `docs/workflow-engine.md`
- [x] `docs/research/forge-console-desktop-frontend-plan.md` - mark Phases 1–3 done
- [x] `docs/updates.md` v3.31 + README `**Latest:**` bump

### 8. Verify
- [x] `npm run typecheck` (server + client) · `npm test` in `scripts/forge-launcher/`
- [x] Manual smoke: `forge-launcher console` → New Project (stub) → board/tasks/logs → pause/stop/replay → Documents + Artifacts → resume

### 9. v3.36 additions
- [x] New Project wizard: add an existing PRD + research/seed documents via file-picker upload (`POST /api/uploads`) **and** absolute-path input; server passes `FORGE_PRD_FILE` / `FORGE_RESEARCH_FILES` to the launcher.
- [x] Plan & Team lists `docs/research/*.md` (kind `research`).
- [x] `POST /api/engine-config { autoCommit }` → `docs/engine-config.json`; auto-commit checkbox on Overview Controls (default on); `engineRunArgs` passes `--no-auto-commit` when off.
- [x] `POST /api/launch-cli` → opens the harness CLI in a terminal (injectable in tests); **Launch \<harness\> CLI** buttons on Tasks header + Overview header.

## Out of scope
Desktop packaging (Phase 4); in-browser editing of PRD/team; board → TS conversion; multi-repo simultaneous tabs.
