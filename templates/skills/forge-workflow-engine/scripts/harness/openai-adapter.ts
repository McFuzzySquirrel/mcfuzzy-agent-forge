import type { AgentDescriptor, HarnessAdapter, ManifestTask, TaskResult, WorkflowState } from "../types.ts";

/**
 * OpenAI API harness adapter.
 *
 * Sends the agent's rawBody as the system prompt and the task description as
 * the user message, then returns the assistant reply as agentOutput.
 *
 * Required env vars:
 *   OPENAI_API_KEY    - API key
 *   OPENAI_BASE_URL   - optional override (default: https://api.openai.com/v1)
 *   OPENAI_MODEL      - optional model override (default: gpt-4o)
 */
export class OpenAIAdapter implements HarnessAdapter {
  readonly name = "openai";
  readonly supportsConcurrency = true;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor() {
    const key = process.env["OPENAI_API_KEY"];
    if (!key) throw new Error("OPENAI_API_KEY is required for the openai harness adapter.");
    this.apiKey = key;
    this.baseUrl = (process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.defaultModel = process.env["OPENAI_MODEL"] ?? "gpt-4o";
  }

  async invoke(
    agent: AgentDescriptor,
    task: ManifestTask,
    _context: WorkflowState,
    _repoRoot: string,
    contextBlock?: string,
  ): Promise<TaskResult> {
    const start = Date.now();
    const model = agent.model ?? this.defaultModel;
    const systemPrompt = this.buildSystemPrompt(agent);
    const userPrompt = this.buildUserPrompt(task, contextBlock);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + this.apiKey,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        return {
          success: false,
          outputFiles: [],
          stdout: "",
          stderr: body,
          durationMs: Date.now() - start,
          errorMessage: `OpenAI API error ${response.status}: ${body}`,
        };
      }

      const data = await response.json() as {
        choices: Array<{ message: { content: string } }>;
      };

      const content = data.choices[0]?.message.content ?? "";
      return {
        success: true,
        outputFiles: [],
        stdout: content,
        stderr: "",
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        success: false,
        outputFiles: [],
        stdout: "",
        stderr: String(error),
        durationMs: Date.now() - start,
        errorMessage: String(error),
      };
    }
  }

  private buildSystemPrompt(agent: AgentDescriptor): string {
    return [
      agent.rawBody,
      "",
      "## Constraints (injected by forge-workflow-engine)",
      ...agent.constraints.map((c) => `- ${c}`),
    ].join("\n").trim();
  }

  private buildUserPrompt(task: ManifestTask, contextBlock?: string): string {
    const lines: string[] = [];

    if (contextBlock) {
      lines.push(contextBlock, "");
    }

    lines.push(`## Task: ${task.title}`, "", task.description);

    if (task.expectedOutputs.length > 0) {
      lines.push("", `**Expected outputs:** ${task.expectedOutputs.join(", ")}`);
    }

    if (task.validationCommands.length > 0) {
      lines.push("", `**Validation commands:** ${task.validationCommands.join("; ")}`);
    }

    return lines.join("\n");
  }
}
