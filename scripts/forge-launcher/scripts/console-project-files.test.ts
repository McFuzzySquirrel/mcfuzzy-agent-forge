import assert from "node:assert/strict";
import { test } from "node:test";

import { buildProjectFiles } from "./console/dashboard/views/project-files-model.ts";
import type { ArtifactIndex, DocsIndex } from "./console/dashboard/types.ts";

test("Project files presents useful documents and deduplicated outputs without task provenance", () => {
  const docs: DocsIndex = {
    entries: [
      { id: "idea", kind: "idea", title: "Project Idea", relPath: "docs/IDEA.md", exists: true },
      { id: "vision", kind: "vision", title: "PRD", relPath: "docs/PRD.md", exists: true },
      { id: "progress", kind: "progress", title: "Progress", relPath: "docs/PROGRESS.md", exists: false },
      { id: "model-plan", kind: "model-plan", title: "Model Plan", relPath: "docs/MODEL-PLAN.md", exists: true },
      { id: "feature:accounts.md", kind: "feature", title: "accounts", relPath: "docs/features/accounts.md", exists: true },
    ],
  };
  const artifacts: ArtifactIndex = {
    artifacts: [
      {
        artifactId: "solution-001",
        type: "solution",
        category: "work",
        taskId: "1.1",
        producedBy: "developer",
        status: "complete",
        summary: "Implemented the application",
        createdAt: "2026-11-04T00:00:00.000Z",
        filesChanged: ["src/app.ts", "src/app.ts", "docs/PRD.md", "docs/PROGRESS.md", "  "],
        inputs: [],
      },
    ],
    types: ["solution"],
  };

  const projectFiles = buildProjectFiles(docs, artifacts);

  assert.deepEqual(
    projectFiles.documents.map(({ title, path, available }) => ({ title, path, available })),
    [
      { title: "Project idea", path: "docs/IDEA.md", available: true },
      { title: "Project brief", path: "docs/PRD.md", available: true },
      { title: "Build progress", path: "docs/PROGRESS.md", available: false },
      { title: "Feature addition: accounts", path: "docs/features/accounts.md", available: true },
    ],
  );
  assert.deepEqual(projectFiles.deliverables, [{ title: "app.ts", path: "src/app.ts" }]);
  assert.equal("taskId" in projectFiles.deliverables[0]!, false);
  assert.equal("artifactId" in projectFiles.deliverables[0]!, false);
});
