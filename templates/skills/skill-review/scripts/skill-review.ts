#!/usr/bin/env node
import { Command } from "commander";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { auditSkill, formatAuditReport, scoreTier, type SkillAudit } from "./rubric.js";
import {
  detectSkillDir,
  findSkillFiles,
  getChangedSkillFiles,
  excludeSelf,
  validateFiles,
} from "./detect.js";
import { githubProvider } from "./providers/github.js";
import { gitlabProvider } from "./providers/gitlab.js";
import { adoProvider } from "./providers/ado.js";
import { stdoutProvider } from "./providers/stdout.js";
import type { Provider } from "./providers/provider.js";

const PROVIDERS: Record<string, Provider> = {
  github: githubProvider,
  gitlab: gitlabProvider,
  ado: adoProvider,
  stdout: stdoutProvider,
};

function detectDefaultRoot(): string {
  try {
    const gitRoot = execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (gitRoot) return gitRoot;
  } catch {
    // Not in a git repo, fall back to current working directory.
  }
  return process.cwd();
}

interface CliOptions {
  provider: string;
  files: string[];
  minScore: string;
  failBelow: boolean;
  root: string;
  skillsDir: string;
}

const program = new Command();

program
  .name("skill-review")
  .description("Audit skill files against agentskills.io best practices")
  .option(
    "-p, --provider <provider>",
    "PR provider for posting comments: github, gitlab, ado, stdout",
    "stdout",
  )
  .option(
    "-f, --files <paths...>",
    "Specific SKILL.md files to audit (absolute or relative paths)",
  )
  .option(
    "-s, --min-score <score>",
    "Minimum overall score threshold (1.0-3.0). Warns if any skill scores below",
    "1.5",
  )
  .option(
    "--fail-below",
    "Exit with non-zero code if any skill scores below --min-score",
    false,
  )
  .option(
    "-r, --root <path>",
    "Project root directory",
    detectDefaultRoot(),
  )
  .option(
    "-d, --skills-dir <path>",
    "Root folder to scan for skills (overrides auto-detection of standard skill directories)",
  )
  .parse(process.argv);

const opts = program.opts<CliOptions>();

async function main() {
  const root = resolve(opts.root);
  const provider = PROVIDERS[opts.provider];
  const minScoreText = opts.minScore.trim();
  const minScore = Number(minScoreText);

  if (!provider) {
    console.error(`Unknown provider: ${opts.provider}. Valid: ${Object.keys(PROVIDERS).join(", ")}`);
    process.exit(1);
  }

  if (!/^\d+(?:\.\d+)?$/.test(minScoreText) || !Number.isFinite(minScore) || minScore < 1 || minScore > 3) {
    console.error(`Invalid min-score: ${opts.minScore}. Must be between 1.0 and 3.0`);
    process.exit(1);
  }

  // Determine which files to audit
  let files: string[];

  if (opts.files && opts.files.length > 0) {
    const { valid, missing } = validateFiles(opts.files, root);
    if (missing.length > 0) {
      console.error(`Missing files: ${missing.join(", ")}`);
    }
    files = valid;
  } else if (opts.skillsDir) {
    const skillsDir = resolve(opts.skillsDir);
    if (!existsSync(skillsDir)) {
      console.error(`Skills directory not found: ${skillsDir}`);
      process.exit(1);
    }
    console.error(`Scanning for skills in: ${skillsDir}`);
    const all = findSkillFiles(skillsDir);
    files = excludeSelf(all);
  } else {
    // Auto-detect: first try changed files from git diff, then fall back to all skills
    const changed = getChangedSkillFiles(root);
    if (changed.length > 0) {
      console.error(`Detected ${changed.length} changed skill file(s)`);
      files = excludeSelf(changed);
    } else {
      const skillDir = detectSkillDir(root);
      if (!skillDir) {
        console.error("No skills directory found. Checked: .agents/skills/, skills/, .opencode/skills/, .claude/skills/, templates/skills/");
        process.exit(0);
      }
      const all = findSkillFiles(skillDir);
      files = excludeSelf(all);
    }
  }

  if (files.length === 0) {
    console.error("No skill files to audit.");
    process.exit(0);
  }

  // Audit each file
  const audits: SkillAudit[] = [];
  const readErrors: string[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(file, "utf-8");
      const skillDir = dirname(file);
      const skillName = skillDir.split("/").pop() || file;

      const audit = auditSkill({
        skillMd: content,
        skillName,
        skillPath: file,
        hasRefsDir: existsSync(join(skillDir, "references")),
        hasAssetsDir: existsSync(join(skillDir, "assets")),
        hasScriptsDir: existsSync(join(skillDir, "scripts")),
      });

      audits.push(audit);
    } catch (err) {
      readErrors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (audits.length === 0) {
    console.error("No skills could be audited.");
    if (readErrors.length > 0) {
      console.error(readErrors.join("\n"));
    }
    process.exit(1);
  }

  // Generate report
  const report = formatAuditReport(audits);

  // Post to provider
  console.error(`Posting audit report via ${provider.name}...`);
  const result = await provider.postComments(report, files);

  if (result.errors.length > 0) {
    console.error("Errors posting comments:");
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
  }

  // For stdout provider, the report was already printed. For others, print a summary.
  if (opts.provider !== "stdout") {
    const belowThreshold = audits.filter((a) => a.overall < minScore);
    console.error(`\nAudited ${audits.length} skill(s). Comments posted: ${result.posted}`);

    if (belowThreshold.length > 0) {
      console.error(`\nSkills below threshold (${minScore}):`);
      for (const a of belowThreshold) {
        console.error(`  ${a.name}: ${a.overall} (${scoreTier(a.overall)})`);
      }
    }
  }

  // Check threshold
  if (opts.failBelow) {
    const belowThreshold = audits.filter((a) => a.overall < minScore);
    if (belowThreshold.length > 0) {
      console.error(`\nFailing: ${belowThreshold.length} skill(s) below minimum score of ${minScore}`);
      process.exit(1);
    }
  }

  // Also report structural issues on stderr
  const structuralCount = audits.reduce(
    (c, a) => c + a.structuralIssues.length,
    0,
  );
  if (structuralCount > 0) {
    console.error(`\n${structuralCount} structural issue(s) found across ${audits.length} skill(s)`);
  }

  if (readErrors.length > 0) {
    console.error("\nRead errors:");
    for (const err of readErrors) {
      console.error(`  - ${err}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
