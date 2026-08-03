import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, basename } from "node:path";

/**
 * Auto-detected skill directory search order.
 */
const SKILL_DIRS = [
  ".agents/skills",
  "skills",
  ".opencode/skills",
  ".claude/skills",
  "templates/skills",
];

/**
 * Returns the first skill directory that exists and contains at least one SKILL.md file.
 */
export function detectSkillDir(root: string): string | null {
  for (const dir of SKILL_DIRS) {
    const full = join(root, dir);
    if (!existsSync(full) || !statSync(full).isDirectory()) continue;
    if (findSkillFiles(full).length > 0) return full;
  }
  return null;
}

/**
 * Recursively find all SKILL.md files under a directory.
 */
export function findSkillFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(current: string) {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        // Skip node_modules, .git, etc.
        if (entry.startsWith(".") && entry !== ".agents" && entry !== ".opencode" && entry !== ".claude") continue;
        if (entry === "node_modules") continue;
        walk(full);
      } else if (entry === "SKILL.md") {
        results.push(resolve(full));
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * Get list of changed SKILL.md files from git diff.
 * Compares against the merge base if in a PR, otherwise against HEAD~1.
 */
export function getChangedSkillFiles(root: string): string[] {
  let changedPaths: string[] = [];

  try {
    // Try merge-base first (PR scenario)
    const mergeBase = execSync(
      "git merge-base HEAD origin/HEAD 2>/dev/null || git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD origin/master 2>/dev/null",
      { encoding: "utf-8", cwd: root },
    ).trim();

    if (mergeBase) {
      changedPaths = execSync(
        `git diff --name-only --diff-filter=ACMR ${mergeBase}...HEAD`,
        { encoding: "utf-8", cwd: root },
      )
        .trim()
        .split("\n")
        .filter(Boolean);
    } else {
      // Fall back to last commit
      changedPaths = execSync(
        "git diff --name-only --diff-filter=ACMR HEAD~1",
        { encoding: "utf-8", cwd: root },
      )
        .trim()
        .split("\n")
        .filter(Boolean);
    }
  } catch {
    // Non-git environment - can't detect changes
    return [];
  }

  return changedPaths
    .filter((p) => p.endsWith("SKILL.md"))
    .map((p) => resolve(root, p))
    .filter((p) => existsSync(p));
}

/**
 * Filter out the skill-review skill itself from an audit list.
 */
export function excludeSelf(files: string[]): string[] {
  return files.filter((f) => {
    const dir = basename(resolve(f, ".."));
    return dir !== "skill-review";
  });
}

/**
 * Ensure listed files exist on disk.
 */
export function validateFiles(files: string[], root: string): { valid: string[]; missing: string[] } {
  const valid: string[] = [];
  const missing: string[] = [];

  for (const f of files) {
    const resolved = resolve(root, f);
    if (existsSync(resolved)) {
      valid.push(resolved);
    } else {
      missing.push(f);
    }
  }

  return { valid, missing };
}
