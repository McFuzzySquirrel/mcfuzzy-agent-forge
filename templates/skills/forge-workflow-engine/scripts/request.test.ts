import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentDescriptor, HarnessAdapter, ManifestTask } from "./types.ts";
import { assertTaskCapabilities, prepareTaskRequest } from "./request.ts";
import { ClaudeAdapter } from "./harness/claude-adapter.ts";
import { CopilotAdapter } from "./harness/copilot-adapter.ts";
import { OpenCodeAdapter } from "./harness/opencode-adapter.ts";
import { OpenAIAdapter } from "./harness/openai-adapter.ts";
import { StubAdapter } from "./harness/stub-adapter.ts";
import { extractModelFlags } from "./harness/run.ts";
import { makeNodeShim } from "./test-support.ts";

const agent: AgentDescriptor = {
  name: "worker", path: "worker.md", description: "Worker", rawBody: "Unique persona content",
  model: "provider/agent-model", modelFallback: "never-auto-fallback", constraints: ["Unique constraint"],
  collaboration: [], expertise: [],
};
const task: ManifestTask = {
  id: "1", title: "Unique task title", description: "Unique task description", model: "provider/task-model",
  dependencies: [], expectedOutputs: ["answer.txt"], validationCommands: ["node --version"],
  approvalRequired: false, sourceLines: [], requiredCapabilities: ["text"],
};

for (const transport of ["copilot", "opencode", "claude", "openai", "stub"] as const) {
  test(`${transport} preserves normalized model precedence and task semantics`, async () => {
    const root = mkdtempSync(join(tmpdir(), "forge-conformance "));
    const originalEnv = { ...process.env };
    const originalFetch = globalThis.fetch;
    const argsFile = join(root, "args.json");
    let wire: { model: string; messages: Array<{ content: string }> } | undefined;
    try {
      const successEnvelope = JSON.stringify({
        type: "result", subtype: "success", is_error: false,
        result: "Substantive completed text response.", permission_denials: [],
      });
      const bin = makeNodeShim(root, "record", `require("fs").writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write(${JSON.stringify(successEnvelope)});`);
      process.env.COPILOT_BIN = bin;
      process.env.OPENCODE_BIN = bin;
      process.env.CLAUDE_BIN = bin;
      process.env.COPILOT_EXTRA_FLAGS = "--model provider/transport-model";
      process.env.OPENCODE_EXTRA_FLAGS = "--model provider/transport-model";
      process.env.CLAUDE_EXTRA_FLAGS = "--model provider/transport-model";
      process.env.OPENAI_API_KEY = "fixture-key";
      process.env.OPENAI_MODEL = "provider/transport-model";
      delete process.env.STUB_FAIL_TASK_IDS;
      delete process.env.STUB_DELAY_MS;
      globalThis.fetch = async (_input, init) => {
        wire = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: "Substantive completed text response." } }] }));
      };
      const adapter: HarnessAdapter = transport === "copilot" ? new CopilotAdapter()
        : transport === "opencode" ? new OpenCodeAdapter()
          : transport === "claude" ? new ClaudeAdapter()
            : transport === "openai" ? new OpenAIAdapter() : new StubAdapter();
      writeFileSync(join(root, "answer.txt"), "result");
      for (const selection of [
        { taskModel: "provider/task-model", agentModel: "provider/agent-model", expected: "provider/task-model" },
        { taskModel: undefined, agentModel: "provider/agent-model", expected: "provider/agent-model" },
        { taskModel: undefined, agentModel: undefined, expected: adapter.defaultModel },
      ]) {
        const request = prepareTaskRequest({
          agent: { ...agent, model: selection.agentModel }, task: { ...task, model: selection.taskModel },
          defaultModel: adapter.defaultModel, repoRoot: root, contextBlock: "Unique projected context",
          timeoutMs: 123_000, maxRetries: 3, attempt: 2, runId: "fixture-run",
        });
        assert.equal(request.effectiveModel, selection.expected);
        assertTaskCapabilities({ ...task, model: selection.taskModel }, adapter);
        const result = await adapter.invoke(request);
        assert.equal(result.success, true);
        if (transport === "stub") {
          if (selection.expected) assert.ok(result.stdout.includes(selection.expected));
          continue;
        }
        let prompt: string;
        if (transport === "openai") {
          assert.equal(wire?.model, selection.expected);
          prompt = wire!.messages.map((message) => message.content).join("\n");
        } else {
          const argv = JSON.parse(readFileSync(argsFile, "utf8")) as string[];
          const stripsPrefix = transport === "copilot" || transport === "claude";
          const expected = stripsPrefix ? selection.expected?.split("/").at(-1) : selection.expected;
          assert.equal(argv.filter((arg) => arg === "--model").length, 1);
          assert.equal(argv[argv.indexOf("--model") + 1], expected);
          // The fixture agent file is not under `.claude/agents/`, so claude inlines the
          // persona and passes the prompt after `-p`, exactly like copilot.
          prompt = stripsPrefix ? argv[argv.indexOf("-p") + 1]! : argv.at(-1)!;
        }
        for (const semantic of [agent.rawBody, "Unique constraint", task.title, task.description,
          "Unique projected context", "answer.txt", "node --version", "Per-task timeout: 123s",
          "retried up to 3 time(s)", "Attempt: 2", "Perform the task now"]) {
          assert.ok(prompt.includes(semantic), `${transport} lost '${semantic}'`);
        }
      }
    } finally {
      process.env = originalEnv;
      globalThis.fetch = originalFetch;
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("attempt requests are detached, deeply readonly snapshots without mutable workflow state", () => {
  const originalTask = { ...task, expectedOutputs: [...task.expectedOutputs] };
  const request = prepareTaskRequest({ agent, task: originalTask, repoRoot: "." });
  originalTask.expectedOutputs.push("later.txt");
  assert.deepEqual(request.task.expectedOutputs, ["answer.txt"]);
  assert.ok(Object.isFrozen(request));
  assert.ok(Object.isFrozen(request.agent.constraints));
  assert.ok(Object.isFrozen(request.task.expectedOutputs));
  assert.equal("state" in request, false);
  assert.equal("tasks" in request, false);
});

test("repository requests reference documents on demand while text requests retain their contents", (context) => {
  const root = mkdtempSync(join(tmpdir(), "forge-reference-request-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "requirements.md"), "Supporting detail. ".repeat(4000));
  const structured: ManifestTask = { ...task, ownerAgent: agent.name, contract: {
    version: 1, kind: "implementation", requirements: ["Mandatory requirement"], acceptanceCriteria: ["Mandatory criterion"],
    constraints: ["Mandatory constraint"], references: ["requirements.md"],
  } };
  const repository = prepareTaskRequest({ agent, task: { ...structured, requiredCapabilities: ["repository-tools"] }, repoRoot: root });
  assert.ok(repository.instructions.length < 3000);
  assert.ok(repository.instructions.includes("requirements.md"));
  assert.ok(!repository.instructions.includes("Supporting detail."));
  for (const required of ["Mandatory requirement", "Mandatory criterion", "Mandatory constraint"]) assert.ok(repository.instructions.includes(required));
  const text = prepareTaskRequest({ agent, task: structured, repoRoot: root });
  assert.ok(text.instructions.includes("Supporting detail."));
});

test("legacy and empty requirements require repository tooling, not merely a text result", () => {
  const harness: HarnessAdapter = { name: "text", supportsConcurrency: true, capabilities: ["text"], invoke: async () => { throw new Error("not called"); } };
  for (const requiredCapabilities of [undefined, []]) {
    assert.throws(() => assertTaskCapabilities({ ...task, expectedOutputs: [], requiredCapabilities }, harness), /requires repository-tools/);
  }
  assert.doesNotThrow(() => assertTaskCapabilities(task, harness));
});

test("structured retry instructions distinguish blockers and retain bounded failure feedback", (context) => {
  const root = mkdtempSync(join(tmpdir(), "forge-retry-request-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "requirements.md"), "Build result and verify tests pass.");
  const request = prepareTaskRequest({
    agent, task: { ...task, ownerAgent: agent.name, contract: { version: 1, kind: "implementation", requirements: ["Build result"], acceptanceCriteria: ["Tests pass"], constraints: [], references: ["requirements.md"] } },
    repoRoot: root, attempt: 2, previousFailure: "validation command failed: npm test\n" + "detail".repeat(2000),
    previousResultPath: "docs/task-executions/previous.result.json",
  });
  for (const expected of ["ONLY blocking unmet requirements", "An unverified required check is a blocker", "warnings", "validationLimitations", "validation command failed: npm test", "docs/task-executions/previous.result.json", "Preserve completed work"]) {
    assert.ok(request.instructions.includes(expected), expected);
  }
  assert.ok(request.instructions.length < 7000);
});

test("model flags are defaults and conflicting model defaults fail explicitly", () => {
  assert.deepEqual(extractModelFlags(["--quiet", "--model=provider/model"]), { flags: ["--quiet"], model: "provider/model" });
  assert.throws(() => extractModelFlags(["--model"]), /requires a model ID/);
  assert.throws(() => extractModelFlags(["--model", "a", "-m", "b"]), /Conflicting/);
});
