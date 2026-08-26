#!/usr/bin/env node
/**
 * Stages the live forge templates/docs into resources/ so the published
 * package bootstraps standalone. Runs as part of `npm pack` (prepack).
 * Excludes node_modules/dist, matching bootstrap's copy behaviour.
 */
import { mkdirSync, readdirSync, rmSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(pkgDir, "..", "..", "..");
const resourcesDir = path.join(pkgDir, "..", "resources");

function copyTree(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) copyTree(src, dest);
    else copyFileSync(src, dest);
  }
}

rmSync(resourcesDir, { recursive: true, force: true });
mkdirSync(resourcesDir, { recursive: true });

copyTree(path.join(repoRoot, "templates"), path.join(resourcesDir, "templates"));
copyFileSync(
  path.join(repoRoot, "docs", "prompt-playbook.md"),
  path.join(resourcesDir, "prompt-playbook.md"),
);

console.log(`Staged templates/ (no node_modules) + prompt-playbook.md into ${resourcesDir}`);
