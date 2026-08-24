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
