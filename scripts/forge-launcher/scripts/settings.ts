// ─── Global (system-level) Console defaults ──────────────────────────────────
//
// Shared defaults stored in the Forge registry directory (FORGE_HOME, or
// ~/.myforge by default) under `settings.json`. Projects inherit these where
// they carry no explicit per-project value, so the effective resolution ladder
// is: explicit override → saved project recommendation → project default →
// system default → runner default.
//
// The registry dir is the natural home: `console/paths.ts` already treats it as
// the user-level Forge state directory, and project removal deliberately leaves
// a `settings.json` there untouched.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { registryPath } from "./console/paths.ts";

export type GlobalAuthoringStage = "prd" | "team" | "skills";
export type GlobalRunner = "copilot" | "opencode" | "claude";

export interface GlobalSettings {
  version: 1;
  /** Default authoring runner and per-stage models; a project overrides them. */
  authoring?: {
    runner?: GlobalRunner;
    models?: Partial<Record<GlobalAuthoringStage, string>>;
  };
  /** Default execution preferences; a project's docs/engine-config.json overrides them. */
  execution?: {
    /** Positive integer; absent/0 means the engine default. */
    concurrency?: number;
    /** Absent means the engine default (on). */
    autoCommit?: boolean;
    /** Absent means the engine default (off). */
    logHarnessActivity?: boolean;
    /** Teammate sub-agents per task: 0 = off, 1-4 = cap, absent = auto. */
    subagents?: number;
  };
  /** Default harness for newly created projects. */
  harness?: "opencode" | "github" | "claude" | "agents";
  /** Per-user UI preferences. */
  ui?: {
    theme?: "light" | "dark" | "auto";
    boardMode?: "kanban" | "gantt" | "table";
  };
}

const GLOBAL_RUNNERS = ["copilot", "opencode", "claude"] as const;
const GLOBAL_STAGES = ["prd", "team", "skills"] as const;
const GLOBAL_HARNESSES = ["opencode", "github", "claude", "agents"] as const;

export function settingsPath(): string {
  return path.join(path.dirname(registryPath()), "settings.json");
}

export function defaultSettings(): GlobalSettings {
  return { version: 1 };
}

/**
 * Lenient read for the resolution ladder: a missing or unreadable settings file
 * yields the defaults so a corrupt file can never break authoring or the launch
 * of a run. `validateSettings` / `saveSettings` remain the strict write path.
 */
export function loadSettings(): GlobalSettings {
  const file = settingsPath();
  if (!fs.existsSync(file)) return defaultSettings();
  try {
    return validateSettings(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return defaultSettings();
  }
}

export function validateSettings(value: unknown): GlobalSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid settings: expected an object.");
  }
  const obj = value as Record<string, unknown>;
  if (obj.version !== undefined && obj.version !== 1) {
    throw new Error("Invalid settings: unsupported version (expected 1).");
  }
  const settings: GlobalSettings = { version: 1 };

  if (obj.authoring !== undefined) {
    if (!obj.authoring || typeof obj.authoring !== "object" || Array.isArray(obj.authoring)) {
      throw new Error("Invalid settings: authoring must be an object.");
    }
    const authoring = obj.authoring as Record<string, unknown>;
    const out: NonNullable<GlobalSettings["authoring"]> = {};
    if (authoring.runner !== undefined) {
      if (typeof authoring.runner !== "string" || !(GLOBAL_RUNNERS as readonly string[]).includes(authoring.runner)) {
        throw new Error("Invalid settings: authoring.runner must be copilot, opencode, or claude.");
      }
      out.runner = authoring.runner as GlobalRunner;
    }
    if (authoring.models !== undefined) {
      if (!authoring.models || typeof authoring.models !== "object" || Array.isArray(authoring.models)) {
        throw new Error("Invalid settings: authoring.models must be an object.");
      }
      const models: NonNullable<NonNullable<GlobalSettings["authoring"]>["models"]> = {};
      for (const [stage, model] of Object.entries(authoring.models as Record<string, unknown>)) {
        if (!(GLOBAL_STAGES as readonly string[]).includes(stage)) {
          throw new Error(`Invalid settings: unknown authoring stage "${stage}".`);
        }
        if (typeof model !== "string" || !model.trim() || /[\s\0]/.test(model.trim())) {
          throw new Error(`Invalid settings: ${stage} model must be a non-empty model ID.`);
        }
        models[stage as GlobalAuthoringStage] = model.trim();
      }
      out.models = models;
    }
    if (out.runner || out.models) settings.authoring = out;
  }

  if (obj.execution !== undefined) {
    if (!obj.execution || typeof obj.execution !== "object" || Array.isArray(obj.execution)) {
      throw new Error("Invalid settings: execution must be an object.");
    }
    const execution = obj.execution as Record<string, unknown>;
    const out: NonNullable<GlobalSettings["execution"]> = {};
    if (execution.concurrency !== undefined) {
      if (typeof execution.concurrency !== "number" || !Number.isInteger(execution.concurrency) || execution.concurrency < 0) {
        throw new Error("Invalid settings: execution.concurrency must be a non-negative integer.");
      }
      out.concurrency = execution.concurrency;
    }
    if (execution.autoCommit !== undefined) {
      if (typeof execution.autoCommit !== "boolean") throw new Error("Invalid settings: execution.autoCommit must be a boolean.");
      out.autoCommit = execution.autoCommit;
    }
    if (execution.logHarnessActivity !== undefined) {
      if (typeof execution.logHarnessActivity !== "boolean") throw new Error("Invalid settings: execution.logHarnessActivity must be a boolean.");
      out.logHarnessActivity = execution.logHarnessActivity;
    }
    if (execution.subagents !== undefined) {
      if (typeof execution.subagents !== "number" || !Number.isInteger(execution.subagents) ||
          execution.subagents < 0 || execution.subagents > 4) {
        throw new Error("Invalid settings: execution.subagents must be an integer from 0 to 4 (0 disables delegation).");
      }
      out.subagents = execution.subagents;
    }
    if (out.concurrency !== undefined || out.autoCommit !== undefined || out.logHarnessActivity !== undefined || out.subagents !== undefined) {
      settings.execution = out;
    }
  }

  if (obj.harness !== undefined) {
    if (typeof obj.harness !== "string" || !(GLOBAL_HARNESSES as readonly string[]).includes(obj.harness)) {
      throw new Error("Invalid settings: harness must be opencode, github, claude, or agents.");
    }
    settings.harness = obj.harness as GlobalSettings["harness"];
  }

  if (obj.ui !== undefined) {
    if (!obj.ui || typeof obj.ui !== "object" || Array.isArray(obj.ui)) {
      throw new Error("Invalid settings: ui must be an object.");
    }
    const ui = obj.ui as Record<string, unknown>;
    const out: NonNullable<GlobalSettings["ui"]> = {};
    if (ui.theme !== undefined) {
      if (ui.theme !== "light" && ui.theme !== "dark" && ui.theme !== "auto") {
        throw new Error("Invalid settings: ui.theme must be light, dark, or auto.");
      }
      out.theme = ui.theme;
    }
    if (ui.boardMode !== undefined) {
      if (ui.boardMode !== "kanban" && ui.boardMode !== "gantt" && ui.boardMode !== "table") {
        throw new Error("Invalid settings: ui.boardMode must be kanban, gantt, or table.");
      }
      out.boardMode = ui.boardMode;
    }
    if (out.theme || out.boardMode) settings.ui = out;
  }

  return settings;
}

export function saveSettings(settings: GlobalSettings): GlobalSettings {
  const validated = validateSettings(settings);
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return validated;
}
