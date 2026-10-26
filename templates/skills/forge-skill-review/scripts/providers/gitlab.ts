import type { Provider } from "./provider.js";

interface GitLabEnv {
  GITLAB_TOKEN: string;
  GITLAB_HOST: string;
  CI_PROJECT_ID: string;
  CI_MERGE_REQUEST_IID: string;
}

function getEnv(): GitLabEnv {
  return {
    GITLAB_TOKEN: process.env.GITLAB_TOKEN || process.env.PRIVATE_TOKEN || "",
    GITLAB_HOST: process.env.GITLAB_HOST || process.env.CI_SERVER_URL || "https://gitlab.com",
    CI_PROJECT_ID: process.env.CI_PROJECT_ID || "",
    CI_MERGE_REQUEST_IID: process.env.CI_MERGE_REQUEST_IID || process.env.GITLAB_MR_IID || "",
  };
}

export const gitlabProvider: Provider = {
  name: "gitlab",

  async postComments(report: string, _files: string[]) {
    const errors: string[] = [];
    const env = getEnv();

    if (!env.GITLAB_TOKEN) {
      errors.push("GITLAB_TOKEN not set - cannot post MR comments");
      return { posted: 0, errors };
    }

    if (!env.CI_PROJECT_ID) {
      errors.push("CI_PROJECT_ID not set - cannot determine GitLab project");
      return { posted: 0, errors };
    }

    if (!env.CI_MERGE_REQUEST_IID) {
      errors.push("CI_MERGE_REQUEST_IID not set - cannot determine merge request");
      return { posted: 0, errors };
    }

    try {
      const apiUrl = `${env.GITLAB_HOST}/api/v4/projects/${encodeURIComponent(env.CI_PROJECT_ID)}/merge_requests/${env.CI_MERGE_REQUEST_IID}/notes`;

      const summaryBody = `## Skill Review Report\n\n${report}`;

      const resp = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "PRIVATE-TOKEN": env.GITLAB_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ body: summaryBody }),
      });

      if (resp.ok) {
        return { posted: 1, errors };
      }

      const errBody = await resp.text();
      errors.push(`GitLab API error: ${resp.status} ${errBody.slice(0, 300)}`);
      return { posted: 0, errors };
    } catch (err) {
      errors.push(`GitLab provider error: ${err instanceof Error ? err.message : String(err)}`);
      return { posted: 0, errors };
    }
  },
};
