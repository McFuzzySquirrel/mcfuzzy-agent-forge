import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ArtifactStore } from "./artifacts.ts";
import type { Artifact } from "../../forge-execution-adapter/scripts/types.ts";

function makeArtifact(type: string, taskId: string): Omit<Artifact, "artifactId" | "createdAt"> {
  return {
    type,
    category: "work",
    taskId,
    producedBy: "test-agent",
    status: "complete",
    summary: "summary",
    inputs: [],
    filesChanged: [],
    payload: {},
    nextActions: [],
  };
}

test("ArtifactStore assigns unique sequential IDs per type", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-artifacts-"));
  try {
    const store = new ArtifactStore({ artifactsPath: root });
    const a = store.write(makeArtifact("review", "1"));
    const b = store.write(makeArtifact("review", "2"));
    assert.equal(a.artifactId, "review-001");
    assert.equal(b.artifactId, "review-002");

    // A different type starts its own counter
    const c = store.write(makeArtifact("implementation.result", "3"));
    assert.equal(c.artifactId, "implementation-result-001");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ArtifactStore seeds counters from existing files on disk", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-artifacts-"));
  try {
    const store1 = new ArtifactStore({ artifactsPath: root });
    store1.write(makeArtifact("review", "1"));
    store1.write(makeArtifact("review", "2"));

    // A new store instance re-seeds from disk and continues at 003
    const store2 = new ArtifactStore({ artifactsPath: root });
    const d = store2.write(makeArtifact("review", "3"));
    assert.equal(d.artifactId, "review-003");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("synthesise uses task title+description as summary and sets confidence 0.9", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-artifacts-synth-"));
  try {
    const store = new ArtifactStore({ artifactsPath: root });
    const artifact = store.synthesise({
      type: "work.foundation",
      taskId: "1.1",
      taskTitle: "Set up foundation",
      taskDescription: "Create the initial project scaffold and directory structure.",
      producedBy: "agent-a",
      outputFiles: ["src/index.ts", "src/types.ts"],
      agentOutput: "I'll start by understanding the existing code.",
      inputArtifactIds: [],
    });
    assert.equal(artifact.summary, "Set up foundation: Create the initial project scaffold and directory structure.");
    assert.equal(artifact.confidence, 0.9);
    assert.deepEqual(artifact.filesChanged, ["src/index.ts", "src/types.ts"]);
    assert.equal(typeof artifact.payload["agentOutputExcerpt"], "string");
    assert.equal(artifact.payload["taskDescription"], "Create the initial project scaffold and directory structure.");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("synthesise falls back to stdout heuristic when no description is provided", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-artifacts-synth-fallback-"));
  try {
    const store = new ArtifactStore({ artifactsPath: root });
    const artifact = store.synthesise({
      type: "work.foundation",
      taskId: "1.1",
      taskTitle: "Set up foundation",
      taskDescription: "",
      producedBy: "agent-a",
      outputFiles: [],
      agentOutput: "Created the main entry point and wired up the router.\nAlso added startup wiring.",
      inputArtifactIds: [],
    });
    assert.equal(artifact.summary, "Created the main entry point and wired up the router.");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("project() default fields include filesChanged and agentOutputExcerpt", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-artifacts-proj-"));
  try {
    const store = new ArtifactStore({ artifactsPath: root });
    store.write({
      ...makeArtifact("work.foundation", "1.1"),
      filesChanged: ["src/app.ts", "src/types.ts"],
      confidence: 0.9,
      payload: { agentOutputExcerpt: "Wired up the router and created base types." },
    });

    const projection = store.project({ taskId: "2.1", inputTypes: ["work.foundation"] });
    assert.equal(projection.artifacts.length, 1);
    const a = projection.artifacts[0]!;
    assert.deepEqual(a.selectedFields["filesChanged"], ["src/app.ts", "src/types.ts"]);
    assert.equal(a.selectedFields["agentOutputExcerpt"], "Wired up the router and created base types.");
    assert.equal(a.confidence, 0.9);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renderProjection renders filesChanged as a bullet list and omits empty arrays", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-artifacts-render-"));
  try {
    const store = new ArtifactStore({ artifactsPath: root });
    store.write({
      ...makeArtifact("work.foundation", "1.1"),
      filesChanged: ["src/app.ts", "src/types.ts"],
      summary: "Set up the foundation.",
      confidence: 0.9,
      payload: { agentOutputExcerpt: "Created entry point." },
    });

    const projection = store.project({ taskId: "2.1", inputTypes: ["work.foundation"] });
    const rendered = store.renderProjection(projection);

    assert.ok(rendered.includes("**Files changed:**"), "should include files changed heading");
    assert.ok(rendered.includes("- src/app.ts"), "should list first file");
    assert.ok(rendered.includes("- src/types.ts"), "should list second file");
    assert.ok(rendered.includes("**agentOutputExcerpt:** Created entry point."), "should include excerpt");
    assert.ok(rendered.includes("**Summary:** Set up the foundation."), "should include summary");
    assert.ok(rendered.includes("**Confidence:** 90%"), "should include confidence");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renderProjection omits empty filesChanged", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-artifacts-render-empty-"));
  try {
    const store = new ArtifactStore({ artifactsPath: root });
    store.write({
      ...makeArtifact("work.foundation", "1.1"),
      filesChanged: [],
      summary: "No files.",
      payload: {},
    });

    const projection = store.project({ taskId: "2.1", inputTypes: ["work.foundation"] });
    const rendered = store.renderProjection(projection);
    assert.ok(!rendered.includes("**Files changed:**"), "should not render empty files list");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
