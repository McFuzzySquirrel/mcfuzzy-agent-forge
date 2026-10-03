// ─── Plan & Team: authoring docs + agent team (collapsible sections) ─────────

import { api } from "../api.js";
import { store } from "../state.js";
import { el, fmtAgo, toast } from "../render/dom.js";
import { renderMarkdown } from "../render/md.js";
import { AUTHORING_RUNNER_OPTIONS, effectiveRunner } from "../runners.js";
import { AUTHORING_STAGES } from "../types.js";
import type { AgentInfo, AuthoringConfig, AuthoringInventory, AuthoringStage, AuthoringStageDetail, AuthoringStageState, BackgroundJobType, DocEntry, DocsIndex, SkillInfo, TeamIndex } from "../types.js";

let unsub: Array<() => void> = [];
let docsHost: HTMLElement | null = null;
let docDialog: HTMLDialogElement | null = null;
let generation = 0;
let authoringStagesHost: HTMLElement | null = null;
let agentsHost: HTMLElement | null = null;
let skillsHost: HTMLElement | null = null;
let rederiveHost: HTMLElement | null = null;
/** Stage requested via `#/documents?stage=<id>`; highlighted on mount. */
let focusStage: AuthoringStage | null = null;

export function unmountDocuments(): void {
  for (const u of unsub) u();
  unsub = [];
  docsHost = null;
  docDialog?.close();
  docDialog = null;
  authoringStagesHost = null;
  agentsHost = null;
  skillsHost = null;
  rederiveHost = null;
  focusStage = null;
  generation += 1;
  authoringGeneration += 1;
}

/** Reads `#/documents?stage=team`, so Overview can link straight at a stage. */
function stageFromHash(): AuthoringStage | null {
  const match = /[?&]stage=(prd|team|skills)\b/.exec(location.hash);
  return match ? match[1] as AuthoringStage : null;
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
  focusStage = stageFromHash();

  container.appendChild(renderAuthoringSettings());

  // ── Documents ─────────────────────────────────────────────────────────────
  const docsSection = section("Documents");
  const list = el("div", { className: "docs-host" });
  docsSection.body.appendChild(
    el("p", { className: "dim small" }, "Select a document to read it in a wide popup. Authoring stays on disk and is never edited here."),
  );
  docsSection.body.appendChild(list);
  docsHost = list;
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
    void refreshDocList();
    refreshDocuments();
  }));

  // `#/documents?stage=team` arrives from the Overview's staleness reasons, so
  // bring the card into view once the settings panel has rendered it. Done after
  // the async load above settles, since the panel replaces its own children.
  if (focusStage) {
    void window.setTimeout(() => {
      const card = authoringStagesHost?.querySelector<HTMLElement>(`[data-authoring-stage="${focusStage}"]`);
      card?.scrollIntoView({ block: "center", behavior: "smooth" });
      card?.focus({ preventScroll: true });
    }, 0);
  }
}

let docsGeneration = 0;

/** Re-reads the document index so an externally authored document appears. */
async function refreshDocList(): Promise<void> {
  if (!docsHost) return;
  const current = ++docsGeneration;
  try {
    const docs = await api.docs();
    if (current !== docsGeneration || !docsHost) return;
    renderDocList(docsHost, docs);
  } catch {
    // Keep the last document index visible while the snapshot catches up.
  }
}

/**
 * Whether a stage's action can be taken right now, and — when it cannot — the
 * reason, which is rendered next to the disabled button.
 *
 * The action used to be hidden unless the stage had failed or was the next one
 * the server named, which meant the UI looked inert at exactly the moment the
 * user needed it. A visible, disabled, explained button is strictly more
 * informative than an absent one.
 */
function stageActionState(
  stage: AuthoringStage,
  detail: AuthoringStageDetail | undefined,
  state: AuthoringStageState | undefined,
  ctx: { authoringBusy: boolean; unsavedModels: boolean },
): { label: string; enabled: boolean; reason: string; interactive: boolean } {
  const status = detail?.status ?? "untracked";
  const label = stage === "prd" ? "Author PRD (interactive)" : `${detail?.stale || status === "failed" ? "Regenerate" : "Retry"} ${stage.toUpperCase()}`;
  if (stage === "prd") {
    // ADR-060: requirements are never authored headlessly.
    return {
      label,
      enabled: !ctx.authoringBusy && !ctx.unsavedModels,
      reason: ctx.authoringBusy ? "Another authoring job is running." : ctx.unsavedModels ? "Save authoring model changes first." : "Opens your harness in a terminal.",
      interactive: true,
    };
  }
  if (ctx.authoringBusy) return { label, enabled: false, reason: "Another authoring job is running.", interactive: false };
  if (ctx.unsavedModels) return { label, enabled: false, reason: "Save authoring model changes first.", interactive: false };
  if (state?.noSkillsRequired) return { label, enabled: false, reason: "The skills stage recorded no skills required.", interactive: false };
  if (detail?.stale) return { label, enabled: true, reason: "", interactive: false };
  if (status === "failed") return { label, enabled: true, reason: "", interactive: false };
  if (status === "untracked") return { label, enabled: true, reason: "This Console has not authored this stage.", interactive: false };
  if (status === "complete") return { label, enabled: false, reason: "Already up to date with its inputs.", interactive: false };
  return { label, enabled: true, reason: "", interactive: false };
}

export function refreshDocuments(): void {
  if (!authoringStagesHost) return;
  const summary = store.summary;
  const details = new Map((summary?.authoringStages ?? []).map((entry) => [entry.stage, entry]));
  const authoringBusy = summary?.job?.status === "running"
    && AUTHORING_JOB_TYPES.has(summary.job.type);
  for (const stage of AUTHORING_STAGES) {
    const card = authoringStagesHost.querySelector<HTMLElement>(`[data-authoring-stage="${stage}"]`);
    if (!card) continue;
    const detail = details.get(stage);
    const state = summary?.authoring?.stages[stage];
    const badge = card.querySelector<HTMLElement>("[data-authoring-stage-status]");
    const model = card.querySelector<HTMLElement>("[data-authoring-stage-model]");
    const why = card.querySelector<HTMLElement>("[data-authoring-stage-why]");
    const outputs = card.querySelector<HTMLElement>("[data-authoring-stage-outputs]");
    const action = card.querySelector<HTMLButtonElement>("[data-authoring-stage-action]");
    const actionNote = card.querySelector<HTMLElement>("[data-authoring-stage-action-note]");
    const presentation = stagePresentation(stage, state);

    if (badge) {
      // A stale stage is not "complete" any more, whatever its last run said.
      badge.className = `badge badge-${detail?.stale ? "stale" : presentation.className}`;
      badge.textContent = detail?.stale ? "stale" : presentation.label;
    }
    if (model) model.textContent = `${state?.invocation?.effectiveModel ?? "runner default"}${state?.outputs.length ? ` · ${state.outputs.length} output${state.outputs.length === 1 ? "" : "s"}` : ""}`;
    if (why) {
      const reason = detail?.stale ? detail.reason : state?.error ?? "";
      why.textContent = reason;
      why.hidden = !reason;
    }
    if (outputs) {
      const at = detail?.completedAt;
      outputs.textContent = at ? `last completed ${fmtAgo(at)}` : "";
      outputs.hidden = !at;
    }
    if (action && actionNote) {
      const actionState = stageActionState(stage, detail, state, {
        authoringBusy,
        unsavedModels: card.dataset.dirty === "true",
      });
      action.textContent = actionState.label;
      action.disabled = !actionState.enabled;
      action.classList.toggle("authoring-stage-action-disabled", !actionState.enabled);
      actionNote.textContent = actionState.reason;
      actionNote.hidden = !actionState.reason;
    }
  }
  if (rederiveHost) renderRederiveFooter(rederiveHost);
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

/** Job types that occupy the authoring pipeline, so a stage action must defer. */
const AUTHORING_JOB_TYPES = new Set<BackgroundJobType>([
  "draft-prd", "draft-existing-prd", "draft-team", "draft-skills", "rederive",
  "feature-prd", "feature-increment", "create-project",
]);

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
    // A live snapshot can arrive while the settings panel is still loading, when
    // there are no stage cards to update yet, and nothing else re-runs the
    // refresh — so the fresh cards would keep their placeholder text.
    refreshDocuments();
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
  const retryButtons: Array<{ button: HTMLButtonElement; stage: AuthoringStage }> = [];
  const updateRetryState = (): void => {
    for (const { button } of retryButtons) button.disabled = dirty || saveInFlight || button.hidden;
  };
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
    updateRetryState();
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
    if (selectedRunner() !== "inherit") next.runner = selectedRunner() as NonNullable<AuthoringConfig["runner"]>;
    save.disabled = true;
    saveInFlight = true;
    updateRetryState();
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
        updateRetryState();
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

  const stageCards = stages.map(([stage, label]) => {
    const state = store.summary?.authoring?.stages[stage];
    const detail = store.summary?.authoringStages?.find((entry) => entry.stage === stage);
    const output = state?.outputs.length ? ` · ${state.outputs.length} output${state.outputs.length === 1 ? "" : "s"}` : "";
    const presentation = stagePresentation(stage, state);
    const actionButton = el("button", { className: "btn btn-sm", type: "button", "data-authoring-stage-action": "true" }) as HTMLButtonElement;
    retryButtons.push({ button: actionButton, stage });
    // ADR-060: the PRD stage is a handoff to an interactive session; only the
    // derivation stages retry as headless background jobs.
    const prdStage = stage === "prd";
    actionButton.textContent = prdStage
      ? `Author ${label.replace(" authoring model", "")} in a session (interactive)`
      : stageActionState(stage, detail, state, { authoringBusy: false, unsavedModels: dirty }).label;
    actionButton.addEventListener("click", () => {
      if (dirty || saveInFlight) {
        toast("Save authoring model changes before retrying this stage.");
        return;
      }
      if (prdStage) {
        // Fire-and-forget: the session runs in an external terminal, so the
        // Overview is what observes the committed result.
        void api.startAuthoringSession("prd")
          .then((res) => toast(res.message || "interactive PRD session requested"))
          .catch((error) => toast(error instanceof Error ? error.message : "could not open the PRD session"));
        return;
      }
      actionButton.disabled = true;
      void api.control(stage === "team" ? "draft-team" : "draft-skills")
        .then((result) => toast(result.message))
        .catch((error) => toast(error instanceof Error ? error.message : "retry failed"))
        .finally(() => { actionButton.disabled = false; });
    });
    const card = el("div", { className: "authoring-stage", "data-authoring-stage": stage, tabindex: "-1" }, [
      el("div", { className: "row between wrap" }, [
        el("strong", null, label.replace(" model", "")),
        el("span", { className: `badge badge-${detail?.stale ? "stale" : presentation.className}`, "data-authoring-stage-status": "true" }, detail?.stale ? "stale" : presentation.label),
      ]),
      el("span", { className: "dim small", "data-authoring-stage-model": "true" }, `${state?.invocation?.effectiveModel ?? (presentation.className === "no-run" ? "existing project artifact" : config.models[stage] ?? "runner default")}${output}`),
      el("span", { className: "dim small", "data-authoring-stage-outputs": "true", hidden: true }),
      el("span", { className: "error-text small", "data-authoring-stage-why": "true", hidden: true }),
      actionButton,
      el("span", { className: "dim small", "data-authoring-stage-action-note": "true", hidden: true }),
    ]);
    if (stage === focusStage) card.classList.add("authoring-stage-focus");
    return card;
  });
  updateRetryState();
  const stageHost = el("div", { className: "authoring-stages" }, stageCards);
  authoringStagesHost = stageHost;
  // The footer lives inside the rebuilt panel: `panel.replaceChildren(...)`
  // discards anything appended before the async load finished, so a footer
  // mounted outside it silently disappears on the first refresh.
  rederiveHost = el("div", { className: "rederive-footer" });
  rederiveHost.replaceChildren(renderRederiveFooter(rederiveHost));

  return el("div", null, [
    el("div", { className: "field" }, [el("label", { for: "authoring-runner" }, "Authoring runner"), runnerSelect]),
    el("div", { className: "form-row" }, stages.map(([stage, label]) => el("div", { className: "field" }, [el("label", { for: `authoring-model-${stage}` }, label), selects.get(stage)!]))),
    el("div", { className: "row gap wrap" }, [save, refresh, status]),
    stageHost,
    rederiveHost,
    store.summary?.authoringReady === false
      ? el("p", { className: "error-text", role: "alert" }, "Authoring is incomplete; build controls remain unavailable until the active stages are ready.")
      : null,
  ]);
}

/**
 * "Re-derive all" footer with live chain progress.
 *
 * Regenerating the team and the project skills in the right order is the one
 * action a user almost always wants together, and doing it as two separate
 * clicks in two collapsed sections was the main complaint about this view. The
 * chain never authors requirements and never resets completed tasks.
 */
function renderRederiveFooter(host: HTMLElement): HTMLElement {
  const summary = store.summary;
  const progress = summary?.rederive ?? null;
  const staleStages = (summary?.authoringStages ?? []).filter(
    (entry) => (entry.stage === "team" || entry.stage === "skills") && (entry.stale || entry.status === "failed"),
  );
  const actionable = staleStages.length > 0 || Boolean(progress?.failedStep);
  const children: HTMLElement[] = [];

  const button = el("button", { className: "btn btn-primary btn-sm", type: "button" },
    progress?.failedStep ? `Retry from ${progress.failedStep}` : "Re-derive team & skills") as HTMLButtonElement;
  const busy = summary?.job?.status === "running" && AUTHORING_JOB_TYPES.has(summary.job.type);
  button.disabled = Boolean(busy) || !actionable;
  if (busy) children.push(el("span", { className: "dim small" }, "An authoring job is running."));
  else if (!actionable) children.push(el("span", { className: "dim small" }, "Nothing to re-derive: the team and project skills match their inputs."));
  button.addEventListener("click", () => {
    button.disabled = true;
    void api.rederive(progress?.failedStep ?? undefined)
      .then((result) => toast(result.message))
      .catch((error) => toast(error instanceof Error ? error.message : "re-derivation failed to start"))
      .finally(() => { button.disabled = false; });
  });
  children.push(button);

  if (staleStages.length > 0) {
    children.push(el("ul", { className: "rederive-causes" }, staleStages.map((entry) => el("li", null, [
      el("strong", null, `${entry.stage === "team" ? "Team" : "Skills"}: `),
      entry.reason,
    ]))));
  }
  if (progress && progress.steps.length > 0) {
    children.push(el("ul", { className: "rederive-steps", role: "status", "aria-live": "polite" },
      progress.steps.map((entry) => el("li", { className: `rederive-step rederive-step-${entry.status}` }, [
        el("div", { className: "row gap wrap" }, [
          el("span", { className: `badge badge-${entry.status === "complete" ? "complete" : entry.status}` }, entry.status),
          el("span", null, entry.label),
          entry.status === "running" ? el("span", { className: "spinner", "aria-hidden": "true" }) : null,
        ].filter(Boolean) as HTMLElement[]),
        entry.message ? el("div", { className: "dim small" }, entry.message) : null,
      ]))));
  }
  return el("div", { className: "rederive-footer" }, children);
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
  const tbody = el("tbody", null);
  for (const entry of docs.entries) {
    const read = entry.exists ? el("button", { className: "btn btn-sm", type: "button" }, "Read") : el("span", { className: "dim" }, "—");
    const tr = el("tr", { className: entry.exists ? "clickable" : null }, [
      el("td", null, el("span", { className: "badge badge-doc" }, entry.kind)),
      el("td", null, entry.title),
      el("td", { className: "mono small" }, entry.relPath),
      el("td", null, entry.exists ? "available" : "not created yet"),
      el("td", null, read),
    ]);
    if (entry.exists) {
      tr.addEventListener("click", () => openDocDialog(entry));
      read.addEventListener("click", (event) => {
        event.stopPropagation();
        openDocDialog(entry);
      });
    }
    tbody.appendChild(tr);
  }
  list.appendChild(
    el("div", { className: "table-scroll" }, [
      el("table", null, [
        el("thead", null, [
          el("tr", null, [
            el("th", null, "Kind"),
            el("th", null, "Title"),
            el("th", null, "Path"),
            el("th", null, "Status"),
            el("th", null, ""),
          ]),
        ]),
        tbody,
      ]),
    ]),
  );
}

/** Opens a document in a wide modal, leaving the page width free for the table. */
function openDocDialog(entry: DocEntry): void {
  docDialog?.close();
  const body = el("div", { className: "md doc-dialog-body" }, el("div", { className: "dim" }, "Loading…"));
  const external = el("button", { className: "btn btn-sm", type: "button" }, "Open externally");
  external.addEventListener("click", () => void openExternal(entry.relPath));
  const close = el("button", { className: "btn btn-sm", type: "button" }, "Close");
  const dialog = el("dialog", { className: "doc-dialog" }, [
    el("div", { className: "doc-dialog-header" }, [
      el("div", { className: "doc-dialog-title" }, [
        el("span", { className: "badge badge-doc" }, entry.kind),
        el("h3", { className: "no-margin" }, entry.title),
      ]),
      el("div", { className: "row gap" }, [external, close]),
    ]),
    body,
  ]) as HTMLDialogElement;
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (docDialog === dialog) docDialog = null;
  }, { once: true });
  docDialog = dialog;
  document.body.appendChild(dialog);
  dialog.showModal();
  void api.docContent(entry.relPath)
    .then((file) => {
      body.replaceChildren(el("div", { html: renderMarkdown(file.content) }));
    })
    .catch(() => {
      body.replaceChildren(el("div", { className: "dim" }, "Could not load document."));
    });
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
