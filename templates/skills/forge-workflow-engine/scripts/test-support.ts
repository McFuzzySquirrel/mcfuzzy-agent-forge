import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** Exercise the same executable/shim path as an npm-installed CLI on each OS. */
export function makeNodeShim(directory: string, name: string, body: string): string {
  const script = join(directory, `${name}.cjs`);
  writeFileSync(script, `#!/usr/bin/env node\n${body}`, { mode: 0o755 });
  if (process.platform !== "win32") return script;
  const command = join(directory, `${name}.cmd`);
  writeFileSync(command, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  return command;
}
