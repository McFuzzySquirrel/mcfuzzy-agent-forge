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

test("engine-run forwards --no-keep-alive and reads it from FORGE_ENGINE_ATTACH=0", async () => {
  const repo = tmpRepo();

  const viaFlag = await runCli([
    "engine-run", "--repo", repo, "--harness", "opencode", "--no-keep-alive", "--yes", "--dry-run",
  ]);
  assert.equal(viaFlag.code, 0, viaFlag.out);
  assert.ok(viaFlag.out.includes("--no-keep-alive"), viaFlag.out);

  const viaEnv = await runCli(
    ["engine-run", "--repo", repo, "--harness", "opencode", "--yes", "--dry-run"],
    { FORGE_ENGINE_ATTACH: "0" },
  );
  assert.equal(viaEnv.code, 0, viaEnv.out);
  assert.ok(viaEnv.out.includes("--no-keep-alive"), viaEnv.out);
});

test("engine-run --stop delegates to the engine stop command (no manifest needed)", async () => {
  const repo = tmpRepo();
  const { code, out } = await runCli([
    "engine-run", "--repo", repo, "--stop", "--dry-run",
  ]);
  assert.equal(code, 0, out);
  assert.ok(out.includes("forge-engine-stop"), out);
  assert.ok(out.includes("workflow-engine -- stop --repo"), out);
  assert.ok(!out.includes("EXECUTION-MANIFEST"), out);
});

test("engine-run --pause delegates to the engine pause command", async () => {
  const repo = tmpRepo();
  const { code, out } = await runCli([
    "engine-run", "--repo", repo, "--pause", "--dry-run",
  ]);
  assert.equal(code, 0, out);
  assert.ok(out.includes("forge-engine-pause"), out);
  assert.ok(out.includes("workflow-engine -- pause --repo"), out);
});

test("engine-run forwards manual execution flags", async () => {
  const repo = tmpRepo();
  const { code, out } = await runCli([
    "engine-run", "--repo", repo, "--harness", "opencode",
    "--execution-mode", "manual",
    "--selection-scope", "range",
    "--selected-tasks", "1.1,1.2",
    "--yes", "--dry-run",
  ]);
  assert.equal(code, 0, out);
  assert.ok(out.includes("--execution-mode manual"), out);
  assert.ok(out.includes("--selection-scope range"), out);
  assert.ok(out.includes("--selected-tasks 1.1,1.2"), out);
});

test("granularity recompilation keeps the manifest-selected team", async (t) => {
  const repo = tmpRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  for (const harness of [".agents", ".github"]) {
    const agents = path.join(repo, harness, "agents");
    fs.mkdirSync(agents, { recursive: true });
    fs.writeFileSync(path.join(agents, "worker.md"), "---\nname: worker\n---\n");
  }
  for (const skill of ["forge-workflow-engine", "forge-execution-adapter"]) {
    const dir = path.join(repo, ".github", "skills", skill);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
  }
  fs.mkdirSync(path.join(repo, "docs"));
  fs.writeFileSync(path.join(repo, "docs", "EXECUTION-MANIFEST.json"), JSON.stringify({ harnessRoot: ".github" }));
  const result = await runCli(["engine-run", "--repo", repo, "--granularity", "fine", "--yes", "--dry-run"]);
  assert.equal(result.code, 0, result.out);
  const compile = result.out.split("\n").find((line) => line.includes("forge-execution-adapter -- compile"));
  assert.ok(compile, result.out);
  assert.ok(compile.includes("--harness-root .github"), compile);
  assert.ok(compile.includes(`--repo ${repo}`), compile);
  assert.ok(result.out.includes(path.join(repo, ".github", "skills", "forge-execution-adapter")), result.out);
});
