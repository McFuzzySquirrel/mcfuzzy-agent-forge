import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getGuidedAuthoringStep,
  initialProjectToolChoice,
  initializeGuidedAuthoring,
  recordGuidedAuthoringSessionExit,
  setGuidedAuthoringStep,
  suggestProjectName,
} from "./console/dashboard/project-authoring.ts";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

test("guided authoring resumes at the last successfully completed interactive phase", () => {
  const storage = new MemoryStorage();
  const repo = "/projects/weather-helper";
  initializeGuidedAuthoring(repo, storage);
  assert.equal(getGuidedAuthoringStep(repo, storage), "idea");

  recordGuidedAuthoringSessionExit(repo, "idea", 1, storage);
  assert.equal(getGuidedAuthoringStep(repo, storage), "idea", "a failed or interrupted session stays resumable");

  recordGuidedAuthoringSessionExit(repo, "idea", 0, storage);
  assert.equal(getGuidedAuthoringStep(repo, storage), "brief");
  assert.equal(getGuidedAuthoringStep("/projects/another-project", storage), null);

  recordGuidedAuthoringSessionExit(repo, "prd", 0, storage);
  assert.equal(getGuidedAuthoringStep(repo, storage), "review");
});

test("a brief session cannot bypass the required interactive Idea exploration", () => {
  const storage = new MemoryStorage();
  const repo = "/projects/weather-helper";
  initializeGuidedAuthoring(repo, storage);

  recordGuidedAuthoringSessionExit(repo, "prd", 0, storage);
  assert.equal(getGuidedAuthoringStep(repo, storage), "idea");
});

test("brief approval and preparation progress resume at their saved Project step", () => {
  const storage = new MemoryStorage();
  const repo = "/projects/weather-helper";
  initializeGuidedAuthoring(repo, storage);
  setGuidedAuthoringStep(repo, "review", storage);
  setGuidedAuthoringStep(repo, "preparing", storage);
  assert.equal(getGuidedAuthoringStep(repo, storage), "preparing");
  setGuidedAuthoringStep(repo, "ready", storage);
  assert.equal(getGuidedAuthoringStep(repo, storage), "ready");
  assert.equal(getGuidedAuthoringStep("/projects/another-project", storage), null);
});

test("Project name suggestions are editable-safe URL-friendly slugs", () => {
  assert.equal(suggestProjectName("A weather helper for young readers!"), "a-weather-helper-for-young");
  assert.equal(suggestProjectName("東京"), "my-project");
});

test("the configured AI coding tool is selected without inventing a default", () => {
  assert.equal(initialProjectToolChoice("claude"), "claude");
  assert.equal(initialProjectToolChoice(undefined), "");
  assert.equal(initialProjectToolChoice("unknown"), "");
});
