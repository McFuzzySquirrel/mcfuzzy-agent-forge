#!/usr/bin/env node
/**
 * Copies the console client's static assets (index.html, style.css) into the
 * compiled client output directory so the console server can serve them
 * alongside the tsc-emitted .js modules.
 */
import { mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(pkgDir, "scripts", "console", "dashboard");
const dest = path.join(pkgDir, "resources", "console", "client");
const repoRoot = path.resolve(pkgDir, "..", "..");

mkdirSync(dest, { recursive: true });
for (const file of ["index.html", "style.css"]) {
  copyFileSync(path.join(src, file), path.join(dest, file));
}

// The console user guide is served to the client as /guide.md so the Help
// modal can render it. Source of truth lives in the repo's docs/ directory.
copyFileSync(
  path.join(repoRoot, "docs", "forge-console-user-guide.md"),
  path.join(dest, "guide.md"),
);

console.log(`Copied console client assets into ${dest}`);
