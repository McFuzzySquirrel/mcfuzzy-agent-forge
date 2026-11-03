# Choose the reliable Board rendering baseline

Type: prototype
Status: closed
Assignee: @McFuzzySquirrel
Blocked by: 06-board-information-model.md

## Question

What concrete Board prototype should establish the semantic HTML/CSS baseline, optional SVG use, and PixiJS enhancement boundary while preserving the same data, interaction, and accessibility contract?

## Prototype

From the repository root, run `npm --prefix scripts/forge-launcher run build`, then start `node scripts/forge-launcher/dist/cli.js console --repo .`. Append `#/board?prototype=1&variant=A` to the Console URL.

- **A · Semantic lanes**: native HTML/CSS task lists and phase lanes.
- **B · SVG relationships**: an optional SVG dependency map with semantic task controls.
- **C · Canvas enhancement**: optional canvas preview with a fully interactive semantic task list that remains when the visual layer is off.

All variants use the same in-memory sample tasks, filters, task selection, detail panel, and accessibility actions; they do not execute or persist changes. Switch variants with the floating bar or `variant=A|B|C`.

Source: [Board rendering prototype](../../../scripts/forge-launcher/scripts/console/dashboard/views/board-rendering-prototype.ts).

## Comments

Resolution: The user selected **A · Semantic lanes** as the reliable Board rendering baseline. Keep the core Board in semantic HTML/CSS; optional visual layers must not replace the accessible task controls or become required for core interactions. This settles which rendering approach anchors the Board prototype and implementation direction.

The prototype source remains on the current `prototype/board-rendering-baseline` worktree. It is not committed; repository guidance says to commit only when asked.
