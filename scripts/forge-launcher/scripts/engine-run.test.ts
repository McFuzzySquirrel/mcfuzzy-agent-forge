import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));

function tmpRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fl-engine-run-"));
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.mkdirSync(path.join(root, ".agents", "skills", "forge-workflow-engine"), { recursive: true });
  fs.writeFileSync(path.join(root, ".agents", "skills", "forge-workflow-engine", "package.json"), "{}");
  return root;
}

function runCli(args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    execFile("node", ["--import", "tsx", CLI, ...args], { env: { ...process.env, ...env } }, (err, stdout, stderr) => {
      if (err) {
        resolve({ code: (err as { code?: number }).code ?? 1, out: stdout + stderr });
        return;
      }
      resolve({ code: 0, out: stdout + stderr });
    });
  });
}

test("engine-run forwards --keep-alive / --keep-alive-port / --attach to the engine command", async () => {
  const repo = tmpRepo();
  const { code, out } = await runCli([
    "engine-run", "--repo", repo, "--harness", "opencode",
    "--keep-alive", "--keep-alive-port", "4096",
    "--attach", "http://127.0.0.1:4096", "--yes", "--dry-run",
  ]);
  assert.equal(code, 0, out);
  assert.ok(out.includes("--keep-alive"), out);
  assert.ok(out.includes("--keep-alive-port 4096"), out);
  assert.ok(out.includes("--attach http://127.0.0.1:4096"), out);
});

test("engine-run reads keep-alive/attach from FORGE_ENGINE_ATTACH[_URL]", async () => {
  const repo = tmpRepo();
  const { code, out } = await runCli(
    ["engine-run", "--repo", repo, "--harness", "opencode", "--yes", "--dry-run"],
    { FORGE_ENGINE_ATTACH: "1", FORGE_ENGINE_ATTACH_URL: "http://127.0.0.1:4096" },
  );
  assert.equal(code, 0, out);
  assert.ok(out.includes("--keep-alive"), out);
  assert.ok(out.includes("--attach http://127.0.0.1:4096"), out);
});
