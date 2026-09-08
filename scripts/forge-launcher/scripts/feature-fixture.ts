import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function writeFeatureFixture(repo: string, text = "# Fixture requirements", id = "BUILD-1"): void {
  mkdirSync(join(repo, "docs/features"), { recursive: true });
  const task = { id, title: `Build ${id}`, description: `Implement ${id} behavior`, ownerAgent: "project-agent", dependencies: [], expectedOutputs: ["src/behavior.ts"], validationCommands: ["npm test"], contract: { version: 1, kind: "implementation", requirements: ["FR-1: Behavior"], acceptanceCriteria: ["Behavior verified"], constraints: [], references: ["docs/PRD.md"] } };
  writeFileSync(join(repo, "docs/features/fixture.md"), text.includes("```forge-task") ? text : `# Feature: Fixture\n## Phase 1: Build\n\`\`\`forge-task\n${JSON.stringify(task)}\n\`\`\`\n`);
  writeFileSync(join(repo, "docs/PRD.md"), (text.includes("```forge-task") ? "# Product Vision" : text) + "\n## 14. Features\n| # | Feature | File | Dependencies |\n| 1 | Fixture | features/fixture.md | None |\n");
}