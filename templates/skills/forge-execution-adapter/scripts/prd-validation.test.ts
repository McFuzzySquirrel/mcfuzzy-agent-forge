import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validatePrd } from "./prd-validation.ts";

const task = { id: "BUILD-1", title: "Validate uploads", description: "Reject oversized uploads before extraction", ownerAgent: "documents-engineer", dependencies: [] as string[], expectedOutputs: ["src/upload.ts", "tests/upload.test.ts"], validationCommands: ["npm test -- upload"], contract: { version: 1, kind: "implementation", requirements: ["FR-001: Reject oversized uploads"], acceptanceCriteria: ["Extractor never receives rejected bytes"], constraints: [], references: ["docs/requirements.md"] } };
const document = (value = task) => '# PRD\n## Phase 1: Uploads\n```forge-task\n' + JSON.stringify(value) + '\n```\n';
function fixture(text = document()) {
  const root = mkdtempSync(join(tmpdir(), "prd-validation-"));
  mkdirSync(join(root, "docs/features"), { recursive: true });
  writeFileSync(join(root, "docs/requirements.md"), "Upload limits");
  writeFileSync(join(root, "docs/PRD.md"), "# Vision\n## 14. Features\n| # | Feature | File | Dependencies |\n| 1 | Upload | features/upload.md | None |\n");
  writeFileSync(join(root, "docs/features/upload.md"), text);
  return root;
}
test("even a single-task solution requires canonical features and ignores historical PRDs", () => {
  const root = mkdtempSync(join(tmpdir(), "features-required-"));
  mkdirSync(join(root, "docs/features"), { recursive: true });
  writeFileSync(join(root, "docs/product-vision.md"), document());
  writeFileSync(join(root, "docs/requirements.md"), "Upload limits");
  assert.match(validatePrd(root).errors.join("\n"), /Missing docs\/PRD/);
  writeFileSync(join(root, "docs/PRD.md"), "# Vision\n## 14. Features\n| # | Feature | File | Dependencies |\n| 1 | Upload | features/upload.md | None |\n");
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
  writeFileSync(join(root, "docs/PRD.md"), vision + "Missing |\n");
  assert.match(validatePrd(root).errors.join("\n"), /unknown dependency/);
  writeFileSync(join(root, "docs/PRD.md"), vision + "Upload |\n");
  assert.match(validatePrd(root).errors.join("\n"), /cycle/);
});

test("incremental feature tasks resolve existing IDs without accepting unknown prerequisites", () => {
  const root = fixture();
  const file = "docs/features/new.md";
  writeFileSync(join(root, "docs/PRD.md"), "# Vision\n## 14. Features\n| # | Feature | File | Dependencies |\n| 1 | Upload | features/upload.md | None |\n| 2 | New | features/new.md | Upload |\n");
  writeFileSync(join(root, file), document({ ...task, id: "NEW-1", description: "Add another upload behavior", dependencies: ["BUILD-1"] }));
  assert.deepEqual(validatePrd(root, { featureFiles: [file] }).errors, []);
  writeFileSync(join(root, file), document({ ...task, id: "NEW-1", dependencies: ["UNKNOWN"] }));
  assert.match(validatePrd(root, { featureFiles: [file] }).errors.join("\n"), /unknown dependency/);
});

test("incremental validation checks canonical ownership and coverage across all features", () => {
  const definition = '```forge-requirement\n{"id":"FR-001","kind":"requirement","text":"Reject oversized uploads"}\n```\n';
  const root = fixture(definition + document());
  const file = "docs/features/new.md";
  const vision = "# Vision\n## 14. Features\n| # | Feature | File | Dependencies |\n| 1 | Upload | features/upload.md | None |\n| 2 | New | features/new.md | Upload |\n";
  writeFileSync(join(root, "docs/PRD.md"), vision);
  writeFileSync(join(root, file), document({ ...task, id: "NEW-1", description: "Add upload history" }));
  assert.deepEqual(validatePrd(root, { featureFiles: [file] }).errors, []);
  writeFileSync(join(root, "docs/PRD.md"), vision + definition);
  assert.match(validatePrd(root, { featureFiles: [file] }).errors.join("\n"), /Duplicate canonical definition/);
  writeFileSync(join(root, "docs/PRD.md"), vision + definition.replace("FR-001", "FR-002"));
  assert.match(validatePrd(root, { featureFiles: [file] }).errors.join("\n"), /not covered/);
  writeFileSync(join(root, "docs/PRD.md"), vision.replace("| 2 | New | features/new.md | Upload |\n", ""));
  assert.match(validatePrd(root, { featureFiles: [file] }).errors.join("\n"), /missing from the vision/);
  unlinkSync(join(root, "docs/PRD.md"));
  assert.match(validatePrd(root, { featureFiles: [file] }).errors.join("\n"), /Missing docs\/PRD/);
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