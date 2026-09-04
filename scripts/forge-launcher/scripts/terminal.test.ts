import assert from "node:assert/strict";
import { test } from "node:test";

import { windowsTerminalArgs } from "./terminal.ts";

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
