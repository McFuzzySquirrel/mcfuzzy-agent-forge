import puppeteer, { type Browser, type Page } from "puppeteer-core";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter((value): value is string => Boolean(value));

const BASE_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--hide-scrollbars",
  "--force-color-profile=srgb",
  "--font-render-hinting=none",
  "--disable-lcd-text",
  "--enable-unsafe-swiftshader",
  "--disable-gpu-vsync",
  "--disable-features=Translate,MediaRouter",
];

export interface LaunchOptions {
  headless?: boolean;
  executablePath?: string;
}

export async function launchBrowser(options: LaunchOptions = {}): Promise<Browser> {
  return puppeteer.launch({
    executablePath: options.executablePath ?? CHROME_CANDIDATES[0],
    headless: options.headless ?? true,
    args: BASE_ARGS,
    defaultViewport: null,
  });
}

export interface Viewport {
  width: number;
  height: number;
}

const DETERMINISM_CSS = "*{transition:none!important;animation:none!important;caret-color:transparent!important;scroll-behavior:auto!important}";

/** Opens a route, neutralises motion, and waits for the SSE connection and layout to settle. */
export async function openRoute(browser: Browser, baseUrl: string, route: string, viewport: Viewport): Promise<Page> {
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.goto(`${baseUrl}/#/${route}`, { waitUntil: "load" });
  await settle(page);
  return page;
}

export async function settle(page: Page): Promise<void> {
  await settleConnection(page);
  await page.addStyleTag({ content: DETERMINISM_CSS });
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function settleConnection(page: Page): Promise<void> {
  try {
    await page.waitForFunction(() => {
      const node = document.querySelector("#connection-status");
      return node !== null && node.textContent === "Connected";
    }, { timeout: 10000 });
  } catch {
    // The status element may already read "Connected" before the function poll
    // starts, or the SSE stream may reconnect; a timeout must not abort capture.
  }
}

/** Clicks the first element whose text contains `text`, preferring an exact match. */
export async function clickByText(page: Page, selector: string, text: string): Promise<boolean> {
  const handles = await page.$$(selector);
  let exact: Awaited<ReturnType<Page["$"]>> | undefined;
  let partial: Awaited<ReturnType<Page["$"]>> | undefined;
  for (const handle of handles) {
    const content = (await handle.evaluate((node) => node.textContent ?? "")) as string;
    if (content.includes(text)) {
      if (content.trim() === text) exact = handle;
      else partial ??= handle;
    }
  }
  const target = exact ?? partial;
  if (!target) return false;
  await target.click();
  await settle(page);
  return true;
}
