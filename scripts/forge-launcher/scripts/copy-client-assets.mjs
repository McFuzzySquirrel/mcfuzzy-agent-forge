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

mkdirSync(dest, { recursive: true });
for (const file of ["index.html", "style.css"]) {
  copyFileSync(path.join(src, file), path.join(dest, file));
}

console.log(`Copied console client assets into ${dest}`);
