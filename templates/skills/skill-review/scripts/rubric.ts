import { basename, dirname } from "node:path";
import { existsSync } from "node:fs";
import { checkSkillStructure, scoreSkill } from "../../forge-build-agent-team/scripts/quality-rubric.mjs";

export interface Score {
  axis: string;
  score: number; // 1-3
  reasoning: string;
}

export interface SkillAudit {
  name: string;
  path: string;
  scores: Score[];
  overall: number;
  reviewerStyleProxy: number | null;
  strengths: string[];
  improvements: string[];
  suggestedChanges: string[];
  structuralIssues: string[];
}

const AXES = [
  "Context economy",
  "Gotchas coverage",
  "Procedural clarity",
  "Progressive disclosure",
  "Calibration",
  "Validation",
] as const;

export { AXES };

function countLines(text: string): number {
  return text.split("\n").length;
}

function hasSection(text: string, name: string): boolean {
  const re = new RegExp(`^#{2,}\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "im");
  return re.test(text);
}

function sectionContent(text: string, name: string): string {
  const re = new RegExp(
    `^#{2,}\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]*\\n([\\s\\S]*?)(?=^#{2,}\\s|\\Z)`,
    "im",
  );
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

function countCheckboxes(text: string): number {
  return (text.match(/^\s*- \[[ x]\]/gm) || []).length;
}

function hasReferences(text: string): boolean {
  return /\[.*\]\(references\//i.test(text) || /\[.*\]\(assets\//i.test(text);
}

function hasLoadTrigger(text: string): boolean {
  return /load when/i.test(text) || /load.*reference/i.test(text);
}

function countFencedCommandBlocks(text: string): number {
  return (text.match(/```(?:bash|sh|shell|zsh|console|powershell|cmd)?[\s\S]*?```/gi) || []).length;
}

function hasFallbackGuidance(text: string): boolean {
  return /(if (that|this) doesn'?t work|if that fails|if it fails|fallback|otherwise|alternatively|try .* instead)/i.test(text);
}

/**
 * Score context economy (1-3).
 * Dings for generic/fundamental explanations, but rewards progressive disclosure when
 * long detail is moved into references/assets with explicit load triggers.
 */
function scoreContextEconomy(skillMd: string, hasRefsDirOnDisk: boolean, hasAssetsDirOnDisk: boolean): number {
  const genericPatterns = [
    /what is an? /i,
    /is a (widely|well|commonly) known/i,
    /in (this|the) (article|guide|document), we('ll| will) (explain|discuss|cover)/i,
    /stands for/i,
    /simple terms/i,
    /basic (concept|idea|principle)/i,
    /for those unfamiliar/i,
    /a (popular|common|well-known) (framework|library|pattern|concept)/i,
  ];

  let genericHits = 0;
  for (const p of genericPatterns) {
    genericHits += (skillMd.match(new RegExp(p.source, "gi")) || []).length;
  }

  const lines = countLines(skillMd);
  const hasOffloadedDetail = (hasReferences(skillMd) || hasRefsDirOnDisk || hasAssetsDirOnDisk) && hasLoadTrigger(skillMd);

  if (genericHits <= 1 && hasOffloadedDetail) return 3;
  if (genericHits === 0 && lines < 200) return 3;
  if (genericHits <= 1 && lines < 350) return 2;
  return 1;
}

/**
 * Score gotchas coverage (1-3).
 * Checks for a ## Gotchas section with concrete, project-specific gotchas.
 */
function scoreGotchasCoverage(skillMd: string): number {
  if (!hasSection(skillMd, "Gotchas")) return 1;

  const content = sectionContent(skillMd, "Gotchas");
  const gotchaItems = (content.match(/^\s*[-*]/gm) || []).length;

  const genericGotchas = [
    /handle errors/i,
    /be careful/i,
    /make sure to test/i,
    /follow best practices/i,
  ];
  const genericHits = genericGotchas.reduce(
    (c, p) => c + (content.match(p) || []).length,
    0,
  );

  if (gotchaItems >= 3 && genericHits <= 1) return 3;
  if (gotchaItems >= 1) return 2;
  return 1;
}

/**
 * Score procedural clarity (1-3).
 * Step-by-step process vs declarative output.
 */
function scoreProceduralClarity(skillMd: string): number {
  const hasProcess = hasSection(skillMd, "Process");
  const steps = (skillMd.match(/^###?\s+Step\s+\d+:/gm) || []).length;
  const numberedSteps = (skillMd.match(/^\d+\.\s+\*\*/gm) || []).length;
  const decisionPatterns = (skillMd.match(/if\s+.*\bthen\b/gi) || []).length;
  const totalSteps = steps + numberedSteps;

  if (hasProcess && totalSteps >= 3 && decisionPatterns >= 1) return 3;
  if (hasProcess && totalSteps >= 2) return 2;
  return 1;
}

/**
 * Score progressive disclosure (1-3).
 * Checks for references/assets usage and reasonable SKILL.md length.
 * Also considers on-disk presence of references/ and assets/ directories.
 */
function scoreProgressiveDisclosure(skillMd: string, hasRefsDirOnDisk: boolean, hasAssetsDirOnDisk: boolean): number {
  const lines = countLines(skillMd);
  const hasRefs = hasReferences(skillMd);
  const hasLoad = hasLoadTrigger(skillMd);
  const hasRefsDir = hasRefsDirOnDisk || /\breferences\//i.test(skillMd);
  const hasAssetsDir = hasAssetsDirOnDisk || /\bassets\//i.test(skillMd);

  if (hasRefs && hasLoad && (hasRefsDir || hasAssetsDir) && lines < 500)
    return 3;
  if ((hasRefs || hasRefsDir || hasAssetsDir) && lines < 600) return 2;
  return 1;
}

/**
 * Score calibration (1-3).
 * Matches prescriptiveness to task fragility.
 */
function scoreCalibration(skillMd: string): number {
  const inlineCommands = (skillMd.match(/`[^`]{3,}`/g) || []).length;
  const fencedCommands = countFencedCommandBlocks(skillMd);
  const escapeHatches = (skillMd.match(
    /if (that|this) doesn'?t work/i,
  ) || []).length;
  const defaults = (skillMd.match(/(?:by default|default command|use the standard|run the standard|recommended command)/gi) || []).length;
  const mayAlternatives = (skillMd.match(
    /you (can|may|might|could) (also |alternatively )?/gi,
  ) || []).length;
  const destructiveOps = (skillMd.match(
    /(delete|destroy|drop|rm\s|remove|truncate|purge)/gi,
  ) || []).length;
  const commandExamples = inlineCommands + fencedCommands;
  const hasFallbacks = hasFallbackGuidance(skillMd) || escapeHatches > 0 || defaults > 0;

  // Destructive ops should have exact commands; flexible ops should have escape hatches
  if (destructiveOps > 0 && commandExamples === 0) return 1;
  if (commandExamples >= 1 && hasFallbacks) return 3;
  if (commandExamples >= 2 || mayAlternatives >= 1) return 2;
  return 1;
}

function scoreReviewerStyleProxy(
  skillMd: string,
  hasRefsDirOnDisk: boolean,
  hasAssetsDirOnDisk: boolean,
  hasScriptsDirOnDisk: boolean,
): number {
  const gotchaCount = (sectionContent(skillMd, "Gotchas").match(/^\s*[-*]/gm) || []).length;
  const hasProcess = hasSection(skillMd, "Process");
  const stepCount = (skillMd.match(/^###?\s+Step\s+\d+:/gm) || []).length;
  const hasOffloadedDetail = (hasReferences(skillMd) || hasRefsDirOnDisk || hasAssetsDirOnDisk) && hasLoadTrigger(skillMd);
  const fencedCommands = countFencedCommandBlocks(skillMd);
  const hasFallback = hasFallbackGuidance(skillMd);
  const validationChecks = countCheckboxes(skillMd);
  const hasScriptSupport = hasScriptsDirOnDisk || /scripts?\//i.test(skillMd);

  let points = 0;
  if (gotchaCount >= 3) points += 1;
  if (hasProcess && stepCount >= 2) points += 1;
  if (hasOffloadedDetail) points += 1;
  if (fencedCommands >= 1 && hasFallback) points += 1;
  if (validationChecks >= 2 && hasScriptSupport) points += 1;

  if (points >= 4) return 3;
  if (points >= 2) return 2;
  return 1;
}

/**
 * Score validation (1-3).
 * Checks for validation section, checkboxes, scripts.
 * Also considers on-disk presence of a scripts/ directory.
 */
function scoreValidation(skillMd: string, hasScriptsDirOnDisk: boolean): number {
  const hasValidation = hasSection(skillMd, "Validation");
  const checkboxes = countCheckboxes(skillMd);
  const hasScriptCheck = hasScriptsDirOnDisk || /scripts?\//i.test(skillMd);
  const hasSelfCheck = /self.?(check|validate|verify)/i.test(skillMd);

  if (hasValidation && checkboxes >= 3 && (hasScriptCheck || hasSelfCheck))
    return 3;
  if (hasValidation && checkboxes >= 1) return 2;
  return 1;
}

/**
 * Check structural / metadata issues.
 */
function checkStructural(
  name: string,
  parentDir: string,
  rawFrontmatter: Record<string, unknown>,
  skillMd: string,
): string[] {
  const issues: string[] = [];

  if (typeof rawFrontmatter.name === "string") {
    if (rawFrontmatter.name !== parentDir) {
      issues.push(
        `Frontmatter \`name\` ("${rawFrontmatter.name}") does not match parent directory ("${parentDir}")`,
      );
    }
  } else {
    issues.push("Missing or invalid `name` in frontmatter");
  }

  const desc = rawFrontmatter.description;
  if (typeof desc !== "string" || desc.trim().length < 20) {
    issues.push(
      "`description` is missing, too short, or not specific enough for activation",
    );
  }

  // Check relative path references
  const mdRefs = Array.from(
    new Set(skillMd.match(/\([^)]*\.md\)/g) || []),
  );
  for (const mr of mdRefs) {
    if (!mr.startsWith("(./") && !mr.startsWith("(../")) {
      issues.push(`File reference "${mr}" should use a relative path from the skill root`);
    }
  }

  // Check reference chain depth (look for load triggers that reference other load triggers)
  const loadRefs = skillMd.match(/load\s+`references\/[^`]+`/gi) || [];
  // For each reference that says "load references/X.md", check if X.md itself has a "load references/" pattern
  // This is a simple heuristic - a more thorough check would read the referenced files
  if (loadRefs.length > 0) {
    const nestedHint = skillMd.match(
      /references\/[^)]+\.md.*references\/[^)]+\.md/gi,
    );
    if (nestedHint && nestedHint.length > 0) {
      issues.push(
        "Potential nested reference chain detected - keep to one level of depth",
      );
    }
  }

  return issues;
}

export interface AuditInput {
  skillMd: string;
  skillName: string;
  skillPath: string;
  hasRefsDir: boolean;
  hasAssetsDir: boolean;
  hasScriptsDir: boolean;
}

import matter from "gray-matter";

export function auditSkill(input: AuditInput): SkillAudit {
  const { skillMd, skillName, skillPath, hasRefsDir, hasAssetsDir, hasScriptsDir } = input;
  const parentDir = basename(dirname(skillPath)) || skillName;

  // Parse frontmatter for structural checks
  let rawFm: Record<string, unknown> = {};
  try {
    rawFm = matter(skillMd).data as Record<string, unknown>;
  } catch {
    // gray-matter parsing failed - rawFm stays empty
  }

  const quality = scoreSkill(skillMd, {
    hasRefsDirOnDisk: hasRefsDir,
    hasAssetsDirOnDisk: hasAssetsDir,
    hasScriptsDirOnDisk: hasScriptsDir,
  });
  const scores: Score[] = [
    {
      axis: "Context economy",
      score: quality.contextEconomy!,
      reasoning: buildReasoning("context economy", quality.contextEconomy!),
    },
    {
      axis: "Gotchas coverage",
      score: quality.gotchasCoverage!,
      reasoning: buildReasoning("gotchas coverage", quality.gotchasCoverage!),
    },
    {
      axis: "Procedural clarity",
      score: quality.proceduralClarity!,
      reasoning: buildReasoning("procedural clarity", quality.proceduralClarity!),
    },
    {
      axis: "Progressive disclosure",
      score: quality.progressiveDisclosure!,
      reasoning: buildReasoning(
        "progressive disclosure",
        quality.progressiveDisclosure!,
      ),
    },
    {
      axis: "Calibration",
      score: quality.calibration!,
      reasoning: buildReasoning("calibration", quality.calibration!),
    },
    {
      axis: "Validation",
      score: quality.validation!,
      reasoning: buildReasoning("validation", quality.validation!),
    },
  ];

  const structuralIssues = checkSkillStructure({
    name: skillName,
    parentDir,
    rawFrontmatter: rawFm,
    text: skillMd,
    resolveReference: (reference) => existsSync(`${dirname(skillPath)}/${reference}`),
  });
  const overall =
    Math.round(
      (scores.reduce((sum, s) => sum + s.score, 0) / scores.length) * 10,
    ) / 10;
  const reviewerStyleProxy = scoreReviewerStyleProxy(skillMd, hasRefsDir, hasAssetsDir, hasScriptsDir);

  const strengths = buildStrengths(scores);
  const improvements = buildImprovements(scores);
  const suggestedChanges = buildSuggestedChanges(scores, skillMd, hasRefsDir, hasAssetsDir, hasScriptsDir);

  return {
    name: skillName,
    path: skillPath,
    scores,
    overall,
    reviewerStyleProxy,
    strengths,
    improvements,
    suggestedChanges,
    structuralIssues,
  };
}

function buildReasoning(axis: string, score: number): string {
  const map: Record<number, Record<string, string>> = {
    3: {
      "context economy":
        "Tight, project-specific content without generic filler",
      "gotchas coverage":
        "Strong gotchas section with concrete, environment-specific items",
      "procedural clarity":
        "Clear step-by-step process with decision criteria",
      "progressive disclosure":
        "Well-organized with references/assets and load triggers",
      "calibration":
        "Balanced prescriptiveness with escape hatches for flexible ops",
      "validation": "Concrete self-check steps with scripts or checklists",
    },
    2: {
      "context economy":
        "Mostly focused but some generic content present",
      "gotchas coverage":
        "Has gotchas but could be more specific or comprehensive",
      "procedural clarity":
        "Some process steps but missing decision criteria or detail",
      "progressive disclosure":
        "Partial use of references or assets, could be better organized",
      "calibration": "Some structure but could tighten prescriptiveness",
      "validation": "Basic validation present but could be more concrete",
    },
    1: {
      "context economy":
        "Contains generic/fundamental explanations that waste tokens",
      "gotchas coverage":
        "Missing gotchas section or only has generic advice",
      "procedural clarity":
        "Declares outputs without teaching the approach",
      "progressive disclosure":
        "Everything in one file without subdirectory organization",
      "calibration": "Uniform prescriptiveness or vague on important steps",
      "validation": "No verification step defined",
    },
  };

  return map[score]?.[axis] || `Score: ${score}`;
}

function buildStrengths(scores: Score[]): string[] {
  return scores.filter((s) => s.score === 3).map((s) => `Strong ${s.axis.toLowerCase()}`.replace(/^./, (c) => c.toUpperCase()));
}

function buildImprovements(scores: Score[]): string[] {
  return scores
    .filter((s) => s.score <= 2)
    .map((s) => {
      const axis = s.axis;
      if (s.score === 1) return `Add or significantly improve ${axis.toLowerCase()}`;
      return `Improve ${axis.toLowerCase()}`;
    });
}

function buildSuggestedChanges(scores: Score[], skillMd: string, hasRefsDirOnDisk: boolean, hasAssetsDirOnDisk: boolean, hasScriptsDirOnDisk: boolean): string[] {
  const changes: string[] = [];

  for (const s of scores) {
    if (s.score >= 3) continue;

    switch (s.axis) {
      case "Gotchas coverage":
        if (s.score === 1) {
          changes.push(
            'Add a `## Gotchas` section with at least 3 concrete, environment-specific gotchas (e.g., naming inconsistencies, soft deletes, non-obvious API behaviors)',
          );
        } else {
          changes.push(
            "Expand `## Gotchas` with more specific, project-relevant items - not generic advice",
          );
        }
        break;

      case "Progressive disclosure":
        if (s.score === 1) {
          if (hasRefsDirOnDisk || hasAssetsDirOnDisk) {
            const dirName = hasRefsDirOnDisk ? "references" : "assets";
            changes.push(
              `Link your existing \`${dirName}/\` files in \`SKILL.md\` and add load triggers (e.g., load \`references/example.md\`)`,
            );
          } else {
            const longSections = findLongSections(skillMd);
            if (longSections.length > 0) {
              changes.push(
                `Move verbose sections to \`references/\`: ${longSections.join(", ")}`,
              );
            } else {
              changes.push(
                "Create a `references/` directory and move reference material out of `SKILL.md` with load triggers",
              );
            }
          }
        } else {
          changes.push(
            "Add explicit load triggers for existing `references/` or `assets/` content",
          );
        }
        break;

      case "Validation":
        if (s.score === 1) {
          changes.push(
            "Add a `## Validation` section with a checklist of concrete verification steps the agent can self-run",
          );
        } else {
          changes.push(
            "Expand `## Validation` with more checkboxes and/or a self-contained validation script",
          );
        }
        break;

      case "Context economy":
        changes.push(
          "Trim generic or fundamental explanations - assume the agent already knows common concepts",
        );
        break;

      case "Procedural clarity":
        changes.push(
          "Add numbered steps with decision criteria to the `## Process` section - teach *how*, not just *what*",
        );
        break;

      case "Calibration":
        changes.push(
          "Add exact commands for fragile/destructive operations and escape-hatch alternatives for flexible operations",
        );
        break;
    }
  }

  return changes;
}

function findLongSections(skillMd: string): string[] {
  const sections = skillMd.match(/^#{2,}\s+[^\n]+/gm) || [];
  const long: string[] = [];
  for (const sec of sections) {
    const title = sec.replace(/^#{2,}\s+/, "");
    const content = sectionContent(skillMd, title);
    if (countLines(content) > 50) {
      long.push(title);
    }
  }
  return long;
}

export function scoreTier(overall: number): "strong" | "adequate" | "needs-work" {
  if (overall >= 2.5) return "strong";
  if (overall >= 1.5) return "adequate";
  return "needs-work";
}

export function formatAuditReport(audits: SkillAudit[]): string {
  const rows = audits
    .map((a) => {
      const cells = a.scores.map((s) => s.score).join(" | ");
      return `| \`${a.name}\` | ${cells} | ${a.overall} |`;
    })
    .join("\n");

  const perSkill = audits
    .map((a) => {
      const tier = scoreTier(a.overall);
      const tierEmoji = tier === "strong" ? "🟢" : tier === "adequate" ? "🟡" : "🔴";

      return [
        `### \`${a.name}\``,
        "",
        `**Overall score:** ${a.overall} ${tierEmoji} (${tier})`,
        `**Path:** \`${a.path}\``,
        `**Reviewer-style proxy:** ${a.reviewerStyleProxy} (proxy)`,
        "",
        a.strengths.length > 0
          ? `**Strengths:**\n${a.strengths.map((s) => `- ${s}`).join("\n")}`
          : "**Strengths:** None identified - all axes have room to grow",
        "",
        a.improvements.length > 0
          ? `**Improvement opportunities:**\n${a.improvements.map((i) => `- ${i}`).join("\n")}`
          : "**Improvement opportunities:** None - all axes scored 3",
        "",
        a.suggestedChanges.length > 0
          ? `**Suggested changes:**\n${a.suggestedChanges.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
          : "",
        "",
        a.structuralIssues.length > 0
          ? `**Structural issues:**\n${a.structuralIssues.map((i) => `- ⚠️ ${i}`).join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");

  const date = new Date().toISOString().split("T")[0];

  return [
    "# Skill Audit Report",
    "",
    `**Generated:** ${date}`,
    `**Audited by:** \`skill-review\``,
    `**Skills audited:** ${audits.length}`,
    "",
    "---",
    "",
    "## Summary Scores",
    "",
    `| Skill | ${AXES.join(" | ")} | Overall |`,
    `|-------|${AXES.map(() => "---").join("|")}|---------|`,
    rows,
    "",
    "**Score interpretation:**",
    "- 2.5–3.0: Strong - follows best practices well",
    "- 1.5–2.4: Adequate - works but has improvement opportunities",
    "- 1.0–1.4: Needs work - significant gaps against best practices",
    "",
    "---",
    "",
    perSkill,
    "",
    "---",
    "",
    "## Next Steps",
    "",
    "Review the suggested changes above. Fix structural issues first, then tackle the lowest-scoring axes.",
  ].join("\n");
}
