import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import type * as Metadata from "../../../templates/skills/forge-execution-adapter/scripts/repo-metadata.mjs";
import { resolveResources } from "./resources.ts";

// Load from our own bundled templates, never from an unprepared target repo.
const metadata: typeof Metadata = await import(pathToFileURL(path.join(
  resolveResources().templatesDir, "skills", "forge-execution-adapter", "scripts", "repo-metadata.mjs",
)).href);

export const { HARNESS_ROOTS, selectHarnessRoot, parseMetadata } = metadata;
export type HarnessRoot = Metadata.HarnessRoot;

/** Keep authoring and reporting on the same team as an existing manifest. */
export function selectProjectHarnessRoot(repoRoot: string, preferred?: HarnessRoot) {
  if (preferred !== undefined) return selectHarnessRoot(repoRoot, preferred);
  const file = path.join(repoRoot, "docs", "EXECUTION-MANIFEST.json");
  if (!fs.existsSync(file)) return selectHarnessRoot(repoRoot);
  const manifest: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    throw new Error(`Execution manifest must be an object: ${file}`);
  }
  if ("harnessRoot" in manifest) {
    if (typeof manifest.harnessRoot !== "string") {
      throw new Error(`Execution manifest harnessRoot must be a string: ${file}`);
    }
    const selected = HARNESS_ROOTS.find((root) => root === manifest.harnessRoot);
    if (!selected) throw new Error(`Unsupported execution manifest harnessRoot: ${manifest.harnessRoot}`);
    return selectHarnessRoot(repoRoot, selected);
  }
  return selectHarnessRoot(repoRoot);
}
