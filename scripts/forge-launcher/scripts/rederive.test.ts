import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  REDERIVE_STEPS,
  completeRederiveStep,
  failRederiveStep,
  newRederiveState,
  readRederiveState,
  rederiveProgress,
  rederiveStatePath,
  startRederive,
  startRederiveStep,
} from "./rederive-state.ts";
import { authoringStageDetails, explainStaleness, fingerprintFiles, saveAuthoringStage, stageInputFingerprint, type AuthoringStageState } from "./authoring-state.ts";
import { writeAuthoringJson } from "./authoring-config.ts";

const HARNESS = ".agents";

function repo(t: { after: (fn: () => void) => void }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-rederive-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "docs", "features"), { recursive: true });
  fs.mkdirSync(path.join(root, HARNESS, "agents"), { recursive: true });
  return root;
}

function write(root: string, relative: string, text: string): void {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

/** A completed stage record whose fingerprints match the repository as it stands. */
function completeStage(root: string, stage: "team" | "skills"): AuthoringStageState {
  return {
    status: "complete",
    inputFingerprint: stageInputFingerprint(root, stage, HARNESS),
    outputs: [],
    outputFingerprint: fingerprintFiles(root, []),
    completedAt: new Date().toISOString(),
  };
}

// ─── Step state machine ───────────────────────────────────────────────────────

test("a fresh chain reports three pending steps and no progress", (t) => {
  const root = repo(t);
  const progress = rederiveProgress(root);
  assert.deepEqual(progress.steps, []);
  assert.equal(progress.active, false);
  assert.equal(progress.complete, false);
  assert.equal(progress.currentStep, null);
  assert.equal(progress.failedStep, null);

  startRederive(root);
  const started = rederiveProgress(root);
  assert.deepEqual(started.steps.map((step) => step.id), [...REDERIVE_STEPS]);
  assert.ok(started.steps.every((step) => step.status === "pending"));
  assert.equal(started.active, false);
  assert.equal(started.complete, false);
  assert.equal(started.currentStep, "team");
});

test("starting a step marks it running and points the UI at it", (t) => {
  const root = repo(t);
  startRederive(root);
  startRederiveStep(root, "team", "Regenerating the agent team from the PRD…");
  const progress = rederiveProgress(root);
  assert.equal(progress.active, true);
  assert.equal(progress.currentStep, "team");
  assert.equal(progress.steps[0]!.status, "running");
  assert.equal(progress.steps[0]!.message, "Regenerating the agent team from the PRD…");
  assert.ok(progress.steps[0]!.startedAt);
});

test("completing every step reports a complete chain", (t) => {
  const root = repo(t);
  startRederive(root);
  for (const id of REDERIVE_STEPS) {
    startRederiveStep(root, id);
    completeRederiveStep(root, id, `${id} done`);
  }
  const progress = rederiveProgress(root);
  assert.equal(progress.complete, true);
  assert.equal(progress.active, false);
  assert.equal(progress.currentStep, null);
  assert.equal(progress.failedStep, null);
  assert.ok(progress.steps.every((step) => step.status === "complete" && step.finishedAt));
});

test("a failed step keeps its message and is the retry point", (t) => {
  const root = repo(t);
  startRederive(root);
  startRederiveStep(root, "team");
  completeRederiveStep(root, "team");
  startRederiveStep(root, "skills");
  failRederiveStep(root, "skills", "Project-skill generation failed.");

  const progress = rederiveProgress(root);
  assert.equal(progress.failedStep, "skills");
  assert.equal(progress.complete, false);
  assert.equal(progress.steps[0]!.status, "complete", "the completed team step must be preserved");
  assert.equal(progress.steps[1]!.status, "failed");
  assert.equal(progress.steps[1]!.message, "Project-skill generation failed.");
  assert.equal(progress.steps[2]!.status, "pending");
  assert.equal(progress.currentStep, "manifest");
});

test("restarting a chain from a step re-runs that step and its whole tail", (t) => {
  const root = repo(t);
  startRederive(root);
  for (const id of REDERIVE_STEPS) {
    startRederiveStep(root, id);
    completeRederiveStep(root, id);
  }
  // The team is regenerated, so the skills derived from the old team and the
  // manifest compiled from it are no longer true even though both are marked
  // complete. Retrying from `team` must clear them.
  startRederive(root);
  startRederiveStep(root, "team");
  const progress = rederiveProgress(root);
  assert.equal(progress.steps[0]!.status, "running");
  assert.equal(progress.steps[1]!.status, "pending");
  assert.equal(progress.steps[2]!.status, "pending");
  assert.notEqual(progress.complete, true);
});

test("a new chain gets a new run id so a retry is distinguishable from the failed one", (t) => {
  const root = repo(t);
  const first = startRederive(root);
  startRederiveStep(root, "team");
  failRederiveStep(root, "team", "boom");
  const second = startRederive(root);
  assert.notEqual(first.runId, second.runId);
  assert.equal(rederiveProgress(root).steps[0]!.status, "pending");
});

test("chain state survives a fresh read, so a reloaded client resumes the step machine", (t) => {
  const root = repo(t);
  startRederive(root);
  startRederiveStep(root, "team");
  const reread = readRederiveState(root);
  assert.ok(reread);
  assert.equal(reread.steps[0]!.status, "running");
  assert.ok(fs.existsSync(rederiveStatePath(root)));
});

test("a malformed chain file throws rather than silently reading as never-run", (t) => {
  const root = repo(t);
  writeAuthoringJson(rederiveStatePath(root), { version: 1, runId: "x", steps: [{ id: "team", status: "running" }] });
  assert.throws(() => readRederiveState(root), /Invalid re-derivation state/);
});

test("a chain file missing a step is rejected", (t) => {
  const root = repo(t);
  writeAuthoringJson(rederiveStatePath(root), {
    version: 1,
    runId: "x",
    steps: [{ id: "team", label: "Agent team", status: "complete" }, { id: "skills", label: "Project skills", status: "complete" }],
  });
  assert.throws(() => readRederiveState(root), /Invalid re-derivation state/);
});

test("newRederiveState is a pure value with no repository side effects", (t) => {
  const root = repo(t);
  const state = newRederiveState("fixed-run");
  assert.equal(state.runId, "fixed-run");
  assert.equal(state.version, 1);
  assert.deepEqual(state.steps.map((step) => step.id), [...REDERIVE_STEPS]);
  assert.equal(fs.existsSync(rederiveStatePath(root)), false);
});

// ─── Staleness explanation ────────────────────────────────────────────────────

test("a stage that has not been authored is untracked, not stale", (t) => {
  const root = repo(t);
  const explanation = explainStaleness(root, "team", HARNESS);
  assert.equal(explanation.stale, false);
  assert.deepEqual(explanation.staleInputs, []);
  const [prd, team, skills] = authoringStageDetails(root, HARNESS);
  assert.equal(prd!.status, "untracked");
  assert.equal(team!.status, "untracked");
  assert.equal(skills!.status, "untracked");
  assert.equal(team!.reason, "");
});

test("a current stage reports no reason at all", (t) => {
  const root = repo(t);
  write(root, "docs/PRD.md", "# PRD\n");
  write(root, "docs/features/board.md", "# Board\n");
  saveAuthoringStage(root, "team", completeStage(root, "team"));
  const explanation = explainStaleness(root, "team", HARNESS);
  assert.equal(explanation.stale, false);
  assert.equal(explanation.reason, "");
});

/**
 * The staleness explanation compares an input's mtime against the stage's
 * `completedAt`, so tests drive that clock explicitly instead of sleeping: a
 * wall-clock wait is slow, and a same-millisecond write is indistinguishable
 * from no write at all on a fast machine.
 */
const PAST = "2001-01-01T00:00:00.000Z";

function backdate(root: string, relative: string, iso = PAST): void {
  const when = new Date(iso);
  fs.utimesSync(path.join(root, relative), when, when);
}

/** A team stage that completed at the same instant its inputs were last written. */
function settledTeamStage(root: string): void {
  backdate(root, "docs/PRD.md");
  backdate(root, "docs/features/board.md");
  saveAuthoringStage(root, "team", { ...completeStage(root, "team"), completedAt: PAST });
}

test("editing the PRD after the team stage explains staleness by naming the file", (t) => {
  const root = repo(t);
  write(root, "docs/PRD.md", "# PRD\n");
  write(root, "docs/features/board.md", "# Board\n");
  settledTeamStage(root);
  assert.equal(explainStaleness(root, "team", HARNESS).stale, false, "precondition: the stage starts out current");

  // Rewriting the PRD gives it a fresh mtime, later than the stage's
  // completion, and changes the fingerprint the staleness decision rests on.
  write(root, "docs/PRD.md", "# PRD\n\nA new requirement.\n");

  const explanation = explainStaleness(root, "team", HARNESS);
  assert.equal(explanation.stale, true);
  assert.match(explanation.reason, /Inputs changed after this stage completed/);
  assert.deepEqual(explanation.staleInputs.map((entry) => entry.path), ["docs/PRD.md"]);

  const team = authoringStageDetails(root, HARNESS)[1]!;
  assert.equal(team.stale, true);
  assert.equal(team.status, "complete");
  assert.match(team.reason, /docs\/PRD\.md/);
});

test("several changed inputs are all named", (t) => {
  const root = repo(t);
  write(root, "docs/PRD.md", "# PRD\n");
  write(root, "docs/features/board.md", "# Board\n");
  settledTeamStage(root);
  write(root, "docs/features/board.md", "# Board\n\nRevised.\n");
  write(root, "docs/PRD.md", "# PRD\n\nAlso revised.\n");

  const explanation = explainStaleness(root, "team", HARNESS);
  assert.equal(explanation.stale, true);
  const named = explanation.staleInputs.map((entry) => entry.path).sort();
  assert.deepEqual(named, ["docs/PRD.md", "docs/features/board.md"]);
});

test("a changed file under the harness directory is named with POSIX separators", (t) => {
  const root = repo(t);
  const agent = `${HARNESS}/agents/api-engineer.md`;
  write(root, "docs/PRD.md", "# PRD\n");
  write(root, agent, "# api-engineer\n");
  backdate(root, "docs/PRD.md");
  backdate(root, agent);
  saveAuthoringStage(root, "skills", { ...completeStage(root, "skills"), completedAt: PAST });
  assert.equal(explainStaleness(root, "skills", HARNESS).stale, false, "precondition: the stage starts out current");

  write(root, agent, "# api-engineer\n\nmodel: some/model\n");

  const explanation = explainStaleness(root, "skills", HARNESS);
  assert.equal(explanation.stale, true);
  // The skills stage names the harness agents directory via `path.join`, so
  // without normalisation this reads `.agents\agents\api-engineer.md` on Windows.
  assert.deepEqual(explanation.staleInputs.map((entry) => entry.path), [".agents/agents/api-engineer.md"]);
  // The reason is the string a user actually reads, so it is the contract worth
  // pinning: one sentence must not mix `docs/PRD.md` with a Windows path.
  assert.ok(!explanation.reason.includes("\\"), `reason leaked a separator: ${explanation.reason}`);
});

test("a deleted generated output explains staleness without blaming the inputs", (t) => {
  const root = repo(t);
  write(root, "docs/PRD.md", "# PRD\n");
  saveAuthoringStage(root, "team", {
    status: "complete",
    inputFingerprint: stageInputFingerprint(root, "team", HARNESS),
    outputs: ["docs/TEAM.md"],
    completedAt: new Date().toISOString(),
  });
  const explanation = explainStaleness(root, "team", HARNESS);
  assert.equal(explanation.stale, true);
  assert.match(explanation.reason, /Generated output removed from disk: docs\/TEAM\.md/);
  assert.deepEqual(explanation.staleInputs, []);
});

test("a failed stage reports its recorded error rather than calling itself stale", (t) => {
  const root = repo(t);
  write(root, "docs/PRD.md", "# PRD\n");
  saveAuthoringStage(root, "team", {
    status: "failed",
    inputFingerprint: stageInputFingerprint(root, "team", HARNESS),
    outputs: [],
    error: "The model returned no agents.",
  });
  const explanation = explainStaleness(root, "team", HARNESS);
  assert.equal(explanation.stale, false);
  const team = authoringStageDetails(root, HARNESS)[1]!;
  assert.equal(team.status, "failed");
  assert.equal(team.stale, false);
  assert.equal(team.reason, "The model returned no agents.");
});

test("stage details cover every authoring stage in pipeline order", (t) => {
  const root = repo(t);
  assert.deepEqual(authoringStageDetails(root, HARNESS).map((entry) => entry.stage), ["prd", "team", "skills"]);
});