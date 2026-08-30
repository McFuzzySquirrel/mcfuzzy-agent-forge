import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("./validate-frontmatter.mjs", import.meta.url));

function harnessFixture() {
  const root = mkdtempSync(join(tmpdir(), "fm-validate-"));
  mkdirSync(join(root, "agents"), { recursive: true });
  mkdirSync(join(root, "skills", "demo-skill"), { recursive: true });
  return root;
}

function run(root) {
  try {
    const out = execFileSync(process.execPath, [CLI, "--harness-root", root], { encoding: "utf8" });
    return { status: 0, out };
  } catch (err) {
    const e = err;
    return { status: e.status ?? 1, out: String(e.stdout ?? "") + String(e.stderr ?? "") };
  }
}

function agent(root, name, body) {
  writeFileSync(join(root, "agents", `${name}.md`), body, "utf8");
}

test("passes clean single-line double-quoted frontmatter", () => {
  const root = harnessFixture();
  agent(root, "api-engineer", '---\nname: api-engineer\ndescription: "Owns the API and validation."\nmodel: gpt-4o\n---\n\n## Expertise\n- Testing\n');
  const { status, out } = run(root);
  assert.equal(status, 0, out);
});

test("rejects a folded block scalar description (> )", () => {
  const root = harnessFixture();
  agent(root, "api-engineer", '---\nname: api-engineer\ndescription: >\n  Owns the API routes and\n  input validation.\n---\n');
  const { status, out } = run(root);
  assert.notEqual(status, 0);
  assert.match(out, /block scalar/);
});

test("rejects a literal block scalar description (|)", () => {
  const root = harnessFixture();
  agent(root, "api-engineer", '---\nname: api-engineer\ndescription: |\n  Owns the API routes.\n---\n');
  const { status, out } = run(root);
  assert.notEqual(status, 0);
  assert.match(out, /block scalar/);
});

test("rejects multi-line continuation without an indicator", () => {
  const root = harnessFixture();
  agent(root, "api-engineer", '---\nname: api-engineer\ndescription: Owns the API\n  routes and validation.\n---\n');
  const { status, out } = run(root);
  assert.notEqual(status, 0);
  assert.match(out, /multi-line value not allowed/);
});

test("rejects an unquoted description containing ': '", () => {
  const root = harnessFixture();
  agent(root, "api-engineer", "---\nname: api-engineer\ndescription: Owns the Discovery: recursive scanning.\n---\n");
  const { status, out } = run(root);
  assert.notEqual(status, 0);
  assert.match(out, /must be double-quoted/);
});

test("rejects a missing description", () => {
  const root = harnessFixture();
  agent(root, "api-engineer", "---\nname: api-engineer\n---\n");
  const { status, out } = run(root);
  assert.notEqual(status, 0);
  assert.match(out, /missing 'description'/);
});
