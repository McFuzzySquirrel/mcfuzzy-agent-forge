import type { Provider } from "./provider.js";
import { execSync } from "node:child_process";
import { relative, resolve } from "node:path";

export interface GitHubEnv {
  GITHUB_TOKEN: string;
  GITHUB_REPOSITORY?: string;
  GITHUB_PR_NUMBER?: string;
}

function getEnv(): GitHubEnv {
  const token = process.env.GITHUB_TOKEN || "";
  const repo = process.env.GITHUB_REPOSITORY || process.env.BUILD_REPOSITORY_NAME || "";
  const prNumber = process.env.GITHUB_PR_NUMBER || process.env.SYSTEM_PULLREQUEST_PULLREQUESTID || process.env.PR_NUMBER || "";
  return { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_PR_NUMBER: prNumber };
}

function extractPrNumber(): number | null {
  // Try GITHUB_REF (refs/pull/123/merge) for GitHub Actions
  const ref = process.env.GITHUB_REF || "";
  const refMatch = ref.match(/refs\/pull\/(\d+)\/merge/);
  if (refMatch) return parseInt(refMatch[1], 10);

  // Try env vars
  const env = getEnv();
  if (env.GITHUB_PR_NUMBER && /^\d+$/.test(env.GITHUB_PR_NUMBER)) {
    return parseInt(env.GITHUB_PR_NUMBER, 10);
  }

  return null;
}

function extractRepo(): { owner: string; repo: string } | null {
  const env = getEnv();
  if (env.GITHUB_REPOSITORY) {
    const parts = env.GITHUB_REPOSITORY.split("/");
    if (parts.length === 2) return { owner: parts[0], repo: parts[1] };
  }
  return null;
}

function detectRepoRoot(): string {
  try {
    const repoRoot = execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (repoRoot) return repoRoot;
  } catch {
    // Fall back to current working directory outside git contexts.
  }
  return process.cwd();
}

export const githubProvider: Provider = {
  name: "github",

  async postComments(report: string, files: string[]) {
    const errors: string[] = [];
    const token = getEnv().GITHUB_TOKEN;
    const prNumber = extractPrNumber();
    const repo = extractRepo();

    if (!token) {
      errors.push("GITHUB_TOKEN not set - cannot post PR comments");
      return { posted: 0, errors };
    }

    if (!prNumber) {
      errors.push("Could not determine PR number from environment (GITHUB_REF, GITHUB_PR_NUMBER, or PR_NUMBER)");
      return { posted: 0, errors };
    }

    if (!repo) {
      errors.push("Could not determine repository from GITHUB_REPOSITORY environment variable");
      return { posted: 0, errors };
    }

    try {
      const apiUrl = process.env.GITHUB_API_URL || "https://api.github.com";

      let postedCount = 0;

      // Post a general summary comment on the PR
      const summaryBody = `## Skill Review Report\n\n${report}`;
      const summaryResp = await fetch(
        `${apiUrl}/repos/${repo.owner}/${repo.repo}/issues/${prNumber}/comments`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({ body: summaryBody }),
        },
      );

      if (summaryResp.ok) {
        postedCount++;
      } else {
        const errBody = await summaryResp.text();
        errors.push(`Failed to post summary comment: ${summaryResp.status} ${errBody.slice(0, 300)}`);
      }

      // Post per-file inline comments as review comments if possible
      const headSha = process.env.GITHUB_SHA || process.env.BUILD_SOURCEVERSION || "";
      const repoRoot = detectRepoRoot();

      for (const file of files) {
        const relativePath = relative(repoRoot, resolve(file)).replace(/\\/g, "/");
        if (relativePath.startsWith("../")) {
          errors.push(`Skipping inline comment for file outside repository root: ${file}`);
          continue;
        }

        // Get the git diff to find the position in the file
        try {
          const diff = execSync(`git diff HEAD~1 -- "${relativePath}"`, {
            encoding: "utf-8",
            cwd: repoRoot,
          }).trim();

          if (diff) {
            // Find the first changed line to anchor the comment
            const hunkMatch = diff.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
            let line = 1;
            if (hunkMatch) {
              line = parseInt(hunkMatch[1], 10);
            }

            const fileComment = `### Skill Review: \`${relativePath}\`\n\nChecked against [agentskills.io best practices](https://agentskills.io/skill-creation/best-practices). See the summary comment above for full report.`;

            const reviewResp = await fetch(
              `${apiUrl}/repos/${repo.owner}/${repo.repo}/pulls/${prNumber}/comments`,
              {
                method: "POST",
                headers: {
                  Authorization: "Bearer " + token,
                  "Content-Type": "application/json",
                  Accept: "application/vnd.github+json",
                  "X-GitHub-Api-Version": "2022-11-28",
                },
                body: JSON.stringify({
                  body: fileComment,
                  commit_id: headSha,
                  path: relativePath,
                  line,
                  side: "RIGHT",
                }),
              },
            );

            if (reviewResp.ok) {
              postedCount++;
            } else {
              const errBody = await reviewResp.text();
              errors.push(`Failed to post comment on ${relativePath}: ${reviewResp.status} ${errBody.slice(0, 200)}`);
            }
          }
        } catch {
          // If we can't post inline, that's okay - summary comment is enough
        }
      }

      return { posted: postedCount, errors };
    } catch (err) {
      errors.push(`GitHub provider error: ${err instanceof Error ? err.message : String(err)}`);
      return { posted: 0, errors };
    }
  },
};
