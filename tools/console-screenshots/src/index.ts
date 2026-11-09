import { spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { captureAll, captureBoard, captureGifFrames } from "./capture.ts";
import { launchBrowser } from "./chrome.ts";
import { buildFixture } from "./fixture.ts";
import { writeNumbered, writeThumbnails, writeWalkthroughGif } from "./postprocess.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const LAUNCHER_CLI = join(REPO_ROOT, "scripts", "forge-launcher", "dist", "cli.js");
const IMAGES_ROOT = join(REPO_ROOT, "docs", "images", "forge-console");
const CURRENT_DIR = join(IMAGES_ROOT, "current");
const THUMB_DIR = join(IMAGES_ROOT, "thumb");
const CAPTURE_WORK_DIR = join(REPO_ROOT, ".scratch", "adaptive-console-redesign", "board-capture-work");
const BOARD_NUMBERED = new Set(["03-board", "03b-board-gantt", "03c-board-detail"]);

function startConsole(repoRoot: string, homeDir: string): Promise<{ child: ChildProcess; url: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [LAUNCHER_CLI, "console", "--repo", repoRoot, "--no-open"], {
      cwd: repoRoot,
      env: { ...process.env, FORGE_HOME: homeDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) reject(new Error(`Timed out waiting for the Console URL.\n${buffer}`));
    }, 30000);
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      const match = buffer.match(/Forge Console:\s+(https?:\/\/\S+)/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        resolvePromise({ child, url: match[1]! });
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", (chunk: Buffer) => { buffer += chunk.toString("utf8"); });
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("exit", (code) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`Console exited before starting (exit ${code}).\n${buffer}`)); }
    });
  });
}

async function main(): Promise<void> {
  const headed = process.argv.includes("--headed");
  const boardOnly = process.argv.includes("--board-only");
  const repoRoot = join(CAPTURE_WORK_DIR, "ledgerly");
  const homeDir = join(CAPTURE_WORK_DIR, "ledgerly-home");
  const framesDir = join(CAPTURE_WORK_DIR, "frames");
  const fixture = await buildFixture(repoRoot, homeDir);
  rmSync(framesDir, { recursive: true, force: true });
  process.env.FORGE_HOME = fixture.homeDir;

  const { child, url } = await startConsole(fixture.repoRoot, fixture.homeDir);
  const browser = await launchBrowser({ headless: !headed, userDataDir: join(CAPTURE_WORK_DIR, "chrome-profile") });
  try {
    console.log(`Capturing Forge Console at ${url} (headless=${!headed})`);
    const names = boardOnly
      ? await captureBoard(browser, url, CURRENT_DIR)
      : await captureAll(browser, url, CURRENT_DIR);
    console.log(`Captured ${names.length} responsive screenshots.`);
    if (boardOnly) {
      writeNumbered(CURRENT_DIR, IMAGES_ROOT, BOARD_NUMBERED);
      writeThumbnails(IMAGES_ROOT, THUMB_DIR, BOARD_NUMBERED);
      console.log("Refreshed only the Board screenshots and thumbnails.");
    } else {
      await captureGifFrames(browser, url, framesDir);
      writeNumbered(CURRENT_DIR, IMAGES_ROOT);
      writeThumbnails(IMAGES_ROOT, THUMB_DIR);
      writeWalkthroughGif(framesDir, join(CURRENT_DIR, "console-walkthrough.gif"));
      console.log("Wrote numbered images, thumbnails, and the walkthrough GIF.");
    }
  } finally {
    await browser.close();
    child.kill("SIGTERM");
    fixture.cleanup();
    rmSync(CAPTURE_WORK_DIR, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
