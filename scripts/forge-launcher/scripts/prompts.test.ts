import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listDirEntries, splitPathInput } from "./prompts.ts";

test("splitPathInput splits on / and \\", () => {
  assert.deepEqual(splitPathInput("C:\\Users\\me\\projects"), { dir: "C:\\Users\\me\\", base: "projects" });
  assert.deepEqual(splitPathInput("/home/me/docs"), { dir: "/home/me/", base: "docs" });
  assert.deepEqual(splitPathInput("docs/x"), { dir: "docs/", base: "x" });
});

test("splitPathInput handles bare names and trailing separators", () => {
  assert.deepEqual(splitPathInput("projects"), { dir: "", base: "projects" });
  assert.deepEqual(splitPathInput("C:\\Users\\"), { dir: "C:\\Users\\", base: "" });
  assert.deepEqual(splitPathInput(""), { dir: "", base: "" });
});

test("listDirEntries lists only directories in directory mode, folders first otherwise", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fl-prompts-"));
  fs.mkdirSync(path.join(dir, "beta"));
  fs.mkdirSync(path.join(dir, "Alpha"));
  fs.writeFileSync(path.join(dir, "a.txt"), "");
  fs.writeFileSync(path.join(dir, "B.md"), "");

  const dirs = listDirEntries(dir, { directory: true });
  assert.deepEqual(dirs.map((e) => e.name), ["Alpha", "beta"]);
  assert.ok(dirs.every((e) => e.isDirectory));

  const all = listDirEntries(dir);
  assert.deepEqual(all.map((e) => e.name), ["Alpha", "beta", "a.txt", "B.md"]);
  assert.ok(all[0].isDirectory && all[1].isDirectory);
  assert.ok(!all[2].isDirectory && !all[3].isDirectory);
});

test("listDirEntries returns [] for missing/unreadable dirs", () => {
  assert.deepEqual(listDirEntries(path.join(os.tmpdir(), "does-not-exist-" + Date.now())), []);
});
