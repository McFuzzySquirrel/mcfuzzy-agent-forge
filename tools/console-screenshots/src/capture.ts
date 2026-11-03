import { mkdirSync } from "node:fs";
import { join } from "node:path";

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

const ROUTES = ["home", "overview", "board", "tasks", "logs", "documents", "artifacts", "timeline", "projects", "new", "settings"] as const;
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
      name: "board-detail-1440",
      route: "board",
      viewport: WIDE,
      prepare: async (page) => { await openBoardDetails(page); },
    },
    {
      name: "nav-menu-1440",
      route: "overview",
      viewport: WIDE,
      prepare: async (page) => { await openNavMenu(page, "Monitor"); },
    },
  ];
}

/** Opens a top-nav category flyout by clicking its button. */
async function openNavMenu(page: Awaited<ReturnType<Browser["newPage"]>>, label: string): Promise<void> {
  await page.evaluate((name) => {
    const button = Array.from(document.querySelectorAll<HTMLElement>(".nav-category-btn"))
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

export async function captureAll(browser: Browser, baseUrl: string, currentDir: string): Promise<string[]> {
  const names = await captureTargets(browser, baseUrl, currentDir, [...routeTargets(), ...detailTargets()]);
  names.push(...await captureProjectBriefLifecycle(browser, baseUrl, currentDir));
  return names;
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
