const genericContextPatterns = [
  /what is an? /i,
  /is a (widely|well|commonly) known/i,
  /in (this|the) (article|guide|document), we('ll| will) (explain|discuss|cover)/i,
  /stands for/i,
  /simple terms/i,
  /basic (concept|idea|principle)/i,
  /for those unfamiliar/i,
  /a (popular|common|well-known) (framework|library|pattern|concept)/i,
];

const genericGotchaPatterns = [
  /handle errors/i,
  /be careful/i,
  /make sure to test/i,
  /follow best practices/i,
];

export const QUALITY_AXES = [
  { key: "contextEconomy", label: "Context economy" },
  { key: "gotchasCoverage", label: "Gotchas coverage" },
  { key: "proceduralClarity", label: "Procedural clarity" },
  { key: "progressiveDisclosure", label: "Progressive disclosure" },
  { key: "calibration", label: "Calibration" },
  { key: "validation", label: "Validation" },
];

function countLines(text) {
  return text.split("\n").length;
}

function hasSection(text, name) {
  return new RegExp(`^#{2,}\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "im").test(text);
}

function sectionContent(text, name) {
  const re = new RegExp(
    `^#{2,}\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]*\\n([\\s\\S]*?)(?=^#{2,}\\s|\\Z)`,
    "im",
  );
  return re.exec(text)?.[1]?.trim() ?? "";
}

function hasReferences(text) {
  return /\b(?:references|assets)\//i.test(text);
}

function hasLoadTrigger(text) {
  return /load when/i.test(text) || /load.*(?:`|\b)(?:references|assets)\//i.test(text);
}

function countFencedCommandBlocks(text) {
  return (text.match(/```(?:bash|sh|shell|zsh|console|powershell|cmd)?[\s\S]*?```/gi) ?? []).length;
}

function hasFallbackGuidance(text) {
  return /(if (that|this) doesn'?t work|if that fails|if it fails|fallback|otherwise|alternatively|try .* instead)/i.test(text);
}

function scoreContextEconomy(text, hasRefsDirOnDisk, hasAssetsDirOnDisk) {
  let genericHits = 0;
  for (const pattern of genericContextPatterns) genericHits += (text.match(new RegExp(pattern.source, "gi")) ?? []).length;
  const lines = countLines(text);
  const hasOffloadedDetail = (hasReferences(text) || hasRefsDirOnDisk || hasAssetsDirOnDisk) && hasLoadTrigger(text);
  if (genericHits <= 1 && hasOffloadedDetail) return 3;
  if (genericHits === 0 && lines < 200) return 3;
  if (genericHits <= 1 && lines < 350) return 2;
  return 1;
}

function scoreGotchasCoverage(text) {
  if (!hasSection(text, "Gotchas")) return 1;
  const content = sectionContent(text, "Gotchas");
  const items = (content.match(/^\s*[-*]/gm) ?? []).length;
  const genericHits = genericGotchaPatterns.reduce((count, pattern) => count + (content.match(pattern) ?? []).length, 0);
  if (items >= 3 && genericHits <= 1) return 3;
  if (items >= 1) return 2;
  return 1;
}

function scoreProceduralClarity(text) {
  const steps = (text.match(/^###?\s+Step\s+\d+:/gm) ?? []).length;
  const numberedSteps = (text.match(/^\d+\.\s+\*\*/gm) ?? []).length;
  const decisions = (text.match(/if\s+.*\bthen\b/gi) ?? []).length;
  const totalSteps = steps + numberedSteps;
  if (hasSection(text, "Process") && totalSteps >= 3 && decisions >= 1) return 3;
  if (hasSection(text, "Process") && totalSteps >= 2) return 2;
  return 1;
}

function scoreProgressiveDisclosure(text, hasRefsDirOnDisk, hasAssetsDirOnDisk) {
  const lines = countLines(text);
  const hasRefs = hasReferences(text);
  const hasLoad = hasLoadTrigger(text);
  const hasRefsDir = hasRefsDirOnDisk || /\b(?:references|assets)\//i.test(text);
  const hasAssetsDir = hasAssetsDirOnDisk || /\bassets\//i.test(text);
  if (hasRefs && hasLoad && (hasRefsDir || hasAssetsDir) && lines < 500) return 3;
  if ((hasRefs || hasRefsDir || hasAssetsDir) && lines < 600) return 2;
  return 1;
}

function scoreCalibration(text) {
  const inlineCommands = (text.match(/`[^`]{3,}`/g) ?? []).length;
  const fencedCommands = countFencedCommandBlocks(text);
  const escapeHatches = (text.match(/if (that|this) doesn'?t work/i) ?? []).length;
  const defaults = (text.match(/(?:by default|default command|use the standard|run the standard|recommended command)/gi) ?? []).length;
  const alternatives = (text.match(/you (can|may|might|could) (also |alternatively )?/gi) ?? []).length;
  const destructiveOps = (text.match(/(delete|destroy|drop|rm\s|remove|truncate|purge)/gi) ?? []).length;
  const commandExamples = inlineCommands + fencedCommands;
  const hasFallbacks = hasFallbackGuidance(text) || escapeHatches > 0 || defaults > 0;
  if (destructiveOps > 0 && commandExamples === 0) return 1;
  if (commandExamples >= 1 && hasFallbacks) return 3;
  if (commandExamples >= 2 || alternatives >= 1) return 2;
  return 1;
}

function scoreValidation(text, hasScriptsDirOnDisk) {
  const checkboxes = (text.match(/^\s*- \[[ x]\]/gm) ?? []).length;
  const hasScriptCheck = hasScriptsDirOnDisk || /scripts?\//i.test(text);
  const hasSelfCheck = /self.?(check|validate|verify)/i.test(text);
  if (hasSection(text, "Validation") && checkboxes >= 3 && (hasScriptCheck || hasSelfCheck)) return 3;
  if (hasSection(text, "Validation") && checkboxes >= 1) return 2;
  return 1;
}

export function scoreSkill(text, directories = {}) {
  return {
    contextEconomy: scoreContextEconomy(text, Boolean(directories.hasRefsDirOnDisk), Boolean(directories.hasAssetsDirOnDisk)),
    gotchasCoverage: scoreGotchasCoverage(text),
    proceduralClarity: scoreProceduralClarity(text),
    progressiveDisclosure: scoreProgressiveDisclosure(text, Boolean(directories.hasRefsDirOnDisk), Boolean(directories.hasAssetsDirOnDisk)),
    calibration: scoreCalibration(text),
    validation: scoreValidation(text, Boolean(directories.hasScriptsDirOnDisk)),
  };
}

export function checkSkillStructure({ name, parentDir, rawFrontmatter, text, resolveReference }) {
  const issues = [];
  if (typeof rawFrontmatter?.name !== "string") issues.push("Missing or invalid `name` in frontmatter");
  else if (rawFrontmatter.name !== parentDir) issues.push(`Frontmatter \`name\` ("${rawFrontmatter.name}") does not match parent directory ("${parentDir}")`);
  if (typeof rawFrontmatter?.description !== "string" || rawFrontmatter.description.trim().length < 20) {
    issues.push("`description` is missing, too short, or not specific enough for activation");
  }
  const references = [...new Set(text.match(/\(([^)]*\.md)\)/g) ?? [])].map((value) => value.slice(1, -1));
  for (const reference of references) {
    if (!reference.startsWith("./") && !reference.startsWith("../")) {
      issues.push(`File reference "(${reference})" should use a relative path from the skill root`);
    } else if (resolveReference && !resolveReference(reference)) {
      issues.push(`Missing referenced file ${reference}`);
    }
  }
  const loadRefs = text.match(/load\s+`references\/[^`]+`/gi) ?? [];
  if (loadRefs.length > 0 && /references\/[^)]+\.md.*references\/[^)]+\.md/gi.test(text)) {
    issues.push("Potential nested reference chain detected - keep to one level of depth");
  }
  return issues;
}
