import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { decompositionRequired, validatePrd } from "./prd-validation.ts";

const task = { id: "BUILD-1", title: "Validate uploads", description: "Reject oversized uploads before extraction", ownerAgent: "documents-engineer", dependencies: [] as string[], expectedOutputs: ["src/upload.ts", "tests/upload.test.ts"], validationCommands: ["npm test -- upload"], contract: { version: 1, kind: "implementation", requirements: ["FR-001: Reject oversized uploads"], acceptanceCriteria: ["Extractor never receives rejected bytes"], constraints: [], references: ["docs/requirements.md"] } };
const document = (value = task) => '# PRD\n## Phase 1: Uploads\n```forge-task\n' + JSON.stringify(value) + '\n```\n';
function fixture(text = document()) {
  const root = mkdtempSync(join(tmpdir(), "prd-validation-"));
  mkdirSync(join(root, "docs/features"), { recursive: true });
  writeFileSync(join(root, "docs/requirements.md"), "Upload limits");
  writeFileSync(join(root, "docs/PRD.md"), text);
  return root;
}
test("decomposition threshold applies at 3 phases or 15 unique requirements", () => {
  assert.equal(decompositionRequired("## Phase 0: A\n## Phase 1: B\n## Phase 2: C"), true);
  assert.equal(decompositionRequired("FR-001–015"), true);
  assert.equal(decompositionRequired("FR-001\n".repeat(20)), false);
  assert.equal(decompositionRequired("## Phase 1: A\n## Phase 2: B"), false);
  assert.equal(decompositionRequired("FR-001-014"), false);
  assert.equal(decompositionRequired("FR-001-FR-015"), true);
  assert.equal(decompositionRequired("```text\n## Phase 1\n## Phase 2\n## Phase 3\nFR-001-015\n```"), false);
});
test("qualifying PRD requires canonical decomposition, not assorted domain documents", () => {
  const root = fixture(document() + "## Phase 2: B\n## Phase 3: C\n");
  assert.ok(validatePrd(root).errors.length);
  writeFileSync(join(root, "docs/product-vision.md"), "# Vision\n## 14. Features\n| # | Feature | File | Dependencies |\n| 1 | Upload | features/upload.md | None |\n");
  assert.match(validatePrd(root).errors.join("\n"), /features/);
  writeFileSync(join(root, "docs/features/upload.md"), document());
  const result = validatePrd(root);
  assert.deepEqual(result.errors, []);
  assert.ok(result.outputs.includes("docs/features/upload.md"));
});
test("authoring validation catches banking-style invalid contracts before team generation", () => {
  assert.deepEqual(validatePrd(fixture()).errors, []);
  assert.match(validatePrd(fixture(document({ ...task, validationCommands: [] }))).errors.join("\n"), /validationCommands/);
  assert.match(validatePrd(fixture(document({ ...task, expectedOutputs: ["docs/requirements.md"] }))).errors.join("\n"), /reference inputs/);
  assert.match(validatePrd(fixture(document({ ...task, expectedOutputs: ["src/uploads"] }))).errors.join("\n"), /concrete deliverable/);
  assert.match(validatePrd(fixture(document({ ...task, dependencies: ["MISSING"] }))).errors.join("\n"), /unknown dependency/);
  assert.match(validatePrd(fixture(document({ ...task, ownerAgent: "project-orchestrator" }))).errors.join("\n"), /implementation owner/);
});

test("feature graphs and task dependencies fail closed before compilation", () => {
  const root = fixture(document() + "## Phase 2: B\n## Phase 3: C\n");
  writeFileSync(join(root, "docs/features/upload.md"), document());
  const vision = "# Vision\n## 14. Features\n| # | Feature | File | Dependencies |\n| 1 | Upload | features/upload.md | ";
  writeFileSync(join(root, "docs/product-vision.md"), vision + "Missing |\n");
  assert.match(validatePrd(root).errors.join("\n"), /unknown dependency/);
  writeFileSync(join(root, "docs/product-vision.md"), vision + "Upload |\n");
  assert.match(validatePrd(root).errors.join("\n"), /cycle/);
});

test("incremental feature tasks resolve existing IDs without accepting unknown prerequisites", () => {
  const root = fixture();
  const file = "docs/features/new.md";
  writeFileSync(join(root, file), document({ ...task, id: "NEW-1", dependencies: ["BUILD-1"] }));
  assert.deepEqual(validatePrd(root, { featureFiles: [file] }).errors, []);
  writeFileSync(join(root, file), document({ ...task, id: "NEW-1", dependencies: ["UNKNOWN"] }));
  assert.match(validatePrd(root, { featureFiles: [file] }).errors.join("\n"), /unknown dependency/);
});

test("empty phase placeholders and empty incremental selections fail validation", () => {
  assert.match(validatePrd(fixture(document() + "## Phase 2: Pending\n")).errors.join("\n"), /Phase 2.*no valid structured tasks/);
  assert.match(validatePrd(fixture(), { featureFiles: [] }).errors.join("\n"), /Select at least one/);
});

test("authoring rejects missing references, malformed tasks, duplicates and backward phase cycles", () => {
  assert.match(validatePrd(fixture(document({ ...task, contract: { ...task.contract, references: ["docs/missing.md"] } }))).errors.join("\n"), /missing.md/);
  assert.match(validatePrd(fixture(document().replace('"id":', '"id"'))).errors.join("\n"), /JSON/);
  assert.match(validatePrd(fixture(document() + document())).errors.join("\n"), /Duplicate global task ID/);
  const first = document({ ...task, dependencies: ["BUILD-2"] });
  const second = document({ ...task, id: "BUILD-2" }).replace("Phase 1", "Phase 2");
  assert.match(validatePrd(fixture(first + second)).errors.join("\n"), /cycle/);
});