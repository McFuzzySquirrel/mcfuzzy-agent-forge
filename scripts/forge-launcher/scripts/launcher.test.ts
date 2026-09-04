import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTeamPrompt,
  compareFeatureIncrementFiles,
  defaultEngineHarness,
  engineDetachedCommand,
  featureTaskIds,
  headlessSkillMsg,
  snapshotFeatureIncrementFiles,
} from "./launcher.ts";
import { spawnDetached } from "./format.ts";

const CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));

const GIT_ENV = {
  GIT_AUTHOR_NAME: "forge-launcher-test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "forge-launcher-test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fl-launcher-"));
}

function runCli(args: string[], env: Record<string, string>): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "node",
      ["--import", "tsx", CLI, ...args],
      { env: { ...process.env, ...GIT_ENV, ...env } },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ code: (err as { code?: number }).code ?? 1, out: stdout + stderr });
          return;
        }
        resolve({ code: 0, out: stdout + stderr });
      },
    );
  });
}

test("feature-increment filesystem guard allows additive manifest refreshes alongside agent updates", () => {
  const repo = tmpDir();
  fs.mkdirSync(path.join(repo, ".agents", "agents"), { recursive: true });
  fs.mkdirSync(path.join(repo, ".agents", "skills", "forge-build-agent-team"), { recursive: true });
  fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".agents", "agents", "existing.md"), "before\n");
  fs.writeFileSync(path.join(repo, ".agents", "agents", "project-orchestrator.md"), "template\n");
  fs.writeFileSync(path.join(repo, ".agents", "skills", "forge-build-agent-team", "SKILL.md"), "before\n");
  fs.writeFileSync(path.join(repo, "docs", "EXECUTION-MANIFEST.json"), JSON.stringify({
    phases: [{ id: "1", tasks: [{ id: "1.1", title: "Task 1.1", description: "Existing task", dependencies: [], expectedOutputs: [], validationCommands: [], approvalRequired: false }] }],
  }), "utf8");
  fs.writeFileSync(path.join(repo, "docs", "agent-responsibility-matrix.md"), "before\n");

  const before = snapshotFeatureIncrementFiles(repo);
  fs.writeFileSync(path.join(repo, ".agents", "agents", "existing.md"), "after\n");
  fs.writeFileSync(path.join(repo, ".agents", "agents", "new-agent.md"), "new\n");
  fs.writeFileSync(path.join(repo, ".agents", "agents", "project-orchestrator.md"), "updated template\n");
  fs.writeFileSync(path.join(repo, ".agents", "skills", "forge-build-agent-team", "SKILL.md"), "after\n");
  fs.writeFileSync(path.join(repo, "docs", "EXECUTION-MANIFEST.json"), JSON.stringify({
    phases: [
      { id: "1", tasks: [{ id: "1.1", title: "Task 1.1", description: "Existing task", dependencies: [], expectedOutputs: [], validationCommands: [], approvalRequired: false }] },
      { id: "FEATURE-1", feature: "feature", tasks: [{ id: "FEATURE-1.1", title: "Task 1.1", description: "New task", dependencies: [], expectedOutputs: [], validationCommands: [], approvalRequired: false }] },
    ],
  }), "utf8");
  fs.writeFileSync(path.join(repo, "docs", "agent-responsibility-matrix.md"), "after\n");

  assert.deepEqual(compareFeatureIncrementFiles(before, repo), {
    addedAgents: [".agents/agents/new-agent.md"],
    modifiedAgents: [".agents/agents/existing.md"],
    deletedAgents: [],
    updatedOutputs: ["docs/EXECUTION-MANIFEST.json", "docs/agent-responsibility-matrix.md"],
    unrelatedFiles: [],
  });
});

test("feature-increment filesystem guard reports deletions and unrelated changes", () => {
  const repo = tmpDir();
  fs.mkdirSync(path.join(repo, ".agents", "agents"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".agents", "agents", "existing.md"), "agent\n");
  fs.writeFileSync(path.join(repo, "README.md"), "before\n");
  const before = snapshotFeatureIncrementFiles(repo);
  fs.rmSync(path.join(repo, ".agents", "agents", "existing.md"));
  fs.writeFileSync(path.join(repo, "README.md"), "unexpected\n");

  const changes = compareFeatureIncrementFiles(before, repo);
  assert.deepEqual(changes.deletedAgents, [".agents/agents/existing.md"]);
  assert.deepEqual(changes.unrelatedFiles, ["README.md"]);
});

test("feature-increment filesystem guard rejects manifest rewrites that change existing tasks", () => {
  const repo = tmpDir();
  fs.mkdirSync(path.join(repo, ".agents", "agents"), { recursive: true });
  fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".agents", "agents", "existing.md"), "agent\n");
  fs.writeFileSync(path.join(repo, "docs", "EXECUTION-MANIFEST.json"), JSON.stringify({
    phases: [{ id: "1", tasks: [{ id: "1.1", title: "Task 1.1", description: "Existing task", dependencies: [], expectedOutputs: [], validationCommands: [], approvalRequired: false }] }],
  }), "utf8");

  const before = snapshotFeatureIncrementFiles(repo);
  fs.writeFileSync(path.join(repo, "docs", "EXECUTION-MANIFEST.json"), JSON.stringify({
    phases: [{ id: "1", tasks: [{ id: "1.1", title: "Task 1.1", description: "Changed task", dependencies: [], expectedOutputs: [], validationCommands: [], approvalRequired: false }] }],
  }), "utf8");

  const changes = compareFeatureIncrementFiles(before, repo);
  assert.deepEqual(changes.updatedOutputs, []);
  assert.deepEqual(changes.unrelatedFiles, ["docs/EXECUTION-MANIFEST.json"]);
});

test("non-interactive run with no PRD bootstraps and queues forge-auto-build-prd", async () => {
  const parent = tmpDir();
  const { code, out } = await runCli(["--non-interactive"], {
    FORGE_HARNESS_CHOICE: "4",
    FORGE_REPO_NAME: "no-prd-app",
    FORGE_REPO_PARENT_DIR: parent,
    FORGE_IDEA: "A small expense tracker CLI",
    FORGE_YN_DEFAULT: "n",
  });

  assert.equal(code, 0, out);
  const repo = path.join(parent, "no-prd-app");
  assert.ok(fs.existsSync(path.join(repo, ".agents", "agents", "project-orchestrator.md")));
  assert.ok(fs.existsSync(path.join(repo, ".agents", "skills", "forge-auto-build", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(repo, "docs", "IDEA.md")));
  assert.ok(fs.existsSync(path.join(repo, "IDEA.md")));
  assert.ok(!fs.existsSync(path.join(repo, "docs", "PRD.md")));
  const config = JSON.parse(
    fs.readFileSync(path.join(repo, "docs", "engine-config.json"), "utf8"),
  ) as { harness: string };
  assert.equal(config.harness, "opencode");
  // CR-001 lifecycle: no PRD -> queue forge-auto-build-prd
  assert.ok(out.includes("/forge-auto-build-prd Use docs/IDEA.md as the project idea"));
  assert.ok(!out.includes("/forge-auto-build Use docs/PRD.md as the project PRD"));
});

test("GitHub projects default to the copilot engine harness", () => {
  assert.equal(defaultEngineHarness("github"), "copilot");
  assert.equal(defaultEngineHarness("opencode"), "opencode");
  assert.equal(defaultEngineHarness("claude"), "opencode");
  assert.equal(defaultEngineHarness("agents"), "opencode");
});

test("headless PRD message includes the gap check the manual flow runs", () => {
  const msg = headlessSkillMsg();
  assert.ok(msg.startsWith("/forge-auto-build-prd "), msg);
  assert.ok(msg.includes("PRD gap check"), msg);
  assert.ok(msg.includes("acceptance criteria"), msg);
  assert.ok(msg.includes("non-functional requirements"), msg);
  assert.ok(msg.includes("implementation phases"), msg);
});

test("team-generation prompt targets the selected harness directories", () => {
  assert.ok(buildTeamPrompt("docs/PRD.md", "opencode").includes(".opencode/agents/"));
  assert.ok(buildTeamPrompt("docs/PRD.md", "opencode").includes(".opencode/skills/"));
  assert.ok(buildTeamPrompt("docs/PRD.md", "github").includes(".github/agents/"));
  assert.ok(buildTeamPrompt("docs/PRD.md", "github").includes(".github/skills/"));
});

test("auto-draft engine command carries configured granularity/concurrency/timeout/retries", async () => {
  const parent = tmpDir();
  const { code, out } = await runCli(["--non-interactive"], {
    FORGE_HARNESS_CHOICE: "4",
    FORGE_REPO_NAME: "engine-opts-app",
    FORGE_REPO_PARENT_DIR: parent,
    FORGE_IDEA: "A todo list app",
    FORGE_YN_DEFAULT: "n",
    FORGE_AUTO_DRAFT: "1",
    FORGE_RUN_WITH: "stub",
    FORGE_ENGINE_HARNESS: "copilot",
    FORGE_ENGINE_GRANULARITY: "coarse",
    FORGE_ENGINE_CONCURRENCY: "3",
    FORGE_ENGINE_TASK_TIMEOUT_MS: "300000",
    FORGE_ENGINE_MAX_RETRIES: "4",
  });

  assert.equal(code, 0, out);
  const repo = path.join(parent, "engine-opts-app");
  assert.ok(out.includes(`engine-run --repo ${repo}`), out);
  assert.ok(out.includes("--harness copilot"), out);
  assert.ok(out.includes("--granularity coarse"), out);
  assert.ok(out.includes("--concurrency 3"), out);
  assert.ok(out.includes("--task-timeout-ms 300000"), out);
  assert.ok(out.includes("--max-retries 4"), out);
  assert.ok(out.includes("--yes"), out);
});

test("auto-draft engine command enables the live dashboard from env", async () => {
  const parent = tmpDir();
  const { code, out } = await runCli(["--non-interactive"], {
    FORGE_HARNESS_CHOICE: "4",
    FORGE_REPO_NAME: "engine-viz-app",
    FORGE_REPO_PARENT_DIR: parent,
    FORGE_IDEA: "A todo list app",
    FORGE_YN_DEFAULT: "n",
    FORGE_AUTO_DRAFT: "1",
    FORGE_RUN_WITH: "stub",
    FORGE_ENGINE_VIZ: "1",
    FORGE_ENGINE_VIZ_PORT: "5500",
  });

  assert.equal(code, 0, out);
  const repo = path.join(parent, "engine-viz-app");
  assert.ok(out.includes(`engine-run --repo ${repo}`), out);
  assert.ok(out.includes("--viz"), out);
  assert.ok(out.includes("--viz-port 5500"), out);
  assert.ok(out.includes("--yes"), out);
});

test("auto-draft engine command carries keep-alive/attach from env", async () => {
  const parent = tmpDir();
  const { code, out } = await runCli(["--non-interactive"], {
    FORGE_HARNESS_CHOICE: "4",
    FORGE_REPO_NAME: "engine-keepalive-app",
    FORGE_REPO_PARENT_DIR: parent,
    FORGE_IDEA: "A todo list app",
    FORGE_YN_DEFAULT: "n",
    FORGE_AUTO_DRAFT: "1",
    FORGE_RUN_WITH: "stub",
    FORGE_ENGINE_ATTACH: "1",
    FORGE_ENGINE_ATTACH_URL: "http://127.0.0.1:4096",
  });

  assert.equal(code, 0, out);
  const repo = path.join(parent, "engine-keepalive-app");
  assert.ok(out.includes(`engine-run --repo ${repo}`), out);
  assert.ok(out.includes("--keep-alive"), out);
  assert.ok(out.includes("--attach http://127.0.0.1:4096"), out);
  assert.ok(out.includes("--yes"), out);
});

test("spawnDetached tees child output to the log even with only logFile", async () => {
  const dir = tmpDir();
  const logFile = path.join(dir, "detached.log");
  spawnDetached(process.execPath, ["-e", 'console.log("viz-stdout"); console.error("viz-stderr");'], {
    cwd: dir,
    logFile,
  });

  const deadline = Date.now() + 5000;
  let text = "";
  while (Date.now() < deadline) {
    try {
      text = fs.readFileSync(logFile, "utf8");
      if (text.includes("viz-stdout") && text.includes("viz-stderr")) break;
    } catch {
      /* not written yet */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(text.includes("viz-stdout"), `stdout captured: ${text}`);
  assert.ok(text.includes("viz-stderr"), `stderr captured: ${text}`);
});

test("detached engine command resolves a runnable CLI entry", () => {
  const repo = "/tmp/example-repo";
  const { cmd, args } = engineDetachedCommand(["engine-run", "--repo", repo, "--harness", "opencode", "--yes"]);

  assert.equal(cmd, process.execPath);
  // The CLI entry must resolve to a real file: dist/cli.js when compiled, or
  // scripts/cli.ts when running from source (the detached child would otherwise
  // fail to start with ENOENT and produce no manifest or logs).
  const entryIdx = args.findIndex((a) => a.endsWith("cli.js") || a.endsWith("cli.ts"));
  assert.ok(entryIdx >= 0, args.join(" "));
  assert.ok(fs.existsSync(args[entryIdx]), `entry exists: ${args[entryIdx]}`);

  const runIdx = args.indexOf("engine-run");
  assert.ok(runIdx > entryIdx, "engine-run subcommand must follow the CLI entry");
  assert.ok(args.includes("--repo") && args.includes(repo));
  assert.ok(args.includes("--harness") && args.includes("opencode"));
  assert.ok(args.includes("--yes"));

  // Running from source (tsx) preloads the tsx loader so plain `node` can run the .ts entry.
  if (import.meta.url.endsWith(".ts")) {
    assert.equal(args[0], "--import");
  }
});

test("feature-prd fails when the skill exits without a new feature document", async () => {
  const repo = tmpDir();
  execFileSync("git", ["init", "-q", repo]);
  fs.mkdirSync(path.join(repo, ".agents", "skills", "forge-build-feature-prd"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".agents", "skills", "forge-build-feature-prd", "SKILL.md"), "# feature skill\n");

  const result = await runCli(["feature-prd", "--repo", repo, "--prompt", "safe feature"], {
    FORGE_RUN_WITH: "stub",
    FORGE_STUB_NOOP: "1",
  });

  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /without creating a new non-empty/);
});

test("feature-prd accepts a newly created non-empty feature document", async () => {
  const repo = tmpDir();
  execFileSync("git", ["init", "-q", repo]);
  fs.mkdirSync(path.join(repo, ".agents", "skills", "forge-build-feature-prd"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".agents", "skills", "forge-build-feature-prd", "SKILL.md"), "# feature skill\n");

  const result = await runCli(["feature-prd", "--repo", repo, "--prompt", "safe feature"], {
    FORGE_RUN_WITH: "stub",
  });

  assert.equal(result.code, 0, result.out);
  assert.ok(fs.readFileSync(path.join(repo, "docs", "features", "stub-feature.md"), "utf8").trim());
  const log = fs.readFileSync(path.join(repo, "docs", "engine-run.log"), "utf8");
  const event = log.split("\n").find((line) => line.startsWith("FORGE_EVENT "));
  assert.ok(event, "feature authoring should emit a structured lifecycle event");
  assert.equal(JSON.parse(event!.slice("FORGE_EVENT ".length)).type, "authoring.started");
});

test("feature increment selection excludes unrelated manifest tasks", () => {
  const selected = featureTaskIds({ phases: [
    { id: "OLD-1", feature: "Old Feature", tasks: [{ id: "OLD-1.1" }] },
    { id: "NEW-FEATURE-1", feature: "new-feature", tasks: [{ id: "NEW-FEATURE-1.1" }, { id: "NEW-FEATURE-1.2" }] },
  ] }, ["new-feature"]);
  assert.deepEqual(selected, ["NEW-FEATURE-1.1", "NEW-FEATURE-1.2"]);
});

test("headless skill command pins the repo dir with --dir", async () => {
  const parent = tmpDir();
  const { code, out } = await runCli(["--non-interactive", "--dry-run"], {
    FORGE_HARNESS_CHOICE: "4",
    FORGE_REPO_NAME: "dir-app",
    FORGE_REPO_PARENT_DIR: parent,
    FORGE_IDEA: "A thing",
    FORGE_YN_DEFAULT: "n",
    FORGE_AUTO_DRAFT: "1",
    FORGE_RUN_WITH: "opencode",
  });

  assert.equal(code, 0, out);
  const repo = path.join(parent, "dir-app");
  // opencode resolves its project dir from its parent process, not the child's
  // spawn cwd, so the launcher must pass --dir explicitly or the skill runs in
  // the wrong repository and its input (docs/IDEA.md) is reported missing.
  assert.ok(out.includes(`opencode run --auto --dir "${repo}"`), out);
});

test("non-interactive run with a PRD queues forge-auto-build", async () => {
  const parent = tmpDir();
  const prd = path.join(parent, "prd.md");
  fs.writeFileSync(prd, "# PRD\n\nBuild a thing.\n");

  const { code, out } = await runCli(["--non-interactive"], {
    FORGE_HARNESS_CHOICE: "4",
    FORGE_REPO_NAME: "with-prd-app",
    FORGE_REPO_PARENT_DIR: parent,
    FORGE_IDEA: "A thing",
    FORGE_PRD_FILE: prd,
    FORGE_YN_DEFAULT: "n",
  });

  assert.equal(code, 0, out);
  const repo = path.join(parent, "with-prd-app");
  assert.ok(fs.existsSync(path.join(repo, "docs", "PRD.md")));
  // No team generated (no auto-draft) -> forge-auto-build still does in-chat team-gen.
  assert.ok(out.includes("/forge-auto-build Use docs/PRD.md as the project PRD"));
  assert.ok(!out.includes("/forge-auto-build-prd Use docs/IDEA.md"));
});

test("non-interactive run with a PRD and a generated team queues /forge-orchestrate-build", async () => {
  const parent = tmpDir();
  const prd = path.join(parent, "prd.md");
  fs.writeFileSync(prd, "# PRD\n\nBuild a thing.\n");

  const { code, out } = await runCli(["--non-interactive"], {
    FORGE_HARNESS_CHOICE: "4",
    FORGE_REPO_NAME: "with-team-app",
    FORGE_REPO_PARENT_DIR: parent,
    FORGE_IDEA: "A thing",
    FORGE_PRD_FILE: prd,
    FORGE_YN_DEFAULT: "n",
    FORGE_AUTO_DRAFT: "1",
    FORGE_RUN_WITH: "stub",
  });

  assert.equal(code, 0, out);
  const repo = path.join(parent, "with-team-app");
  assert.ok(fs.existsSync(path.join(repo, ".agents", "agents", "stub-project-agent.md")), out);
  // Team exists -> the in-harness entry is the interactive orchestrator.
  assert.ok(out.includes("/forge-orchestrate-build Use docs/PRD.md as the project PRD"), out);
  assert.ok(!out.includes("/forge-auto-build Use docs/PRD.md as the project PRD"), out);
});

test("commit step created the bootstrap commit", async () => {
  const parent = tmpDir();
  const { code } = await runCli(["--non-interactive"], {
    FORGE_HARNESS_CHOICE: "4",
    FORGE_REPO_NAME: "commit-app",
    FORGE_REPO_PARENT_DIR: parent,
    FORGE_IDEA: "A thing",
    FORGE_YN_DEFAULT: "n",
  });
  assert.equal(code, 0);
  const out = execFileSync("git", ["-C", path.join(parent, "commit-app"), "log", "--oneline"], { encoding: "utf8" });
  assert.ok(out.includes("chore: bootstrap MyForge"));
});

test("openCode harness bootstrap rewrites paths to .opencode", async () => {
  const parent = tmpDir();
  const { code } = await runCli(["--non-interactive"], {
    FORGE_HARNESS_CHOICE: "2",
    FORGE_REPO_NAME: "oc-app",
    FORGE_REPO_PARENT_DIR: parent,
    FORGE_IDEA: "A thing",
    FORGE_YN_DEFAULT: "n",
  });
  assert.equal(code, 0);
  const repo = path.join(parent, "oc-app");
  assert.ok(fs.existsSync(path.join(repo, ".opencode", "skills", "forge-auto-build", "SKILL.md")));
  assert.ok(!fs.existsSync(path.join(repo, ".agents")));
  const skill = fs.readFileSync(path.join(repo, ".opencode", "skills", "forge-auto-build", "SKILL.md"), "utf8");
  assert.ok(skill.includes(".opencode/"));
  assert.ok(!skill.includes(".agents/"));
});

test("auto-draft PRD succeeds via the stub skill runner", async () => {
  const parent = tmpDir();
  const { code, out } = await runCli(["--non-interactive"], {
    FORGE_HARNESS_CHOICE: "4",
    FORGE_REPO_NAME: "draft-app",
    FORGE_REPO_PARENT_DIR: parent,
    FORGE_IDEA: "A todo list app",
    FORGE_YN_DEFAULT: "n",
    FORGE_AUTO_DRAFT: "1",
    FORGE_RUN_WITH: "stub",
  });

  assert.equal(code, 0, out);
  const repo = path.join(parent, "draft-app");
  assert.ok(fs.existsSync(path.join(repo, "docs", "PRD.md")), "PRD should exist");
  assert.ok(out.includes("PRD generated."));
  assert.ok(out.includes("docs: add auto-drafted PRD"));
  // the team stage ran too
  assert.ok(fs.existsSync(path.join(repo, ".agents", "agents", "stub-project-agent.md")));
  assert.ok(out.includes("Agent team generated."));
  const log = execFileSync("git", ["-C", repo, "log", "--oneline"], { encoding: "utf8" });
  assert.ok(log.includes("docs: add auto-drafted PRD"));
  assert.ok(log.includes("feat: generate auto-drafted agent team"));
});

test("plan & validate step saves an execution plan after team creation", async () => {
  const parent = tmpDir();
  const prd = path.join(parent, "prd.md");
  fs.writeFileSync(prd, "# PRD\n\nBuild a thing.\n");

  const { code, out } = await runCli(["--non-interactive"], {
    FORGE_HARNESS_CHOICE: "4",
    FORGE_REPO_NAME: "plan-step-app",
    FORGE_REPO_PARENT_DIR: parent,
    FORGE_IDEA: "A thing",
    FORGE_PRD_FILE: prd,
    FORGE_YN_DEFAULT: "n",
    FORGE_AUTO_DRAFT: "1",
    FORGE_RUN_WITH: "stub",
  });

  assert.equal(code, 0, out);
  const repo = path.join(parent, "plan-step-app");
  assert.ok(fs.existsSync(path.join(repo, "docs", "PROGRESS.md")), "execution plan should exist");
  assert.ok(out.includes("Execution plan saved to docs/PROGRESS.md"), out);
  const log = execFileSync("git", ["-C", repo, "log", "--oneline"], { encoding: "utf8" });
  assert.ok(log.includes("docs: add execution plan"), log);
  // The engine decision still runs after the plan step.
  assert.ok(out.includes("engine-run --repo"), out);
});

test("auto-draft PRD failure is diagnosed with log tail and no commit", async () => {
  const parent = tmpDir();
  const { code, out } = await runCli(["--non-interactive"], {
    FORGE_HARNESS_CHOICE: "4",
    FORGE_REPO_NAME: "draft-fail-app",
    FORGE_REPO_PARENT_DIR: parent,
    FORGE_IDEA: "A todo list app",
    FORGE_YN_DEFAULT: "n",
    FORGE_AUTO_DRAFT: "1",
    FORGE_RUN_WITH: "stub",
    FORGE_STUB_NOOP: "1",
  });

  assert.equal(code, 0, out);
  const repo = path.join(parent, "draft-fail-app");
  assert.ok(!fs.existsSync(path.join(repo, "docs", "PRD.md")), "no PRD should exist");
  assert.ok(out.includes("did not produce the expected artifact"));
  assert.ok(out.includes("Run it manually in the repo"));
  assert.ok(out.includes("[stub] invoking forge-auto-build-prd"));
  // nothing was committed beyond the bootstrap commit
  const log = execFileSync("git", ["-C", repo, "log", "--oneline"], { encoding: "utf8" });
  assert.ok(!log.includes("docs: add auto-drafted PRD"));
});
