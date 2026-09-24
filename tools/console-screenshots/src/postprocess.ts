import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

/** Numbered tour images derive from the responsive `current/` captures for consistency. */
export const NUMBERED: Array<{ numbered: string; from: string }> = [
  { numbered: "01-home", from: "home-1024" },
  { numbered: "02-overview", from: "overview-1024" },
  { numbered: "03-board", from: "board-1440" },
  { numbered: "04-tasks", from: "tasks-1440" },
  { numbered: "05-tasks-detail", from: "tasks-detail-1440" },
  { numbered: "06-logs", from: "logs-1440" },
  { numbered: "07-logs-audit", from: "logs-audit-1440" },
  { numbered: "08-plan-team", from: "documents-1440" },
  { numbered: "09-plan-team-doc", from: "documents-detail-1440" },
  { numbered: "10-artifacts", from: "artifacts-1440" },
  { numbered: "11-artifacts-detail", from: "artifacts-detail-1440" },
  { numbered: "12-timeline", from: "timeline-1440" },
  { numbered: "13-new-project", from: "new-1440" },
  { numbered: "14-help", from: "help-1440" },
];

function run(bin: string, args: string[]): void {
  const result = spawnSync(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${bin} failed (exit ${result.status}): ${result.stderr?.toString().trim() ?? ""}`);
}

export function writeNumbered(currentDir: string, imagesRoot: string): void {
  for (const { numbered, from } of NUMBERED) {
    copyFileSync(join(currentDir, `${from}.png`), join(imagesRoot, `${numbered}.png`));
  }
}

export function writeThumbnails(imagesRoot: string, thumbDir: string): void {
  mkdirSync(thumbDir, { recursive: true });
  for (const { numbered } of NUMBERED) {
    run("ffmpeg", ["-y", "-loglevel", "error", "-i", join(imagesRoot, `${numbered}.png`), "-vf", "scale=640:-1", join(thumbDir, `${numbered}.png`)]);
  }
}

export function writeWalkthroughGif(framesDir: string, outFile: string, ffmpeg = "ffmpeg"): void {
  const palette = join(framesDir, "palette.png");
  const scale = "scale=1100:-1:flags=lanczos";
  run(ffmpeg, ["-y", "-loglevel", "error", "-framerate", "1.5", "-i", join(framesDir, "frame-%03d.png"), "-vf", `${scale},palettegen`, palette]);
  run(ffmpeg, ["-y", "-loglevel", "error", "-framerate", "1.5", "-i", join(framesDir, "frame-%03d.png"), "-i", palette, "-lavfi", `fps=1.5,${scale}[x];[x][1:v]paletteuse`, "-loop", "0", outFile]);
  rmSync(palette, { force: true });
}
