import type { HarnessAdapter, TaskAttemptRequest, TaskResult } from "../types.ts";
import { inlinePersona } from "../request.ts";

/**
 * OpenAI API harness adapter.
 *
 * Sends the normalized persona and task instructions as system/user messages,
 * then returns the assistant reply as agentOutput. No repository tools exist.
 *
 * Required env vars:
 *   OPENAI_API_KEY    - API key
 *   OPENAI_BASE_URL   - optional override (default: https://api.openai.com/v1)
 *   OPENAI_MODEL      - transport default below task/agent models (default: gpt-4o)
 */
export class OpenAIAdapter implements HarnessAdapter {
  readonly name = "openai";
  readonly supportsConcurrency = true;
  readonly capabilities = ["text"] as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  readonly defaultModel: string;

  constructor() {
    const key = process.env["OPENAI_API_KEY"];
    if (!key) throw new Error("OPENAI_API_KEY is required for the openai harness adapter.");
    this.apiKey = key;
    this.baseUrl = (process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.defaultModel = process.env["OPENAI_MODEL"] ?? "gpt-4o";
  }

  async invoke(request: TaskAttemptRequest): Promise<TaskResult> {
    const start = Date.now();
    const model = request.effectiveModel;
    const systemPrompt = inlinePersona(request);
    const userPrompt = request.instructions;
    const effectiveTimeoutMs = request.budget.timeoutMs;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);
    timer.unref?.();
    const signal = request.signal ? AbortSignal.any([controller.signal, request.signal]) : controller.signal;

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
        signal,
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
          failureKind: response.status === 408 || response.status === 429 || response.status >= 500 ? "retryable" : "configuration",
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
      const aborted = controller.signal.aborted;
      return {
        success: false,
        outputFiles: [],
        stdout: "",
        stderr: String(error),
        durationMs: Date.now() - start,
        failureKind: request.signal?.aborted ? "cancelled" : aborted ? "timeout" : error instanceof TypeError ? "retryable" : "exception",
        errorMessage: request.signal?.aborted ? "Task cancelled" : aborted
          ? `timed out after ${effectiveTimeoutMs}ms`
          : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }

}
