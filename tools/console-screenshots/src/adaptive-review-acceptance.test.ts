import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { Browser, Page } from "puppeteer-core";
import { startConsoleServer, type ConsoleServer } from "../../../scripts/forge-launcher/scripts/console/server.ts";
import type { Fixture } from "./fixture.ts";
import { buildFixture } from "./fixture.ts";
import { clickByText, launchBrowser, settle } from "./chrome.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const WORK_ROOT = join(REPO_ROOT, ".scratch", "adaptive-console-redesign", "review-acceptance-work");
const VIEWPORT = { width: 1440, height: 1000 };
let nextPort = 48100;

async function createFixture(name: string): Promise<Fixture> {
  const workspace = join(WORK_ROOT, name);
  const repoRoot = join(workspace, "project");
  const homeDir = join(workspace, "home");
  return buildFixture(repoRoot, homeDir);
}

async function startBrowserConsole(
  fixture: Fixture,
  options: { allowExternalOpen?: boolean; launchCli?: (cli: string, dir: string, args: string[]) => Promise<boolean> } = {},
): Promise<{ server: ConsoleServer; browser: Browser; page: Page }> {
  process.env.FORGE_HOME = fixture.homeDir;
  const server = await startConsoleServer({
    repoRoot: fixture.repoRoot,
    port: nextPort++,
    open: false,
    allowExternalOpen: options.allowExternalOpen,
    launchCli: options.launchCli,
    inventoryProbe: async () => ({ code: 0, stdout: "opencode/qwen3-coder", stderr: "" }),
  });
  const browser = await launchBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  await page.setViewport({ ...VIEWPORT, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.goto(`${server.url}/#/home`, { waitUntil: "load" });
  await settle(page);
  return { server, browser, page };
}

async function click(page: Page, selector: string, text: string): Promise<void> {
  assert.equal(await clickByText(page, selector, text), true, `Expected to find ${text}.`);
}

async function beginExternalAuthoring(page: Page, target: "idea" | "prd"): Promise<void> {
  await click(page, "button", target === "idea" ? "Explore your idea" : "Author the Project brief");
  await page.waitForFunction((value) => location.hash.includes(`authoring=${value}`), { timeout: 10000 }, target);
  await click(page, "button", "Open in external terminal");
  await page.waitForFunction(() => {
    const status = document.querySelector<HTMLElement>(".terminal-controls + [role='status']");
    return status?.textContent !== "No terminal session running.";
  }, { timeout: 10000 });
  const status = await page.$eval(".terminal-controls + [role='status']", (node) => node.textContent ?? "");
  assert.match(status, /interactive (idea|prd) authoring/, `The external authoring session did not start: ${status}`);
}

async function returnToProjectGuide(page: Page): Promise<void> {
  await click(page, "a", "Return to Project guide");
  await page.waitForFunction(() => location.hash === "#/overview", { timeout: 10000 });
}

test("external authoring advances the Project guide only after its document is written", async () => {
  const fixture = await createFixture("external-authoring");
  const previousHome = process.env.FORGE_HOME;
  let server: ConsoleServer | undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  try {
    rmSync(join(fixture.repoRoot, "docs", "PRD.md"), { force: true });
    rmSync(join(fixture.repoRoot, "docs", "features"), { recursive: true, force: true });
    rmSync(join(fixture.repoRoot, "docs", "EXECUTION-MANIFEST.json"), { force: true });
    rmSync(join(fixture.repoRoot, "docs", "WORKFLOW-STATE.json"), { force: true });
    rmSync(join(fixture.repoRoot, "docs", "authoring-state.json"), { force: true });
    rmSync(join(fixture.repoRoot, ".agents", "agents"), { recursive: true, force: true });
    writeFileSync(join(fixture.repoRoot, "docs", "authoring-config.json"), JSON.stringify({
      version: 1,
      models: {},
      runner: "opencode",
    }));
    mkdirSync(join(fixture.repoRoot, "docs", "research"), { recursive: true });
    const verifiedAt = new Date().toISOString();
    writeFileSync(join(fixture.repoRoot, "docs", "research", "model-inventory.json"), JSON.stringify({
      last_verified: verifiedAt,
      opencode_cli: {
        last_verified: verifiedAt,
        models: [{ id: "opencode/qwen3-coder" }],
      },
    }));

    const launches: string[] = [];
    ({ server, browser, page } = await startBrowserConsole(fixture, {
      allowExternalOpen: true,
      launchCli: async (cli, _dir, args) => {
        launches.push(`${cli} ${args.join(" ")}`);
        return true;
      },
    }));
    await page.evaluate((repoRoot) => {
      localStorage.setItem(`forge-console:guided-authoring:${repoRoot}`, "idea");
      location.hash = "#/overview";
    }, fixture.repoRoot);
    await page.waitForFunction(() => document.body.innerText.includes("First: explore your Idea"));

    const ideaPath = join(fixture.repoRoot, "docs", "IDEA.md");
    const originalIdea = readFileSync(ideaPath, "utf8");
    await beginExternalAuthoring(page, "idea");
    await returnToProjectGuide(page);
    await page.waitForFunction(() => document.body.innerText.includes("First: explore your Idea"));
    assert.match(await page.$eval("#view", (view) => view.textContent ?? ""), /First: explore your Idea/,
      "Starting an external terminal without an authored Idea must not advance the Project.");

    await beginExternalAuthoring(page, "idea");
    writeFileSync(ideaPath, `${originalIdea}\n## Clarified outcome\nHelp small teams track spending.\n`);
    await returnToProjectGuide(page);
    await page.waitForFunction(() => document.body.innerText.includes("Next: author your Project brief"));
    assert.match(await page.$eval("#view", (view) => view.textContent ?? ""), /Next: author your Project brief/,
      "A changed Idea document should advance the Project guide to brief authoring.");

    await beginExternalAuthoring(page, "prd");
    await returnToProjectGuide(page);
    await page.waitForFunction(() => document.body.innerText.includes("Next: author your Project brief"));
    assert.match(await page.$eval("#view", (view) => view.textContent ?? ""), /Next: author your Project brief/,
      "Starting an external brief session without a brief must not advance the Project.");

    await beginExternalAuthoring(page, "prd");
    mkdirSync(join(fixture.repoRoot, "docs", "features"), { recursive: true });
    writeFileSync(join(fixture.repoRoot, "docs", "PRD.md"), "# Weather helper\n\n## Outcome\nHelp young readers plan for weather.\n");
    writeFileSync(join(fixture.repoRoot, "docs", "features", "weather.md"), "# Weather guidance\n");
    await returnToProjectGuide(page);
    await page.waitForSelector("#project-brief-editor", { timeout: 10000 });
    assert.match(await page.$eval("#view", (view) => view.textContent ?? ""), /Review your Project brief/,
      "A written Project brief should advance the Project guide to review.");
    assert.equal(launches.length, 4, "Each external session should be launched through the Console process seam.");
  } finally {
    if (page) await page.close();
    if (browser) await browser.close();
    if (server) await server.stop();
    fixture.cleanup();
    rmSync(join(WORK_ROOT, "external-authoring"), { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = previousHome;
  }
});

test("a completed Idea and Project brief route overview to brief review", async () => {
  const fixture = await createFixture("completed-idea-brief-next-action");
  const previousHome = process.env.FORGE_HOME;
  const manifestPath = join(fixture.repoRoot, "docs", "EXECUTION-MANIFEST.json");
  const workflowStatePath = join(fixture.repoRoot, "docs", "WORKFLOW-STATE.json");
  rmSync(manifestPath, { force: true });
  rmSync(workflowStatePath, { force: true });
  writeFileSync(join(fixture.repoRoot, "docs", "IDEA.md"), "# Weather helper\n\nHelp young readers plan for weather.\n");
  writeFileSync(join(fixture.repoRoot, "docs", "PRD.md"), "# Weather helper\n\n## Outcome\nHelp young readers plan for weather.\n");
  mkdirSync(join(fixture.repoRoot, "docs", "features"), { recursive: true });
  writeFileSync(join(fixture.repoRoot, "docs", "features", "weather.md"), "# Weather planning\n\nHelp readers prepare for local weather.\n");
  let server: ConsoleServer | undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  try {
    ({ server, browser, page } = await startBrowserConsole(fixture));
    const summaryResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/summary" && response.ok());
    await page.evaluate((repoRoot) => {
      localStorage.setItem(`forge-console:guided-authoring:${repoRoot}`, "idea");
      location.hash = "#/overview";
    }, fixture.repoRoot);
    const summary = await (await summaryResponse).json() as { hasIdea: boolean; hasPrd: boolean; hasManifest: boolean };
    assert.deepEqual(
      { hasIdea: summary.hasIdea, hasPrd: summary.hasPrd, hasManifest: summary.hasManifest },
      { hasIdea: true, hasPrd: true, hasManifest: false },
      "The fixture must represent a completed Idea and brief awaiting review.",
    );
    await settle(page);
    const overviewText = await page.$eval("#view", (view) => view.textContent ?? "");
    assert.match(
      overviewText,
      /Review your Project brief/,
      `Completed Idea and brief documents should route to brief review, not the stale Idea step. Overview showed: ${overviewText}`,
    );
    assert.doesNotMatch(overviewText, /First: explore your Idea/i, "Overview must not keep presenting Idea exploration as the next action.");
    assert.equal(
      await page.evaluate((repoRoot) => localStorage.getItem(`forge-console:guided-authoring:${repoRoot}`), fixture.repoRoot),
      "review",
      "Completed brief progress should replace the stale saved Idea step.",
    );
    await page.evaluate((repoRoot) => {
      localStorage.setItem(`forge-console:guided-authoring:${repoRoot}`, "brief");
    }, fixture.repoRoot);
    await page.reload({ waitUntil: "load" });
    await settle(page);
    assert.match(
      await page.$eval("#view", (view) => view.textContent ?? ""),
      /Review your Project brief/,
      "A stale saved brief step should also advance to review when the complete brief exists.",
    );
  } finally {
    if (page) await page.close();
    if (browser) await browser.close();
    if (server) await server.stop();
    fixture.cleanup();
    rmSync(join(WORK_ROOT, "completed-idea-brief-next-action"), { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = previousHome;
  }
});

test("the prepared-plan Start build action routes pending feature Tasks to review", async () => {
  const fixture = await createFixture("prepared-plan-review");
  const previousHome = process.env.FORGE_HOME;
  let server: ConsoleServer | undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  try {
    const manifestPath = join(fixture.repoRoot, "docs", "EXECUTION-MANIFEST.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.reconciliation = {
      previousGeneratedAt: "2026-02-27T00:00:00.000Z",
      preservedTaskIds: [],
      newTaskIds: ["2.1"],
      removedTaskIds: [],
      changedTaskIds: [],
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const workflowStatePath = join(fixture.repoRoot, "docs", "WORKFLOW-STATE.json");
    const completedWorkflowState = readFileSync(workflowStatePath, "utf8");
    rmSync(workflowStatePath, { force: true });

    ({ server, browser, page } = await startBrowserConsole(fixture));
    const runRequests: string[] = [];
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "GET" && url.pathname === "/api/actions") {
        void request.respond({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ canRun: true, canResume: false, canPause: false, canStop: false, failedTasks: [] }),
        }).catch(() => {});
        return;
      }
      if (request.method() === "POST" && url.pathname === "/api/control") {
        const action = (JSON.parse(request.postData() ?? "{}") as { action?: string }).action ?? "";
        if (action === "run") {
          runRequests.push(action);
          void request.respond({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              ok: true,
              message: "Build started.",
              job: {
                id: "acceptance-build",
                type: "engine-run",
                repoPath: fixture.repoRoot,
                startedAt: "2026-11-04T00:00:00.000Z",
                updatedAt: "2026-11-04T00:00:00.000Z",
                status: "running",
                message: "Build started.",
              },
            }),
          }).catch(() => {});
          return;
        }
      }
      void request.continue().catch(() => {});
    });
    await page.evaluate((repoRoot) => {
      localStorage.setItem(`forge-console:guided-authoring:${repoRoot}`, "ready");
      localStorage.setItem(`forge-console:feature-task-review-pending:${repoRoot}`, JSON.stringify({ state: "pending", previous: null }));
      location.hash = "#/overview";
    }, fixture.repoRoot);
    await page.waitForSelector(".project-prepared-plan", { timeout: 10000 });
    await click(page, ".project-prepared-plan button", "Start build");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    assert.deepEqual(runRequests, [], "Start build must not dispatch execution while generated Tasks await review.");
    assert.match(await page.$eval(".project-prepared-plan", (panel) => panel.textContent ?? ""), /Review the 1 generated Task before starting this Build/,
      "The prepared plan should explain why execution is gated.");
    assert.ok(await page.$('.project-prepared-plan a[href="#/tasks?feature-review=1"]'),
      "The prepared plan should link directly to generated Task review.");

    writeFileSync(workflowStatePath, completedWorkflowState);
    await page.reload({ waitUntil: "load" });
    await settle(page);
    await page.waitForSelector(".feature-task-review-gate", { timeout: 10000 });
    assert.match(await page.$eval(".feature-task-review-gate", (panel) => panel.textContent ?? ""), /Review generated Tasks before execution/);
    await click(page, '.feature-task-review-gate a[href="#/tasks?feature-review=1"]', "Review new Tasks");
    await page.waitForSelector(".feature-task-review", { timeout: 10000 });
    assert.match(await page.$eval(".feature-task-review", (panel) => panel.textContent ?? ""), /Expense capture/);
    await click(page, ".feature-task-review button", "I reviewed these Tasks");
    await page.waitForFunction(() => location.hash === "#/overview", { timeout: 10000 });
    rmSync(workflowStatePath, { force: true });
    await page.reload({ waitUntil: "load" });
    await settle(page);
    await page.waitForSelector(".project-prepared-plan", { timeout: 10000 });
    await click(page, ".project-prepared-plan button", "Start build");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    assert.deepEqual(runRequests, ["run"], "An explicitly reviewed feature should be allowed to start its Build.");
  } finally {
    if (page) await page.close();
    if (browser) await browser.close();
    if (server) await server.stop();
    fixture.cleanup();
    rmSync(join(WORK_ROOT, "prepared-plan-review"), { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = previousHome;
  }
});

test("All tasks directs an unstarted Project to Start build before running a selection", async () => {
  const fixture = await createFixture("unstarted-build-run-gate");
  const previousHome = process.env.FORGE_HOME;
  const workflowStatePath = join(fixture.repoRoot, "docs", "WORKFLOW-STATE.json");
  const workflowState = readFileSync(workflowStatePath, "utf8");
  rmSync(workflowStatePath, { force: true });
  let server: ConsoleServer | undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  const controlActions: string[] = [];
  const runRequests: string[] = [];
  try {
    ({ server, browser, page } = await startBrowserConsole(fixture));
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "GET" && url.pathname === "/api/actions") {
        void request.respond({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ canRun: true, canResume: false, canPause: false, canStop: false, failedTasks: [] }),
        }).catch(() => {});
        return;
      }
      if (request.method() === "POST" && url.pathname === "/api/control") {
        const action = (JSON.parse(request.postData() ?? "{}") as { action?: string }).action ?? "";
        controlActions.push(action);
        if (action === "run") {
          runRequests.push(action);
          if (runRequests.length === 1) writeFileSync(workflowStatePath, workflowState);
          void request.respond({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              ok: true,
              message: "Build started.",
              job: {
                id: `acceptance-build-${runRequests.length}`,
                type: "engine-run",
                repoPath: fixture.repoRoot,
                startedAt: "2026-11-04T00:00:00.000Z",
                updatedAt: "2026-11-04T00:00:00.000Z",
                status: "running",
                message: "Build started.",
              },
            }),
          }).catch(() => {});
          return;
        }
      }
      void request.continue().catch(() => {});
    });

    await page.evaluate((repoRoot) => {
      localStorage.setItem(`forge-console:guided-authoring:${repoRoot}`, "ready");
    }, fixture.repoRoot);
    await click(page, "#nav .nav-category button", "Project");
    await click(page, '#nav a[href="#/overview"]', "Build status");
    await page.waitForSelector(".project-prepared-plan", { timeout: 10000 });
    assert.deepEqual(
      await page.$$eval("#view button", (buttons) => buttons.map((button) => button.textContent?.trim() ?? "")
        .filter((label) => ["Run", "Run selected", "Resume", "Resume selected"].includes(label))),
      [],
      "Build status should expose Start build, not generic first-run controls.",
    );
    await click(page, "#nav .nav-category button", "Advanced");
    await click(page, '#nav a[href="#/tasks"]', "All tasks");
    await page.waitForSelector('#view input[aria-label^="Select task "]', { timeout: 10000 });
    await page.click('#view input[aria-label^="Select task "]');
    await click(page, "#view button", "Run selected");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));

    assert.deepEqual(controlActions, [], "All tasks must not start or resume a Build before the user chooses Start build.");
    const gateGuidance = await page.$eval("#view", (view) => view.textContent ?? "");
    assert.match(gateGuidance, /This Project's Build has not started/i,
      "All tasks should explain that the Build must be started first.");
    assert.match(gateGuidance, /choose Start build/i, "The guidance should name the explicit Build-start action.");
    assert.ok(await page.$('#view a[href="#/overview"]'), "All tasks should link to Build status.");
    await click(page, "#view button", "Resume selected");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    assert.deepEqual(controlActions, [], "All tasks must not resume a Build that has never started.");

    await click(page, "#nav .nav-category button", "Project");
    await click(page, '#nav a[href="#/overview"]', "Build status");
    await page.waitForSelector(".project-prepared-plan", { timeout: 10000 });
    await click(page, ".project-prepared-plan button", "Start build");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    assert.deepEqual(runRequests, ["run"], "The prepared-plan Start build action should authorize the first run.");
    assert.deepEqual(controlActions, ["run"]);
    await page.waitForFunction(() => document.querySelector("#view")?.textContent?.includes("run-2026-09-22") ?? false,
      { timeout: 10000 });

    await click(page, "#nav .nav-category button", "Advanced");
    await click(page, '#nav a[href="#/tasks"]', "All tasks");
    await page.waitForSelector('#view input[aria-label^="Select task "]', { timeout: 10000 });
    await page.click('#view input[aria-label^="Select task "]');
    await click(page, "#view button", "Run selected");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    assert.deepEqual(runRequests, ["run", "run"], "Manual task execution should remain available after Start build.");
    assert.deepEqual(controlActions, ["run", "run"]);
  } finally {
    if (page) await page.close();
    if (browser) await browser.close();
    if (server) await server.stop();
    fixture.cleanup();
    rmSync(join(WORK_ROOT, "unstarted-build-run-gate"), { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = previousHome;
  }
});

test("stale Idea and brief progress retain the explicit Start build gate", async () => {
  const fixture = await createFixture("stale-guided-build-gate");
  const previousHome = process.env.FORGE_HOME;
  const workflowStatePath = join(fixture.repoRoot, "docs", "WORKFLOW-STATE.json");
  rmSync(workflowStatePath, { force: true });
  let server: ConsoleServer | undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  try {
    ({ server, browser, page } = await startBrowserConsole(fixture));
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "GET" && url.pathname === "/api/actions") {
        void request.respond({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ canRun: true, canResume: false, canPause: false, canStop: false, failedTasks: [] }),
        }).catch(() => {});
        return;
      }
      void request.continue().catch(() => {});
    });

    for (const [index, step] of (["idea", "brief"] as const).entries()) {
      await page.evaluate(({ repoRoot, savedStep }) => {
        localStorage.setItem(`forge-console:guided-authoring:${repoRoot}`, savedStep);
      }, { repoRoot: fixture.repoRoot, savedStep: step });
      if (index === 0) {
        await click(page, "#nav .nav-category button", "Project");
        await click(page, '#nav a[href="#/overview"]', "Build status");
      } else {
        await page.reload({ waitUntil: "load" });
        await settle(page);
      }
      await page.waitForSelector("#view", { timeout: 10000 });
      assert.ok(
        await page.$(".project-prepared-plan"),
        `A stale ${step} marker should route to the prepared plan; got: ${await page.$eval("#view", (view) => view.textContent ?? "")}`,
      );
      assert.deepEqual(
        await page.$$eval("#view button", (buttons) => buttons.map((button) => button.textContent?.trim() ?? "")
          .filter((label) => ["Run", "Run selected", "Resume", "Resume selected"].includes(label))),
        [],
        `A stale ${step} marker must not expose generic first-run controls.`,
      );
      assert.equal(
        await page.$eval(".project-prepared-plan button", (button) => button.textContent?.trim()),
        "Start build",
        "The explicit Start build action should remain available.",
      );
    }
  } finally {
    if (page) await page.close();
    if (browser) await browser.close();
    if (server) await server.stop();
    fixture.cleanup();
    rmSync(join(WORK_ROOT, "stale-guided-build-gate"), { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = previousHome;
  }
});

test("the Project switcher and Projects list open a completed Project on Project files", async () => {
  const fixture = await createFixture("completed-project-switcher");
  const previousHome = process.env.FORGE_HOME;
  const completedRoot = join(fixture.root, "completed-project");
  let server: ConsoleServer | undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  try {
    cpSync(fixture.repoRoot, completedRoot, { recursive: true });
    const statePath = join(completedRoot, "docs", "WORKFLOW-STATE.json");
    const state = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
    state.status = "complete";
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    const registryPath = join(fixture.homeDir, "projects.json");
    const registry = JSON.parse(readFileSync(registryPath, "utf8")) as Array<Record<string, unknown>>;
    registry.push({
      path: completedRoot,
      name: "completed-project",
      harness: "agents",
      createdAt: "2026-09-22T09:30:00.000Z",
      lastOpenedAt: "2026-11-04T00:00:00.000Z",
    });
    writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

    ({ server, browser, page } = await startBrowserConsole(fixture));
    await page.waitForFunction(
      (path) => Array.from(document.querySelectorAll<HTMLSelectElement>(".context-switcher option")).some((option) => option.value === path),
      { timeout: 10000 },
      completedRoot,
    );
    await page.select(".context-switcher", completedRoot);
    await page.waitForFunction(() => location.hash === "#/project-files", { timeout: 10000 });
    assert.match(await page.$eval("#view", (view) => view.textContent ?? ""), /Project files/,
      "The persistent Project switcher should open completed Projects on their files.");

    await page.evaluate(() => { location.hash = "#/projects"; });
    await page.waitForSelector('button[aria-label="Open completed-project"]', { timeout: 10000 });
    await page.click('button[aria-label="Open completed-project"]');
    await page.waitForFunction(() => location.hash === "#/project-files", { timeout: 10000 });
    assert.match(await page.$eval("#view", (view) => view.textContent ?? ""), /Project files/,
      "Opening the same completed Project from Projects should reach the same destination.");
  } finally {
    if (page) await page.close();
    if (browser) await browser.close();
    if (server) await server.stop();
    fixture.cleanup();
    rmSync(completedRoot, { recursive: true, force: true });
    rmSync(join(WORK_ROOT, "completed-project-switcher"), { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = previousHome;
  }
});

test("the Project files link from brief review opens Project files", async () => {
  const fixture = await createFixture("brief-review-project-files");
  const previousHome = process.env.FORGE_HOME;
  let server: ConsoleServer | undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  try {
    rmSync(join(fixture.repoRoot, "docs", "EXECUTION-MANIFEST.json"), { force: true });
    rmSync(join(fixture.repoRoot, "docs", "WORKFLOW-STATE.json"), { force: true });
    ({ server, browser, page } = await startBrowserConsole(fixture));

    await page.evaluate((repoRoot) => {
      localStorage.setItem(`forge-console:guided-authoring:${repoRoot}`, "review");
      location.hash = "#/overview";
    }, fixture.repoRoot);
    await page.waitForSelector(".project-brief-review", { timeout: 10000 });
    await click(page, ".project-brief-review a", "Project files");
    await page.waitForFunction(() => location.hash === "#/project-files", { timeout: 10000 });
    assert.match(await page.$eval("#view", (view) => view.textContent ?? ""), /Project files/);
  } finally {
    if (page) await page.close();
    if (browser) await browser.close();
    if (server) await server.stop();
    fixture.cleanup();
    rmSync(join(WORK_ROOT, "brief-review-project-files"), { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = previousHome;
  }
});

test("the prepared-plan Project files link opens the Project files destination", async () => {
  const fixture = await createFixture("prepared-plan-project-files");
  const previousHome = process.env.FORGE_HOME;
  let server: ConsoleServer | undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  try {
    rmSync(join(fixture.repoRoot, "docs", "WORKFLOW-STATE.json"), { force: true });
    ({ server, browser, page } = await startBrowserConsole(fixture));
    await page.evaluate((repoRoot) => {
      localStorage.setItem(`forge-console:guided-authoring:${repoRoot}`, "ready");
      location.hash = "#/overview";
    }, fixture.repoRoot);
    await page.waitForSelector(".project-prepared-plan", { timeout: 10000 });
    await click(page, ".project-prepared-plan a", "Project files");
    await page.waitForFunction(() => location.hash === "#/project-files", { timeout: 10000 });
    assert.match(await page.$eval("#view", (view) => view.textContent ?? ""), /Project files/);
  } finally {
    if (page) await page.close();
    if (browser) await browser.close();
    if (server) await server.stop();
    fixture.cleanup();
    rmSync(join(WORK_ROOT, "prepared-plan-project-files"), { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = previousHome;
  }
});

test("Stop requires confirmation and only sends the stop action after approval", async () => {
  const fixture = await createFixture("stop-confirmation");
  const previousHome = process.env.FORGE_HOME;
  let server: ConsoleServer | undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  try {
    ({ server, browser, page } = await startBrowserConsole(fixture));
    const stopActions: string[] = [];
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "GET" && url.pathname === "/api/actions") {
        void request.respond({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ canRun: false, canResume: false, canPause: false, canStop: true, failedTasks: [] }),
        }).catch(() => {});
        return;
      }
      if (request.method() === "POST" && url.pathname === "/api/control") {
        const action = (JSON.parse(request.postData() ?? "{}") as { action?: string }).action ?? "";
        if (action === "stop") {
          stopActions.push(action);
          void request.respond({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: true, message: "Build stop requested." }),
          }).catch(() => {});
          return;
        }
      }
      void request.continue().catch(() => {});
    });

    await page.evaluate(() => { location.hash = "#/overview"; });
    await page.waitForFunction(() => {
      const stop = Array.from(document.querySelectorAll<HTMLButtonElement>("#view button"))
        .find((button) => button.textContent?.trim() === "Stop");
      return stop !== undefined && !stop.disabled;
    }, { timeout: 10000 });

    let cancelMessage = "";
    const dismissed = new Promise<void>((resolvePromise) => {
      page!.once("dialog", (dialog) => {
        cancelMessage = dialog.message();
        void dialog.dismiss().then(resolvePromise);
      });
    });
    await page.click("#view button.btn-danger");
    await dismissed;
    assert.match(cancelMessage, /stop/i, "The Stop action should present an explicit confirmation.");
    assert.deepEqual(stopActions, [], "Canceling Stop must not issue a stop request.");

    let confirmMessage = "";
    const accepted = new Promise<void>((resolvePromise) => {
      page!.once("dialog", (dialog) => {
        confirmMessage = dialog.message();
        void dialog.accept().then(resolvePromise);
      });
    });
    const stopRequest = page.waitForRequest((request) => {
      if (request.method() !== "POST" || new URL(request.url()).pathname !== "/api/control") return false;
      return (JSON.parse(request.postData() ?? "{}") as { action?: string }).action === "stop";
    }, { timeout: 10000 });
    await page.click("#view button.btn-danger");
    await accepted;
    await stopRequest;
    assert.match(confirmMessage, /stop/i);
    assert.deepEqual(stopActions, ["stop"], "Confirming Stop should issue exactly one stop action.");
  } finally {
    if (page) await page.close();
    if (browser) await browser.close();
    if (server) await server.stop();
    fixture.cleanup();
    rmSync(join(WORK_ROOT, "stop-confirmation"), { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = previousHome;
  }
});

test("Board task controls stay concise until selected", async () => {
  const fixture = await createFixture("minimal-board-cards");
  const previousHome = process.env.FORGE_HOME;
  let server: ConsoleServer | undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  try {
    ({ server, browser, page } = await startBrowserConsole(fixture));
    await page.evaluate(() => { location.hash = "#/board"; });
    await page.waitForSelector(".board-kanban-table .board-task-control");

    const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();
    const compactControl = async (selector: string) => {
      const control = await page!.$(selector);
      assert.ok(control, `Expected a task control matching ${selector}.`);
      const visibleText = await control.evaluate((button) =>
        button instanceof HTMLElement ? button.innerText : button.textContent ?? "",
      );
      return { control, visibleText };
    };
    const selectedTaskDetails = async () => page!.$eval(".board-details", (panel) => {
      const status = Array.from(panel.querySelectorAll("dt"))
        .find((label) => label.textContent?.trim() === "Status")
        ?.nextElementSibling?.textContent ?? "";
      return {
        status,
        title: panel.querySelector("h3")?.textContent ?? "",
        text: panel.textContent ?? "",
        summary: panel.querySelector(".board-details-summary")?.textContent?.trim() ?? "",
      };
    });
    const assertCompact = (cardText: string, status: string, title: string): void => {
      assert.ok(status.trim(), "Selected Task details should expose its status.");
      assert.ok(title.trim(), "Selected Task details should expose its title.");
      assert.equal(
        normalizeText(cardText).toLocaleLowerCase(),
        normalizeText(`${status} ${title}`).toLocaleLowerCase(),
      );
    };

    const kanbanCard = await compactControl(".board-kanban-table .board-task-control");
    await kanbanCard.control.click();
    await page.waitForSelector(".board-details .board-details-summary");
    const kanbanDetails = await selectedTaskDetails();
    assertCompact(kanbanCard.visibleText, kanbanDetails.status, kanbanDetails.title);
    assert.match(kanbanDetails.text, /Next responsible/);
    assert.match(kanbanDetails.text, /Next action/);
    assert.ok(kanbanDetails.summary.length > 0);

    const previousTitle = normalizeText(kanbanDetails.title);
    await page.click('[data-board-mode="gantt"]');
    await page.waitForFunction(() =>
      document.querySelector('[data-board-mode="gantt"]')?.getAttribute("aria-selected") === "true",
    );
    const ganttCard = await compactControl(
      ".board-gantt-table .board-task-control[aria-pressed='false'], .board-gantt-fallback-list .board-task-control[aria-pressed='false']",
    );
    await ganttCard.control.click();
    await page.waitForFunction(
      (title) => document.querySelector(".board-details h3")?.textContent?.trim() !== title,
      { timeout: 10000 },
      previousTitle,
    );
    const ganttDetails = await selectedTaskDetails();
    assertCompact(ganttCard.visibleText, ganttDetails.status, ganttDetails.title);
  } finally {
    if (page) await page.close();
    if (browser) await browser.close();
    if (server) await server.stop();
    fixture.cleanup();
    rmSync(join(WORK_ROOT, "minimal-board-cards"), { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = previousHome;
  }
});
