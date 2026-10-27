import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as repo from "./console/repo.ts";
import { repoPaths } from "./console/paths.ts";

// Isolate the registry so refreshJobs() never touches a real ~/.myforge/jobs.json.
const FORGE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "forge-usage-home-"));
process.env.FORGE_HOME = FORGE_HOME;
process.on("exit", () => {
  try { fs.rmSync(FORGE_HOME, { recursive: true, force: true }); } catch { /* ignore */ }
});

function fixture(t: { after: (fn: () => void) => void }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-usage-repo-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const docs = path.join(root, "docs");
  fs.mkdirSync(docs, { recursive: true });
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.mkdirSync(path.join(root, ".agents", "agents"), { recursive: true });

  const manifest = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    repoRoot: root,
    harnessRoot: ".agents",
    phases: [{
      id: "1", title: "Phase", description: "", ownerAgents: [], dependencies: [], approvalRequired: false,
      tasks: [
        { id: "1.1", title: "A", description: "", ownerAgent: "qa", dependencies: [], expectedOutputs: [], validationCommands: [], approvalRequired: false },
        { id: "1.2", title: "B", description: "", ownerAgent: "qa", dependencies: [], expectedOutputs: [], validationCommands: [], approvalRequired: false },
      ],
    }],
  };
  fs.writeFileSync(path.join(docs, "EXECUTION-MANIFEST.json"), JSON.stringify(manifest));

  const state = {
    runId: "run-usage", startedAt: new Date().toISOString(), lastUpdatedAt: new Date().toISOString(),
    manifestPath: path.join(docs, "EXECUTION-MANIFEST.json"), manifestVersion: "1.0",
    harness: "opencode", status: "running",
    tasks: {
      "1.1": {
        taskId: "1.1", status: "complete", attempt: 1, outputFiles: [],
        usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, costUsd: 0.01, source: "harness" },
      },
      "1.2": {
        taskId: "1.2", status: "running", attempt: 1, outputFiles: [],
        usage: { source: "unavailable", note: "not reported" },
      },
    },
    blockers: [],
  };
  fs.writeFileSync(path.join(docs, "WORKFLOW-STATE.json"), JSON.stringify(state));
  return root;
}

test("run summary aggregates reported usage and counts unreported tasks", (t) => {
  const paths = repoPaths(fixture(t));
  const summary = repo.summary(paths);
  assert.ok(summary.run);
  assert.deepEqual(summary.run.usage, {
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 5,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    costUsd: 0.01,
    credits: 0,
    tasksWithUsage: 1,
    tasksTotal: 2,
  });
});

test("task rows expose per-task usage and 'unavailable' is preserved", (t) => {
  const rows = repo.tasks(repoPaths(fixture(t)));
  assert.deepEqual(rows.find((row) => row.id === "1.1")?.usage, {
    inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, costUsd: 0.01, source: "harness",
  });
  const unreported = rows.find((row) => row.id === "1.2")?.usage;
  assert.equal(unreported?.source, "unavailable");
  assert.match(unreported?.note ?? "", /not reported/);
});
