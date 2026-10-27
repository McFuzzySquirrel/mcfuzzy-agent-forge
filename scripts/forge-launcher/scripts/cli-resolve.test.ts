import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { cliExecutableNames, cliNotFoundMessage, cliSearchDirs, resolveCliPath } from "./cli-resolve.ts";

test("cliExecutableNames adds Windows executable extensions but not on POSIX", () => {
  assert.deepEqual(cliExecutableNames("opencode", "win32"), [
    "opencode.exe",
    "opencode.cmd",
    "opencode.bat",
    "opencode.com",
    "opencode",
  ]);
  assert.deepEqual(cliExecutableNames("opencode", "linux"), ["opencode"]);
  assert.deepEqual(cliExecutableNames("opencode", "darwin"), ["opencode"]);
});

test("cliSearchDirs includes PATH and well-known Windows install locations", () => {
  const dirs = cliSearchDirs(
    {
      Path: "C:\\tools;C:\\Windows\\System32",
      LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local",
      APPDATA: "C:\\Users\\demo\\AppData\\Roaming",
      USERPROFILE: "C:\\Users\\demo",
      SystemRoot: "C:\\Windows",
    },
    "win32",
  );

  assert.ok(dirs.includes("C:\\tools"));
  assert.ok(dirs.includes("C:\\Users\\demo\\AppData\\Local\\Programs\\opencode\\bin"));
  assert.ok(dirs.includes("C:\\Users\\demo\\AppData\\Roaming\\npm"));
  assert.ok(dirs.includes("C:\\Users\\demo\\.opencode\\bin"));
  assert.ok(dirs.includes("C:\\Windows\\System32\\WindowsPowerShell\\v1.0"));
  // Deduplicated: System32 from Path and SystemRoot appears once.
  assert.equal(dirs.filter((dir) => dir === "C:\\Windows\\System32").length, 1);
});

test("resolveCliPath finds an executable on PATH", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fl-resolve-"));
  try {
    const exeName = cliExecutableNames("mytool")[0]!;
    const exe = path.join(dir, exeName);
    fs.writeFileSync(exe, "#!/bin/sh\n");
    const resolved = resolveCliPath("mytool", { env: { PATH: dir } });
    assert.equal(resolved, exe);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveCliPath returns null when the executable is absent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fl-resolve-empty-"));
  try {
    assert.equal(resolveCliPath("mytool", { env: { PATH: dir } }), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveCliPath honors the explicit CLI override", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fl-resolve-override-"));
  try {
    const exeName = cliExecutableNames("opencode")[0]!;
    const exe = path.join(dir, exeName);
    fs.writeFileSync(exe, "#!/bin/sh\n");
    assert.equal(resolveCliPath("opencode", { env: { PATH: "", OPENCODE_BIN: exe } }), exe);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cliNotFoundMessage names the CLI and its override variable", () => {
  assert.match(cliNotFoundMessage("opencode"), /opencode.*OPENCODE_BIN/);
  assert.match(cliNotFoundMessage("claude"), /CLAUDE_CODE_BIN/);
  assert.match(cliNotFoundMessage("copilot"), /COPILOT_BIN/);
});
