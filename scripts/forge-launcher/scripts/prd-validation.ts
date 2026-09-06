import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runCommand } from "./format.ts";
import { resolveResources } from "./resources.ts";

const require = createRequire(import.meta.url);

export async function validateAuthoredPrd(repo: string, options: { featureFiles?: string[]; allowLegacy?: boolean } = {}): Promise<string[]> {
  const script = path.join(resolveResources().templatesDir, "skills/forge-execution-adapter/scripts/prd-validation.ts");
  const result = await runCommand(process.execPath, ["--import", pathToFileURL(require.resolve("tsx")).href, script, repo,
    ...(options.allowLegacy ? ["--allow-legacy"] : []),
    ...(options.featureFiles?.flatMap((file) => ["--feature", file]) ?? []),
  ], { cwd: repo, capture: true });
  let report: { errors: string[]; outputs: string[] };
  try { report = JSON.parse(result.stdout); }
  catch { throw new Error(`PRD validation could not run: ${result.stderr || result.stdout}`); }
  if (result.code !== 0 || report.errors.length) throw new Error(`PRD authoring validation failed:\n${report.errors.join("\n")}\nRepair the PRD task contracts and required decomposition before team generation; retry draft-prd or draft-existing-prd. No implementation was started.`);
  return report.outputs;
}