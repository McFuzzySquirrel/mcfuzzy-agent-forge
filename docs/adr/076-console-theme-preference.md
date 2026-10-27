# ADR-076: Console theme preference and light palette

- **Status:** Accepted
- **Date:** October 2026
- **Related:** [ADR-071](071-system-level-console-defaults.md), [ADR-075](075-top-navigation-and-fluid-layout.md)

## Context

The Forge Console shipped with a dark-only palette in
`scripts/forge-launcher/scripts/console/dashboard/style.css`, with component
colors hard-coded alongside a small set of custom properties. The global
settings schema already reserved `ui.theme: "light" | "dark" | "auto"`
(ADR-071), but nothing read or wrote it, there was no light palette, and the
Settings view had no Appearance control. Saving the Global defaults form also
built a fresh settings object, so any `ui` block would have been overwritten.

Users expect a Console theme choice in Settings, and the repository already has
a system-level settings file (`settings.json` in `FORGE_HOME`) that is the
natural, per-user home for a UI preference.

## Decision

1. **Three preferences, resolved at runtime.** `auto` follows the OS
   `prefers-color-scheme`; `light` and `dark` are explicit. The resolved value
   is mirrored onto `<html data-theme="light|dark">` and
   `color-scheme`, so native form controls and scrollbars match.
2. **Tokenized palette.** Page, bar, panel, surface, border, shadow, backdrop,
   and semantic colors are custom properties on `:root` (dark). A
   `:root[data-theme="light"]` block redefines them. Translucent component tints
   use `color-mix(in srgb, var(--semantic) N%, transparent)` so badges, buttons,
   dialogs, and markdown blocks adapt without duplicated per-theme rules.
   Semantic greens/reds/blues are darkened in light mode for AA contrast, while
   the amber primary button keeps dark text and a separate `--accent-ink` is
   used for amber text and indicators.
3. **No flash, one source of truth.** The Settings Appearance panel applies a
   change immediately and persists it to `settings.json`. The preference is also
   cached in `localStorage` so the inline head script can paint the saved palette
   before the stylesheet loads; `main.ts` then reconciles with
   `GET /api/settings`, which wins if another session changed it.
4. **Settings saves preserve unrelated sections.** The settings endpoint still
   replaces the file. The Settings view therefore loads the complete object and
   merges before every save: Appearance sends the loaded object with only
   `ui.theme` changed, and Global defaults starts from the loaded object so it
   preserves `ui` and `authoring.models` while still allowing fields to be
   cleared.
5. **Terminal follows the theme.** The browser terminal uses a dark palette by
   default and a light ANSI palette when the resolved theme is light; it
   re-themes live if Appearance changes while the view is open.

## Consequences

- The preference is per user and global, matching `settings.json`; there is no
  per-project theme.
- The embedded **Board** view is a separate `/board/` application with its own
  CSS and canvas colors. It intentionally stays dark in this change; passing the
  resolved theme into the board is a separate follow-up.
- The light palette depends on `color-mix()`, which is available in current
  Chromium, Firefox, and Safari. The Console is a local, modern-browser UI.
- `ui.boardMode` remains reserved and unused.
- Existing `settings.json` files without `ui` default to System/auto, so no
  migration is needed.

## References

- Theme runtime: `scripts/forge-launcher/scripts/console/dashboard/theme.ts`.
- Palette: `scripts/forge-launcher/scripts/console/dashboard/style.css`.
- Settings view: `scripts/forge-launcher/scripts/console/dashboard/views/settings.ts`.
- Schema: `scripts/forge-launcher/scripts/settings.ts`.
- Changelog: [updates.md](../updates.md), v3.113.
