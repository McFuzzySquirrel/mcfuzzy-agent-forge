import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startConsoleServer } from "./console/server.ts";
import { settingsPath } from "./settings.ts";

let port = 46900;

test("settings API is token-gated and round-trips UI preferences", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-settings-console-"));
  const oldForgeHome = process.env.FORGE_HOME;
  process.env.FORGE_HOME = path.join(root, "registry");
  fs.mkdirSync(path.join(root, ".git"));
  t.after(() => {
    if (oldForgeHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = oldForgeHome;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const server = await startConsoleServer({ repoRoot: root, port: port++, open: false });
  t.after(() => server.stop());
  const url = `${server.url}/api/settings`;

  assert.deepEqual(await fetch(url).then((r) => r.json()), { version: 1 });
  assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 403);

  const post = (body: unknown) => fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forge-Token": server.token },
    body: JSON.stringify(body),
  });

  assert.equal((await post({ version: 1, ui: { theme: "sepia" } })).status, 400);

  const settings = { version: 1, execution: { concurrency: 2 }, ui: { theme: "light" } };
  assert.equal((await post(settings)).status, 200);
  assert.deepEqual(await fetch(url).then((r) => r.json()), settings);
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath(), "utf8")), settings);
});
