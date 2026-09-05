import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface JobRunnerOutcome {
  version: 1;
  id: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  finishedAt: string;
  error?: string;
}

const nodeRequire = createRequire(import.meta.url);
const IS_SOURCE = import.meta.url.endsWith(".ts");
const ENTRY = fileURLToPath(new URL(IS_SOURCE ? "./job-runner.ts" : "./job-runner.js", import.meta.url));

function nodePrefix(): string[] {
  return IS_SOURCE ? ["--import", pathToFileURL(nodeRequire.resolve("tsx")).href] : [];
}

export function jobRunnerCommand(
  command: string,
  args: string[],
  resultPath: string,
  id: string,
): { cmd: string; args: string[] } {
  return {
    cmd: process.execPath,
    args: [...nodePrefix(), ENTRY, "--result", resultPath, "--id", id, "--", command, ...args],
  };
}

function writeOutcome(resultPath: string, outcome: JobRunnerOutcome): void {
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  const temporary = `${resultPath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(outcome)}\n`, "utf8");
    fs.renameSync(temporary, resultPath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function parseArgs(argv: string[]): { resultPath: string; id: string; command: string; args: string[] } {
  if (argv[0] !== "--result" || !argv[1] || argv[2] !== "--id" || !argv[3] || argv[4] !== "--" || !argv[5]) {
    throw new Error("job-runner requires --result <path> --id <id> -- <command> [args...]");
  }
  return { resultPath: argv[1], id: argv[3], command: argv[5], args: argv.slice(6) };
}

export async function runJobRunner(argv = process.argv.slice(2)): Promise<number> {
  const { resultPath, id, command, args } = parseArgs(argv);
  return await new Promise<number>((resolve) => {
    let settled = false;
    const finish = (outcome: Omit<JobRunnerOutcome, "finishedAt">): void => {
      if (settled) return;
      settled = true;
      try {
        writeOutcome(resultPath, { ...outcome, finishedAt: new Date().toISOString() });
        resolve(outcome.exitCode ?? 1);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        resolve(1);
      }
    };
    let child;
    try {
      child = spawn(command, args, { stdio: "inherit", env: process.env });
    } catch (error) {
      finish({
        version: 1,
        id,
        exitCode: null,
        signal: null,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    child.once("error", (error) => {
      finish({
        version: 1,
        id,
        exitCode: null,
        signal: null,
        error: error.message,
      });
    });
    child.once("close", (exitCode, signal) => {
      finish({ version: 1, id, exitCode, signal });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ENTRY)) {
  void runJobRunner().then((code) => {
    process.exitCode = code;
  });
}
