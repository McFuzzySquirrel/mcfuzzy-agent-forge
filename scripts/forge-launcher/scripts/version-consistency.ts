import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface VersionConsistencyResult {
  ok: boolean;
  readmeVersion: string | null;
  changelogVersion: string | null;
  message: string;
}

export function validateVersionConsistency(readme: string, changelog: string): VersionConsistencyResult {
  const readmeVersion = /\*\*Latest:\s*v([^*\s]+)\s*\*\*/i.exec(readme)?.[1] ?? null;
  const changelogVersion = /^##\s+[^\n-]+-\s+v([^\s]+)/m.exec(changelog)?.[1] ?? null;
  const ok = Boolean(readmeVersion && changelogVersion && readmeVersion === changelogVersion);
  return { ok, readmeVersion, changelogVersion, message: ok ? `README and changelog are both v${readmeVersion}.` : `README Latest (${readmeVersion ?? "missing"}) does not match changelog (${changelogVersion ?? "missing"}).` };
}

export function validateVersionFiles(readmePath: string, changelogPath: string): VersionConsistencyResult {
  return validateVersionConsistency(fs.readFileSync(readmePath, "utf8"), fs.readFileSync(changelogPath, "utf8"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const result = validateVersionFiles(path.join(root, "README.md"), path.join(root, "docs/updates.md"));
  console.log(result.message);
  if (!result.ok) process.exitCode = 1;
}
