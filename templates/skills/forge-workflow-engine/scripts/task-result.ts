export interface TaskHandoff {
  summary: string;
  decisions: string[];
  interfaces: string[];
  tests: string[];
  unresolved: string[];
}

export function parseTaskHandoff(output: string): TaskHandoff | undefined {
  const matches = [...output.matchAll(/```forge-result\s*\r?\n([\s\S]*?)```/g)];
  if (!matches.length) return undefined;
  try {
    const value = JSON.parse(matches.at(-1)![1]!) as TaskHandoff;
    if (typeof value.summary !== "string" || !value.summary.trim()) return undefined;
    for (const field of ["decisions", "interfaces", "tests", "unresolved"] as const) {
      if (!Array.isArray(value[field]) || value[field].some((entry) => typeof entry !== "string" || !entry.trim())) return undefined;
    }
    if (!value.tests.length || JSON.stringify(value).length > 16000) return undefined;
    return value;
  } catch { return undefined; }
}