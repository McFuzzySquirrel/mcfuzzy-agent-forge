export type HarnessRoot = ".agents" | ".github" | ".claude" | ".opencode";
export const HARNESS_ROOTS: readonly HarnessRoot[];
export function selectHarnessRoot(repoRoot: string, preferred?: HarnessRoot): {
  root: HarnessRoot | null;
  warnings: string[];
};
export interface ParsedMetadata {
  data: Record<string, unknown>;
  content: string;
}
export function parseMetadata(
  markdown: string,
  parser: (markdown: string) => { data: unknown; content: string },
  source?: string,
): ParsedMetadata;
