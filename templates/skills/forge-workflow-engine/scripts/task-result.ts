export interface TaskHandoff {
  summary: string;
  decisions: string[];
  interfaces: string[];
  tests: string[];
  unresolved: string[];
  warnings?: string[];
  validationLimitations?: string[];
}

export function readTaskHandoff(output: string): { handoff?: TaskHandoff; error?: string } {
  const matches = [...output.matchAll(/```forge-result\s*\r?\n([\s\S]*?)```/g)];
  if (!matches.length) return { error: "Missing fenced forge-result JSON report." };
  try {
    const value = JSON.parse(matches.at(-1)![1]!);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "forge-result must be a JSON object." };
    if (JSON.stringify(value).length > 16000) return { error: "forge-result exceeds the 16000-character limit; shorten the report." };
    const strings = (entries: unknown): entries is string[] => Array.isArray(entries) && entries.every((entry) => typeof entry === "string" && Boolean(entry.trim()));
    const summary = strings(value.summary) ? value.summary.join("\n") : value.summary;
    if (typeof summary !== "string" || !summary.trim()) return { error: "forge-result.summary must be a nonempty string or nonempty list of strings." };
    if (!strings(value.unresolved)) return { error: "forge-result.unresolved must be a string array; use [] when no blocking requirements remain." };
    for (const field of ["decisions", "interfaces", "tests", "warnings", "validationLimitations"] as const) {
      if (value[field] !== undefined && !strings(value[field])) return { error: `forge-result.${field} must be an array of nonempty strings when supplied.` };
    }
    return { handoff: { ...value, summary, decisions: value.decisions ?? [], interfaces: value.interfaces ?? [], tests: value.tests ?? [] } };
  } catch { return { error: "forge-result contains invalid JSON; return one valid JSON object." }; }
}

export function parseTaskHandoff(output: string): TaskHandoff | undefined {
  return readTaskHandoff(output).handoff;
}