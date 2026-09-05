import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { RunController } from "./console/control.ts";
import { currentJobForRepo } from "./console/jobs.ts";

test("records asynchronous detached startup failures on the created job", () => {
  const previousHome = process.env.FORGE_HOME;
  const home = mkdtempSync(join(tmpdir(), "forge-control-"));
  const repo = mkdtempSync(join(tmpdir(), "forge-repo-"));
  process.env.FORGE_HOME = home;
  try {
    let failStartup: ((error: Error) => void) | undefined;
    const controller = new RunController(repo, {
      spawner: (_cmd, _args, options) => {
        failStartup = options.onStartupError;
        return { pid: 987659 };
      },
    });
    const result = controller.run();
    assert.equal(result.ok, true);
    assert.equal(result.job?.status, "running");
    failStartup?.(new Error("spawn failed"));
    const job = currentJobForRepo(repo);
    assert.equal(job?.status, "failed");
    assert.match(job?.message ?? "", /Failed to start background job: spawn failed/);
  } finally {
    if (previousHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});
