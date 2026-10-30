#!/usr/bin/env node
// inventory.mjs — read-only retirement inventory for a completed Forge project.
//
// Classifies repository paths as delete / rewrite / review without changing
// anything. The companion apply.mjs consumes the same classification.
//
// Usage:
//   node scripts/inventory.mjs --repo <repo> [--harness-root .agents]
//                              [--keep <glob>]... [--json]

import path from "node:path";
import { classify } from "./lib.mjs";

const args = process.argv.slice(2);
const valueFor = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};
const valuesFor = (flag) =>
  args.flatMap((value, index) => (value === flag && args[index + 1] ? [args[index + 1]] : []));
const hasFlag = (flag) => args.includes(flag);
const repo = path.resolve(valueFor("--repo") ?? process.cwd());
const plan = classify(repo, {
  harnessRoot: valueFor("--harness-root"),
  keep: valuesFor("--keep"),
});

if (hasFlag("--json")) {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  process.exit(0);
}

const lines = [];
lines.push("# Forge retirement inventory");
lines.push("");
lines.push(`Repository: \`${plan.repo}\``);
lines.push(`Harness: \`${plan.harnessRoot ?? "not detected"}\``);
lines.push("");
if (plan.preflight.blocking.length > 0) {
  lines.push("## Blocking preflight");
  for (const item of plan.preflight.blocking) lines.push(`- ${item}`);
  lines.push("");
}
if (plan.preflight.warnings.length > 0) {
  lines.push("## Preflight warnings");
  for (const item of plan.preflight.warnings) lines.push(`- ${item}`);
  lines.push("");
}
lines.push("## Delete");
lines.push("");
if (plan.deletions.length === 0) lines.push("_Nothing matched._");
for (const item of plan.deletions) {
  lines.push(`- \`${item.path}\` — ${item.reason}`);
}
lines.push("");
lines.push("## Rewrite");
lines.push("");
lines.push(`- Support lead: ${plan.rewrites.supportLead ? `\`${plan.rewrites.supportLead}\` → \`support-lead.md\`` : "_none_"}`);
lines.push(`- Specialist agents (${plan.rewrites.agents.length}): ${plan.rewrites.agents.map((item) => `\`${item}\``).join(", ") || "_none_"}`);
lines.push(`- Project skills (${plan.rewrites.skills.length}): ${plan.rewrites.skills.map((item) => `\`${item.path}\``).join(", ") || "_none_"}`);
lines.push(`- Active docs (${plan.rewrites.docs.length}): ${plan.rewrites.docs.map((item) => `\`${item.path}\``).join(", ") || "_none_"}`);
lines.push(`- Config (${plan.rewrites.config.length}): ${plan.rewrites.config.map((item) => `\`${item.path}\``).join(", ") || "_none_"}`);
lines.push("");
lines.push("## Review");
lines.push("");
if (plan.reviews.length === 0) lines.push("_Nothing matched._");
for (const item of plan.reviews) lines.push(`- \`${item.path}\` — ${item.reason}`);
lines.push("");
lines.push("## Repo map");
lines.push("");
lines.push(`- Source: ${plan.repoMap.sourceDirectories.map((item) => `\`${item}\``).join(", ") || "_none_"}`);
lines.push(`- Manifests: ${plan.repoMap.manifests.map((item) => `\`${item}\``).join(", ") || "_none_"}`);
lines.push(`- Tests: ${[...plan.repoMap.tests.dirs, ...plan.repoMap.tests.files].map((item) => `\`${item}\``).join(", ") || "_none_"}`);
lines.push(`- CI: ${plan.repoMap.ci.map((item) => `\`${item}\``).join(", ") || "_none_"}`);
lines.push("");
lines.push(
  `Summary: ${plan.summary.deleteFiles} files and ${plan.summary.deleteDirectories} directories to delete; ` +
    `${plan.summary.rewriteAgents} agents, ${plan.summary.rewriteSkills} skills, ${plan.summary.rewriteDocs} docs to rewrite; ` +
    `${plan.summary.review} item(s) to review.`,
);
process.stdout.write(`${lines.join("\n")}\n`);
