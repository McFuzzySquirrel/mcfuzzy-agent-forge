import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
