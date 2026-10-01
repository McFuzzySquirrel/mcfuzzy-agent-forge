import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { launchCliInTerminal, windowsTerminalArgs } from "./terminal.ts";

test("Windows Terminal receives the working directory separately from the PowerShell command", () => {
  const args = windowsTerminalArgs(
    "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    "C:\\repos\\demo",
    "& 'C:\\Users\\demo\\AppData\\Roaming\\npm\\copilot.cmd' '-i' '/forge-assign-models Discover models.'",
  );

  assert.deepEqual(args, [
    "new-tab",
    "-d",
    "C:\\repos\\demo",
    "--",
    "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    "-NoProfile",
    "-NoExit",
    "-Command",
    "& 'C:\\Users\\demo\\AppData\\Roaming\\npm\\copilot.cmd' '-i' '/forge-assign-models Discover models.'",
  ]);
  assert.equal(args.at(-1)?.includes("Set-Location"), false);
  assert.equal(args.at(-1)?.includes(";"), false);
});

/**
 * A detached terminal spawned from a pipe is unreachable, and the posix launch
 * script ends in `; exec bash`, so the emulator holds a shell open that nobody
 * can close. `--dry-run` and the automated suite both run without a TTY, so
 * every terminal candidate must be skipped rather than tried.
 */
test("no terminal is spawned when there is no TTY", async () => {
  // A PATH of only fake candidates: reaching one would create a marker file.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fl-nontty-"));
  try {
    for (const name of ["gnome-terminal", "x-terminal-emulator", "konsole", "mate-terminal", "wt", "pwsh", "powershell"]) {
      const file = path.join(dir, name);
      // PATH is replaced outright so a real terminal emulator cannot be reached.
      fs.writeFileSync(file, `#!/bin/sh\n/bin/touch "${path.join(dir, "spawned")}"\n`);
      fs.chmodSync(file, 0o755);
    }
    const original = process.env.PATH;
    const originalTty = process.stdin.isTTY;
    process.env.PATH = dir;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    try {
      const launched = await launchCliInTerminal("opencode", "/tmp/some-repo", ["--model", "x"]);
      assert.equal(launched, false, "must not report a launch");
      assert.equal(fs.existsSync(path.join(dir, "spawned")), false, "no terminal candidate may be spawned");
    } finally {
      process.env.PATH = original;
      Object.defineProperty(process.stdin, "isTTY", { value: originalTty, configurable: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the Console can still open a terminal without a TTY", async () => {
  // The guard is opt-out because the Console's whole purpose is to open
  // terminals on the user's behalf; this pins that the opt-out still reaches
  // the spawn path (observed via the candidate's side effect).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fl-allow-nontty-"));
  try {
    const marker = path.join(dir, "spawned");
    const isWindows = process.platform === "win32";
    const file = path.join(dir, isWindows ? "powershell.cmd" : "gnome-terminal");
    const script = isWindows
      ? `@echo off\r\necho marker>"%FORGE_TERMINAL_TEST_MARKER%"\r\n`
      : `#!/bin/sh\n/bin/touch "$FORGE_TERMINAL_TEST_MARKER"\n`;
    // PATH is replaced, so the marker command must use a self-contained script.
    fs.writeFileSync(file, script);
    fs.chmodSync(file, 0o755);
    const original = process.env.PATH;
    const originalMarker = process.env.FORGE_TERMINAL_TEST_MARKER;
    const originalTty = process.stdin.isTTY;
    process.env.PATH = dir;
    process.env.FORGE_TERMINAL_TEST_MARKER = marker;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    try {
      await launchCliInTerminal("opencode", "/tmp/some-repo", [], { allowWithoutTty: true });
      // The candidate is spawned detached, so its side effect is not synchronous.
      for (let attempt = 0; attempt < 50 && !fs.existsSync(marker); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(fs.existsSync(marker), true, "the opt-out must reach the spawn path");
    } finally {
      process.env.PATH = original;
      if (originalMarker === undefined) delete process.env.FORGE_TERMINAL_TEST_MARKER;
      else process.env.FORGE_TERMINAL_TEST_MARKER = originalMarker;
      Object.defineProperty(process.stdin, "isTTY", { value: originalTty, configurable: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
