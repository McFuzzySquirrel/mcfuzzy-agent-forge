import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import matter from "gray-matter";
import { HARNESS_ROOTS, parseMetadata, selectHarnessRoot, selectProjectHarnessRoot } from "./repo-metadata.ts";
import { detectHarnessRoot, repoPaths } from "./console/paths.ts";
import { team } from "./console/repo.ts";
import { bootstrap } from "./bootstrap.ts";

function fixture(t: { after(fn: () => void): void }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-metadata-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("all metadata consumers prefer agent files over skills-only and empty roots", (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, ".agents", "skills"), { recursive: true });
  fs.mkdirSync(path.join(root, ".github", "agents"), { recursive: true });
  fs.mkdirSync(path.join(root, ".opencode", "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, ".opencode", "agents", "worker.md"), '---\nname: worker\ndescription: "Build things"\n---\n');
  assert.equal(selectHarnessRoot(root).root, ".opencode");
  assert.equal(detectHarnessRoot(root), ".opencode");
  assert.equal(team(repoPaths(root)).harnessRoot, ".opencode");
  assert.match(selectHarnessRoot(root).warnings.join("\n"), /Ignoring skills-only/);
  assert.equal(selectHarnessRoot(root, ".github").root, ".github");
  assert.throws(() => selectHarnessRoot(root, ".claude"), /does not exist/);
});

test("metadata supports each bootstrapped harness and ignores unrelated GitHub configuration", (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
  assert.equal(selectHarnessRoot(root).root, null);
  for (const harness of HARNESS_ROOTS) {
    const repo = path.join(root, harness);
    fs.mkdirSync(path.join(repo, harness, "skills"), { recursive: true });
    assert.equal(selectHarnessRoot(repo).root, harness);
  }
});

test("Console reports only the selected team instead of mixing duplicate agent identities", (t) => {
  const root = fixture(t);
  for (const harness of [".agents", ".opencode"]) {
    const dir = path.join(root, harness, "agents");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "worker.md"), `---\nname: worker\ndescription: "${harness} worker"\n---\n`);
  }
  const result = team(repoPaths(root));
  assert.equal(result.harnessRoot, ".agents");
  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0]?.description, ".agents worker");
});

test("a bootstrapped tooling-only root cannot hide a generated team", (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, ".agents", "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, ".agents", "agents", "forge-team-builder.md"), "# Team builder\n");
  fs.mkdirSync(path.join(root, ".opencode", "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, ".opencode", "agents", "worker.md"), "---\nname: worker\n---\n");
  assert.equal(selectHarnessRoot(root).root, ".opencode");
  assert.equal(team(repoPaths(root)).agents[0]?.name, "worker");
});

test("Console honors the manifest-selected team and rejects invalid persisted roots", (t) => {
  const root = fixture(t);
  for (const harness of [".agents", ".github"]) {
    const dir = path.join(root, harness, "agents");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "worker.md"), `---\nname: worker\ndescription: "${harness} worker"\n---\n`);
  }
  fs.mkdirSync(path.join(root, "docs"));
  const manifest = path.join(root, "docs", "EXECUTION-MANIFEST.json");
  fs.writeFileSync(manifest, JSON.stringify({ harnessRoot: ".github" }));
  assert.equal(detectHarnessRoot(root), ".github");
  assert.equal(team(repoPaths(root)).agents[0]?.description, ".github worker");
  assert.equal(selectProjectHarnessRoot(root, ".agents").root, ".agents");
  fs.writeFileSync(manifest, JSON.stringify({ harnessRoot: ".claude" }));
  assert.throws(() => detectHarnessRoot(root), /does not exist/);
  fs.writeFileSync(manifest, JSON.stringify({ harnessRoot: 42 }));
  assert.throws(() => detectHarnessRoot(root), /harnessRoot must be a string/);
});

test("shared parser preserves quoted and block YAML and reports invalid documents", () => {
  const parsed = parseMetadata('---\nname: "worker"\ndescription: >-\n  First: sentence\n  Second sentence\nmodel: "provider/model"\n---\nBody\n', matter, "worker.md");
  assert.equal(parsed.data.description, "First: sentence Second sentence");
  assert.equal(parsed.data.model, "provider/model");
  assert.equal(parsed.content, "Body\n");
  assert.throws(() => parseMetadata("---\ndescription: bad: value\n---\n", matter, "bad.md"), /Invalid YAML frontmatter in bad.md/);
  assert.throws(() => parseMetadata("", () => ({ data: [], content: "" }), "array.md"), /must be a mapping/);
});

test("canonical metadata module works when copied outside the source checkout", async (t) => {
  const root = fixture(t);
  const source = fileURLToPath(new URL("../../../templates/skills/forge-execution-adapter/scripts/repo-metadata.mjs", import.meta.url));
  const copied = path.join(root, "repo-metadata.mjs");
  fs.copyFileSync(source, copied);
  const standalone: typeof import("./repo-metadata.ts") = await import(pathToFileURL(copied).href);
  fs.mkdirSync(path.join(root, ".github", "skills"), { recursive: true });
  assert.equal(standalone.selectHarnessRoot(root).root, ".github");
  assert.equal(standalone.parseMetadata("---\nname: copied\n---\n", matter).data.name, "copied");
});

test("bootstrap distributes standalone metadata for every harness", async (t) => {
  const root = fixture(t);
  for (const harness of ["agents", "github", "claude", "opencode"] as const) {
    const target = path.join(root, harness);
    fs.mkdirSync(path.join(target, ".git"), { recursive: true });
    await bootstrap({ targetDir: target, harness, force: true, nonInteractive: true });
    const helper = path.join(target, `.${harness}`, "skills", "forge-execution-adapter", "scripts", "repo-metadata.mjs");
    const standalone: typeof import("./repo-metadata.ts") = await import(pathToFileURL(helper).href);
    assert.equal(standalone.selectHarnessRoot(target).root, `.${harness}`);
    assert.ok(fs.existsSync(helper.replace(/\.mjs$/, ".d.mts")));
    assert.equal(fs.existsSync(path.join(target, `.${harness}`, "skills", "forge-workforce-compiler")), false);
    assert.ok(fs.existsSync(path.join(target, `.${harness}`, "skills", "forge-build-project-skills", "SKILL.md")));
  }
});

test("retirement does not delete existing downstream workforce artifacts or modified skills", async (t) => {
  const root = fixture(t);
  const retired = path.join(root, ".github", "skills", "forge-workforce-compiler");
  fs.mkdirSync(path.join(root, ".git"));
  fs.mkdirSync(retired, { recursive: true });
  fs.mkdirSync(path.join(root, ".workforce"));
  fs.mkdirSync(path.join(root, "docs"));
  const artifacts = [
    path.join(retired, "SKILL.md"),
    path.join(root, ".workforce", "custom.json"),
    path.join(root, "docs", "KERNEL-BRIDGE.json"),
  ];
  for (const file of artifacts) fs.writeFileSync(file, "User-owned legacy artifact.\n");
  await bootstrap({ targetDir: root, harness: "github", force: true, nonInteractive: true });
  for (const file of artifacts) assert.equal(fs.readFileSync(file, "utf8"), "User-owned legacy artifact.\n");
});
