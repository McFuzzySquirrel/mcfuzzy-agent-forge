import { readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export function discoverTests(directory) {
  const files = readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? discoverTests(path) : entry.isFile() && entry.name.endsWith(".test.ts") ? [path] : [];
  });
  return files.sort();
}

export function runTests(directory, args = []) {
  const files = discoverTests(directory);
  if (files.length === 0) {
    throw new Error(`No test files discovered in ${directory}`);
  }
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...args, ...files], { stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runTests(fileURLToPath(new URL(".", import.meta.url)), process.argv.slice(2));
}
