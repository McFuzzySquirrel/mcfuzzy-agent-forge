import type { Provider } from "./provider.js";
import { execSync } from "node:child_process";
import { relative, resolve } from "node:path";

interface AdoEnv {
  token: string;
  tokenType: "pat" | "bearer";
  orgUrl: string;
  project: string;
  repoId: string;
  prId: string;
}

function getAuth(token: string, type: "pat" | "bearer"): string {
  if (type === "bearer") {
    return "Bearer " + token;
  }
  return `Basic ${Buffer.from(`:${token}`).toString("base64")}`;
}

function getEnv(): AdoEnv | null {
  const orgUrl = (process.env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI || process.env.SYSTEM_COLLECTIONURI || "").replace(/\/$/, "");
  const project = process.env.SYSTEM_TEAMPROJECT || process.env.SYSTEM_TEAMPROJECTID || "";
  const repoId = process.env.BUILD_REPOSITORY_ID || process.env.BUILD_REPOSITORY_NAME || "";
  const prId = process.env.SYSTEM_PULLREQUEST_PULLREQUESTID || process.env.PR_ID || "";

  // System.AccessToken is the preferred auth method in ADO pipelines - OAuth bearer token
  const accessToken = process.env.SYSTEM_ACCESSTOKEN || "";
  if (accessToken && orgUrl && project && repoId && prId) {
    return { token: accessToken, tokenType: "bearer", orgUrl, project, repoId, prId };
  }

  // Fall back to explicit PAT
  const pat = process.env.ADO_PAT || process.env.AZURE_DEVOPS_EXT_PAT || "";
  if (pat && orgUrl && project && repoId && prId) {
    return { token: pat, tokenType: "pat", orgUrl, project, repoId, prId };
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

export const adoProvider: Provider = {
  name: "ado",

  async postComments(report: string, files: string[]) {
    const errors: string[] = [];
    const env = getEnv();

    if (!env) {
      const missing: string[] = [];
      const orgUrl = process.env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI || "";
      const accessToken = process.env.SYSTEM_ACCESSTOKEN || "";
      const pat = process.env.ADO_PAT || "";
      if (!orgUrl) missing.push("SYSTEM_TEAMFOUNDATIONCOLLECTIONURI");
      if (!accessToken && !pat) missing.push("SYSTEM_ACCESSTOKEN or ADO_PAT");
      if (!process.env.SYSTEM_TEAMPROJECT && !process.env.SYSTEM_TEAMPROJECTID) missing.push("SYSTEM_TEAMPROJECT");
      if (!process.env.BUILD_REPOSITORY_ID && !process.env.BUILD_REPOSITORY_NAME) missing.push("BUILD_REPOSITORY_ID");
      if (!process.env.SYSTEM_PULLREQUEST_PULLREQUESTID && !process.env.PR_ID) missing.push("SYSTEM_PULLREQUEST_PULLREQUESTID");
      errors.push(`Missing ADO environment variables: ${missing.join(", ")}`);
      return { posted: 0, errors };
    }

    const auth = getAuth(env.token, env.tokenType);
    const repoRoot = detectRepoRoot();

    try {
      let postedCount = 0;

      const summaryBody = `## Skill Review Report\n\n${report}`;

      const summaryResp = await fetch(
        `${env.orgUrl}/${encodeURIComponent(env.project)}/_apis/git/repositories/${encodeURIComponent(env.repoId)}/pullRequests/${env.prId}/threads?api-version=7.1`,
        {
          method: "POST",
          headers: {
            Authorization: auth,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            comments: [
              {
                parentCommentId: 0,
                content: summaryBody,
                commentType: "text",
              },
            ],
            status: "active",
          }),
        },
      );

      if (summaryResp.ok) {
        postedCount++;
      } else {
        const errBody = await summaryResp.text();
        errors.push(`ADO summary thread error: ${summaryResp.status} ${errBody.slice(0, 300)}`);
      }

      for (const file of files) {
        const relativePath = relative(repoRoot, resolve(file)).replace(/\\/g, "/");
        if (relativePath.startsWith("../")) {
          errors.push(`Skipping ADO inline thread for file outside repository root: ${file}`);
          continue;
        }

        const fileBody = `### Skill Review: \`${relativePath}\`\n\nChecked against [agentskills.io best practices](https://agentskills.io/skill-creation/best-practices). See summary thread for full report.`;

        const fileResp = await fetch(
          `${env.orgUrl}/${encodeURIComponent(env.project)}/_apis/git/repositories/${encodeURIComponent(env.repoId)}/pullRequests/${env.prId}/threads?api-version=7.1`,
          {
            method: "POST",
            headers: {
              Authorization: auth,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              comments: [
                {
                  parentCommentId: 0,
                  content: fileBody,
                  commentType: "text",
                },
              ],
              status: "active",
              threadContext: {
                filePath: `/${relativePath}`,
                leftFileStart: null,
                leftFileEnd: null,
                rightFileStart: { line: 1, offset: 0 },
                rightFileEnd: { line: 1, offset: 0 },
              },
            }),
          },
        );

        if (fileResp.ok) {
          postedCount++;
        } else {
          const errBody = await fileResp.text();
          errors.push(`ADO file thread error for ${relativePath}: ${fileResp.status} ${errBody.slice(0, 300)}`);
        }
      }

      return { posted: postedCount, errors };
    } catch (err) {
      errors.push(`ADO provider error: ${err instanceof Error ? err.message : String(err)}`);
      return { posted: 0, errors };
    }
  },
};
