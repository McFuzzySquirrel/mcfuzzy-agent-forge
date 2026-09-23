import assert from "node:assert/strict";
import { test } from "node:test";

import { renderMarkdown } from "./console/dashboard/render/md.ts";

test("renderMarkdown merges consecutive forge-requirement blocks into one table", () => {
  const html = renderMarkdown([
    "```forge-requirement",
    '{"id":"AUTH-FR-01","kind":"requirement","text":"Reject expired tokens."}',
    "```",
    "",
    "```forge-requirement",
    '{"id":"AUTH-FR-02","kind":"constraint","text":"Tokens are HTTP-only."}',
    "```",
  ].join("\n"));
  assert.match(html, /forge-table forge-requirements/);
  assert.match(html, /AUTH-FR-01/);
  assert.match(html, /AUTH-FR-02/);
  assert.equal((html.match(/<table/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<pre>/);
});

test("renderMarkdown renders forge-task blocks with dependencies and a details row", () => {
  const html = renderMarkdown([
    "```forge-task",
    JSON.stringify({
      id: "T-1",
      title: "Implement thing",
      description: "Do the thing end to end.",
      ownerAgent: "dev",
      dependencies: ["T-0"],
      expectedOutputs: ["src/x.ts"],
      validationCommands: ["npm test"],
      contract: {
        version: 2,
        kind: "implementation",
        requirements: [],
        requirementRefs: ["docs/features/a.md#FR-1"],
        acceptanceCriteria: ["works"],
        constraints: [],
        constraintRefs: [],
        references: [],
      },
    }),
    "```",
  ].join("\n"));
  assert.match(html, /forge-table forge-tasks/);
  assert.match(html, /T-1/);
  assert.match(html, /T-0/);
  assert.match(html, /<details>/);
  assert.match(html, /FR-1/);
});

test("renderMarkdown closes a forge group before a following heading", () => {
  const html = renderMarkdown([
    "```forge-requirement",
    '{"id":"FR-1","kind":"requirement","text":"One."}',
    "```",
    "",
    "## Next",
  ].join("\n"));
  assert.equal((html.match(/<table/g) ?? []).length, 1);
  assert.match(html, /<h2>Next<\/h2>/);
});

test("renderMarkdown falls back to a code block for malformed forge JSON", () => {
  const html = renderMarkdown("```forge-requirement\n{not json}\n```");
  assert.match(html, /<pre><code>/);
  assert.doesNotMatch(html, /forge-requirements/);
});
