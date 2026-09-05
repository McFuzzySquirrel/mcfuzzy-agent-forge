import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadAuthoringConfig, saveAuthoringConfig, selectAuthoringModel, writeAuthoringJson } from "./authoring-config.ts";
import { authoringArgv, parseModelInventoryOutput, refreshAuthoringInventory, resolveAuthoringModel } from "./authoring-inventory.ts";
import { authoringReadiness, authoringStageIsCurrent, fingerprintFiles, readAuthoringState, readSkillCandidates } from "./authoring-state.ts";
import { runDraftPrd, runDraftSkills, runDraftTeam, runFeatureIncrement, runLauncher, runResume, type LauncherOptions } from "./launcher.ts";
import { createSessionScope } from "./launcher-session.ts";
import { prompts, withPromptSession } from "./prompts.ts";

function fixture(t: { after: (fn: () => void) => void }): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "forge-authoring-"));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
  fs.mkdirSync(path.join(repo, ".github", "agents"), { recursive: true });
  for (const skill of ["forge-auto-build-prd", "forge-build-prd", "forge-build-feature-prd", "forge-build-agent-team", "forge-build-project-skills"]) {
    write(repo, `.github/skills/${skill}/SKILL.md`, `---\nname: ${skill}\ndescription: "Fixture"\n---\n# Fixture\n`);
  }
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "config", "user.email", "test@example.invalid"]);
  execFileSync("git", ["-C", repo, "config", "user.name", "Authoring fixture"]);
  return repo;
}

function write(repo: string, relative: string, text: string): void {
  const file = path.join(repo, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
function inventory(repo: string): void {
  writeAuthoringJson(path.join(repo, "docs/research/model-inventory.json"), {
    last_verified: new Date().toISOString(),
    copilot_cli: { models: [{ id: "prd-1" }, { id: "team-2" }, { id: "skills-3" }] },
    opencode_cli: { models: [{ id: "anthropic/team-2" }] },
  });
}
const candidates = {
  version: 1,
  candidates: [{ name: "project-fixture", description: "Use when validating project fixture work.", consumers: ["project-agent"], action: "create", reason: "Project fixture behavior needs a dedicated reusable procedure." }],
};
const stub: LauncherOptions = { env: { FORGE_RUN_WITH: "stub" } };

test("authoring config persists independent models and clearing restores inheritance", (t) => {
  const repo = fixture(t);
  saveAuthoringConfig(repo, { version: 1, models: { prd: "prd-1", team: "team-2", skills: "skills-3" } });
  assert.deepEqual(loadAuthoringConfig(repo).models, { prd: "prd-1", team: "team-2", skills: "skills-3" });
  saveAuthoringConfig(repo, { version: 1, models: { team: "team-2", prd: "inherit" } });
  assert.deepEqual(loadAuthoringConfig(repo).models, { team: "team-2" });
  assert.equal(fs.existsSync(path.join(repo, "docs/model-overrides.json")), false);
});

test("authoring model precedence is invocation then environment then project then runner", (t) => {
  const repo = fixture(t);
  saveAuthoringConfig(repo, { version: 1, models: { prd: "saved-1" } });
  assert.deepEqual(selectAuthoringModel(repo, "prd", { prd: "cli-1" }, { FORGE_PRD_MODEL: "env-1" }), { requestedModel: "cli-1", source: "invocation" });
  assert.deepEqual(selectAuthoringModel(repo, "prd", {}, { FORGE_PRD_MODEL: "env-1" }), { requestedModel: "env-1", source: "environment" });
  assert.deepEqual(selectAuthoringModel(repo, "prd", {}, {}), { requestedModel: "saved-1", source: "project" });
  assert.deepEqual(selectAuthoringModel(repo, "prd", { prd: "inherit" }, { FORGE_PRD_MODEL: "env-1" }), { source: "inherit" });
  assert.deepEqual(selectAuthoringModel(repo, "skills", {}, {}), { source: "inherit" });
});

test("invalid settings and future schemas fail instead of resetting choices", (t) => {
  const repo = fixture(t);
  write(repo, "docs/authoring-config.json", '{"version":2,"models":{}}');
  assert.throws(() => loadAuthoringConfig(repo), /Invalid authoring config/);
  assert.throws(() => saveAuthoringConfig(repo, { version: 1, models: { team: "--model other" } }), /Invalid team/);
});

test("inventory is discoverable before PRD and retains other providers and freshness", async (t) => {
  const repo = fixture(t);
  const old = "2020-01-01T00:00:00Z";
  writeAuthoringJson(path.join(repo, "docs/research/model-inventory.json"), {
    last_verified: old, copilot_cli: { models: [{ id: "old-1" }] }, custom: { marker: true },
  });
  const result = await refreshAuthoringInventory(repo, "opencode", async (runner, args) => {
    assert.equal(runner, "opencode");
    assert.deepEqual(args, ["models"]);
    return { code: 0, stdout: "anthropic/team-2\nopenai/prd-1\n", stderr: "" };
  });
  assert.equal(result.models.find((model) => model.provider === "copilot_cli")?.last_verified, old);
  assert.equal(result.models.find((model) => model.id === "anthropic/team-2")?.provider, "opencode_cli");
  assert.equal(fs.existsSync(path.join(repo, "docs/PRD.md")), false);
});

test("Copilot inventory uses non-generative help metadata, never a model prompt", async (t) => {
  const repo = fixture(t);
  const result = await refreshAuthoringInventory(repo, "copilot", async (runner, args) => {
    assert.equal(runner, "copilot");
    assert.deepEqual(args, ["--help"]);
    return { code: 0, stdout: "Models:\n- gpt-6-astra\n- gpt-5.6-luna\n", stderr: "" };
  });
  assert.deepEqual(result.models.map((model) => model.id), ["gpt-6-astra", "gpt-5.6-luna"]);
});

test("Copilot metadata failure is explicit while inherited selection remains unresolved", async (t) => {
  const repo = fixture(t);
  await assert.rejects(
    refreshAuthoringInventory(repo, "copilot", async (_runner, args) => {
      assert.deepEqual(args, ["--help"]);
      return { code: 1, stdout: "", stderr: "Copilot is not logged in" };
    }),
    /copilot model discovery failed/,
  );
  assert.deepEqual(
    await resolveAuthoringModel(repo, "prd", "copilot", {}, {}, async () => {
      throw new Error("inherited selection must not probe");
    }),
    { runner: "copilot", source: "inherit" },
  );
});

test("inventory parser rejects prose and preserves qualified OpenCode IDs", () => {
  assert.deepEqual(parseModelInventoryOutput("Available models:\n- anthropic/claude-4\nopenai/gpt-5\nNo models available\n", "opencode"), ["anthropic/claude-4", "openai/gpt-5"]);
  assert.deepEqual(parseModelInventoryOutput("Models:\n1. claude-4 (default)\ngpt-5\n", "copilot"), ["claude-4", "gpt-5"]);
  assert.deepEqual(parseModelInventoryOutput("| Model | Multiplier |\n| `claude-4` | 1x |\nOpenAI: gpt-5 (1x)\nold-1 (unavailable)", "copilot"), ["claude-4", "gpt-5"]);
});

test("real argv carries stage models; only Copilot strips qualification", async (t) => {
  const repo = fixture(t);
  inventory(repo);
  for (const [stage, model] of [["prd", "prd-1"], ["team", "team-2"], ["skills", "skills-3"]] as const) {
    const resolved = await resolveAuthoringModel(repo, stage, "copilot", { [stage]: model }, {});
    assert.deepEqual(authoringArgv(resolved, repo, "/fixture"), ["-p", "/fixture", "--yolo", "--model", model]);
  }
  const open = await resolveAuthoringModel(repo, "team", "opencode", { team: "anthropic/team-2" }, {});
  assert.equal(authoringArgv(open, repo, "/fixture").includes("anthropic/team-2"), true);
  const copilot = await resolveAuthoringModel(repo, "team", "copilot", { team: "anthropic/team-2" }, {});
  assert.equal(copilot.effectiveModel, "team-2");
  assert.throws(() => authoringArgv(open, repo, "/fixture", ["-mother"]), /Conflicting extra model/);
});

test("inherited defaults stay unresolved and never get a frozen default model", async (t) => {
  const repo = fixture(t);
  const result = await resolveAuthoringModel(repo, "prd", "copilot", {}, {}, async () => { throw new Error("must not guess"); });
  assert.deepEqual(result, { runner: "copilot", source: "inherit" });
  assert.equal(authoringArgv(result, repo, "/fixture").includes("--model"), false);
});

test("dependency, build, and cache directories do not invalidate authored fingerprints", (t) => {
  const repo = fixture(t);
  write(repo, ".github/agents/worker.md", "---\nname: worker\ndescription: \"Worker\"\n---\n");
  const before = fingerprintFiles(repo, [".github/agents"]);
  for (const dir of ["node_modules", "dist", "build", "coverage", ".cache", ".turbo", ".next"]) {
    write(repo, `.github/agents/${dir}/generated.txt`, `${dir}-noise`);
  }
  assert.equal(fingerprintFiles(repo, [".github/agents"]), before);
  write(repo, ".github/agents/worker.md", "---\nname: worker\ndescription: \"Changed worker\"\n---\n");
  assert.notEqual(fingerprintFiles(repo, [".github/agents"]), before);
});

test("explicit incompatible, unavailable, stale and tool-less selections never fall back", async (t) => {
  const repo = fixture(t);
  inventory(repo);
  const unavailable = async () => ({ code: 1, stdout: "", stderr: "offline inventory" });
  await assert.rejects(resolveAuthoringModel(repo, "team", "opencode", { team: "team-2" }, {}, unavailable), /discovery failed/);
  await assert.rejects(resolveAuthoringModel(repo, "prd", "copilot", { prd: "missing-9" }, {}, unavailable), /discovery failed/);
  writeAuthoringJson(path.join(repo, "docs/research/model-inventory.json"), {
    last_verified: "2020-01-01", copilot_cli: { models: [{ id: "prd-1" }] },
  });
  await assert.rejects(resolveAuthoringModel(repo, "prd", "copilot", { prd: "prd-1" }, {}, unavailable), /discovery failed/);
  writeAuthoringJson(path.join(repo, "docs/research/model-inventory.json"), {
    last_verified: new Date().toISOString(), copilot_cli: { models: [{ id: "prd-1", tool_calling: false }] },
  });
  await assert.rejects(resolveAuthoringModel(repo, "prd", "copilot", { prd: "prd-1" }, {}), /required authoring tools/);
});

test("sessions isolate async state and interactive flags", async () => {
  const scope = createSessionScope(() => ({ value: "" }));
  const values = await Promise.all(["first", "second"].map((value, index) => scope.run(() => withPromptSession(index === 0, async () => {
    scope.state.value = value;
    await new Promise((resolve) => setTimeout(resolve, index === 0 ? 10 : 1));
    return { value: scope.state.value, nonInteractive: prompts.nonInteractive };
  }))));
  assert.deepEqual(values, [{ value: "first", nonInteractive: true }, { value: "second", nonInteractive: false }]);
  assert.throws(() => scope.current(), /requires an invocation session/);
});

test("stub team produces handoff only and no-skills completion is durable", async (t) => {
  const repo = fixture(t);
  write(repo, "docs/PRD.md", "# Fixture PRD");
  assert.equal(await runDraftTeam(repo, false, stub), 0);
  assert.deepEqual(readSkillCandidates(repo), { version: 1, candidates: [] });
  assert.equal(readAuthoringState(repo).stages.skills?.status, "pending");
  assert.equal(authoringReadiness(repo, ".github").ready, false);
  assert.equal(await runDraftSkills(repo, stub), 0);
  assert.equal(readAuthoringState(repo).stages.skills?.noSkillsRequired, true);
  assert.equal(authoringReadiness(repo, ".github").ready, true);
  const agent = path.join(repo, ".github/agents/stub-project-agent.md");
  fs.writeFileSync(agent, fs.readFileSync(agent, "utf8").replace('description:', 'model: "execution-only-99"\nmodelFallback: "execution-fallback-1"\ndescription:'));
  assert.equal(authoringReadiness(repo, ".github").ready, true, "implementation-agent overrides must not couple to authoring readiness");
  write(repo, "docs/PRD.md", "# Changed requirements");
  assert.equal(authoringReadiness(repo, ".github").ready, false);
});

test("all-omit handoffs complete without requiring a skills inventory", async (t) => {
  const repo = fixture(t);
  write(repo, "docs/PRD.md", "# Fixture PRD");
  write(repo, ".github/agents/project-agent.md", '---\nname: project-agent\ndescription: "Project agent"\n---\n');
  writeAuthoringJson(path.join(repo, "docs/SKILL-CANDIDATES.json"), {
    version: 1,
    candidates: [{ name: "unused", description: "Unused project procedure.", consumers: ["project-agent"], action: "omit", reason: "Not needed." }],
  });
  assert.equal(await runDraftSkills(repo, { ...stub, models: { skills: "unavailable-explicit-model" } }), 0);
  assert.equal(readAuthoringState(repo).stages.skills?.noSkillsRequired, true);
});

test("legacy team without new markers remains build-ready", (t) => {
  const repo = fixture(t);
  write(repo, ".github/agents/legacy.md", '---\nname: legacy\ndescription: "Legacy"\n---\n');
  assert.deepEqual(authoringReadiness(repo, ".github"), { ready: true });
});

test("active PRD stages block builds without a team or skills transaction", (t) => {
  const repo = fixture(t);
  assert.equal(authoringReadiness(repo, ".github").ready, true);
  for (const status of ["running", "failed"] as const) {
    writeAuthoringJson(path.join(repo, "docs/authoring-state.json"), {
      version: 1, stages: { prd: { status, inputFingerprint: "fixture", outputs: [] } },
    });
    const readiness = authoringReadiness(repo, ".github");
    assert.equal(readiness.ready, false);
    assert.equal(readiness.nextStage, "prd");
  }
});

test("failed skills resume without rerunning a current team and changed outputs invalidate readiness", async (t) => {
  const repo = fixture(t);
  write(repo, "docs/PRD.md", "# Fixture PRD");
  inventory(repo);
  let teamRuns = 0;
  let skillsRuns = 0;
  let failSkills = true;
  const options: LauncherOptions = {
    env: { FORGE_RUN_WITH: "copilot" },
    models: { team: "team-2", skills: "skills-3" },
    dependencies: { runLogged: async (cmd, args) => {
      if (cmd === process.execPath) return { code: 0, stdout: "", stderr: "" };
      const message = args[1]!;
      if (message.startsWith("/forge-build-agent-team")) {
        teamRuns++;
        write(repo, ".github/agents/project-agent.md", '---\nname: project-agent\ndescription: "Project agent"\n---\n');
        writeAuthoringJson(path.join(repo, "docs/SKILL-CANDIDATES.json"), candidates);
      } else {
        skillsRuns++;
        if (failSkills) return { code: 2, stdout: "", stderr: "" };
        write(repo, ".github/skills/project-fixture/SKILL.md", '---\nname: project-fixture\ndescription: "Project fixture"\n---\n# Procedure\n');
      }
      return { code: 0, stdout: "", stderr: "" };
    } },
  };
  assert.equal(await runDraftTeam(repo, false, options), 0);
  await assert.rejects(runDraftSkills(repo, options), /exited with code 2/);
  assert.equal(readAuthoringState(repo).stages.skills?.status, "failed");
  assert.equal(authoringStageIsCurrent(repo, "team", ".github"), true);
  assert.equal(await runDraftTeam(repo, false, options), 0);
  failSkills = false;
  assert.equal(await runDraftSkills(repo, options), 0);
  assert.equal(teamRuns, 1);
  assert.equal(skillsRuns, 2);
  assert.equal(authoringReadiness(repo, ".github").ready, true);
  fs.unlinkSync(path.join(repo, ".github/skills/project-fixture/SKILL.md"));
  assert.equal(authoringReadiness(repo, ".github").ready, false);
});

test("PRD sessions use independent model argv and repo paths concurrently", async (t) => {
  const a = fixture(t);
  const b = fixture(t);
  inventory(a);
  inventory(b);
  const calls: Array<{ repo: string; model: string | undefined }> = [];
  const options = (repo: string, model: string): LauncherOptions => ({
    env: { FORGE_RUN_WITH: "copilot" }, models: { prd: model },
    dependencies: { runLogged: async (_cmd, args, opts) => {
      await new Promise((resolve) => setTimeout(resolve, repo === a ? 5 : 1));
      assert.equal(opts.cwd, repo);
      calls.push({ repo, model: args[args.indexOf("--model") + 1] });
      write(repo, "docs/PRD.md", `# ${model}`);
      return { code: 0, stdout: "", stderr: "" };
    } },
  });
  assert.deepEqual(await Promise.all([runDraftPrd(a, options(a, "prd-1")), runDraftPrd(b, options(b, "team-2"))]), [0, 0]);
  assert.deepEqual(calls.sort((x, y) => x.model!.localeCompare(y.model!)), [{ repo: a, model: "prd-1" }, { repo: b, model: "team-2" }]);
  assert.equal(readAuthoringState(a).stages.prd?.invocation?.effectiveModel, "prd-1");
  assert.equal(readAuthoringState(b).stages.prd?.invocation?.effectiveModel, "team-2");
});

test("retired persisted and environment harness config is rejected before authoring spawn", async (t) => {
  const repo = fixture(t);
  const options: LauncherOptions = {
    env: { FORGE_RUN_WITH: "copilot" },
    dependencies: { runLogged: async () => { throw new Error("unexpected subprocess"); } },
  };
  writeAuthoringJson(path.join(repo, "docs/engine-config.json"), { harness: "flowforge-kernel" });
  await assert.rejects(runDraftPrd(repo, options), /flowforge-kernel.*retired/);
  await assert.rejects(runLauncher({ nonInteractive: true, env: { FORGE_ENGINE_HARNESS: "flowforge-kernel" } }), /flowforge-kernel.*retired/);
  await assert.rejects(runResume({ repo, nonInteractive: true, ...options }), /flowforge-kernel.*retired/);
});

test("feature increment dispatches PRD, team and skills with distinct models before native compile", async (t) => {
  const repo = fixture(t);
  inventory(repo);
  write(repo, "docs/PRD.md", "# Existing requirements");
  write(repo, ".github/skills/forge-execution-adapter/package.json", '{"name":"fixture-adapter"}');
  const calls: Array<{ command: string; model?: string }> = [];
  const options: LauncherOptions = {
    env: { FORGE_RUN_WITH: "copilot" }, models: { prd: "prd-1", team: "team-2", skills: "skills-3" },
    dependencies: { runLogged: async (cmd, args) => {
      if (cmd === process.execPath) return { code: 0, stdout: "", stderr: "" };
      if (cmd === "npm") {
        if (args.includes("compile")) {
          calls.push({ command: "compile" });
          writeAuthoringJson(path.join(repo, "docs/EXECUTION-MANIFEST.json"), { version: "1.0", phases: [] });
        }
        return { code: 0, stdout: "", stderr: "" };
      }
      const message = args[1]!;
      calls.push({ command: message.split(" ")[0]!, model: args[args.indexOf("--model") + 1] });
      if (message.startsWith("/forge-build-feature-prd")) write(repo, "docs/features/new-feature.md", "# New Feature\n\n## Functional Requirements\n- FR-1: New behavior.\n");
      else if (message.startsWith("/forge-build-agent-team")) {
        write(repo, ".github/agents/project-agent.md", '---\nname: project-agent\ndescription: "Project agent"\n---\n');
        writeAuthoringJson(path.join(repo, "docs/SKILL-CANDIDATES.json"), candidates);
      } else write(repo, ".github/skills/project-fixture/SKILL.md", '---\nname: project-fixture\ndescription: "Fixture procedure"\n---\n# Procedure\n');
      return { code: 0, stdout: "", stderr: "" };
    } },
  };
  assert.equal(await runFeatureIncrement(repo, "new behavior", false, options), 0);
  assert.deepEqual(calls, [
    { command: "/forge-build-feature-prd", model: "prd-1" },
    { command: "/forge-build-agent-team", model: "team-2" },
    { command: "/forge-build-project-skills", model: "skills-3" },
    { command: "compile" },
  ]);
  assert.equal(fs.readFileSync(path.join(repo, "docs/PRD.md"), "utf8"), "# Existing requirements");
  assert.equal(authoringReadiness(repo, ".github").ready, true);
});

test("planned missing or structurally invalid skills fail the durable gate", async (t) => {
  const repo = fixture(t);
  write(repo, "docs/PRD.md", "# Existing PRD");
  write(repo, ".github/agents/project-agent.md", '---\nname: project-agent\ndescription: "Project agent"\n---\n');
  writeAuthoringJson(path.join(repo, "docs/SKILL-CANDIDATES.json"), {
    ...candidates, candidates: candidates.candidates.map((candidate) => ({ ...candidate, action: "reuse" })),
  });
  await assert.rejects(runDraftSkills(repo, stub), /Planned project skill is missing/);
  assert.equal(readAuthoringState(repo).stages.skills?.status, "failed");
  write(repo, ".github/skills/project-fixture/SKILL.md", "# Missing frontmatter\n");
  await assert.rejects(runDraftSkills(repo, stub), /structural validation failed/);
  assert.equal(readAuthoringState(repo).stages.skills?.status, "failed");
  write(repo, ".github/skills/project-fixture/SKILL.md", [
    "---",
    "name: project-fixture",
    'description: "Fixture procedure for repeatable project validation work."',
    "---",
    "# Procedure",
    "",
    "## Process",
    "### Step 1: Inspect",
    "Inspect the project fixture and choose the applicable path.",
    "### Step 2: Change",
    "Apply the smallest change, then use the standard command by default.",
    "If that doesn't work, use the fallback command instead.",
    "",
    "Load `references/details.md` when the fixture needs extended guidance.",
    "",
    "## Gotchas",
    "- Fixture paths are rooted at the repository.",
    "- Existing files must remain untouched unless selected.",
    "- The fallback command is required when the standard command is unavailable.",
    "",
    "## Validation",
    "- [ ] Run the standard command.",
    "- [ ] Check the generated output.",
    "- [ ] Review the reference guidance.",
    "",
    "```bash",
    "npm test",
    "```",
    "",
  ].join("\n"));
  write(repo, ".github/skills/project-fixture/references/details.md", "Extended fixture details.\n");
  assert.equal(await runDraftSkills(repo, stub), 0);
  assert.equal(authoringReadiness(repo, ".github").ready, true);
});

test("settings CLI saves and clears stage values and direct draft argv preserves OpenCode IDs", (t) => {
  const repo = fixture(t);
  const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
  const invoke = (args: string[], env: NodeJS.ProcessEnv = {}) => execFileSync(process.execPath, ["--import", "tsx", cli, ...args], {
    encoding: "utf8", env: { ...process.env, ...env },
  });
  invoke(["authoring-config", "--repo", repo, "--prd-model", "anthropic/team-2", "--skills-model", "skills-3"]);
  assert.deepEqual(loadAuthoringConfig(repo).models, { prd: "anthropic/team-2", skills: "skills-3" });
  inventory(repo);
  const output = invoke(["draft-prd", "--repo", repo, "--dry-run"], { FORGE_RUN_WITH: "opencode" });
  assert.match(output, /--model "anthropic\/team-2"/);
  assert.equal(fs.existsSync(path.join(repo, "docs/PRD.md")), false);
  assert.equal(readAuthoringState(repo).stages.prd, undefined);
  invoke(["authoring-config", "--repo", repo, "--prd-model", "inherit"]);
  assert.deepEqual(loadAuthoringConfig(repo).models, { skills: "skills-3" });
});

test("candidate validation rejects unsafe paths and malformed handoff rather than assuming no skills", (t) => {
  const repo = fixture(t);
  writeAuthoringJson(path.join(repo, "docs/SKILL-CANDIDATES.json"), {
    ...candidates, candidates: candidates.candidates.map((candidate) => ({ ...candidate, name: "../elsewhere" })),
  });
  assert.throws(() => readSkillCandidates(repo), /Invalid or duplicate/);
  write(repo, "docs/SKILL-CANDIDATES.json", '{"version":2,"candidates":[]}');
  assert.throws(() => readSkillCandidates(repo), /Invalid SKILL-CANDIDATES/);
});

test("explicit discovery failure records failed stage without spawning an author", async (t) => {
  const repo = fixture(t);
  await assert.rejects(runDraftPrd(repo, {
    env: { FORGE_RUN_WITH: "copilot" }, models: { prd: "unavailable-1" },
    dependencies: {
      inventoryProbe: async () => ({ code: 1, stdout: "", stderr: "offline" }),
      runLogged: async () => { throw new Error("author must not be spawned"); },
    },
  }), /model discovery failed/);
  assert.equal(readAuthoringState(repo).stages.prd?.status, "failed");
  assert.match(readAuthoringState(repo).stages.prd?.error ?? "", /offline/);
});

test("authoring cannot silently take ownership of compiler outputs", async (t) => {
  const repo = fixture(t);
  await assert.rejects(runDraftPrd(repo, {
    env: { FORGE_RUN_WITH: "copilot" },
    dependencies: { runLogged: async () => {
      write(repo, "docs/PRD.md", "# PRD");
      writeAuthoringJson(path.join(repo, "docs/EXECUTION-MANIFEST.json"), { version: "1.0", phases: [] });
      return { code: 0, stdout: "", stderr: "" };
    } },
  }), /compiler- or engine-owned artifacts/);
  assert.equal(readAuthoringState(repo).stages.prd?.status, "failed");
});

test("authoring honors the manifest-selected harness in mixed-root repositories", async (t) => {
  const repo = fixture(t);
  write(repo, ".agents/agents/other-agent.md", '---\nname: other-agent\ndescription: "Other team"\n---\n');
  write(repo, "docs/PRD.md", "# Existing requirements");
  writeAuthoringJson(path.join(repo, "docs/EXECUTION-MANIFEST.json"), {
    version: "1.0", harnessRoot: ".github", phases: [],
  });
  assert.equal(await runDraftTeam(repo, false, stub), 0);
  assert.equal(fs.existsSync(path.join(repo, ".github/agents/stub-project-agent.md")), true);
  assert.equal(fs.existsSync(path.join(repo, ".agents/agents/stub-project-agent.md")), false);
  assert.equal(authoringStageIsCurrent(repo, "team", ".github"), true);
  assert.equal(await runDraftSkills(repo, stub), 0);
  assert.equal(authoringReadiness(repo, ".github").ready, true);
});
