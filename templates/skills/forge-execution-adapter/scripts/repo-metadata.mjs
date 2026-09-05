import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const HARNESS_ROOTS = [".agents", ".github", ".claude", ".opencode"];

function isDirectory(file) {
  return statSync(file, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

function hasAgents(directory, includeTooling = true) {
  if (!isDirectory(directory)) return false;
  return readdirSync(directory, { withFileTypes: true }).some((entry) => {
    if (entry.isFile()) {
      return entry.name.endsWith(".md") && entry.name !== "SKILL.md"
        && (includeTooling || !["forge-team-builder.md", "project-orchestrator.md", "workflow-orchestrator.md"].includes(entry.name));
    }
    return entry.isDirectory()
      && !["node_modules", "dist", ".git"].includes(entry.name)
      && hasAgents(join(directory, entry.name), includeTooling);
  });
}

export function selectHarnessRoot(repoRoot, preferred) {
  if (preferred !== undefined) {
    if (!HARNESS_ROOTS.includes(preferred)) throw new Error(`Unsupported harness root: ${preferred}`);
    if (!isDirectory(join(repoRoot, preferred))) {
      throw new Error(`Selected harness root does not exist: ${join(repoRoot, preferred)}`);
    }
    return { root: preferred, warnings: [] };
  }
  const withGeneratedAgents = HARNESS_ROOTS.filter((root) => hasAgents(join(repoRoot, root, "agents"), false));
  const withAgentFiles = HARNESS_ROOTS.filter((root) => hasAgents(join(repoRoot, root, "agents")));
  const withAgents = HARNESS_ROOTS.filter((root) => isDirectory(join(repoRoot, root, "agents")));
  const withSkills = HARNESS_ROOTS.filter((root) => isDirectory(join(repoRoot, root, "skills")));
  const matches = withGeneratedAgents.length ? withGeneratedAgents
    : withAgentFiles.length ? withAgentFiles : withAgents.length ? withAgents : withSkills;
  if (!matches.length) return { root: null, warnings: [] };
  const warnings = [];
  const ignoredSkillsOnly = withSkills.filter((root) => !withAgents.includes(root));
  if (withAgents.length && ignoredSkillsOnly.length) {
    warnings.push(`Ignoring skills-only harness root(s) ${ignoredSkillsOnly.join(", ")} (no agents/); using ${matches[0]}.`);
  }
  if (matches.length > 1) warnings.push(`Multiple harness roots detected (${matches.join(", ")}); using ${matches[0]}.`);
  return { root: matches[0], warnings };
}

export function parseMetadata(markdown, parser, source = "document") {
  try {
    const parsed = parser(markdown);
    if (!parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
      throw new Error("frontmatter must be a mapping");
    }
    if (typeof parsed.content !== "string") throw new Error("parser did not return document content");
    return { data: parsed.data, content: parsed.content };
  } catch (error) {
    throw new Error(
      `Invalid YAML frontmatter in ${source}: ${error instanceof Error ? error.message : String(error)}. `
      + 'Hint: wrap description values in double quotes (e.g. description: "...").',
      { cause: error },
    );
  }
}
