import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.resolve(PKG_DIR, "..", "..");

/**
 * Resolves the templates/docs directories the launcher bootstraps from.
 * Prefers the live forge repo (development), falling back to the resources
 * bundled with the published package.
 */
export function resolveResources(): {
  templatesDir: string;
  docsDir: string;
  usingBundled: boolean;
} {
  const liveTemplates = path.join(REPO_ROOT, "templates");
  const liveDocs = path.join(REPO_ROOT, "docs");
  if (fs.existsSync(liveTemplates) && fs.existsSync(path.join(liveDocs, "prompt-playbook.md"))) {
    return { templatesDir: liveTemplates, docsDir: liveDocs, usingBundled: false };
  }
  return {
    templatesDir: path.join(PKG_DIR, "resources", "templates"),
    docsDir: path.join(PKG_DIR, "resources"),
    usingBundled: true,
  };
}
