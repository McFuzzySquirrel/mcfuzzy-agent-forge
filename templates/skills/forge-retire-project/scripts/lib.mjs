import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const SKILL_NAME = "forge-retire-project";
export const HARNESS_ROOTS = [".agents", ".opencode", ".claude", ".github"];

/** Forge artifacts that only exist to author requirements or run a build. */
export const DELETE_FILES = [
  "docs/PRD.md",
  "docs/prd.md",
  "docs/IDEA.md",
  "IDEA.md",
  "docs/requirements-source.md",
  "docs/prompt-playbook.md",
  "docs/SKILL-CANDIDATES.json",
  "docs/authoring-config.json",
  "docs/authoring-state.json",
  "docs/AUTHORING-EVENTS.jsonl",
  "docs/SKILL-AUDIT.md",
  "docs/MODEL-PLAN.md",
  "docs/model-overrides.json",
  "docs/research/model-inventory.json",
  "docs/EXECUTION-MANIFEST.json",
  "docs/WORKFLOW-STATE.json",
  "docs/ENGINE-STATE.json",
  "docs/PROGRESS.md",
  "docs/EXECUTION-AUDIT.jsonl",
  "docs/agent-responsibility-matrix.md",
  "docs/engine-config.json",
  "docs/engine-control.json",
  "docs/engine.pid",
  "docs/engine-run.log",
  "docs/rederive-state.json",
  "docs/TEAM.md",
];

/** Directories owned by the authoring or execution lifecycle. */
export const DELETE_DIRS = [
  "docs/features",
  "docs/artifacts",
  "docs/task-executions",
  "docs/reviews",
];

export const GITIGNORE_FORGE_ENTRIES = ["docs/engine-run.log", "docs/artifacts/"];

/** Forge template agents that have no post-build role. */
export const FORGE_AGENT_FILES = new Set(["forge-team-builder.md", "workflow-orchestrator.md"]);

/** Build orchestrator that is rewritten, not deleted. */
export const SUPPORT_LEAD_SOURCE = "project-orchestrator.md";
export const SUPPORT_LEAD_TARGET = "support-lead.md";

/** Filenames that are forge guides rather than project documentation. */
export const FORGE_DOC_NAMES = new Set([
  "workflow-engine.md",
  "workflow-engine-deep-dive.md",
  "artifact-store-deep-dive.md",
  "workforce-compiler-deep-dive.md",
  "task-contracts.md",
  "canonical-features.md",
  "agent-skill-associations.md",
  "forge-launcher.md",
  "forge-console.md",
  "forge-console-user-guide.md",
  "forge-console-screenshots.md",
  "human-review-guide.md",
  "running-with-local-models.md",
]);

const SOURCE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".kts", ".cs", ".fs",
  ".c", ".h", ".cc", ".cpp", ".hpp", ".m", ".mm", ".swift",
  ".php", ".ex", ".exs", ".erl", ".hrl", ".clj", ".scala", ".dart",
  ".sh", ".ps1", ".sql", ".graphql", ".proto",
]);

const IGNORED_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", "coverage", ".next", ".nuxt",
  ".cache", ".turbo", "vendor", "target", "bin", "obj", ".venv", "venv",
  "__pycache__", ".forge-archive",
]);

const MANIFEST_NAMES = new Set([
  "package.json", "pyproject.toml", "setup.py", "setup.cfg", "Cargo.toml",
  "go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "composer.json",
  "Gemfile", "mix.exs", "pubspec.yaml", "Makefile", "justfile", "Taskfile.yml",
  "docker-compose.yml", "compose.yaml", "Dockerfile",
]);

const HISTORICAL_PREFIXES = [
  "docs/adr/",
  "docs/research/",
  "docs/updates.md",
  "CHANGELOG",
  "docs/THE-STORY",
  ".forge-archive/",
];

/** Patterns that must not survive in active documentation, agents, or skills. */
export const FORGE_REFERENCE_PATTERNS = [
  ["PRD", /docs\/PRD\.md/i],
  ["feature documents", /docs\/features\//i],
  ["progress file", /docs\/PROGRESS\.md/i],
  ["execution manifest", /EXECUTION-MANIFEST/i],
  ["workflow state", /WORKFLOW-STATE/i],
  ["skill candidates", /SKILL-CANDIDATES/i],
  ["responsibility matrix", /agent-responsibility-matrix/i],
  ["engine state", /docs\/ENGINE-STATE/i],
  ["authoring state", /docs\/authoring-/i],
  ["task contract", /forge-task/i],
  ["result report", /forge-result/i],
  ["forge skill", /\bforge-(?:launcher|workflow-engine|execution-adapter|auto-build|build-prd|build-feature-prd|build-agent-team|build-project-skills|decompose-prd|orchestrate-build|assign-models|skill-creator|skill-review|skill-review-updater|grill-idea|retire-project)\b/i],
  ["forge team builder", /forge-team-builder/i],
  ["workflow orchestrator", /workflow-orchestrator/i],
];

export function posix(value) {
  return value.split(path.sep).join("/");
}

export function rel(repo, absolute) {
  return posix(path.relative(repo, absolute));
}

export function exists(repo, relativePath) {
  return fs.existsSync(path.join(repo, relativePath));
}

export function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.slice(1).findIndex((line) => line.trim() === "---");
  if (end < 0) return null;
  const data = {};
  const errors = [];
  for (let index = 1; index <= end; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (/^\s/.test(line)) {
      errors.push(`line ${index + 1}: frontmatter continuation is not supported`);
      continue;
    }
    const colon = line.indexOf(":");
    if (colon < 1) {
      errors.push(`line ${index + 1}: invalid frontmatter field`);
      continue;
    }
    const key = line.slice(0, colon).trim();
    const raw = line.slice(colon + 1).trim();
    data[key] = raw;
  }
  return { data, errors, body: lines.slice(end + 2).join("\n") };
}

export function detectHarnessRoot(repo, explicit = undefined) {
  if (explicit) {
    const absolute = path.isAbsolute(explicit) ? explicit : path.join(repo, explicit);
    return fs.existsSync(absolute) ? { rootRel: rel(repo, absolute), rootAbs: absolute } : null;
  }
  for (const root of HARNESS_ROOTS) {
    const absolute = path.join(repo, root);
    if (fs.existsSync(path.join(absolute, "agents")) || fs.existsSync(path.join(absolute, "skills"))) {
      return { rootRel: root, rootAbs: absolute };
    }
  }
  return null;
}

export function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !IGNORED_DIRS.has(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export function listFilesIn(dir, predicate = () => true) {
  const found = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && predicate(full)) found.push(full);
    }
  }
  return found.sort();
}

export function git(repo, args) {
  try {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function isGitRepo(repo) {
  return git(repo, ["rev-parse", "--show-toplevel"]) !== null;
}

export function isTracked(repo, relativePath) {
  return git(repo, ["ls-files", "--error-unmatch", "--", relativePath]) !== null;
}

export function isHistorical(relativePath) {
  return HISTORICAL_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

export function isForgeReference(text) {
  return FORGE_REFERENCE_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

export function readSkillCandidates(repo) {
  const value = readJson(path.join(repo, "docs", "SKILL-CANDIDATES.json"));
  if (!value || !Array.isArray(value.candidates)) return null;
  return value.candidates
    .filter((candidate) => candidate && typeof candidate.name === "string")
    .filter((candidate) => candidate.action !== "omit")
    .map((candidate) => ({ name: candidate.name, action: candidate.action }));
}

export function activeDocFiles(repo) {
  return listFilesIn(repo, (file) => {
    const relativePath = rel(repo, file);
    if (!/\.(md|mdx)$/i.test(relativePath)) return false;
    if (HARNESS_ROOTS.some((root) => relativePath.startsWith(`${root}/agents/`) || relativePath.startsWith(`${root}/skills/`))) return false;
    if (isHistorical(relativePath)) return false;
    if (relativePath.startsWith(".forge-archive/")) return false;
    return true;
  });
}

export function agentFiles(repo, harnessRoot) {
  if (!harnessRoot) return [];
  const dir = path.join(harnessRoot, "agents");
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "SKILL.md")
      .map((entry) => path.join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

export function skillDirs(repo, harnessRoot) {
  if (!harnessRoot) return [];
  const dir = path.join(harnessRoot, "skills");
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, dir: path.join(dir, entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export function sourceDirectories(repo) {
  const harnessNames = new Set(HARNESS_ROOTS.map((root) => root.replace(/^\./, "")));
  const topLevel = listDirs(repo).filter((name) => !harnessNames.has(name) && name !== "docs" && name !== "src" && !name.startsWith("."));
  const hasDirectSource = (dir) => {
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .some((entry) => entry.isFile() && SOURCE_EXTS.has(path.extname(entry.name).toLowerCase()));
    } catch {
      return false;
    }
  };
  const hasSource = (dir) => listFilesIn(dir, (file) => SOURCE_EXTS.has(path.extname(file).toLowerCase())).length > 0;
  const dirs = [];
  const src = path.join(repo, "src");
  if (fs.existsSync(src)) {
    if (hasDirectSource(src)) dirs.push("src");
    for (const name of listDirs(src)) {
      if (hasSource(path.join(src, name))) dirs.push(`src/${name}`);
    }
  }
  for (const name of topLevel) {
    const absolute = path.join(repo, name);
    if (hasSource(absolute)) dirs.push(name);
  }
  return [...new Set(dirs)].sort();
}

export function testDirectories(repo) {
  const names = new Set(["test", "tests", "__tests__", "spec", "specs", "e2e"]);
  const dirs = [];
  for (const name of listDirs(repo)) {
    if (names.has(name)) dirs.push(name);
  }
  for (const name of listDirs(path.join(repo, "src"))) {
    if (names.has(name)) dirs.push(`src/${name}`);
  }
  const files = listFilesIn(repo, (file) => /\.(test|spec)\.[^.]+$/i.test(file));
  return { dirs: [...new Set(dirs)].sort(), files: files.map((file) => rel(repo, file)).slice(0, 50) };
}

export function ciFiles(repo) {
  const candidates = [
    ".github/workflows",
    ".gitlab-ci.yml",
    ".circleci/config.yml",
    "azure-pipelines.yml",
    "bitbucket-pipelines.yml",
    "Jenkinsfile",
  ];
  const found = [];
  for (const candidate of candidates) {
    const absolute = path.join(repo, candidate);
    if (fs.existsSync(absolute)) {
      if (fs.statSync(absolute).isDirectory()) {
        for (const file of listFilesIn(absolute)) found.push(rel(repo, file));
      } else {
        found.push(candidate);
      }
    }
  }
  return found.sort();
}

export function configFiles(repo) {
  const names = new Set([
    "package.json",
    "Makefile",
    "makefile",
    "justfile",
    "Taskfile.yml",
    "Taskfile.yaml",
    "Dockerfile",
    "docker-compose.yml",
    "compose.yaml",
    ".gitlab-ci.yml",
    "azure-pipelines.yml",
    "bitbucket-pipelines.yml",
    "Jenkinsfile",
  ]);
  const found = [];
  for (const name of fs.readdirSync(repo)) {
    if (names.has(name)) found.push(name);
  }
  for (const file of ciFiles(repo)) {
    if (/\.(ya?ml|json)$/i.test(file)) found.push(file);
  }
  for (const manifest of repoManifests(repo)) {
    if (manifest === "package.json") found.push(manifest);
  }
  return [...new Set(found)].sort();
}

export function repoManifests(repo) {
  const found = [];
  for (const name of fs.readdirSync(repo)) {
    if (MANIFEST_NAMES.has(name)) found.push(name);
  }
  for (const workspace of ["packages", "apps", "crates", "modules"]) {
    for (const name of listDirs(path.join(repo, workspace))) {
      for (const manifest of MANIFEST_NAMES) {
        const candidate = path.join(workspace, name, manifest);
        if (fs.existsSync(path.join(repo, candidate))) found.push(candidate);
      }
    }
  }
  return [...new Set(found)].sort();
}

export function packageScripts(repo) {
  const value = readJson(path.join(repo, "package.json"), {});
  return value && typeof value.scripts === "object" && value.scripts ? value.scripts : {};
}

export function buildRepoMap(repo) {
  return {
    topLevel: fs
      .readdirSync(repo, { withFileTypes: true })
      .filter((entry) => !IGNORED_DIRS.has(entry.name) && entry.name !== ".git")
      .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
      .sort(),
    manifests: repoManifests(repo),
    sourceDirectories: sourceDirectories(repo),
    tests: testDirectories(repo),
    ci: ciFiles(repo),
    scripts: packageScripts(repo),
    docs: listFilesIn(path.join(repo, "docs"), (file) => file.endsWith(".md"))
      .map((file) => rel(repo, file))
      .sort(),
  };
}

export function classify(repo, options = {}) {
  const keep = options.keep ?? [];
  const detected = detectHarnessRoot(repo, options.harnessRoot);
  const harnessRoot = detected?.rootAbs ?? null;
  const harnessRootRel = detected?.rootRel ?? null;
  const candidates = readSkillCandidates(repo);
  const protectedSkills = new Set(
    (candidates ?? [])
      .filter((candidate) => !(candidate.action === "reuse" && candidate.name.startsWith("forge-")))
      .map((candidate) => candidate.name),
  );

  const deletions = [];
  const addDeletion = (relativePath, kind, group, reason) => {
    if (!exists(repo, relativePath)) return;
    const keepPatterns = keep.map((pattern) => globToRegExp(pattern));
    if (keepPatterns.some((pattern) => pattern.test(relativePath))) return;
    if (kind === "directory" && keep.some((pattern) => posix(pattern).replace(/^\.\//, "").startsWith(`${relativePath}/`))) {
      // A kept descendant keeps the directory itself. Delete the remaining files
      // individually so the exception is honored without touching the kept path.
      for (const file of listFilesIn(path.join(repo, relativePath))) {
        const filePath = rel(repo, file);
        if (keepPatterns.some((pattern) => pattern.test(filePath))) continue;
        deletions.push({ path: filePath, kind: "file", group, reason });
      }
      return;
    }
    deletions.push({ path: relativePath, kind, group, reason });
  };

  for (const file of DELETE_FILES) addDeletion(file, "file", "forge-artifact", "Forge authoring or execution artifact");
  for (const dir of DELETE_DIRS) addDeletion(dir, "directory", "forge-artifact", "Forge authoring or execution directory");

  const deletedAgents = new Set();
  for (const file of agentFiles(repo, harnessRoot)) {
    const name = path.basename(file);
    const relativePath = rel(repo, file);
    if (FORGE_AGENT_FILES.has(name)) {
      addDeletion(relativePath, "file", "forge-agent", "Forge build template agent");
      deletedAgents.add(relativePath);
    }
  }

  const deletedSkills = new Set();
  for (const skill of skillDirs(repo, harnessRoot)) {
    if (!skill.name.startsWith("forge-")) continue;
    if (protectedSkills.has(skill.name)) continue;
    if (skill.name === SKILL_NAME) continue;
    const relativePath = rel(repo, skill.dir);
    addDeletion(relativePath, "directory", "forge-skill", "Forge build or authoring skill");
    deletedSkills.add(relativePath);
  }

  const agents = agentFiles(repo, harnessRoot)
    .map((file) => rel(repo, file))
    .filter((relativePath) => !deletedAgents.has(relativePath));
  const supportLead = agents.find((relativePath) => path.basename(relativePath) === SUPPORT_LEAD_SOURCE) ?? null;
  const projectAgents = agents.filter((relativePath) => path.basename(relativePath) !== SUPPORT_LEAD_SOURCE);

  const projectSkills = [];
  for (const skill of skillDirs(repo, harnessRoot)) {
    const relativePath = rel(repo, skill.dir);
    if (deletedSkills.has(relativePath) || skill.name === SKILL_NAME) continue;
    projectSkills.push({ name: skill.name, path: relativePath, protected: protectedSkills.has(skill.name) });
  }

  const docs = [];
  const reviews = [];
  for (const file of activeDocFiles(repo)) {
    const relativePath = rel(repo, file);
    const text = readText(file);
    const markers = isForgeReference(text);
    const forgeNamed = FORGE_DOC_NAMES.has(path.basename(relativePath));
    if (markers.length === 0 && !forgeNamed) continue;
    const entry = { path: relativePath, markers, reason: forgeNamed ? "Forge-specific guide" : "References removed Forge artifacts" };
    if (forgeNamed) reviews.push(entry);
    else docs.push(entry);
  }

  const config = [];
  for (const relativePath of configFiles(repo)) {
    const markers = isForgeReference(readText(path.join(repo, relativePath)));
    if (markers.length > 0) {
      config.push({ path: relativePath, markers, reason: "Configuration references removed Forge commands or artifacts" });
    }
  }

  return {
    version: 1,
    repo,
    harnessRoot: harnessRootRel,
    skillName: SKILL_NAME,
    generatedAt: new Date().toISOString(),
    preflight: preflight(repo, harnessRootRel),
    candidates,
    protectedSkills: [...protectedSkills].sort(),
    deletions: deletions.sort((a, b) => a.path.localeCompare(b.path)),
    rewrites: {
      supportLead,
      agents: projectAgents,
      skills: projectSkills,
      docs,
      config,
    },
    reviews,
    repoMap: buildRepoMap(repo),
    summary: {
      deleteFiles: deletions.filter((item) => item.kind === "file").length,
      deleteDirectories: deletions.filter((item) => item.kind === "directory").length,
      rewriteAgents: projectAgents.length,
      rewriteSkills: projectSkills.length,
      rewriteDocs: docs.length + config.length,
      review: reviews.length,
    },
  };
}

export function preflight(repo, harnessRootRel) {
  const warnings = [];
  const blocking = [];
  if (!isGitRepo(repo)) blocking.push("Not a git repository. The cleanup needs git history for recovery.");
  if (!harnessRootRel) blocking.push("No harness root found (.agents/.opencode/.claude/.github).");
  const pidFile = path.join(repo, "docs", "engine.pid");
  if (fs.existsSync(pidFile)) {
    const pid = Number(readText(pidFile).trim());
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        blocking.push(`The Forge engine is still running (pid ${pid}). Stop it with 'forge-launcher engine-run --stop' first.`);
      } catch {
        warnings.push(`Stale engine pid file: ${posix(path.relative(repo, pidFile))}`);
      }
    }
  }
  const stateFile = path.join(repo, "docs", "WORKFLOW-STATE.json");
  const state = readJson(stateFile);
  if (state && typeof state.status === "string" && ["running", "paused"].includes(state.status)) {
    blocking.push(`Workflow state is '${state.status}'. Finish or stop the run before retiring the project.`);
  }
  const status = git(repo, ["status", "--porcelain"]);
  const relevantStatus = (status ?? "")
    .split("\n")
    .filter((line) => {
      const pathPart = line.slice(3).trim();
      if (!pathPart) return false;
      if (pathPart.startsWith(".forge-archive/")) return false;
      if (harnessRootRel && pathPart.startsWith(`${harnessRootRel}/skills/${SKILL_NAME}`)) return false;
      return true;
    })
    .join("\n");
  if (relevantStatus) warnings.push("Working tree is not clean. Use --allow-dirty to proceed deliberately.");
  return { blocking, warnings, clean: !relevantStatus };
}

export function globToRegExp(pattern) {
  let normalized = posix(pattern).replace(/^\.\//, "").replace(/\/+$/, "");
  if (normalized === "**") return /^.*$/;
  if (normalized.endsWith("/**")) normalized = normalized.slice(0, -3);
  let expression = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === "*" && normalized[index + 1] === "*") {
      expression += ".*";
      index += 1;
      if (normalized[index + 1] === "/") index += 1;
    } else if (char === "*") {
      expression += "[^/]*";
    } else if (char === "?") {
      expression += "[^/]";
    } else {
      expression += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${expression}(?:/.*)?$`);
}

export function extractScopePaths(text) {
  const match = /^##\s+Scope\s*$/im.exec(text);
  if (!match) return [];
  const rest = text.slice(match.index + match[0].length);
  const end = /^##\s+/m.exec(rest);
  const section = end ? rest.slice(0, end.index) : rest;
  const paths = [];
  for (const token of section.matchAll(/`([^`]+)`/g)) {
    const value = token[1].trim();
    if (!value || /^[a-z]+:\/\//i.test(value)) continue;
    if (!value.includes("/") && !value.includes(".")) continue;
    paths.push(value.replace(/\/+$/, "").replace(/\/\*\*$/, ""));
  }
  return [...new Set(paths)];
}

export function scopeCovers(scope, relativePath) {
  return globToRegExp(scope).test(relativePath);
}

export function coverage(repo, agents) {
  const sourceDirs = sourceDirectories(repo);
  const scopes = agents.map((agent) => ({
    path: agent,
    scopes: extractScopePaths(readText(path.join(repo, agent))),
  }));
  const uncovered = sourceDirs.filter((dir) => !scopes.some((entry) => entry.scopes.some((scope) => scopeCovers(scope, dir))));
  const ownerless = scopes
    .filter((entry) => entry.scopes.length === 0)
    .map((entry) => entry.path);
  return { sourceDirs, uncovered, ownerless };
}

export function activeFilesForScan(repo, harnessRootRel) {
  const files = new Set(activeDocFiles(repo));
  for (const relativePath of configFiles(repo)) files.add(path.join(repo, relativePath));
  if (harnessRootRel) {
    for (const file of agentFiles(repo, path.join(repo, harnessRootRel))) files.add(file);
    for (const skill of skillDirs(repo, path.join(repo, harnessRootRel))) {
      if (skill.name === SKILL_NAME) continue;
      const skillFile = path.join(skill.dir, "SKILL.md");
      if (fs.existsSync(skillFile)) files.add(skillFile);
    }
  }
  return [...files].sort();
}

export function scanDangling(repo, harnessRootRel) {
  const findings = [];
  for (const file of activeFilesForScan(repo, harnessRootRel)) {
    const relativePath = rel(repo, file);
    const lines = readText(file).split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const markers = isForgeReference(lines[index]);
      if (markers.length === 0) continue;
      findings.push({ path: relativePath, line: index + 1, markers, text: lines[index].trim() });
    }
  }
  return findings;
}
