import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readReference, referenceParts, requirementDefinitions, resolvedReferenceBlocks, resolveRequirement } from "./requirement-sources.ts";
import { parseTaskBlocks } from "./task-contract.ts";
import { documentIntegrity } from "./document-integrity.ts";

test("canonical IDs and exact headings resolve without sibling tasks", (context) => {
  const root = mkdtempSync(join(tmpdir(), "forge-sources-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "feature.md"), '# Feature\n## Requirements\n```forge-requirement\n{"id":"FR-1","kind":"requirement","text":"Reject uploads over 10 MB."}\n```\n## Tasks\nDo unrelated work.\n');
  assert.equal(resolveRequirement(root, "feature.md#FR-1", "requirement"), "FR-1: Reject uploads over 10 MB.");
  assert.doesNotMatch(readReference(root, "feature.md#Requirements"), /unrelated/);
  assert.equal(resolvedReferenceBlocks(root, ["feature.md#FR-1", "feature.md#FR-1"]).length, 1);
  assert.throws(() => resolveRequirement(root, "feature.md#FR-1", "constraint"), /Unresolved/);
  assert.throws(() => readReference(root, "feature.md#missing"), /exactly one/);
  assert.throws(() => resolveRequirement(root, "feature.md", "requirement"), /canonical ID/);
});

test("ambiguous definitions and unsafe reference paths fail closed", () => {
  const block = '```forge-requirement\n{"id":"FR-1","kind":"requirement","text":"One rule"}\n```\n';
  assert.throws(() => requirementDefinitions(block + block), /Duplicate canonical/);
  for (const reference of ["../secret.md", "C:/secret.md", "feature.md#", "feature.md#one#two", "./feature.md", "docs\\feature.md"]) assert.throws(() => referenceParts(reference), /repository-relative/);
});

test("compact authoring resolves complete executable contracts and rejects missing rules", (context) => {
  const root = mkdtempSync(join(tmpdir(), "forge-contract-source-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "requirements.md"), '```forge-requirement\n{"id":"FR-1","kind":"requirement","text":"Reject uploads over 10 MB."}\n```\n```forge-requirement\n{"id":"SEC-1","kind":"constraint","text":"Never forward rejected bytes."}\n```\n');
  const source = { id: "UPLOAD-1", title: "Validate upload", description: "Validate upload boundaries", ownerAgent: "worker", dependencies: [], expectedOutputs: ["upload.ts"], validationCommands: ["npm test"], contract: { version: 2, kind: "implementation", requirements: [], requirementRefs: ["requirements.md#FR-1"], acceptanceCriteria: ["Oversized uploads rejected"], constraints: [], constraintRefs: ["requirements.md#SEC-1"], references: [] } };
  const parse = () => parseTaskBlocks('```forge-task\n' + JSON.stringify(source) + '\n```', [], { plannedOwners: true, repoRoot: root })![0]!;
  const task = parse();
  assert.equal(task.contract!.version, 1);
  assert.deepEqual(task.contract!.requirements, ["FR-1: Reject uploads over 10 MB."]);
  assert.deepEqual(task.contract!.constraints, ["SEC-1: Never forward rejected bytes."]);
  assert.deepEqual(task.contract!.references, ["requirements.md#FR-1", "requirements.md#SEC-1"]);
  const sources = new Map([["requirements.md", readReference(root, "requirements.md")]]);
  assert.deepEqual(documentIntegrity(root, sources, [task]).errors, []);
  assert.match(documentIntegrity(root, sources, [task, { ...task, id: "COPY-1" }]).errors.join("\n"), /Duplicate active task bodies/);
  assert.match(documentIntegrity(root, sources, []).errors.join("\n"), /not covered/);
  sources.set("copy.md", readReference(root, "requirements.md"));
  assert.match(documentIntegrity(root, sources, [task]).errors.join("\n"), /Duplicate canonical definition/);
  source.expectedOutputs = ["requirements.md"];
  assert.throws(parse, /distinguish reference inputs/);
  source.expectedOutputs = ["upload.ts"];
  source.contract.requirementRefs = ["requirements.md#MISSING"];
  assert.throws(parse, /Unresolved requirement/);
});