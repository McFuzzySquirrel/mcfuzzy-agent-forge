import { mkdirSync } from "node:fs";
import { join } from "node:path";

import assert from "node:assert/strict";
import type { Browser, HTTPRequest } from "puppeteer-core";
import { clickByText, openRoute, settle, type Viewport } from "./chrome.ts";

export interface CaptureTarget {
  name: string;
  route: string;
  viewport: Viewport;
  /** Capture the entire scrollable page (used for Overview so the Controls are visible). */
  fullPage?: boolean;
  prepare?: (page: Awaited<ReturnType<Browser["newPage"]>>) => Promise<void>;
}

const WIDE: Viewport = { width: 1440, height: 1100 };
const MEDIUM: Viewport = { width: 1024, height: 1100 };
const TABLET: Viewport = { width: 720, height: 1100 };
const MOBILE_L: Viewport = { width: 390, height: 900 };
const MOBILE_S: Viewport = { width: 320, height: 900 };

const ROUTES = ["home", "overview", "board", "project-brief", "project-files", "review-queue", "tasks", "logs", "documents", "artifacts", "timeline", "projects", "new", "settings"] as const;
const VIEWPORTS: Array<[label: string, viewport: Viewport]> = [
  ["1440", WIDE],
  ["1024", MEDIUM],
  ["720", TABLET],
  ["390", MOBILE_L],
  ["320", MOBILE_S],
];

function routeTargets(): CaptureTarget[] {
  const targets: CaptureTarget[] = [];
  for (const route of ROUTES) {
    for (const [label, viewport] of VIEWPORTS) {
      targets.push({ name: `${route}-${label}`, route, viewport, fullPage: route === "overview" || route === "settings" });
    }
  }
  return targets;
}

function detailTargets(): CaptureTarget[] {
  return [
    {
      name: "tasks-detail-1440",
      route: "tasks",
      viewport: WIDE,
      prepare: async (page) => { await clickByText(page, "tr.clickable", "1.1"); },
    },
    {
      name: "logs-audit-1440",
      route: "logs",
      viewport: WIDE,
      prepare: async (page) => { await clickByText(page, ".tab", "Audit"); },
    },
    {
      name: "documents-detail-1440",
      route: "documents",
      viewport: WIDE,
      prepare: async (page) => { await openDocument(page, "docs/PRD.md"); },
    },
    {
      name: "documents-prd-1440",
      route: "documents",
      viewport: WIDE,
      prepare: async (page) => { await openDocument(page, "docs/features/auth.md"); },
    },
    {
      name: "project-files-detail-1440",
      route: "project-files",
      viewport: WIDE,
      prepare: async (page) => {
        await page.waitForFunction(() => {
          const text = document.body.innerText;
          return text.includes("Read Project brief") && text.includes("Open index.ts externally");
        }, { timeout: 10000 });
        await clickByText(page, ".project-file-card button", "Read Project brief");
        await page.waitForSelector("dialog.doc-dialog", { timeout: 10000 });
        await page.waitForFunction(() => {
          const body = document.querySelector("dialog.doc-dialog .doc-dialog-body");
          return body?.textContent?.includes("Ledgerly gives a small company") ?? false;
        }, { timeout: 10000 });
      },
    },
    {
      name: "artifacts-detail-1440",
      route: "artifacts",
      viewport: WIDE,
      prepare: async (page) => { await clickByText(page, ".doc-item", "solution-001"); },
    },
    {
      name: "help-1440",
      route: "overview",
      viewport: WIDE,
      prepare: async (page) => { await clickByText(page, ".help-btn", "Help"); },
    },
    {
      name: "board-gantt-1440",
      route: "board",
      viewport: WIDE,
      prepare: async (page) => { await setBoardMode(page, "gantt"); },
    },
    {
      name: "board-gantt-390",
      route: "board",
      viewport: MOBILE_L,
      prepare: async (page) => {
        await setBoardMode(page, "gantt");
        await clickByText(page, '[role="group"][aria-label="Filter Tasks by status"] button', "All");
        await page.$eval('[aria-label="Gantt Board content"]', (board) => board.scrollIntoView({ block: "start" }));
        const timeline = await page.evaluate(() => {
          const table = document.querySelector<HTMLTableElement>('table[aria-label="Task timeline and duration"]');
          const row = table?.tBodies[0]?.rows[0];
          const cell = row?.cells[1];
          row?.scrollIntoView({ block: "center", inline: "nearest" });
          if (!cell) return null;
          const rect = cell.getBoundingClientRect();
          return {
            x: Math.max(rect.left + 2, Math.min(window.innerWidth - 16, rect.right - 12)),
            y: rect.top + rect.height / 2,
          };
        });
        if (timeline) {
          await page.mouse.move(timeline.x, timeline.y);
          await page.mouse.wheel({ deltaX: 240, deltaY: 0 });
        }
      },
    },
    {
      name: "board-detail-1440",
      route: "board",
      viewport: WIDE,
      prepare: async (page) => { await openBoardDetails(page); },
    },
    {
      name: "board-detail-390",
      route: "board",
      viewport: MOBILE_L,
      prepare: async (page) => { await openBoardDetails(page); },
    },
    {
      name: "nav-menu-1440",
      route: "overview",
      viewport: WIDE,
      prepare: async (page) => { await openNavMenu(page, "Advanced"); },
    },
    {
      name: "nav-drawer-720",
      route: "overview",
      viewport: TABLET,
      prepare: async (page) => {
        await clickByText(page, "#nav-toggle", "Menu");
        await page.waitForFunction(() =>
          document.querySelector("#nav-toggle")?.getAttribute("aria-expanded") === "true");
        await openNavMenu(page, "Project");
        await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
          .find((button) => button.textContent?.trim().startsWith("Project"))?.getAttribute("aria-expanded") === "true");
        assert.equal(await page.evaluate(() => location.hash), "#/overview",
          "Opening the Project group in the drawer should not change the active destination.");
      },
    },
  ];
}

/** Opens a top-nav category flyout by clicking its button. */
async function openNavMenu(page: Awaited<ReturnType<Browser["newPage"]>>, label: string): Promise<void> {
  await page.evaluate((name) => {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button.nav-category-btn"))
      .find((node) => (node.textContent ?? "").includes(name));
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, label);
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function waitForBoard(page: Awaited<ReturnType<Browser["newPage"]>>): Promise<void> {
  await page.waitForSelector(".semantic-board", { timeout: 10000 });
  await page.waitForFunction(() => {
    const board = document.querySelector<HTMLElement>(".semantic-board");
    return board?.getAttribute("aria-busy") === "false";
  }, { timeout: 15000 });
}

async function assertBoardKeyboardContract(browser: Browser, baseUrl: string): Promise<void> {
  const page = await openRoute(browser, baseUrl, "board", WIDE);
  try {
    await waitForBoard(page);
    const controls = await page.evaluate(() => {
      const result: Array<{ tagName: string; tabIndex: number; accessibleText: string }> = [];
      const elements = document.querySelectorAll<HTMLElement>(".semantic-board .board-task-control, .semantic-board .board-gantt-bar");
      for (let index = 0; index < elements.length; index += 1) {
        const control = elements.item(index)!;
        result.push({
          tagName: control.tagName,
          tabIndex: control.tabIndex,
          accessibleText: control.getAttribute("aria-label") ?? control.textContent?.trim() ?? "",
        });
      }
      return result;
    });
    assert.ok(controls.length > 0, "Board should expose Task cards and timeline bars");
    assert.ok(controls.every((control) => control.tagName === "BUTTON" && control.tabIndex >= 0 && control.accessibleText.length > 0),
      "Every visual Task card and Gantt bar should be a named keyboard-focusable button");

    await page.focus('[data-board-mode="gantt"]');
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-board-focus") === "mode:gantt");
    const taskId = await page.evaluate(() => {
      const controls = document.querySelectorAll<HTMLButtonElement>(".board-gantt-table .board-task-control");
      for (let index = 0; index < controls.length; index += 1) {
        const control = controls.item(index)!;
        if (control.textContent?.includes("Approval routing")) return control.dataset.boardTaskId ?? null;
      }
      return null;
    });
    assert.ok(taskId, "Fixture should include an Approval routing Task");
    const selector = `[data-board-task-id="${taskId}"]`;
    await page.focus(`.board-gantt-bar${selector}`);
    await page.keyboard.press("Enter");
    await page.waitForSelector(".board-details");
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-board-focus") === "details-heading");

    const relationships = await page.$eval(".board-details", (details) => {
      const result: Array<{ label: string; text: string; focusableCount: number }> = [];
      const labels = ["Prerequisites", "Artifact inputs", "Artifacts produced"];
      for (const label of labels) {
        let term: HTMLElement | null = null;
        const terms = details.querySelectorAll("dt");
        for (let index = 0; index < terms.length; index += 1) {
          const item = terms.item(index)!;
          if (item.textContent?.trim() === label) {
            term = item;
            break;
          }
        }
        const value = term?.parentElement?.querySelector("dd");
        result.push({
          label,
          text: value?.textContent?.trim() ?? "",
          focusableCount: value?.querySelectorAll("a, button, input, select, textarea, [tabindex='0']").length ?? 0,
        });
      }
      return result;
    });
    assert.match(relationships.find((relationship) => relationship.label === "Prerequisites")?.text ?? "", /Expense capture/);
    assert.match(relationships.find((relationship) => relationship.label === "Artifact inputs")?.text ?? "", /solution\.capture/);
    assert.match(relationships.find((relationship) => relationship.label === "Artifacts produced")?.text ?? "", /solution\.approvals/);
    assert.ok(relationships
      .every((relationship) => relationship.focusableCount === 0),
      "Relationship text should be structured without adding pointer-only links or controls to the focus order");

    await page.focus("[data-board-close]");
    await page.keyboard.press("Enter");
    await page.waitForFunction((key) => document.activeElement?.getAttribute("data-board-focus") === key, { timeout: 10000 }, `bar:${encodeURIComponent(taskId)}`);

    await page.focus('[data-board-mode="kanban"]');
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-board-focus") === "mode:kanban");
    await page.focus(`.board-kanban-table .board-task-control${selector}`);
    await page.keyboard.press("Space");
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-board-focus") === "details-heading");
    await page.focus('[data-board-filter="pending"]');
    await page.keyboard.press("Space");
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-board-focus") === "filter:pending");
    assert.equal(await page.$eval(".board-details h3", (heading) => heading.textContent), "Approval routing",
      "Filtering and changing views should preserve an available selected Task");
    await page.focus("[data-board-close]");
    await page.keyboard.press("Enter");
    await page.waitForFunction((key) => document.activeElement?.getAttribute("data-board-focus") === key, { timeout: 10000 }, `task:${encodeURIComponent(taskId)}`);

    await page.focus(`.board-kanban-table .board-task-control${selector}`);
    await page.keyboard.press("Space");
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-board-focus") === "details-heading");
    await page.focus('[data-board-mode="gantt"]');
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-board-focus") === "mode:gantt");
    assert.equal(await page.$eval(".board-details h3", (heading) => heading.textContent), "Approval routing",
      "Switching Board views should preserve an available selected Task");
    await page.focus("[data-board-close]");
    await page.keyboard.press("Enter");
    await page.waitForFunction((key) => document.activeElement?.getAttribute("data-board-focus") === key, { timeout: 10000 }, `task:${encodeURIComponent(taskId)}`);
    await page.evaluate(() => {
      const keys: string[] = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith("forge-console.board.")) keys.push(key);
      }
      for (const key of keys) window.localStorage.removeItem(key);
    });
  } finally {
    await page.close();
  }
}

async function assertNarrowGanttKeepsTaskLabelsVisible(browser: Browser, baseUrl: string): Promise<void> {
  const page = await openRoute(browser, baseUrl, "board", MOBILE_L);
  try {
    await waitForBoard(page);
    await setBoardMode(page, "gantt");
    const before = await page.evaluate(() => {
      const table = document.querySelector<HTMLTableElement>('table[aria-label="Task timeline and duration"]');
      const row = table ? Array.from(table.tBodies[0]?.rows ?? []).find((candidate) => candidate.querySelector("button")) : null;
      const label = row?.cells[0]?.querySelector("button");
      const timeline = row?.cells[1];
      if (!label || !timeline) return null;
      row?.scrollIntoView({ block: "center", inline: "nearest" });
      const labelRect = label.getBoundingClientRect();
      const timelineRect = timeline.getBoundingClientRect();
      return {
        labelLeft: labelRect.left,
        timelineLeft: timelineRect.left,
        timelineX: Math.max(timelineRect.left + 2, Math.min(window.innerWidth - 16, timelineRect.right - 12)),
        timelineY: timelineRect.top + timelineRect.height / 2,
      };
    });
    assert.ok(before, "Gantt should expose Task labels and a timeline for its Tasks");

    await page.mouse.move(before.timelineX, before.timelineY);
    await page.mouse.wheel({ deltaX: 240, deltaY: 0 });
    await page.waitForFunction((initialTimelineLeft) => {
      const table = document.querySelector<HTMLTableElement>('table[aria-label="Task timeline and duration"]');
      const row = table ? Array.from(table.tBodies[0]?.rows ?? []).find((candidate) => candidate.querySelector("button")) : null;
      const timeline = row?.cells[1];
      return timeline !== undefined && timeline.getBoundingClientRect().left < initialTimelineLeft - 100;
    }, { timeout: 10000 }, before.timelineLeft);

    const labelLeft = await page.$eval(
      'table[aria-label="Task timeline and duration"] tbody tr td:first-child button',
      (label) => label.getBoundingClientRect().left,
    );
    assert.ok(Math.abs(labelLeft - before.labelLeft) < 2,
      "Panning the Gantt timeline should keep its Task label visible in the same position.");
  } finally {
    await page.close();
  }
}

async function assertNarrowKanbanKeepsPhaseLabelsVisible(browser: Browser, baseUrl: string): Promise<void> {
  const page = await openRoute(browser, baseUrl, "board", MOBILE_L);
  try {
    await waitForBoard(page);
    await setBoardMode(page, "kanban");
    const before = await page.evaluate(() => {
      const table = document.querySelector<HTMLTableElement>('table[aria-label="Tasks by phase and workflow status"]');
      const phaseRow = table?.tBodies[0]?.rows[0];
      const phaseLabel = phaseRow?.querySelector("th[scope='row']");
      const firstStatusCell = phaseRow?.cells[1];
      const inProgress = table?.tHead?.rows[0]
        ? Array.from(table.tHead.rows[0].cells).find((cell) => cell.textContent?.trim() === "In progress")
        : null;
      if (!phaseLabel || !firstStatusCell || !inProgress) return null;
      phaseRow?.scrollIntoView({ block: "center", inline: "nearest" });
      const phaseRect = phaseLabel.getBoundingClientRect();
      const statusRect = inProgress.getBoundingClientRect();
      const scrollTarget = firstStatusCell.getBoundingClientRect();
      return {
        phaseLeft: phaseRect.left,
        statusLeft: statusRect.left,
        scrollX: Math.max(scrollTarget.left + 2, Math.min(window.innerWidth - 16, scrollTarget.right - 12)),
        scrollY: scrollTarget.top + scrollTarget.height / 2,
      };
    });
    assert.ok(before, "Kanban should expose its phase labels and workflow-status columns");

    await page.mouse.move(before.scrollX, before.scrollY);
    await page.mouse.wheel({ deltaX: 240, deltaY: 0 });
    await page.waitForFunction((initialStatusLeft) => {
      const table = document.querySelector<HTMLTableElement>('table[aria-label="Tasks by phase and workflow status"]');
      const inProgress = table?.tHead?.rows[0]
        ? Array.from(table.tHead.rows[0].cells).find((cell) => cell.textContent?.trim() === "In progress")
        : null;
      return inProgress !== null && inProgress !== undefined
        && inProgress.getBoundingClientRect().left < initialStatusLeft - 100;
    }, { timeout: 10000 }, before.statusLeft);
    const after = await page.$eval('table[aria-label="Tasks by phase and workflow status"] tbody th[scope="row"]', (phase) =>
      phase.getBoundingClientRect().left);
    assert.ok(Math.abs(after - before.phaseLeft) < 2,
      "Horizontally panning Kanban status columns should keep each phase label visible.");
  } finally {
    await page.close();
  }
}

async function assertKanbanContextSurvivesResponsiveChanges(browser: Browser, baseUrl: string): Promise<void> {
  const page = await openRoute(browser, baseUrl, "board", MOBILE_L);
  try {
    await waitForBoard(page);
    await setBoardMode(page, "kanban");
    assert.equal(await clickByText(page, '[role="group"][aria-label="Filter Tasks by status"] button', "In progress"), true);
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Filter Tasks by status"] button'))
        .some((button) => button.textContent?.trim() === "In progress" && button.getAttribute("aria-pressed") === "true"));

    const before = await page.evaluate(() => {
      const table = document.querySelector<HTMLTableElement>('table[aria-label="Tasks by phase and workflow status"]');
      const phaseRow = table?.tBodies[0]?.rows[0];
      const firstStatusCell = phaseRow?.cells[1];
      const inProgress = table?.tHead?.rows[0]
        ? Array.from(table.tHead.rows[0].cells).find((cell) => cell.textContent?.trim() === "In progress")
        : null;
      if (!phaseRow || !firstStatusCell || !inProgress) return null;
      phaseRow.scrollIntoView({ block: "center", inline: "nearest" });
      const cellRect = firstStatusCell.getBoundingClientRect();
      return {
        statusLeft: inProgress.getBoundingClientRect().left,
        scrollX: Math.max(cellRect.left + 2, Math.min(window.innerWidth - 16, cellRect.right - 12)),
        scrollY: cellRect.top + cellRect.height / 2,
      };
    });
    assert.ok(before, "Kanban should expose its phase labels and workflow-status columns");

    await page.mouse.move(before.scrollX, before.scrollY);
    await page.mouse.wheel({ deltaX: 240, deltaY: 0 });
    await page.waitForFunction((initialStatusLeft) => {
      const table = document.querySelector<HTMLTableElement>('table[aria-label="Tasks by phase and workflow status"]');
      const inProgress = table?.tHead?.rows[0]
        ? Array.from(table.tHead.rows[0].cells).find((cell) => cell.textContent?.trim() === "In progress")
        : null;
      return inProgress !== null && inProgress !== undefined
        && inProgress.getBoundingClientRect().left < initialStatusLeft - 100;
    }, { timeout: 10000 }, before.statusLeft);
    const taskId = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('table[aria-label="Tasks by phase and workflow status"] button'))
        .find((button) => button.textContent?.includes("Approval routing"))?.getAttribute("data-board-task-id"));
    assert.ok(taskId, "The fixture should include the Approval routing Task.");
    await page.focus(`table[aria-label="Tasks by phase and workflow status"] button[data-board-task-id="${taskId}"]`);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() =>
      document.querySelector('[role="region"][aria-labelledby="board-details-title"] h3')?.textContent === "Approval routing");
    const expectedStatusLeft = await page.evaluate(() => {
      const table = document.querySelector<HTMLTableElement>('table[aria-label="Tasks by phase and workflow status"]');
      return Array.from(table?.tHead?.rows[0]?.cells ?? [])
        .find((cell) => cell.textContent?.trim() === "In progress")?.getBoundingClientRect().left ?? 0;
    });

    const narrowDetails = await page.$eval('[role="region"][aria-labelledby="board-details-title"]', (details) => {
      const rect = details.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight };
    });
    assert.ok(narrowDetails.left <= 1 && narrowDetails.top <= 1
      && narrowDetails.width >= narrowDetails.viewportWidth - 1
      && narrowDetails.height >= narrowDetails.viewportHeight - 1,
    "Narrow Task details should fill the screen.");

    await page.setViewport({ width: 1440, height: MOBILE_L.height, deviceScaleFactor: 1 });
    const wideDetails = await page.$eval('[role="region"][aria-labelledby="board-details-title"]', (details) => {
      const rect = details.getBoundingClientRect();
      const board = document.querySelector<HTMLElement>('[aria-label="Kanban Board content"]')?.getBoundingClientRect();
      return { left: rect.left, width: rect.width, boardRight: board?.right ?? 0 };
    });
    assert.ok(wideDetails.left >= wideDetails.boardRight - 1 && wideDetails.width < 400,
      `Wide Task details should sit beside the Board as a side panel (${JSON.stringify(wideDetails)}).`);

    await page.setViewport({ width: MOBILE_L.width, height: MOBILE_L.height, deviceScaleFactor: 1 });
    await page.reload({ waitUntil: "load" });
    await settle(page);
    await waitForBoard(page);
    await page.waitForFunction(() =>
      document.querySelector('[role="region"][aria-labelledby="board-details-title"] h3')?.textContent === "Approval routing");
    assert.equal(await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Filter Tasks by status"] button'))
        .find((button) => button.textContent?.trim() === "In progress")?.getAttribute("aria-pressed")), "true",
    "The selected status filter should survive a refresh.");

    await page.focus('button[aria-label="Close Task details"]');
    await page.keyboard.press("Enter");
    await page.waitForFunction((key) => document.activeElement?.getAttribute("data-board-focus") === key, { timeout: 10000 }, `task:${encodeURIComponent(taskId)}`);
    const restoredStatusLeft = await page.evaluate(() => {
      const table = document.querySelector<HTMLTableElement>('table[aria-label="Tasks by phase and workflow status"]');
      return Array.from(table?.tHead?.rows[0]?.cells ?? [])
        .find((cell) => cell.textContent?.trim() === "In progress")?.getBoundingClientRect().left ?? 0;
    });
    assert.ok(Math.abs(restoredStatusLeft - expectedStatusLeft) < 2,
      `Closing details after resizing and refresh should return to the same Board position (${expectedStatusLeft} → ${restoredStatusLeft}).`);
  } finally {
    await page.close();
  }
}

async function assertBoardKeepsIndependentViewPositions(browser: Browser, baseUrl: string): Promise<void> {
  const page = await openRoute(browser, baseUrl, "board", MOBILE_L);
  try {
    await waitForBoard(page);
    await setBoardMode(page, "kanban");
    const kanbanStatusLeft = await page.evaluate(() => {
      const table = document.querySelector<HTMLTableElement>('table[aria-label="Tasks by phase and workflow status"]');
      return Array.from(table?.tHead?.rows[0]?.cells ?? [])
        .find((cell) => cell.textContent?.trim() === "In progress")?.getBoundingClientRect().left ?? 0;
    });

    await setBoardMode(page, "gantt");
    const before = await page.evaluate(() => {
      const table = document.querySelector<HTMLTableElement>('table[aria-label="Task timeline and duration"]');
      const row = table ? Array.from(table.tBodies[0]?.rows ?? []).find((candidate) => candidate.querySelector("button")) : null;
      const axis = table?.tHead?.rows[0]?.cells[1]?.querySelector('[aria-label="Timeline"]');
      const timelineCell = row?.cells[1];
      if (!axis || !timelineCell || !row) return null;
      row.scrollIntoView({ block: "center", inline: "nearest" });
      const timelineRect = timelineCell.getBoundingClientRect();
      return {
        axisLeft: axis.getBoundingClientRect().left,
        timelineLeft: timelineRect.left,
        scrollX: Math.max(timelineRect.left + 2, Math.min(window.innerWidth - 16, timelineRect.right - 12)),
        scrollY: timelineRect.top + timelineRect.height / 2,
      };
    });
    assert.ok(before, "Gantt should expose its Task timeline and axis");
    await page.mouse.move(before.scrollX, before.scrollY);
    await page.mouse.wheel({ deltaX: 240, deltaY: 0 });
    await page.waitForFunction((initialTimelineLeft) => {
      const table = document.querySelector<HTMLTableElement>('table[aria-label="Task timeline and duration"]');
      const cell = Array.from(table?.tBodies[0]?.rows ?? []).find((row) => row.querySelector("button"))?.cells[1];
      return cell !== undefined && cell.getBoundingClientRect().left < initialTimelineLeft - 100;
    }, { timeout: 10000 }, before.timelineLeft);
    const ganttAxisLeft = await page.$eval(
      'table[aria-label="Task timeline and duration"] thead th[scope="col"]:nth-child(2) [aria-label="Timeline"]',
      (axis) => axis.getBoundingClientRect().left,
    );

    await setBoardMode(page, "kanban");
    const restoredKanbanStatusLeft = await page.evaluate(() => {
      const table = document.querySelector<HTMLTableElement>('table[aria-label="Tasks by phase and workflow status"]');
      return Array.from(table?.tHead?.rows[0]?.cells ?? [])
        .find((cell) => cell.textContent?.trim() === "In progress")?.getBoundingClientRect().left ?? 0;
    });
    assert.ok(Math.abs(restoredKanbanStatusLeft - kanbanStatusLeft) < 2,
      "Switching Board views should restore Kanban's independent horizontal position.");

    await setBoardMode(page, "gantt");
    const restoredGanttAxisLeft = await page.$eval(
      'table[aria-label="Task timeline and duration"] thead th[scope="col"]:nth-child(2) [aria-label="Timeline"]',
      (axis) => axis.getBoundingClientRect().left,
    );
    assert.ok(Math.abs(restoredGanttAxisLeft - ganttAxisLeft) < 2,
      "Switching Board views should restore Gantt's independent horizontal position.");

    await page.reload({ waitUntil: "load" });
    await settle(page);
    await waitForBoard(page);
    await page.waitForSelector('table[aria-label="Task timeline and duration"]', { timeout: 10000 });
    const refreshedGanttAxisLeft = await page.$eval(
      'table[aria-label="Task timeline and duration"] thead th[scope="col"]:nth-child(2) [aria-label="Timeline"]',
      (axis) => axis.getBoundingClientRect().left,
    );
    assert.ok(Math.abs(refreshedGanttAxisLeft - ganttAxisLeft) < 2,
      "Refreshing the Board should restore Gantt's saved horizontal position.");
  } finally {
    await page.close();
  }
}

/** Switches the semantic Board mode and waits for the selected tab to update. */
async function setBoardMode(page: Awaited<ReturnType<Browser["newPage"]>>, mode: "kanban" | "gantt"): Promise<void> {
  await page.evaluate((target) => {
    document.querySelector(`[data-board-mode="${target}"]`)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, mode);
  await page.waitForFunction((expected) => document.querySelector(`[data-board-mode="${expected}"]`)?.getAttribute("aria-selected") === "true", { timeout: 10000 }, mode);
  if (mode === "gantt") {
    await page.waitForSelector(".board-gantt-table, .board-timeline-unavailable", { timeout: 10000 });
  }
}

/** Opens the shared compact Task detail from a semantic Kanban card. */
async function openBoardDetails(page: Awaited<ReturnType<Browser["newPage"]>>): Promise<void> {
  await setBoardMode(page, "kanban");
  await page.waitForSelector(".board-kanban-table .board-task-control", { timeout: 10000 });
  await page.click(".board-kanban-table .board-task-control");
  await page.waitForSelector(".board-details", { timeout: 10000 });
}

/** Expands the collapsed Documents section, opens a document in the wide popup, and waits for it to render. */
async function openDocument(page: Awaited<ReturnType<Browser["newPage"]>>, relPath: string): Promise<void> {
  await clickByText(page, "summary", "Documents");
  await page.waitForSelector("tr.clickable", { timeout: 10000 }).catch(() => {});
  await clickByText(page, "tr.clickable", relPath);
  await page.waitForSelector("dialog.doc-dialog", { timeout: 10000 }).catch(() => {});
  await page.waitForFunction(() => {
    const body = document.querySelector("dialog.doc-dialog .doc-dialog-body");
    return body !== null && !(body.textContent ?? "").includes("Loading");
  }, { timeout: 10000 }).catch(() => {});
}

/**
 * The Console shell pins html/body to the viewport height and scrolls an inner
 * region, so Puppeteer's `fullPage` does not grow the capture. Measure the real
 * content height and resize the viewport instead, so the whole page is shown.
 */
async function expandToContent(page: Awaited<ReturnType<Browser["newPage"]>>, viewport: Viewport): Promise<void> {
  const height = await page.evaluate(() => {
    const view = document.querySelector<HTMLElement>("#view");
    return Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, view?.scrollHeight ?? 0));
  });
  if (height > viewport.height) {
    await page.setViewport({ width: viewport.width, height: Math.min(height + 24, 6000), deviceScaleFactor: 1 });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }
}

async function captureTargets(browser: Browser, baseUrl: string, currentDir: string, targets: CaptureTarget[]): Promise<string[]> {
  mkdirSync(currentDir, { recursive: true });
  const written: string[] = [];
  for (const target of targets) {
    const page = await openRoute(browser, baseUrl, target.route, target.viewport);
    try {
      if (target.route === "board") await waitForBoard(page);
      if (target.prepare) await target.prepare(page);
      if (target.route === "board") await waitForBoard(page);
      if (target.fullPage) await expandToContent(page, target.viewport);
      await settle(page);
      const file = join(currentDir, `${target.name}.png`);
      await page.screenshot({ path: file, type: "png", fullPage: false, optimizeForSpeed: false });
      written.push(target.name);
      process.stdout.write(`  ✓ ${target.name}\n`);
    } finally {
      await page.close();
    }
  }
  return written;
}

async function assertNavigationAcceptance(browser: Browser, baseUrl: string): Promise<void> {
  const page = await openRoute(browser, baseUrl, "home", WIDE);
  try {
    const selectedProject = await page.$eval('select[aria-label="Switch project"]', (select) => select.value);
    assert.ok(selectedProject, "The fixture should begin with a selected Project.");

    const assertProjectContext = async (): Promise<void> => {
      assert.equal(await page.$eval('select[aria-label="Switch project"]', (select) => select.value), selectedProject,
        "Navigation must not switch the selected Project implicitly.");
      assert.match(await page.$eval('header[aria-label="Project context"]', (header) => header.innerText), /ledgerly/i,
        "The selected Project context should remain visible on every destination.");
    };
    const clickNavItem = async (kind: "button" | "a", label: string): Promise<void> => {
      const found = await page.$eval("nav[aria-label='Main']", (nav, args) => {
        const [tagName, text] = args as [string, string];
        const elements = Array.from(nav.querySelectorAll<HTMLElement>(tagName));
        const item = elements.find((element) => element.textContent?.trim().startsWith(text));
        if (!item) return false;
        const style = getComputedStyle(item);
        const visible = Boolean(item.getClientRects().length) && style.display !== "none" && style.visibility !== "hidden";
        if (!visible && tagName === "a") return false;
        item.click();
        return true;
      }, [kind, label]);
      assert.equal(found, true, `${label} should be visible in the navigation.`);
      await settle(page);
    };
    const openDestination = async (group: string, label: string, route: string): Promise<void> => {
      process.stdout.write(`  Checking navigation: ${label}\n`);
      await clickNavItem("button", group);
      await clickNavItem("a", label);
      try {
        await page.waitForFunction((expected) => location.hash.split("?")[0] === expected, { timeout: 15000 }, route);
      } catch {
        throw new Error(`${label} did not open its expected destination ${route}; the browser is at ${await page.evaluate(() => location.hash)}.`);
      }
      await settle(page);
      if (label === "Project brief") {
        await page.waitForFunction(() => document.body.innerText.includes("Ledgerly gives a small company"),
          { timeout: 10000 });
      }
      await assertProjectContext();
    };

    for (const label of ["Home", "Projects"]) {
      await page.$eval("nav[aria-label='Main']", (nav, text) => {
        const link = Array.from(nav.querySelectorAll<HTMLAnchorElement>("a"))
          .find((element) => element.textContent?.trim() === text);
        if (!link || !link.getClientRects().length) throw new Error(`${text} should remain a visible global destination.`);
      }, label);
    }
    await page.$eval("nav[aria-label='Main']", (nav) => {
      for (const text of ["Project", "Advanced"]) {
        const button = Array.from(nav.querySelectorAll<HTMLButtonElement>("button"))
          .find((element) => element.textContent?.trim().startsWith(text));
        if (!button || !button.getClientRects().length) throw new Error(`${text} should be a visible navigation group.`);
      }
    });

    await clickNavItem("a", "Projects");
    await page.waitForFunction(() => location.hash === "#/projects");
    await assertProjectContext();
    await clickNavItem("a", "Home");
    await page.waitForFunction(() => location.hash === "#/home");
    await assertProjectContext();

    for (const [label, route] of [
      ["Build status", "#/overview"],
      ["Board", "#/board"],
      ["Project brief", "#/project-brief"],
      ["Project files", "#/project-files"],
      ["Human review", "#/review-queue"],
    ] as const) {
      await openDestination("Project", label, route);
    }

    for (const [label, route] of [
      ["All tasks", "#/tasks"],
      ["Logs", "#/logs"],
      ["Timeline", "#/timeline"],
      ["Terminal", "#/terminal"],
      ["Plan & Team", "#/documents"],
      ["Artifacts", "#/artifacts"],
      ["Settings", "#/settings"],
    ] as const) {
      await openDestination("Advanced", label, route);
    }

    const taskBookmark = "#/tasks?task=EXP-2&feature-review=1";
    await page.goto(`${baseUrl}/${taskBookmark}`, { waitUntil: "load" });
    await settle(page);
    assert.equal(await page.evaluate(() => location.hash), taskBookmark,
      "A bookmarked Task destination should retain its applicable query state.");
    assert.match(await page.$eval("body", (body) => body.innerText), /Approval routing/,
      "A bookmarked Task link should open the intended Task.");
    await assertProjectContext();

    const stageBookmark = "#/documents?stage=team";
    process.stdout.write("  Checking bookmarked destinations\n");
    await page.goto(`${baseUrl}/${stageBookmark}`, { waitUntil: "load" });
    await settle(page);
    assert.equal(await page.evaluate(() => location.hash), stageBookmark,
      "A Plan & Team stage bookmark should retain its query state.");
    await assertProjectContext();

    for (const bookmark of ["#/terminal?authoring=prd", "#/projects?bootstrap=1"]) {
      await page.goto(`${baseUrl}/${bookmark}`, { waitUntil: "load" });
      await settle(page);
      assert.equal(await page.evaluate(() => location.hash), bookmark,
        `The ${bookmark} bookmark should retain its destination and query state.`);
      await assertProjectContext();
    }

    process.stdout.write("  Checking retired destination fallback\n");
    await page.goto(`${baseUrl}/#/retired-diagnostics?task=EXP-2`, { waitUntil: "load" });
    await page.waitForFunction(() => location.hash === "#/overview", { timeout: 15000 });
    await page.waitForFunction(() => document.body.innerText.includes("retired-diagnostics"), { timeout: 10000 });
    assert.match(await page.$eval("body", (body) => body.innerText), /no longer available|retired/i,
      "A retired destination fallback should explain why it could not be opened.");
    assert.equal(await page.evaluate(() => location.hash), "#/overview",
      "A retired Project destination should route to Build status without selecting another Project.");
    await assertProjectContext();
  } finally {
    await page.close();
  }
}

export async function captureAll(browser: Browser, baseUrl: string, currentDir: string): Promise<string[]> {
  await assertBoardKeyboardContract(browser, baseUrl);
  await assertNavigationAcceptance(browser, baseUrl);
  await assertResponsiveShellAcceptance(browser, baseUrl);
  const names = await captureTargets(browser, baseUrl, currentDir, [...routeTargets(), ...detailTargets()]);
  names.push(...await captureProjectLifecycle(browser, baseUrl, currentDir));
  names.push(...await captureProjectBriefLifecycle(browser, baseUrl, currentDir));
  return names;
}

async function assertResponsiveShellAcceptance(browser: Browser, baseUrl: string): Promise<void> {
  const page = await openRoute(browser, baseUrl, "overview", { width: 1051, height: 900 });
  const destinations = [
    ["Project", [["Build status", "overview"], ["Board", "board"], ["Project brief", "project-brief"], ["Project files", "project-files"], ["Human review", "review-queue"]]],
    ["Advanced", [["All tasks", "tasks"], ["Logs", "logs"], ["Timeline", "timeline"], ["Terminal", "terminal"], ["Plan & Team", "documents"], ["Artifacts", "artifacts"], ["Settings", "settings"]]],
  ] as const;
  const layouts = [
    { name: "wide", width: 1051, menu: false },
    { name: "medium", width: 721, menu: false },
    { name: "narrow", width: 720, menu: true },
  ] as const;

  try {
    const selectedProject = await page.$eval('select[aria-label="Switch project"]', (select) => select.value);
    assert.ok(selectedProject, "The responsive-shell fixture should begin with a selected Project.");

    const assertProjectContext = async (layout: string): Promise<void> => {
      assert.equal(await page.$eval('select[aria-label="Switch project"]', (select) => select.value), selectedProject,
        `${layout} navigation must not switch the selected Project.`);
      assert.match(await page.$eval('header[aria-label="Project context"]', (header) => header.innerText), /ledgerly/i,
        `${layout} should keep the selected Project identity visible.`);
      assert.match(await page.$eval('header[aria-label="Project context"]', (header) => header.innerText), /\b(?:Live|Idle)\b/,
        `${layout} should keep the Project status visible.`);
      const switcherVisible = await page.$eval('select[aria-label="Switch project"]', (switcher) =>
        switcher.getClientRects().length > 0 && getComputedStyle(switcher).visibility !== "hidden");
      assert.equal(switcherVisible, true, `${layout} should keep the Project switcher discoverable.`);
    };

    const ensureMenuOpen = async (menu: boolean): Promise<void> => {
      if (!menu) return;
      const state = await page.$eval("body", (body) => {
        const button = Array.from(body.querySelectorAll<HTMLButtonElement>("button"))
          .find((element) => element.textContent?.trim() === "Menu");
        return button?.getAttribute("aria-expanded") ?? null;
      });
      if (state === null) throw new Error("Narrow screens should expose a labeled navigation menu.");
      if (state !== "true") {
        await page.$eval("body", (body) => {
          const button = Array.from(body.querySelectorAll<HTMLButtonElement>("button"))
            .find((element) => element.textContent?.trim() === "Menu");
          button?.click();
        });
        await page.waitForFunction(() => {
          const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
            .find((element) => element.textContent?.trim() === "Menu");
          return button?.getAttribute("aria-expanded") === "true";
        });
      }
    };

    const activateLink = async (label: string, route: string, menu: boolean): Promise<void> => {
      await ensureMenuOpen(menu);
      const visible = await page.$eval('nav[aria-label="Main"]', (nav, text) => {
        const link = Array.from(nav.querySelectorAll<HTMLAnchorElement>("a"))
          .find((element) => element.textContent?.trim() === text);
        if (!link || link.getClientRects().length === 0 || getComputedStyle(link).visibility === "hidden") return false;
        link.click();
        return true;
      }, label);
      assert.equal(visible, true, `${label} should be discoverable in the responsive navigation.`);
      await page.waitForFunction((expected) => location.hash.split("?")[0] === expected, { timeout: 10000 }, `#/${route}`);
      await settle(page);
    };

    for (const layout of layouts) {
      const activeRoute = await page.evaluate(() => location.hash);
      await page.setViewport({ width: layout.width, height: 900, deviceScaleFactor: 1 });
      await settle(page);
      assert.equal(await page.evaluate(() => location.hash), activeRoute,
        `Resizing to ${layout.name} should preserve the active destination.`);
      await assertProjectContext(layout.name);

      if (layout.menu) {
        const menuVisible = await page.$eval("body", (body) => {
          const button = Array.from(body.querySelectorAll<HTMLButtonElement>("button"))
            .find((element) => element.textContent?.trim() === "Menu");
          return Boolean(button && button.getClientRects().length && getComputedStyle(button).visibility !== "hidden");
        });
        assert.equal(menuVisible, true, "Narrow screens should expose a labeled navigation menu.");
        await ensureMenuOpen(true);
        await page.keyboard.press("Escape");
        const drawerClosed = await page.$eval("#nav-toggle", (button) =>
          button.getAttribute("aria-expanded") === "false" && document.activeElement === button);
        assert.equal(drawerClosed, true, "Escape should close the narrow navigation and return focus to Menu.");
      }

      for (const label of ["Home", "Projects"]) {
        await activateLink(label, label.toLowerCase(), layout.menu);
        await assertProjectContext(layout.name);
      }

      for (const [group, links] of destinations) {
        for (const [label, route] of links) {
          await ensureMenuOpen(layout.menu);
          const opened = await page.$eval('nav[aria-label="Main"]', (nav, name) => {
            const button = Array.from(nav.querySelectorAll<HTMLButtonElement>("button"))
              .find((element) => element.textContent?.trim().startsWith(name));
            if (!button || button.getClientRects().length === 0 || getComputedStyle(button).visibility === "hidden") return false;
            button.click();
            return true;
          }, group);
          assert.equal(opened, true, `${group} should remain discoverable on ${layout.name} screens.`);
          await activateLink(label, route, layout.menu);
          await assertProjectContext(layout.name);
        }
      }
    }

    for (const width of [1051, 1050, 721, 720]) {
      const route = await page.evaluate(() => location.hash);
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
      await settle(page);
      assert.equal(await page.evaluate(() => location.hash), route,
        `Resizing to ${width}px should preserve the active destination.`);
      await assertProjectContext(`${width}px`);
    }
    process.stdout.write("  Checking responsive navigation at 1051px, 721px, and 720px\n");
  } finally {
    await page.close();
  }
}

async function captureProjectLifecycle(browser: Browser, baseUrl: string, currentDir: string): Promise<string[]> {
  const page = await browser.newPage();
  const controlActions: string[] = [];
  let state = "new";
  let featureGenerated = false;
  const states: Array<{
    state: string;
    guide?: string;
    expected: string;
    screenshot?: string;
  }> = [
    { state: "new", expected: "Author PRD (interactive)" },
    { state: "partially-authored", guide: "brief", expected: "Author the Project brief" },
    { state: "needs-review", guide: "review", expected: "Review your Project brief" },
    { state: "preparing", guide: "preparing", expected: "Preparing your Build", screenshot: "project-state-preparing-1440" },
    { state: "ready-to-start", guide: "ready", expected: "Start build", screenshot: "project-state-ready-to-start-1440" },
    { state: "running", expected: "Build is running.", screenshot: "project-state-running-1440" },
    { state: "blocked", expected: "Action blocking progress", screenshot: "project-state-blocked-1440" },
    { state: "failed", expected: "Build execution failed", screenshot: "project-state-failed-1440" },
    { state: "completed", expected: "Project files", screenshot: "project-state-completed-1440" },
  ];
  page.setDefaultTimeout(20000);
  await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);

  try {
    await page.goto(`${baseUrl}/#/home`, { waitUntil: "load" });
    await settle(page);
    const fixture = await page.evaluate(async () => {
      const [summaryResponse, tasksResponse, manifestResponse] = await Promise.all([
        fetch("/api/summary"),
        fetch("/api/tasks"),
        fetch("/api/manifest"),
      ]);
      return {
        summary: await summaryResponse.json() as Record<string, unknown> | null,
        tasks: await tasksResponse.json() as unknown,
        manifest: await manifestResponse.json() as Record<string, unknown> | null,
      };
    });
    const fixtureSummary = fixture.summary;
    if (!fixtureSummary || typeof fixtureSummary.repoRoot !== "string" || !fixtureSummary.repoRoot) {
      throw new Error("The Project lifecycle acceptance fixture has no selected Project.");
    }
    const repoRoot = fixtureSummary.repoRoot;
    const fixtureTasks = Array.isArray(fixture.tasks) ? fixture.tasks as Array<Record<string, unknown>> : [];
    const featureTask: Record<string, unknown> = {
      id: "9.1",
      title: "Export the audit trail",
      description: "Add an export path for the Project audit trail.",
      phaseId: "feature",
      phaseTitle: "Feature additions",
      ownerAgent: "Engineer",
      effectiveModel: null,
      effectiveFallbackModel: null,
      status: "pending",
      attempt: 0,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      outputFiles: [],
      errorMessage: null,
      artifactId: null,
      inputs: [],
      produces: null,
      dependencies: [],
      expectedOutputs: ["docs/engine-run.log"],
      validationCommands: [],
      timeoutMs: null,
      approvalRequired: false,
      usage: null,
      requirements: ["FR-9.1"],
      acceptanceCriteria: ["A user can download the Project audit trail."],
      constraints: [],
      references: [],
      validationGaps: [],
    };
    const featureManifest = fixture.manifest
      ? {
        ...fixture.manifest,
        generatedAt: "2026-03-01T00:00:00.000Z",
        reconciliation: {
          previousGeneratedAt: "2026-02-28T00:00:00.000Z",
          preservedTaskIds: [],
          newTaskIds: ["9.1"],
          removedTaskIds: [],
          changedTaskIds: [],
        },
      }
      : null;
    const baseManifestSummary = fixtureSummary.manifest && typeof fixtureSummary.manifest === "object"
      ? fixtureSummary.manifest as Record<string, unknown>
      : { version: "1.0", generatedAt: "2026-02-28T00:00:00.000Z", phases: 3, tasks: 8 };
    const unrelatedManifestUpdate = {
      ...baseManifestSummary,
      reconciliation: {
        previousGeneratedAt: "2026-02-27T00:00:00.000Z",
        preservedTaskIds: [],
        newTaskIds: ["8.1"],
        removedTaskIds: [],
        changedTaskIds: [],
      },
    };

    await page.evaluate((root) => {
      localStorage.removeItem(`forge-console:guided-authoring:${root}`);
    }, repoRoot);
    await page.setRequestInterception(true);
    const respond = (request: HTTPRequest, body: unknown, status = 200): void => {
      void request.respond({ status, contentType: "application/json", body: JSON.stringify(body) }).catch(() => {});
    };
    const waitForButton = async (label: string): Promise<void> => {
      await page.waitForFunction((text) => Array.from(document.querySelectorAll("button"))
        .some((button) => button.textContent?.trim() === text), { timeout: 15000 }, label);
    };
    const runSummary = (runState: string, blockers: string[] = []): Record<string, unknown> => {
      const source = fixtureSummary.run && typeof fixtureSummary.run === "object"
        ? fixtureSummary.run as Record<string, unknown>
        : {};
      return {
        ...source,
        runId: "capture-run",
        status: runState,
        startedAt: "2026-02-28T00:00:00.000Z",
        lastUpdatedAt: "2026-03-01T00:00:00.000Z",
        completedDurationMs: 120000,
        currentPhase: "build",
        currentPhaseTitle: "Build execution",
        counts: { pending: 2, running: runState === "running" ? 1 : 0, complete: 3, failed: runState === "failed" ? 1 : 0, skipped: 0 },
        total: 6,
        blockers,
        usage: source.usage ?? {
          inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
          reasoningTokens: 0, costUsd: 0, credits: 0, tasksWithUsage: 0, tasksTotal: 0,
        },
      };
    };
    const summaryForState = (): Record<string, unknown> => {
      const current = state as typeof states[number]["state"] | "unavailable";
      const hasIdea = current !== "new";
      const hasPrd = ["needs-review", "preparing", "ready-to-start", "running", "blocked", "failed", "completed"].includes(current);
      const hasTeam = ["ready-to-start", "running", "blocked", "failed", "completed"].includes(current);
      const hasManifest = ["ready-to-start", "running", "blocked", "failed", "completed"].includes(current);
      const run = current === "running"
        ? runSummary("running", ["Review Task 2.2's access policy while the other Tasks continue."])
        : current === "blocked"
          ? runSummary("paused", ["Approve Task 2.2's access policy before resuming the Build."])
          : current === "failed"
            ? runSummary("failed")
            : current === "completed" ? runSummary("complete") : null;
      const job = current === "preparing"
        ? { id: "capture-preparation", type: "rederive", repoPath: repoRoot, startedAt: "2026-03-01T00:00:00.000Z", updatedAt: "2026-03-01T00:00:01.000Z", status: "running", message: "Preparing the Project." }
        : current === "failed"
          ? { id: "capture-build", type: "engine-run", repoPath: repoRoot, startedAt: "2026-02-28T00:00:00.000Z", updatedAt: "2026-03-01T00:00:00.000Z", status: "failed", message: "Task 2.2 failed during Build execution: its required dependency is unavailable." }
          : null;
      const base = {
        ...fixtureSummary,
        repoName: "Ledgerly",
        hasIdea,
        hasPrd,
        hasVision: false,
        hasFeatures: true,
        hasTeam,
        hasManifest,
        manifest: hasManifest
          ? featureGenerated
            ? featureManifest
            : current === "completed"
              ? unrelatedManifestUpdate
              : fixtureSummary.manifest
          : null,
        run,
        live: current === "running",
        control: null,
        job,
        authoringReady: true,
        authoringBlocker: null,
        authoringStages: [],
        rederive: current === "preparing"
          ? {
            runId: "capture-preparation", active: true, currentStep: "team", failedStep: null, complete: false,
            steps: [
              { id: "team", label: "Team", status: "running" },
              { id: "skills", label: "Project skills", status: "pending" },
              { id: "manifest", label: "Build plan", status: "pending" },
            ],
          }
          : current === "ready-to-start"
            ? {
              runId: "capture-preparation", active: false, currentStep: null, failedStep: null, complete: true,
              steps: [
                { id: "team", label: "Team", status: "complete" },
                { id: "skills", label: "Project skills", status: "complete" },
                { id: "manifest", label: "Build plan", status: "complete" },
              ],
            }
            : null,
      };
      return base;
    };

    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/events") {
        const snapshot = {
          summary: summaryForState(),
          manifest: fixture.manifest,
          state: null,
          layout: null,
        };
        void request.respond({
          status: 200,
          contentType: "text/event-stream",
          headers: { "Cache-Control": "no-cache", Connection: "keep-alive" },
          body: `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`,
        }).catch(() => {});
        return;
      }
      if (url.pathname === "/api/projects") {
        respond(request, {
          projects: [{
            path: repoRoot,
            name: "Ledgerly",
            stage: state,
            lifecycleState: state,
            lastOpenedAt: "2026-03-01T00:00:00.000Z",
          }],
          current: null,
        });
        return;
      }
      if (request.method() === "POST" && url.pathname === "/api/projects/select") {
        respond(request, state === "unavailable"
          ? { ok: false, message: "The saved Project location is unavailable." }
          : { ok: true, repoRoot });
        return;
      }
      if (url.pathname === "/api/summary") {
        respond(request, summaryForState());
        return;
      }
      if (url.pathname === "/api/actions") {
        respond(request, {
          canRun: ["ready-to-start", "completed"].includes(state) || (state === "completed" && featureGenerated),
          canResume: ["running", "blocked", "failed"].includes(state),
          canPause: state === "running",
          canStop: state === "running",
          failedTasks: state === "failed" ? ["2.2"] : [],
        });
        return;
      }
      if (url.pathname === "/api/tasks") {
        respond(request, featureGenerated
          ? [...fixtureTasks, featureTask]
          : fixtureTasks);
        return;
      }
      if (url.pathname === "/api/manifest") {
        respond(request, fixture.manifest);
        return;
      }
      if (url.pathname === "/api/jobs") {
        respond(request, { jobs: [], active: 0, failed: 0 });
        return;
      }
      if (request.method() === "POST" && url.pathname === "/api/control") {
        const action = (JSON.parse(request.postData() ?? "{}") as { action?: string }).action ?? "";
        controlActions.push(action);
        if (action === "feature-increment-continue") {
          featureGenerated = true;
          respond(request, { ok: true, message: "Feature Tasks are ready for review." });
          return;
        }
        if (action === "run" && state === "completed" && featureGenerated) {
          state = "running";
          respond(request, {
            ok: true,
            message: "Build started.",
            job: {
              id: "capture-build", type: "engine-run", repoPath: repoRoot,
              startedAt: "2026-03-01T00:00:00.000Z", updatedAt: "2026-03-01T00:00:00.000Z",
              status: "running", message: "Build started.",
            },
          });
          return;
        }
        respond(request, { ok: false, message: `Unexpected control action: ${action}` });
        return;
      }
      void request.continue().catch(() => {});
    });

    await page.reload({ waitUntil: "load" });
    await settle(page);
    for (const entry of states) {
      state = entry.state;
      featureGenerated = false;
      process.stdout.write(`  Checking Project state: ${entry.state}\n`);
      await page.evaluate(({ root, step }) => {
        if (step) localStorage.setItem(`forge-console:guided-authoring:${root}`, step);
        else localStorage.removeItem(`forge-console:guided-authoring:${root}`);
        location.hash = "#/projects";
      }, { root: repoRoot, step: entry.guide });
      await page.waitForSelector('button[aria-label="Open Ledgerly"]', { timeout: 15000 });
      await page.click('button[aria-label="Open Ledgerly"]');
      if (entry.state === "completed") {
        await page.waitForFunction(() => location.hash.startsWith("#/project-files"), { timeout: 15000 });
      } else {
        await page.waitForFunction(() => location.hash.startsWith("#/overview"), { timeout: 15000 });
      }
      try {
        await page.waitForFunction((text) => document.querySelector("#view")?.textContent?.includes(text) ?? false, { timeout: 20000 }, entry.expected);
      } catch {
        const detail = await page.evaluate(() => ({
          hash: location.hash,
          text: document.querySelector("#view")?.textContent?.trim().slice(0, 1200) ?? "",
        }));
        throw new Error(`Project state "${entry.state}" did not show "${entry.expected}" at ${detail.hash}. View text: ${detail.text}`);
      }
      const stateText = await page.$eval("#view", (view) => view.textContent ?? "");
      if (entry.state === "running"
        && (!stateText.includes("Review Task 2.2's access policy while the other Tasks continue.")
          || !stateText.includes("The Project remains Running while work can continue."))) {
        throw new Error("A Running Project must retain its state while showing the exact action needed to unblock remaining work.");
      }
      if (entry.state === "blocked"
        && (!stateText.includes("Approve Task 2.2's access policy before resuming the Build.")
          || !stateText.includes("Completed Tasks and Project history are preserved.")
          || !stateText.includes("Resume after resolving the blocker"))) {
        throw new Error("A blocked Project must name the required action and confirm its completed history is preserved.");
      }
      if (entry.state === "failed"
        && (!stateText.includes("Build execution failed")
          || !stateText.includes("Task 2.2 failed during Build execution")
          || !stateText.includes("Completed work and Project history are preserved.")
          || !stateText.includes("Resume Build"))) {
        throw new Error("A failed Project must name its failed stage, explain the failure, and preserve completed work and history.");
      }
      if (entry.screenshot) {
        await expandToContent(page, { width: 1440, height: 1100 });
        await page.screenshot({ path: join(currentDir, `${entry.screenshot}.png`), type: "png" });
      }
    }
    if (controlActions.length > 0) {
      throw new Error(`Opening or routing Projects must not change execution state; observed control actions: ${controlActions.join(", ")}.`);
    }

    state = "unavailable";
    await page.evaluate(() => { location.hash = "#/projects"; });
    await page.waitForSelector('button[aria-label="Reconnect Ledgerly"]', { timeout: 15000 });
    await page.click('button[aria-label="Reconnect Ledgerly"]');
    await page.waitForFunction(() => document.querySelector("#view")?.textContent?.includes("history remains on record") ?? false, { timeout: 15000 });
    await page.waitForFunction(() => location.hash.startsWith("#/projects"), { timeout: 10000 });
    if (!(await page.$('button[aria-label="Reconnect Ledgerly"]'))) {
      throw new Error("An unavailable Project must remain in the Projects list after a failed reconnect.");
    }
    await expandToContent(page, { width: 1440, height: 1100 });
    await page.screenshot({ path: join(currentDir, "project-state-unavailable-1440.png"), type: "png" });

    state = "completed";
    featureGenerated = false;
    await page.evaluate((root) => {
      localStorage.removeItem(`forge-console:guided-authoring:${root}`);
      location.hash = "#/overview";
    }, repoRoot);
    await page.waitForSelector('textarea[aria-label="Feature description"]', { timeout: 15000 });
    await page.waitForFunction(() => document.querySelector("#view")?.textContent?.includes("Add a feature") ?? false);
    await waitForButton("Author feature PRD (interactive)");
    if (await page.$(".feature-task-review-gate")) {
      throw new Error("An unrelated manifest update must not trigger the Add a feature review gate.");
    }
    await page.$eval('textarea[aria-label="Feature description"]', (node) => {
      const input = node as HTMLTextAreaElement;
      input.value = "Add an export for the Project audit trail";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clickByText(page, "button", "Author feature PRD (interactive)");
    await page.waitForFunction(() => location.hash.includes("authoring=feature-prd") && location.hash.includes("prompt="), { timeout: 10000 });
    await settle(page);
    await page.evaluate(() => { location.hash = "#/overview"; });
    await waitForButton("Continue after authoring");
    const continueRequest = page.waitForRequest((request) => {
      if (request.method() !== "POST" || new URL(request.url()).pathname !== "/api/control") return false;
      return (JSON.parse(request.postData() ?? "{}") as { action?: string }).action === "feature-increment-continue";
    }, { timeout: 10000 });
    await clickByText(page, "button", "Continue after authoring");
    await continueRequest;
    await page.reload({ waitUntil: "load" });
    await settle(page);
    await page.waitForSelector('a[href="#/tasks?feature-review=1"]', { timeout: 15000 });
    const prematureExecution = controlActions.filter((action) => ["run", "resume", "replay"].includes(action));
    if (prematureExecution.length > 0) {
      throw new Error(`Feature Tasks must not execute before review; observed: ${prematureExecution.join(", ")}.`);
    }
    const gate = await page.$eval(".feature-task-review-gate", (node) => node.textContent ?? "").catch(() => "");
    if (!gate.includes("Review generated Tasks before execution")) {
      throw new Error("New feature Tasks must gate execution until they are reviewed.");
    }
    const continueDisabled = await page.$$eval("#view button", (buttons) =>
      buttons.some((button) => button.textContent?.trim() === "Continue after authoring" && button.disabled));
    if (!continueDisabled) {
      throw new Error("Another feature increment must wait until the current generated Tasks are reviewed.");
    }
    state = "failed";
    await page.reload({ waitUntil: "load" });
    await settle(page);
    await page.waitForSelector(".feature-task-review-gate", { timeout: 15000 });
    const failedFeatureView = await page.$eval("#view", (view) => view.textContent ?? "");
    const failedFeatureButtons = await page.$$eval("#view button", (buttons) => buttons.map((button) => button.textContent?.trim()));
    if (!failedFeatureView.includes("Review generated Tasks")
      || failedFeatureButtons.includes("Resume Build")) {
      throw new Error("A failed Build must keep Resume gated until the generated feature Tasks are reviewed.");
    }
    state = "completed";
    await page.reload({ waitUntil: "load" });
    await settle(page);
    await page.waitForSelector(".feature-task-review-gate", { timeout: 15000 });

    await page.click('a[href="#/tasks?feature-review=1"]');
    await page.waitForSelector(".feature-task-review", { timeout: 15000 });
    await page.waitForFunction(() => document.querySelector(".feature-task-review")?.textContent?.includes("A user can download the Project audit trail.") ?? false);
    await page.evaluate(() => { location.hash = "#/tasks"; });
    await page.waitForSelector(".feature-task-review", { timeout: 15000 });
    await page.click('input[aria-label="Select task 9.1"]');
    const selectionControls = await page.$$eval("#view button", (buttons) =>
      buttons.filter((button) => ["Run selected", "Resume selected"].includes(button.textContent?.trim() ?? ""))
        .map((button) => ({ label: button.textContent?.trim(), disabled: button.disabled })));
    if (selectionControls.length !== 2 || selectionControls.some((button) => !button.disabled)) {
      throw new Error("Run selected and Resume selected must stay disabled until generated Tasks are reviewed.");
    }
    const executionActionsBefore = controlActions.filter((action) => ["run", "resume", "replay"].includes(action)).length;
    await page.$$eval("#view button", (buttons) => {
      for (const button of buttons) {
        if (["Run selected", "Resume selected"].includes(button.textContent?.trim() ?? "")) button.disabled = false;
      }
    });
    await clickByText(page, "button", "Run selected");
    await clickByText(page, "button", "Resume selected");
    await settle(page);
    if (controlActions.filter((action) => ["run", "resume", "replay"].includes(action)).length !== executionActionsBefore) {
      throw new Error("Task selection handlers must refuse Run and Resume until generated Tasks are reviewed.");
    }
    await page.$$eval("#view button", (buttons) => {
      for (const button of buttons) {
        if (["Run selected", "Resume selected"].includes(button.textContent?.trim() ?? "")) button.disabled = true;
      }
    });
    await expandToContent(page, { width: 1440, height: 1100 });
    await page.screenshot({ path: join(currentDir, "feature-task-review-1440.png"), type: "png" });
    await clickByText(page, "button", "I reviewed these Tasks");
    await page.waitForFunction(() => location.hash.startsWith("#/overview"), { timeout: 10000 });
    await page.waitForFunction(() => {
      const button = document.querySelector<HTMLButtonElement>('[data-overview-region="overview-actions"] button.btn-primary');
      return button?.textContent?.trim() === "Run" && !button.disabled;
    }, { timeout: 15000 });
    if (controlActions.some((action) => ["run", "resume", "replay"].includes(action))) {
      throw new Error("Reviewing generated Tasks must not itself start or resume execution.");
    }
    const runRequest = page.waitForRequest((request) => {
      if (request.method() !== "POST" || new URL(request.url()).pathname !== "/api/control") return false;
      return (JSON.parse(request.postData() ?? "{}") as { action?: string }).action === "run";
    }, { timeout: 10000 });
    await page.click('[data-overview-region="overview-actions"] button.btn-primary');
    await runRequest;
    if (controlActions.filter((action) => ["run", "resume", "replay"].includes(action)).join("|") !== "run") {
      throw new Error(`Only explicit Run after review may start execution; observed: ${controlActions.join(", ")}`);
    }

    return [
      ...states.map((entry) => entry.screenshot).filter((name): name is string => Boolean(name)),
      "project-state-unavailable-1440",
      "feature-task-review-1440",
    ];
  } finally {
    await page.close();
  }
}

async function captureProjectBriefLifecycle(browser: Browser, baseUrl: string, currentDir: string): Promise<string[]> {
  const page = await browser.newPage();
  const controlActions: string[] = [];
  const savedBriefs: string[] = [];
  const savedBriefProjects: unknown[] = [];
  let phase: "review" | "preparing" | "ready" | "started" = "review";
  page.setDefaultTimeout(20000);
  await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);

  try {
    await page.goto(`${baseUrl}/#/home`, { waitUntil: "load" });
    await settle(page);
    const fixtureSummary = await page.evaluate(async () => {
      const response = await fetch("/api/summary");
      return response.json() as Promise<Record<string, unknown> | null>;
    });
    if (!fixtureSummary || typeof fixtureSummary.repoRoot !== "string") {
      throw new Error("The Project brief acceptance fixture has no selected Project.");
    }
    const repoRoot = fixtureSummary.repoRoot;
    if (!repoRoot) throw new Error("The Project brief acceptance fixture has no selected Project.");
    await page.evaluate((root) => {
      localStorage.setItem(`forge-console:guided-authoring:${root}`, "review");
    }, repoRoot);
    await page.setRequestInterception(true);

    const respond = (request: HTTPRequest, body: unknown): void => {
      void request.respond({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      }).catch(() => {});
    };
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/summary") {
        const ready = phase === "ready" || phase === "started";
        const preparing = phase === "preparing";
        const progress = preparing
          ? {
            runId: "capture-preparation",
            active: true,
            currentStep: "team",
            failedStep: null,
            complete: false,
            steps: [
              { id: "team", label: "Team", status: "running" },
              { id: "skills", label: "Project skills", status: "pending" },
              { id: "manifest", label: "Build plan", status: "pending" },
            ],
          }
          : ready
            ? {
              runId: "capture-preparation",
              active: false,
              currentStep: null,
              failedStep: null,
              complete: true,
              steps: [
                { id: "team", label: "Team", status: "complete" },
                { id: "skills", label: "Project skills", status: "complete" },
                { id: "manifest", label: "Build plan", status: "complete" },
              ],
            }
            : null;
        const job = preparing || phase === "ready"
          ? {
            id: "capture-rederive",
            type: "rederive",
            repoPath: repoRoot,
            startedAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
            status: preparing ? "running" : "complete",
            message: preparing ? "Preparing the Project." : "Preparation complete.",
          }
          : phase === "started"
            ? {
              id: "capture-build",
              type: "engine-run",
              repoPath: repoRoot,
              startedAt: "2026-01-01T00:00:02.000Z",
              updatedAt: "2026-01-01T00:00:02.000Z",
              status: "running",
              message: "Build started.",
            }
            : null;
        respond(request, {
          ...fixtureSummary,
          hasIdea: true,
          hasPrd: true,
          hasTeam: ready,
          hasManifest: ready,
          manifest: ready ? fixtureSummary.manifest : null,
          run: phase === "started" ? fixtureSummary.run : null,
          live: phase === "started",
          job,
          authoringReady: true,
          authoringBlocker: null,
          authoringStages: [],
          rederive: progress,
        });
        return;
      }
      if (request.method() === "POST" && url.pathname === "/api/project-brief") {
        const body = JSON.parse(request.postData() ?? "{}") as { repoRoot?: unknown; content?: unknown };
        savedBriefProjects.push(body.repoRoot);
        const content = body.content;
        if (typeof content === "string") savedBriefs.push(content);
        respond(request, { ok: true, message: "Project brief saved." });
        return;
      }
      if (request.method() === "POST" && url.pathname === "/api/authoring/validate") {
        respond(request, { ok: true, message: "Project brief validated." });
        return;
      }
      if (request.method() === "POST" && url.pathname === "/api/control") {
        const action = (JSON.parse(request.postData() ?? "{}") as { action?: string }).action ?? "";
        controlActions.push(action);
        if (action === "rederive") {
          phase = "preparing";
          setTimeout(() => {
            if (phase === "preparing") phase = "ready";
          }, 1200);
          respond(request, {
            ok: true,
            message: "Preparation started.",
            job: {
              id: "capture-rederive",
              type: "rederive",
              repoPath: repoRoot,
              startedAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:01.000Z",
              status: "running",
              message: "Preparing the Project.",
            },
          });
          return;
        }
        if (action === "run") {
          phase = "started";
          respond(request, {
            ok: true,
            message: "Build started.",
            job: {
              id: "capture-build",
              type: "engine-run",
              repoPath: repoRoot,
              startedAt: "2026-01-01T00:00:02.000Z",
              updatedAt: "2026-01-01T00:00:02.000Z",
              status: "running",
              message: "Build started.",
            },
          });
          return;
        }
        respond(request, { ok: false, message: `Unexpected control action: ${action}` });
        return;
      }
      void request.continue().catch(() => {});
    });

    await page.evaluate(() => { location.hash = "#/overview"; });
    await page.waitForFunction(() => {
      const editor = document.querySelector<HTMLTextAreaElement>("#project-brief-editor");
      return editor !== null && !editor.disabled && editor.value.length > 0;
    }, { timeout: 15000 });
    const earlyButtons = await page.$$eval("button", (buttons) => buttons.map((button) => button.textContent?.trim() ?? ""));
    if (earlyButtons.includes("Start build") || earlyButtons.includes("Run")) {
      throw new Error("Build execution was offered before the Project brief was approved and prepared.");
    }

    await expandToContent(page, WIDE);
    await page.screenshot({ path: join(currentDir, "project-brief-review-1440.png"), type: "png" });
    await clickByText(page, "button", "Approve");
    await page.waitForSelector(".project-preparation", { timeout: 15000 });
    await expandToContent(page, WIDE);
    await page.screenshot({ path: join(currentDir, "project-preparing-1440.png"), type: "png" });
    await page.waitForFunction(() => document.querySelector(".project-prepared-plan") !== null, { timeout: 15000 });

    if (controlActions.join("|") !== "rederive") {
      throw new Error(`Approving the Project brief must only prepare the plan; observed actions: ${controlActions.join(", ") || "none"}.`);
    }
    const preparedButtons = await page.$$eval("button", (buttons) => buttons.map((button) => button.textContent?.trim() ?? ""));
    if (!preparedButtons.includes("Start build") || preparedButtons.includes("Run")) {
      throw new Error("A prepared Project must present Start build explicitly without exposing a generic Run action.");
    }
    await expandToContent(page, WIDE);
    await page.screenshot({ path: join(currentDir, "prepared-plan-1440.png"), type: "png" });
    await clickByText(page, "button", "Start build");
    if (controlActions.join("|") !== "rederive|run") {
      throw new Error(`Start build must be the first action that runs execution; observed actions: ${controlActions.join(", ")}.`);
    }

    phase = "review";
    await page.evaluate((root) => {
      localStorage.setItem(`forge-console:guided-authoring:${root}`, "review");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }, repoRoot);
    await page.waitForFunction(() => {
      const editor = document.querySelector<HTMLTextAreaElement>("#project-brief-editor");
      return editor !== null && !editor.disabled;
    }, { timeout: 15000 });
    const requestedBrief = "# Revised after review\n\n## Assumptions\n- Keep the original outcome.";
    await page.evaluate((content) => {
      const editor = document.querySelector<HTMLTextAreaElement>("#project-brief-editor");
      if (!editor) throw new Error("The editable brief is missing.");
      editor.value = content;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }, requestedBrief);
    await clickByText(page, "button", "Request changes");
    await page.waitForFunction(() => location.hash.includes("#/terminal?authoring=prd"), { timeout: 15000 });
    const savedStep = await page.evaluate((root) => localStorage.getItem(`forge-console:guided-authoring:${root}`), repoRoot);
    if (savedStep !== "brief" || !savedBriefs.includes(requestedBrief)) {
      throw new Error("Request changes must save the edited Project brief and return to interactive authoring.");
    }
    if (savedBriefProjects.length !== 2 || savedBriefProjects.some((project) => project !== repoRoot)) {
      throw new Error("Project brief saves must be bound to the reviewed Project.");
    }
    if (controlActions.join("|") !== "rederive|run") {
      throw new Error(`Request changes must not launch Build execution; observed actions: ${controlActions.join(", ")}.`);
    }
    return ["project-brief-review-1440", "project-preparing-1440", "prepared-plan-1440"];
  } finally {
    await page.close();
  }
}

export async function captureBoard(browser: Browser, baseUrl: string, currentDir: string): Promise<string[]> {
  await assertBoardKeyboardContract(browser, baseUrl);
  await assertNarrowKanbanKeepsPhaseLabelsVisible(browser, baseUrl);
  await assertKanbanContextSurvivesResponsiveChanges(browser, baseUrl);
  await assertBoardKeepsIndependentViewPositions(browser, baseUrl);
  await assertNarrowGanttKeepsTaskLabelsVisible(browser, baseUrl);
  const targets = [
    ...routeTargets().filter((target) => target.route === "board"),
    ...detailTargets().filter((target) => target.name.startsWith("board-")),
  ];
  return captureTargets(browser, baseUrl, currentDir, targets);
}

/** The walkthrough GIF frames: a short scripted tour. */
export async function captureGifFrames(browser: Browser, baseUrl: string, framesDir: string): Promise<void> {
  mkdirSync(framesDir, { recursive: true });
  const viewport: Viewport = { width: 1280, height: 800 };

  const frames: Array<{ route: string; scroll?: number; prepare?: (page: Awaited<ReturnType<Browser["newPage"]>>) => Promise<void> }> = [
    { route: "home" },
    { route: "overview" },
    { route: "overview", scroll: 0.35 },
    { route: "overview", scroll: 0.7 },
    { route: "board" },
    { route: "tasks" },
    { route: "logs" },
    { route: "settings" },
    { route: "overview", prepare: async (page) => { await openNavMenu(page, "Monitor"); } },
    { route: "artifacts" },
  ];

  let index = 0;
  for (const frame of frames) {
    const page = await openRoute(browser, baseUrl, frame.route, viewport);
    try {
      if (frame.route === "board") await waitForBoard(page);
      if (frame.scroll !== undefined) {
        await page.evaluate((ratio) => {
          const shell = document.querySelector<HTMLElement>("#view") ?? document.scrollingElement;
          if (shell) shell.scrollTop = shell.scrollHeight * ratio;
        }, frame.scroll);
      }
      await settle(page);
      await page.screenshot({ path: join(framesDir, `frame-${String(index).padStart(3, "0")}.png`), type: "png", fullPage: false });
      index += 1;
    } finally {
      await page.close();
    }
  }
}
