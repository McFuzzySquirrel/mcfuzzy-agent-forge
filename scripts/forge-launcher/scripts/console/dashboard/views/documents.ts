// ─── Plan & Team: authoring docs + agent team (collapsible sections) ─────────

import { api } from "../api.js";
import { store } from "../state.js";
import { el, toast } from "../render/dom.js";
import { renderMarkdown } from "../render/md.js";
import type { AgentInfo, AuthoringConfig, AuthoringInventory, AuthoringStage, AuthoringStageState, DocEntry, DocsIndex, SkillInfo, TeamIndex } from "../types.js";

let unsub: Array<() => void> = [];
let detailHost: HTMLElement | null = null;
let generation = 0;
let authoringStagesHost: HTMLElement | null = null;
let agentsHost: HTMLElement | null = null;
let skillsHost: HTMLElement | null = null;

export function unmountDocuments(): void {
  for (const u of unsub) u();
  unsub = [];
  detailHost = null;
  authoringStagesHost = null;
  agentsHost = null;
  skillsHost = null;
  generation += 1;
  authoringGeneration += 1;
}

interface Section {
  root: HTMLElement;
  body: HTMLElement;
}

/** A collapsible top-level section (native <details>, open by default). */
function section(title: string): Section {
  const root = el("details", { className: "section" });
  const summary = el("summary", null, title);
  const body = el("div", { className: "section-body" });
  root.appendChild(summary);
  root.appendChild(body);
  return { root, body };
}

export function renderDocuments(container: HTMLElement): void {
  unmountDocuments();
  container.textContent = "";

  container.appendChild(renderAuthoringSettings());

  // ── Documents ─────────────────────────────────────────────────────────────
  const docsSection = section("Documents");
  const grid = el("div", { className: "grid-2" });
  const list = el("div", { className: "panel list-pane" });
  detailHost = el("div", { className: "panel detail-pane" });
  grid.appendChild(list);
  grid.appendChild(detailHost);
  docsSection.body.appendChild(grid);
  container.appendChild(docsSection.root);

  const myGeneration = generation;
  void api.docs()
    .then((docs) => {
      if (myGeneration !== generation) return;
      renderDocList(list, docs);
    })
    .catch(() => list.appendChild(el("div", { className: "dim" }, "Failed to load documents.")));

  // ── Agents ────────────────────────────────────────────────────────────────
  const agentsSection = section("Agents");
  agentsHost = agentsSection.body;
  container.appendChild(agentsSection.root);
  void api.team()
    .then((team) => {
      if (myGeneration !== generation) return;
      renderAgents(agentsSection.body, team);
    })
    .catch(() => agentsSection.body.appendChild(el("div", { className: "dim" }, "Failed to load team.")));

  // ── Skills ────────────────────────────────────────────────────────────────
  const skillsSection = section("Skills");
  skillsHost = skillsSection.body;
  container.appendChild(skillsSection.root);
  void api.team()
    .then((team) => {
      if (myGeneration !== generation) return;
      renderSkills(skillsSection.body, team);
    })
    .catch(() => skillsSection.body.appendChild(el("div", { className: "dim" }, "Failed to load skills.")));
  unsub.push(store.subscribe(() => {
    void refreshGeneratedListings();
    refreshDocuments();
  }));
}

export function refreshDocuments(): void {
  if (!authoringStagesHost) return;
  for (const [stage] of [["prd"], ["team"], ["skills"]] as const) {
    const state = store.summary?.authoring?.stages[stage];
    const card = authoringStagesHost.querySelector<HTMLElement>(`[data-authoring-stage="${stage}"]`);
    if (!card) continue;
    const badge = card.querySelector<HTMLElement>("[data-authoring-stage-status]");
    const model = card.querySelector<HTMLElement>("[data-authoring-stage-model]");
    const error = card.querySelector<HTMLElement>("[data-authoring-stage-error]");
    const action = card.querySelector<HTMLButtonElement>("[data-authoring-stage-action]");
    const presentation = stagePresentation(stage, state);
    if (badge) {
      badge.className = `badge badge-${presentation.className}`;
      badge.textContent = presentation.label;
    }
    if (model) model.textContent = `${state?.invocation?.effectiveModel ?? "runner default"}${state?.outputs.length ? ` · ${state.outputs.length} output${state.outputs.length === 1 ? "" : "s"}` : ""}`;
    if (error) {
      error.textContent = state?.error ?? "";
      error.hidden = !state?.error;
    }
    if (action) {
      const stale = state?.status === "complete" && store.summary?.authoringNextStage === stage;
      const available = (state?.status === "failed" || stale) && !state.noSkillsRequired;
      action.hidden = !available;
      action.textContent = stale ? `Regenerate ${stage.toUpperCase()}` : `Retry ${stage.toUpperCase()}`;
      action.disabled = !available;
    }
  }
}

function renderAuthoringSettings(): HTMLElement {
  const panel = el("div", { className: "panel authoring-settings" }, [
    el("h3", null, "Authoring settings"),
    el("p", { className: "dim small" }, "Configure independent PRD, team, and project-skill authoring models. Empty selections inherit the runner default; execution model overrides below remain separate."),
    el("div", { className: "spinner-row", role: "status" }, [el("span", { className: "spinner", "aria-hidden": "true" }), "Loading authoring settings…"]),
  ]);
  const generation = ++authoringGeneration;
  void loadAuthoringSettings(panel, generation);
  return panel;
}

let authoringGeneration = 0;

function stagePresentation(stage: AuthoringStage, state: AuthoringStageState | undefined): { label: string; className: string } {
  if (state?.noSkillsRequired) return { label: "not required", className: "complete" };
  if (state?.status) return { label: state.status, className: state.status };
  const summary = store.summary;
  const exists = stage === "prd" ? summary?.hasPrd : stage === "team" ? summary?.hasTeam : Boolean(summary?.hasTeam && summary.authoringReady !== false);
  return exists
    ? { label: "Existing / untracked", className: "no-run" }
    : { label: "pending", className: "pending" };
}

async function loadAuthoringSettings(panel: HTMLElement, generation: number): Promise<void> {
  try {
    const [config, inventory] = await Promise.all([api.authoringConfig(), api.authoringInventory()]);
    if (generation !== authoringGeneration) return;
    panel.replaceChildren(buildAuthoringSettings(panel, config, inventory));
  } catch (error) {
    if (generation !== authoringGeneration) return;
    panel.replaceChildren(
      el("h3", null, "Authoring settings"),
      el("p", { className: "error-text", role: "alert" }, error instanceof Error ? `Unable to load authoring settings: ${error.message}` : "Unable to load authoring settings."),
      el("button", { className: "btn btn-sm" }, "Retry"),
    );
    panel.querySelector("button")?.addEventListener("click", () => void loadAuthoringSettings(panel, generation));
  }
}

function buildAuthoringSettings(panel: HTMLElement, initial: AuthoringConfig, inventory: AuthoringInventory, initialDirty = false): HTMLElement {
  let config: AuthoringConfig = { version: 1, models: { ...initial.models } };
  let dirty = initialDirty;
  let saveInFlight = false;
  const stages: Array<[AuthoringStage, string]> = [
    ["prd", "PRD authoring model"],
    ["team", "Team authoring model"],
    ["skills", "Project skills authoring model"],
  ];
  const selects = new Map<AuthoringStage, HTMLSelectElement>();
  const status = el("div", { className: "dim small", role: "status", "aria-live": "polite" }, inventory.models.length > 0 ? `${inventory.models.length} models available.` : (inventory.diagnostics?.join(" ") || "No models reported; empty selections inherit."));
  const save = el("button", { className: "btn btn-primary", type: "button" }, "Save authoring settings") as HTMLButtonElement;
  const refresh = el("button", { className: "btn btn-sm", type: "button" }, "Refresh inventory") as HTMLButtonElement;
  const retryButtons: Array<{ button: HTMLButtonElement; stage: AuthoringStage }> = [];
  const updateRetryState = (): void => {
    for (const { button } of retryButtons) button.disabled = dirty || saveInFlight || button.hidden;
  };

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
      updateRetryState();
      status.textContent = "Unsaved authoring model changes.";
    });
    selects.set(stage, select);
  }

  save.addEventListener("click", () => {
    const next: AuthoringConfig = { version: 1, models: {} };
    for (const [stage, select] of selects) {
      if (select.value) next.models[stage] = select.value;
    }
    save.disabled = true;
    saveInFlight = true;
    updateRetryState();
    status.textContent = "Saving authoring settings…";
    void api.saveAuthoringConfig(next)
      .then((result) => {
        if (!result.ok) throw new Error(result.message || "save failed");
        config = { version: 1, models: { ...result.config.models } };
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
        updateRetryState();
      });
  });

  refresh.addEventListener("click", () => {
    refresh.disabled = true;
    const runner = inventory.runner ?? (store.summary?.harness === "github" ? "copilot" : "opencode");
    for (const [stage, select] of selects) {
      if (select.value) config.models[stage] = select.value;
      else delete config.models[stage];
    }
    void api.refreshAuthoringInventory(runner)
      .then((next) => {
        panel.replaceChildren(buildAuthoringSettings(panel, config, next, dirty));
      })
      .catch((error) => {
        status.textContent = error instanceof Error ? error.message : "Unable to refresh inventory.";
      })
      .finally(() => { refresh.disabled = false; });
  });

  const stageCards = stages.map(([stage, label]) => {
    const state = store.summary?.authoring?.stages[stage];
    const output = state?.outputs.length ? ` · ${state.outputs.length} output${state.outputs.length === 1 ? "" : "s"}` : "";
    const presentation = stagePresentation(stage, state);
    const stale = state?.status === "complete" && store.summary?.authoringNextStage === stage;
    const actionButton = el("button", { className: "btn btn-sm", type: "button", "data-authoring-stage-action": "true" }) as HTMLButtonElement;
    retryButtons.push({ button: actionButton, stage });
    actionButton.hidden = !(state?.status === "failed" || stale) || Boolean(state?.noSkillsRequired);
    actionButton.textContent = stale ? `Regenerate ${label.replace(" authoring model", "")}` : `Retry ${label.replace(" authoring model", "")}`;
    actionButton.addEventListener("click", () => {
      if (dirty || saveInFlight) {
        toast("Save authoring model changes before retrying this stage.");
        return;
      }
      actionButton.disabled = true;
      void api.control(stage === "prd" ? "draft-prd" : stage === "team" ? "draft-team" : "draft-skills")
        .then((result) => toast(result.message))
        .catch((error) => toast(error instanceof Error ? error.message : "retry failed"))
        .finally(() => { actionButton.disabled = false; });
    });
    return el("div", { className: "authoring-stage", "data-authoring-stage": stage }, [
      el("div", { className: "row between wrap" }, [
        el("strong", null, label.replace(" model", "")),
        el("span", { className: `badge badge-${presentation.className}`, "data-authoring-stage-status": "true" }, presentation.label),
      ]),
      el("span", { className: "dim small", "data-authoring-stage-model": "true" }, `${state?.invocation?.effectiveModel ?? (presentation.className === "no-run" ? "existing project artifact" : config.models[stage] ?? "runner default")}${output}`),
      el("span", { className: "error-text small", "data-authoring-stage-error": "true", hidden: state?.error ? null : true }, state?.error ?? ""),
      actionButton,
    ]);
  });
  updateRetryState();
  const stageHost = el("div", { className: "authoring-stages" }, stageCards);
  authoringStagesHost = stageHost;

  return el("div", null, [
    el("div", { className: "form-row" }, stages.map(([stage, label]) => el("div", { className: "field" }, [el("label", { for: `authoring-model-${stage}` }, label), selects.get(stage)!]))),
    el("div", { className: "row gap wrap" }, [save, refresh, status]),
    stageHost,
    store.summary?.authoringReady === false
      ? el("p", { className: "error-text", role: "alert" }, "Authoring is incomplete; build controls remain unavailable until the active stages are ready.")
      : null,
  ]);
}

async function refreshGeneratedListings(): Promise<void> {
  if (!agentsHost && !skillsHost) return;
  const currentGeneration = ++generation;
  try {
    const team = await api.team();
    if (currentGeneration !== generation) return;
    if (agentsHost) renderAgents(agentsHost, team);
    if (skillsHost) renderSkills(skillsHost, team);
  } catch {
    // Keep the last generated listing visible while the snapshot catches up.
  }
}

function renderDocList(list: HTMLElement, docs: DocsIndex): void {
  list.textContent = "";
  if (docs.entries.length === 0) {
    list.appendChild(el("div", { className: "dim" }, "No documents."));
    return;
  }
  const ul = el("ul", { className: "doc-list" });
  for (const entry of docs.entries) {
    const item = el("li", { className: entry.exists ? "doc-item" : "doc-item missing" }, [
      el("span", { className: "kind" }, entry.kind),
      el("span", null, entry.title),
      entry.exists ? null : el("span", { className: "dim" }, "— not created yet"),
    ]);
    if (entry.exists) item.addEventListener("click", () => void openDoc(entry));
    ul.appendChild(item);
  }
  list.appendChild(ul);
}

async function openDoc(entry: DocEntry): Promise<void> {
  if (!detailHost) return;
  detailHost.textContent = "";
  detailHost.appendChild(el("div", { className: "dim" }, "Loading…"));
  try {
    const file = await api.docContent(entry.relPath);
    detailHost.textContent = "";
    const openBtn = el("button", { className: "btn btn-sm" }, "Open externally");
    openBtn.addEventListener("click", () => void openExternal(entry.relPath));
    detailHost.appendChild(
      el("div", { className: "row between" }, [el("h3", null, entry.title), openBtn]),
    );
    detailHost.appendChild(el("div", { className: "md" }, [el("div", { html: renderMarkdown(file.content) })]));
  } catch {
    detailHost.textContent = "";
    detailHost.appendChild(el("div", { className: "dim" }, "Could not load document."));
  }
}

async function openExternal(relPath: string): Promise<void> {
  try {
    const res = await api.openExternal(relPath);
    if (!res.ok) toast(res.message ?? "open failed");
  } catch (err) {
    toast(err instanceof Error ? err.message : "open failed");
  }
}

function renderAgents(host: HTMLElement, team: TeamIndex): void {
  host.textContent = "";
  if (team.agents.length === 0) {
    host.appendChild(el("div", { className: "dim" }, "No agent team generated yet."));
    return;
  }
  const grid = el("div", { className: "cards" });
  void api.modelInventory().then((inventory) => {
    const terminal = modelTerminalPanel();
    host.appendChild(terminal);
    for (const agent of team.agents) grid.appendChild(agentCard(agent, inventory.models));
    host.appendChild(grid);
  }).catch(() => {
    for (const agent of team.agents) grid.appendChild(agentCard(agent, []));
    host.appendChild(grid);
  });
}

function modelTerminalPanel(): HTMLElement {
  const provider = el("select", null, [el("option", { value: "opencode" }, "OpenCode"), el("option", { value: "copilot" }, "Copilot")]);
  const message = el("textarea", { rows: "3", placeholder: "Ask the model assistant to review or improve MODEL-PLAN.md" });
  (message as HTMLTextAreaElement).value = "/forge-assign-models Discover the available models from OpenCode, Copilot, Ollama, and BYOK, normalize the model IDs, enrich capabilities with BenchLM, and update the model inventory and plan.";
  const button = el("button", { className: "btn btn-sm btn-primary" }, "Launch model terminal");
  button.addEventListener("click", () => {
    const text = (message as HTMLTextAreaElement).value.trim();
    if (!text) { toast("Enter a message first."); return; }
    button.setAttribute("disabled", "true");
    void api.launchModelTerminal((provider as HTMLSelectElement).value as "opencode" | "copilot", text)
      .then((result) => toast(result.message ?? "terminal launch requested"))
      .catch((err) => toast(err instanceof Error ? err.message : "terminal launch failed"))
      .finally(() => button.removeAttribute("disabled"));
  });
  return el("div", { className: "panel" }, [el("h4", null, "Model planning terminal"), el("p", { className: "dim small" }, "Launch an interactive assistant in this repository. Changes are not applied automatically."), el("div", { className: "row gap wrap" }, [provider, message, button])]);
}

function renderSkills(host: HTMLElement, team: TeamIndex): void {
  host.textContent = "";
  if (team.skills.length === 0) {
    host.appendChild(el("div", { className: "dim" }, "No skills generated yet."));
    return;
  }
  const forge = team.skills.filter((s) => s.category === "forge");
  const project = team.skills.filter((s) => s.category !== "forge");
  if (project.length > 0) appendSkillGroup(host, "Project skills", project);
  if (forge.length > 0) appendSkillGroup(host, "Forge skills", forge);
}

function appendSkillGroup(host: HTMLElement, title: string, skills: SkillInfo[]): void {
  host.appendChild(el("h4", { className: "group-title" }, `${title} (${skills.length})`));
  const grid = el("div", { className: "cards" });
  for (const skill of skills) grid.appendChild(skillCard(skill));
  host.appendChild(grid);
}

function skillCard(skill: SkillInfo): HTMLElement {
  const card = el("div", { className: "card" }, [
    el("div", { className: "card-title" }, [
      el("strong", null, skill.name),
      el("span", { className: `badge badge-${skill.category}` }, skill.category),
      el("button", { className: "btn btn-sm" }, "Open"),
    ]),
    el("p", { className: "dim" }, skill.description),
    el("p", { className: "small mono dim" }, skill.relPath),
  ]);
  const openBtn = card.querySelector<HTMLElement>(".card-title .btn");
  if (openBtn) openBtn.addEventListener("click", () => void openExternal(skill.relPath));
  return card;
}

function agentCard(agent: AgentInfo, models: Array<{ id: string; provider?: string }>): HTMLElement {
  const collapse = (title: string, items: string[]): HTMLElement | null => {
    if (items.length === 0) return null;
    return el("details", { className: "collapsible" }, [
      el("summary", null, title),
      el("ul", null, items.map((x) => el("li", null, x))),
    ]);
  };

  const primary = el("select", { className: "model-select" }, [el("option", { value: "" }, "Use recommendation"), ...models.map((model) => el("option", { value: model.id }, model.id))]);
  const fallback = el("select", { className: "model-select" }, [el("option", { value: "" }, "Use recommendation"), ...models.map((model) => el("option", { value: model.id }, model.id))]);
  if (agent.modelOverride) (primary as HTMLSelectElement).value = agent.modelOverride;
  if (agent.modelFallbackOverride) (fallback as HTMLSelectElement).value = agent.modelFallbackOverride;
  const save = el("button", { className: "btn btn-sm" }, "Save model override");
  save.addEventListener("click", () => void api.setModelOverride(agent.name, (primary as HTMLSelectElement).value || undefined, (fallback as HTMLSelectElement).value || undefined).then((result) => toast(result.message)).catch((err) => toast(err instanceof Error ? err.message : "override failed")));
  const card = el("div", { className: "card" }, [
    el("div", { className: "card-title" }, [
      el("strong", null, agent.name),
      (agent.modelOverride ?? agent.model) ? el("span", { className: "badge badge-running" }, agent.modelOverride ?? agent.model!) : null,
      el("button", { className: "btn btn-sm" }, "Open"),
    ]),
    el("p", { className: "dim" }, agent.description),
    el("div", { className: "row gap wrap" }, [el("label", { className: "small" }, ["Primary ", primary]), el("label", { className: "small" }, ["Fallback ", fallback]), save]),
    collapse("Expertise", agent.expertise),
    collapse("Collaboration", agent.collaboration),
    collapse("Constraints", agent.constraints),
  ]);

  const openBtn = card.querySelector<HTMLElement>(".card-title .btn");
  if (openBtn) openBtn.addEventListener("click", () => void openExternal(agent.relPath));

  return card;
}
