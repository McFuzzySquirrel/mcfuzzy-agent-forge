// ─── Settings: authoring, execution, and model configuration ────────────────
//
// Consolidates the knobs that used to be scattered across Overview (execution
// prefs + timeouts) and Plan & Team (authoring models, per-agent model
// overrides, and the model planning terminal). Each section maps to a distinct
// on-disk file: docs/authoring-config.json, docs/engine-config.json, and
// docs/model-overrides.json respectively, so a user finds every project-level
// preference in one place.

import { api } from "../api.js";
import { store } from "../state.js";
import { el, minutesToTimeoutMs, toast } from "../render/dom.js";
import { AUTHORING_RUNNER_OPTIONS, effectiveRunner } from "../runners.js";
import type {
  AgentInfo,
  AuthoringConfig,
  AuthoringInventory,
  AuthoringStage,
  ExecutionMode,
  GlobalRunner,
  GlobalSettings,
  TaskRow,
} from "../types.js";

let unsub: Array<() => void> = [];
let authoringGeneration = 0;
// Execution controls that reflect store.summary and are updated in place so a
// background snapshot never clobbers the user mid-edit.
let autoCommitCb: HTMLInputElement | null = null;
let logActivityCb: HTMLInputElement | null = null;
let concurrencyInput: HTMLInputElement | null = null;

export function unmountSettings(): void {
  for (const u of unsub) u();
  unsub = [];
  authoringGeneration += 1;
  autoCommitCb = null;
  logActivityCb = null;
  concurrencyInput = null;
}

export function renderSettings(container: HTMLElement): void {
  unmountSettings();
  container.textContent = "";

  container.appendChild(
    el("div", null, [
      el("h1", null, "Settings"),
      el("p", { className: "dim" }, "Project-level configuration plus system-level defaults. Global defaults apply across projects; a project's saved value overrides the inherited default."),
    ]),
  );

  container.appendChild(globalDefaultsSection());
  container.appendChild(authoringSection());
  container.appendChild(executionSection());
  container.appendChild(modelsSection());

  unsub.push(store.subscribe(() => refreshExecution()));
}

// ─── Global defaults ──────────────────────────────────────────────────────────

function globalDefaultsSection(): HTMLElement {
  const panel = el("div", { className: "panel" }, [
    el("h2", null, "Global defaults"),
    el("p", { className: "dim small" }, "System-level defaults shared across all projects (stored in your Forge settings). Projects inherit these where they have not chosen their own value."),
    el("div", { className: "spinner-row", role: "status" }, [el("span", { className: "spinner", "aria-hidden": "true" }), "Loading global defaults…"]),
  ]);
  const generation = ++authoringGeneration;
  void loadGlobalDefaults(panel, generation);
  return panel;
}

async function loadGlobalDefaults(panel: HTMLElement, generation: number): Promise<void> {
  try {
    const settings = await api.settings();
    if (generation !== authoringGeneration) return;
    panel.replaceChildren(el("h2", null, "Global defaults"), buildGlobalDefaults(settings));
  } catch (error) {
    if (generation !== authoringGeneration) return;
    panel.replaceChildren(
      el("h2", null, "Global defaults"),
      el("p", { className: "error-text", role: "alert" }, error instanceof Error ? `Unable to load global defaults: ${error.message}` : "Unable to load global defaults."),
      el("button", { className: "btn btn-sm" }, "Retry"),
    );
    panel.querySelector("button")?.addEventListener("click", () => void loadGlobalDefaults(panel, generation));
  }
}

function buildGlobalDefaults(initial: GlobalSettings): HTMLElement {
  const harness = el("select", { id: "global-harness", "aria-label": "Default harness" }, [
    el("option", { value: "" }, "No default"),
    el("option", { value: "opencode" }, "opencode"),
    el("option", { value: "github" }, "github"),
    el("option", { value: "claude" }, "claude"),
    el("option", { value: "agents" }, "agents"),
  ]) as HTMLSelectElement;
  harness.value = initial.harness ?? "";

  const runner = el("select", { id: "global-runner", "aria-label": "Default authoring runner" }, [
    el("option", { value: "" }, "Inherit harness"),
    el("option", { value: "opencode" }, "OpenCode"),
    el("option", { value: "copilot" }, "Copilot"),
    el("option", { value: "claude" }, "Claude Code"),
  ]) as HTMLSelectElement;
  runner.value = initial.authoring?.runner ?? "";

  const concurrency = el("input", {
    id: "global-concurrency",
    type: "number",
    min: "0",
    placeholder: "engine default",
    className: "timeout-input",
    "aria-label": "Default concurrency",
    value: initial.execution?.concurrency && initial.execution.concurrency > 0 ? String(initial.execution.concurrency) : "",
  }) as HTMLInputElement;

  const autoCommit = el("select", { id: "global-autocommit", "aria-label": "Default auto-commit" }, [
    el("option", { value: "" }, "Engine default (on)"),
    el("option", { value: "true" }, "On"),
    el("option", { value: "false" }, "Off"),
  ]) as HTMLSelectElement;
  autoCommit.value = initial.execution?.autoCommit === undefined ? "" : String(initial.execution.autoCommit);

  const logActivity = el("select", { id: "global-logactivity", "aria-label": "Default harness-activity logging" }, [
    el("option", { value: "" }, "Engine default (off)"),
    el("option", { value: "true" }, "On"),
    el("option", { value: "false" }, "Off"),
  ]) as HTMLSelectElement;
  logActivity.value = initial.execution?.logHarnessActivity === undefined ? "" : String(initial.execution.logHarnessActivity);

  const status = el("div", { className: "dim small", role: "status", "aria-live": "polite" });
  const save = el("button", { className: "btn btn-primary", type: "button" }, "Save global defaults") as HTMLButtonElement;
  save.addEventListener("click", () => {
    const next: GlobalSettings = { version: 1 };
    if (harness.value) next.harness = harness.value as NonNullable<GlobalSettings["harness"]>;
    if (runner.value) next.authoring = { runner: runner.value as GlobalRunner };
    const execution: NonNullable<GlobalSettings["execution"]> = {};
    const c = Number(concurrency.value);
    if (concurrency.value && Number.isInteger(c) && c > 0) execution.concurrency = c;
    if (autoCommit.value) execution.autoCommit = autoCommit.value === "true";
    if (logActivity.value) execution.logHarnessActivity = logActivity.value === "true";
    if (Object.keys(execution).length > 0) next.execution = execution;
    save.disabled = true;
    status.textContent = "Saving global defaults…";
    void api.saveSettings(next)
      .then((result) => {
        status.textContent = result.message || "Global defaults saved.";
        toast(status.textContent);
      })
      .catch((error) => {
        status.textContent = error instanceof Error ? error.message : "Unable to save global defaults.";
        toast(status.textContent);
      })
      .finally(() => { save.disabled = false; });
  });

  return el("div", null, [
    el("div", { className: "form-row" }, [
      el("div", { className: "field" }, [el("label", { for: "global-harness" }, "Default harness (new projects)"), harness]),
      el("div", { className: "field" }, [el("label", { for: "global-runner" }, "Default authoring runner"), runner]),
    ]),
    el("div", { className: "form-row" }, [
      el("div", { className: "field" }, [el("label", { for: "global-concurrency" }, "Default concurrency"), concurrency]),
      el("div", { className: "field" }, [el("label", { for: "global-autocommit" }, "Default auto-commit"), autoCommit]),
      el("div", { className: "field" }, [el("label", { for: "global-logactivity" }, "Default harness-activity logging"), logActivity]),
    ]),
    el("div", { className: "row gap wrap" }, [save, status]),
  ]);
}

/** Reflects the latest execution prefs from the snapshot without rebuilding. */
export function refreshSettings(): void {
  refreshExecution();
}

function refreshExecution(): void {
  const summary = store.summary;
  if (autoCommitCb) autoCommitCb.checked = summary?.autoCommit ?? true;
  if (logActivityCb) logActivityCb.checked = summary?.logHarnessActivity ?? false;
  if (concurrencyInput && document.activeElement !== concurrencyInput) {
    const concurrency = summary?.concurrency ?? 0;
    concurrencyInput.value = concurrency > 0 ? String(concurrency) : "";
  }
}

// ─── Authoring ────────────────────────────────────────────────────────────────

function authoringSection(): HTMLElement {
  const panel = el("div", { className: "panel" }, [
    el("h2", null, "Authoring"),
    el("p", { className: "dim small" }, "Configure independent PRD, team, and project-skill authoring models. Empty selections inherit the runner default; per-agent execution model overrides are set below under Models."),
    el("div", { className: "spinner-row", role: "status" }, [el("span", { className: "spinner", "aria-hidden": "true" }), "Loading authoring settings…"]),
  ]);
  const generation = ++authoringGeneration;
  void loadAuthoringSettings(panel, generation);
  return panel;
}

async function loadAuthoringSettings(panel: HTMLElement, generation: number): Promise<void> {
  try {
    const [config, inventory] = await Promise.all([api.authoringConfig(), api.authoringInventory()]);
    if (generation !== authoringGeneration) return;
    panel.replaceChildren(buildAuthoringSettings(panel, config, inventory));
  } catch (error) {
    if (generation !== authoringGeneration) return;
    panel.replaceChildren(
      el("h2", null, "Authoring"),
      el("p", { className: "error-text", role: "alert" }, error instanceof Error ? `Unable to load authoring settings: ${error.message}` : "Unable to load authoring settings."),
      el("button", { className: "btn btn-sm" }, "Retry"),
    );
    panel.querySelector("button")?.addEventListener("click", () => void loadAuthoringSettings(panel, generation));
  }
}

function buildAuthoringSettings(panel: HTMLElement, initial: AuthoringConfig, inventory: AuthoringInventory, initialDirty = false): HTMLElement {
  let config: AuthoringConfig = { version: 1, models: { ...initial.models }, ...(initial.runner ? { runner: initial.runner } : {}) };
  let dirty = initialDirty;
  let saveInFlight = false;
  // Refresh and the runner select both reload the inventory and rebuild this
  // panel, so a slow response must not land after a newer one. Every reload
  // takes a ticket from this counter and drops itself if the counter has moved
  // on, the same guard the wizard's load() uses.
  let inventoryRequestId = 0;
  const stages: Array<[AuthoringStage, string]> = [
    ["prd", "PRD authoring model"],
    ["team", "Team authoring model"],
    ["skills", "Project skills authoring model"],
  ];
  const selects = new Map<AuthoringStage, HTMLSelectElement>();
  const status = el("div", { className: "dim small", role: "status", "aria-live": "polite" }, inventory.models.length > 0 ? `${inventory.models.length} models available.` : (inventory.diagnostics?.join(" ") || "No models reported; empty selections inherit."));
  const save = el("button", { className: "btn btn-primary", type: "button" }, "Save authoring settings") as HTMLButtonElement;
  const refresh = el("button", { className: "btn btn-sm", type: "button" }, "Refresh inventory") as HTMLButtonElement;
  const runnerSelect = el("select", { id: "authoring-runner", "aria-label": "Authoring runner" }, AUTHORING_RUNNER_OPTIONS.map(([value, label]) => el("option", { value }, label))) as HTMLSelectElement;
  runnerSelect.value = config.runner ?? "inherit";
  const selectedRunner = (): string => runnerSelect.value || "inherit";
  /** Copies the live select values back into `config` before a rebuild. */
  const captureSelections = (): void => {
    for (const [stage, select] of selects) {
      if (select.value) config.models[stage] = select.value;
      else delete config.models[stage];
    }
    if (selectedRunner() === "inherit") delete config.runner;
    else config.runner = selectedRunner() as NonNullable<AuthoringConfig["runner"]>;
  };
  runnerSelect.addEventListener("change", () => {
    dirty = true;
    status.textContent = "Loading authoring models for the selected runner…";
    captureSelections();
    const id = ++inventoryRequestId;
    void api.authoringInventory(effectiveRunner(selectedRunner(), store.summary?.harness ?? ""))
      .then((next) => {
        if (id !== inventoryRequestId) return;
        panel.replaceChildren(buildAuthoringSettings(panel, config, next, dirty));
      })
      .catch((error) => {
        if (id !== inventoryRequestId) return;
        status.textContent = error instanceof Error ? error.message : "Unable to load authoring models for the selected runner.";
      });
  });

  for (const [stage, label] of stages) {
    const select = el("select", { id: `authoring-model-${stage}`, "aria-label": label }) as HTMLSelectElement;
    select.appendChild(el("option", { value: "" }, "Inherit runner default"));
    const selected = config.models[stage];
    if (selected && !inventory.models.some((model) => model.id === selected)) {
      select.appendChild(el("option", { value: selected }, `Unavailable: ${selected}`));
    }
    for (const model of inventory.models) {
      select.appendChild(el("option", { value: model.id }, model.provider ? `${model.id} (${model.provider})` : model.id));
    }
    select.value = selected ?? "";
    select.addEventListener("change", () => {
      dirty = true;
      status.textContent = "Unsaved authoring model changes.";
    });
    selects.set(stage, select);
  }

  save.addEventListener("click", () => {
    const next: AuthoringConfig = { version: 1, models: {} };
    for (const [stage, select] of selects) {
      if (select.value) next.models[stage] = select.value;
    }
    if (selectedRunner() !== "inherit") next.runner = selectedRunner() as NonNullable<AuthoringConfig["runner"]>;
    save.disabled = true;
    saveInFlight = true;
    status.textContent = "Saving authoring settings…";
    void api.saveAuthoringConfig(next)
      .then((result) => {
        if (!result.ok) throw new Error(result.message || "save failed");
        config = { version: 1, models: { ...result.config.models }, ...(result.config.runner ? { runner: result.config.runner } : {}) };
        runnerSelect.value = result.config.runner ?? "inherit";
        dirty = false;
        status.textContent = result.message || "Authoring settings saved.";
        toast(status.textContent);
      })
      .catch((error) => {
        status.textContent = error instanceof Error ? error.message : "Unable to save authoring settings.";
        toast(status.textContent);
      })
      .finally(() => {
        saveInFlight = false;
        save.disabled = false;
      });
  });

  refresh.addEventListener("click", () => {
    refresh.disabled = true;
    const runner = effectiveRunner(selectedRunner(), store.summary?.harness ?? "");
    captureSelections();
    const id = ++inventoryRequestId;
    void api.refreshAuthoringInventory(runner)
      .then((next) => {
        if (id !== inventoryRequestId) return;
        panel.replaceChildren(buildAuthoringSettings(panel, config, next, dirty));
      })
      .catch((error) => {
        if (id !== inventoryRequestId) return;
        status.textContent = error instanceof Error ? error.message : "Unable to refresh inventory.";
      })
      .finally(() => { refresh.disabled = false; });
  });

  return el("div", null, [
    el("div", { className: "field" }, [el("label", { for: "authoring-runner" }, "Authoring runner"), runnerSelect]),
    el("div", { className: "form-row" }, stages.map(([stage, label]) => el("div", { className: "field" }, [el("label", { for: `authoring-model-${stage}` }, label), selects.get(stage)!]))),
    el("div", { className: "row gap wrap" }, [save, refresh, status]),
  ]);
}

// ─── Execution ────────────────────────────────────────────────────────────────

function executionSection(): HTMLElement {
  const summary = store.summary;
  return el("div", { className: "panel" }, [
    el("h2", null, "Execution"),
    el("p", { className: "dim small" }, "These preferences are stored in the project's docs/engine-config.json and apply to subsequently started runs."),
    renderBuildModeSetting(summary?.executionMode ?? "auto"),
    renderConcurrencyControl(summary?.concurrency ?? 0),
    renderAutoCommitToggle(summary?.autoCommit ?? true),
    renderLogHarnessActivityToggle(summary?.logHarnessActivity ?? false),
    renderTimeoutControls(),
  ]);
}

function renderBuildModeSetting(mode: ExecutionMode): HTMLElement {
  const select = el("select", { "aria-label": "Build mode" }, [
    el("option", { value: "auto", selected: mode === "auto" }, "auto (full workflow)"),
    el("option", { value: "manual", selected: mode === "manual" }, "manual (selected tasks)"),
  ]) as HTMLSelectElement;
  select.addEventListener("change", () => {
    const value = (select as HTMLSelectElement).value as ExecutionMode;
    void (async () => {
      try {
        const res = await api.setExecutionMode(value);
        toast(res.message || (res.ok ? "updated" : "update failed"));
      } catch (err) {
        toast(err instanceof Error ? err.message : "update failed");
      }
    })();
  });
  return el("div", { style: "margin-top:10px" }, [
    el("div", { className: "row gap" }, [
      el("span", { className: "dim small" }, "Build mode"),
      select,
      el("a", { href: "#/tasks", className: "btn btn-sm" }, "Choose tasks"),
    ]),
  ]);
}

function renderAutoCommitToggle(enabled: boolean): HTMLElement {
  const cb = el("input", { type: "checkbox", checked: enabled ? true : null }) as HTMLInputElement;
  autoCommitCb = cb;
  const label = el("label", { className: "checkbox-row" }, [
    cb,
    el("span", null, "Auto-commit after each task (one commit per completed task)"),
  ]);
  cb.addEventListener("change", () => {
    const value = cb.checked;
    void (async () => {
      try {
        const res = await api.setAutoCommit(value);
        toast(res.message || (res.ok ? "updated" : "update failed"));
      } catch (err) {
        toast(err instanceof Error ? err.message : "update failed");
      }
    })();
  });
  return el("div", { style: "margin-top:10px" }, [label]);
}

function renderLogHarnessActivityToggle(enabled: boolean): HTMLElement {
  const cb = el("input", { type: "checkbox", checked: enabled ? true : null }) as HTMLInputElement;
  logActivityCb = cb;
  const label = el("label", { className: "checkbox-row" }, [
    cb,
    el("span", null, "Log harness activity (stream harness CLI output into the engine log)"),
  ]);
  cb.addEventListener("change", () => {
    const value = cb.checked;
    void (async () => {
      try {
        const res = await api.setLogHarnessActivity(value);
        toast(res.message || (res.ok ? "updated" : "update failed"));
      } catch (err) {
        toast(err instanceof Error ? err.message : "update failed");
      }
    })();
  });
  return el("div", { style: "margin-top:10px" }, [
    label,
    el("p", { className: "dim small", role: "note" }, "Off by default. Applies to subsequently started runs; the current run is unchanged. Activity logs can contain sensitive repository content and increase log volume. Command logging is always on."),
  ]);
}

function renderConcurrencyControl(current: number): HTMLElement {
  const input = el("input", {
    type: "number",
    placeholder: "1",
    min: "0",
    className: "timeout-input",
    value: current > 0 ? String(current) : "",
  }) as HTMLInputElement;
  concurrencyInput = input;
  const btn = el("button", { className: "btn btn-sm" }, "Set");
  btn.addEventListener("click", () => {
    const raw = Number(input.value);
    if (!Number.isInteger(raw) || raw < 0) {
      toast("Enter a positive integer (or 0 for engine default).");
      return;
    }
    void (async () => {
      try {
        const res = await api.setConcurrency(raw);
        toast(res.message || (res.ok ? "updated" : "update failed"));
      } catch (err) {
        toast(err instanceof Error ? err.message : "update failed");
      }
    })();
  });
  const hint = el("span", { className: "dim small" }, current > 0 ? `current: ${current}` : "current: engine default");
  return el("div", { style: "margin-top:10px" }, [
    el("div", { className: "row gap" }, [
      el("span", { className: "dim small" }, "Concurrency (parallel tasks)"),
      input,
      btn,
      hint,
    ]),
  ]);
}

function renderTimeoutControls(): HTMLElement {
  const host = el("div", { className: "timeout-controls" });

  const render = (tasks: TaskRow[]): void => {
    const sorted = [...tasks].sort((a, b) => {
      const af = a.status === "failed" ? 0 : 1;
      const bf = b.status === "failed" ? 0 : 1;
      return af - bf || a.id.localeCompare(b.id);
    });

    const taskSelect = el("select", { className: "replay-select", "aria-label": "Task" });
    for (const t of sorted) {
      taskSelect.appendChild(el("option", { value: t.id }, `${t.id} — ${t.title}`));
    }

    const taskInput = el("input", { type: "number", placeholder: "min", className: "timeout-input", "aria-label": "Task timeout in minutes" }) as HTMLInputElement;
    const setTask = el("button", { className: "btn btn-sm" }, "Set");
    setTask.addEventListener("click", () => {
      const minutes = Number(taskInput.value);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        toast("Enter a positive timeout in minutes.");
        return;
      }
      const id = (taskSelect as HTMLSelectElement).value;
      if (!id) {
        toast("Select a task.");
        return;
      }
      void api.setTaskTimeout(id, minutesToTimeoutMs(minutes))
        .then((res) => { toast(res.message || (res.ok ? "ok" : "failed")); reload(); })
        .catch((err) => toast(err instanceof Error ? err.message : "update failed"));
    });

    const allInput = el("input", { type: "number", placeholder: "min", className: "timeout-input", "aria-label": "All-tasks timeout in minutes" }) as HTMLInputElement;
    const setAll = el("button", { className: "btn btn-sm" }, "Set all");
    setAll.addEventListener("click", () => {
      const minutes = Number(allInput.value);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        toast("Enter a positive timeout in minutes.");
        return;
      }
      void api.setAllTaskTimeouts(minutesToTimeoutMs(minutes))
        .then((res) => { toast(res.message || (res.ok ? "ok" : "failed")); reload(); })
        .catch((err) => toast(err instanceof Error ? err.message : "update failed"));
    });

    host.replaceChildren(
      el("h3", null, "Timeouts"),
      el("div", { className: "row gap", style: "margin:6px 0" }, [
        el("span", { className: "dim small" }, "Task"),
        taskSelect,
        taskInput,
        setTask,
      ]),
      el("div", { className: "row gap" }, [
        el("span", { className: "dim small" }, "All tasks"),
        allInput,
        setAll,
      ]),
    );
  };

  const reload = (): void => {
    void api.tasks()
      .then(render)
      .catch(() => host.replaceChildren(el("h3", null, "Timeouts"), el("div", { className: "error-text" }, "Failed to load tasks.")));
  };

  host.replaceChildren(el("h3", null, "Timeouts"), el("div", { className: "dim small" }, "Loading tasks…"));
  reload();
  return host;
}

// ─── Models ───────────────────────────────────────────────────────────────────

function modelsSection(): HTMLElement {
  const panel = el("div", { className: "panel" });
  const generation = ++authoringGeneration;

  const render = (): void => {
    panel.replaceChildren(el("h2", null, "Models"), el("div", { className: "spinner-row", role: "status" }, [el("span", { className: "spinner", "aria-hidden": "true" }), "Loading agents…"]));
    void api.team()
      .then((team) => {
        if (generation !== authoringGeneration) return;
        if (team.agents.length === 0) {
          panel.replaceChildren(el("h2", null, "Models"), el("p", { className: "dim" }, "No agent team generated yet. Generate the team first, then return to assign model overrides."));
          return;
        }
        void api.modelInventory()
          .then((inventory) => {
            if (generation !== authoringGeneration) return;
            panel.replaceChildren(el("h2", null, "Models"), modelTerminalPanel(), modelOverrides(team.agents, inventory.models, render));
          })
          .catch(() => {
            if (generation !== authoringGeneration) return;
            panel.replaceChildren(el("h2", null, "Models"), modelTerminalPanel(), modelOverrides(team.agents, [], render));
          });
      })
      .catch(() => {
        if (generation !== authoringGeneration) return;
        panel.replaceChildren(el("h2", null, "Models"), el("p", { className: "error-text", role: "alert" }, "Failed to load team."));
      });
  };

  render();
  return panel;
}

function modelOverrides(agents: AgentInfo[], models: Array<{ id: string; provider?: string }>, reload: () => void): HTMLElement {
  const header = el("div", { className: "row between wrap", style: "margin-top:12px" }, [
    el("h3", { className: "no-margin" }, "Per-agent model overrides"),
    el("button", { className: "btn btn-sm", type: "button" }, "Refresh inventory"),
  ]);
  header.querySelector("button")?.addEventListener("click", reload);
  const grid = el("div", { className: "cards" });
  for (const agent of agents) grid.appendChild(agentOverrideCard(agent, models));
  return el("div", null, [header, grid]);
}

function agentOverrideCard(agent: AgentInfo, models: Array<{ id: string; provider?: string }>): HTMLElement {
  const primary = el("select", { className: "model-select", "aria-label": `${agent.name} primary model` }, [el("option", { value: "" }, "Use recommendation"), ...models.map((model) => el("option", { value: model.id }, model.id))]);
  const fallback = el("select", { className: "model-select", "aria-label": `${agent.name} fallback model` }, [el("option", { value: "" }, "Use recommendation"), ...models.map((model) => el("option", { value: model.id }, model.id))]);
  if (agent.modelOverride) (primary as HTMLSelectElement).value = agent.modelOverride;
  if (agent.modelFallbackOverride) (fallback as HTMLSelectElement).value = agent.modelFallbackOverride;
  const save = el("button", { className: "btn btn-sm" }, "Save model override");
  save.addEventListener("click", () => void api.setModelOverride(agent.name, (primary as HTMLSelectElement).value || undefined, (fallback as HTMLSelectElement).value || undefined).then((result) => toast(result.message)).catch((err) => toast(err instanceof Error ? err.message : "override failed")));
  return el("div", { className: "card" }, [
    el("div", { className: "card-title" }, [
      el("strong", null, agent.name),
      (agent.modelOverride ?? agent.model) ? el("span", { className: "badge badge-running" }, agent.modelOverride ?? agent.model!) : null,
    ]),
    el("p", { className: "dim" }, agent.description),
    el("div", { className: "row gap wrap" }, [el("label", { className: "small" }, ["Primary ", primary]), el("label", { className: "small" }, ["Fallback ", fallback]), save]),
  ]);
}

function modelTerminalPanel(): HTMLElement {
  const provider = el("select", null, [el("option", { value: "opencode" }, "OpenCode"), el("option", { value: "copilot" }, "Copilot"), el("option", { value: "claude" }, "Claude Code")]);
  const message = el("textarea", { rows: "3", placeholder: "Ask the model assistant to review or improve MODEL-PLAN.md" });
  (message as HTMLTextAreaElement).value = "/forge-assign-models Discover the available models from OpenCode, Copilot, Ollama, and BYOK, normalize the model IDs, enrich capabilities with BenchLM, and update the model inventory and plan.";
  const button = el("button", { className: "btn btn-sm btn-primary" }, "Launch model terminal");
  button.addEventListener("click", () => {
    const text = (message as HTMLTextAreaElement).value.trim();
    if (!text) { toast("Enter a message first."); return; }
    button.setAttribute("disabled", "true");
    void api.launchModelTerminal((provider as HTMLSelectElement).value as "opencode" | "copilot" | "claude", text)
      .then((result) => toast(result.message ?? "terminal launch requested"))
      .catch((err) => toast(err instanceof Error ? err.message : "terminal launch failed"))
      .finally(() => button.removeAttribute("disabled"));
  });
  return el("div", { className: "panel" }, [el("h3", null, "Model planning terminal"), el("p", { className: "dim small" }, "Launch an interactive assistant in this repository. Changes are not applied automatically; refresh the inventory above after it writes a new model plan."), el("div", { className: "row gap wrap" }, [provider, message, button])]);
}
