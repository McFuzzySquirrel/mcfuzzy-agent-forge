import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { Browser } from "puppeteer-core";
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

const ROUTES = ["home", "overview", "board", "tasks", "logs", "documents", "artifacts", "timeline", "projects", "new"] as const;
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
      targets.push({ name: `${route}-${label}`, route, viewport, fullPage: route === "overview" });
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
  ];
}

async function waitForBoard(page: Awaited<ReturnType<Browser["newPage"]>>): Promise<void> {
  const frame = page.frames().find((candidate) => candidate.url().endsWith("/board"));
  if (frame) await frame.waitForSelector("canvas", { timeout: 8000 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 1200));
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

export async function captureAll(browser: Browser, baseUrl: string, currentDir: string): Promise<string[]> {
  mkdirSync(currentDir, { recursive: true });
  const written: string[] = [];
  for (const target of [...routeTargets(), ...detailTargets()]) {
    const page = await openRoute(browser, baseUrl, target.route, target.viewport);
    try {
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
