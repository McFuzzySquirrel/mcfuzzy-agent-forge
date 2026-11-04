// ─── Tasks: filterable/sortable table with expandable detail ────────────────

import { api } from "../api.js";
import { featureTaskReviewIds, featureTasksReviewed, recordFeatureTaskReview } from "../feature-task-review.js";
import { store } from "../state.js";
import { el, fmtDuration, fmtTime, minutesToTimeoutMs, statusBadge, timeoutToMinutes, toast } from "../render/dom.js";
import { formatUsage, usageCell } from "../render/usage.js";
import type { SelectionScope, TaskRow } from "../types.js";

type SortKey = "status" | "phase" | "owner" | "duration" | "attempt";

const STATUSES = ["pending", "running", "complete", "failed", "skipped"];

let gen = 0;
let unsub: Array<() => void> = [];
let allTasks: TaskRow[] = [];
let taskViewMode: "all" | "review-queue" = "all";
let filterStatus: string | null = null;
let search = "";
let sortKey: SortKey = "status";
let sortDir: 1 | -1 = 1;
let expandedId: string | null = null;
let tableHost: HTMLElement | null = null;
let countLine: HTMLElement | null = null;
let selectedIds = new Set<string>();
let selectionScope: SelectionScope | null = null;
let refreshGeneration = 0;
let rangeStartControl: HTMLSelectElement | null = null;
let rangeEndControl: HTMLSelectElement | null = null;
let taskViewContainer: HTMLElement | null = null;
let featureReviewHost: HTMLElement | null = null;
let runSelectionStatus: HTMLElement | null = null;
let explicitFeatureReview = false;
let runSelectionControl: HTMLButtonElement | null = null;
let resumeSelectionControl: HTMLButtonElement | null = null;

export function unmountTasks(): void {
  for (const u of unsub) u();
  unsub = [];
  allTasks = [];
  taskViewMode = "all";
  filterStatus = null;
  search = "";
  sortKey = "status";
  sortDir = 1;
  expandedId = null;
  tableHost = null;
  countLine = null;
  selectedIds = new Set<string>();
  selectionScope = null;
  rangeStartControl = null;
  rangeEndControl = null;
  taskViewContainer = null;
  featureReviewHost = null;
  runSelectionStatus = null;
  explicitFeatureReview = false;
  runSelectionControl = null;
  resumeSelectionControl = null;
  refreshGeneration += 1;
}

function taskFilterFromHash(): string | null {
  const m = /[?&]task=([^&]+)/.exec(location.hash);
  return m ? decodeURIComponent(m[1]!) : null;
}

export async function renderTasks(container: HTMLElement): Promise<void> {
  await renderTaskView(container, "all");
}

export async function renderHumanReviewQueue(container: HTMLElement): Promise<void> {
  await renderTaskView(container, "review-queue");
}

async function renderTaskView(container: HTMLElement, mode: "all" | "review-queue"): Promise<void> {
  unmountTasks();
  taskViewMode = mode;
  taskViewContainer = container;
  container.textContent = "";
  const myGen = ++gen;
  unsub.push(store.subscribe(() => {
    void refresh();
  }));

  const fromHash = taskFilterFromHash();
  if (fromHash) {
    search = fromHash;
    expandedId = fromHash;
  }

  explicitFeatureReview = mode === "all" && new URLSearchParams(location.hash.split("?")[1] ?? "").get("feature-review") === "1";
  featureReviewHost = null;
  if (explicitFeatureReview || featureTaskReviewRequired()) {
    featureReviewHost = el("div", { className: "feature-task-review-host" });
    container.appendChild(featureReviewHost);
  }

  countLine = el("div", { className: "dim small" });
  tableHost = el("div", null);
  if (mode === "review-queue") {
    const projectName = store.summary?.repoName ?? "selected Project";
    container.appendChild(el("section", { className: "review-queue" }, [
      el("h1", null, "Tasks"),
      el("p", { className: "dim" }, `Human review for ${projectName}. This focused queue is separate from Project brief approval.`),
      el("p", { className: "panel hint" },
        "A Human review requires a person's findings and explicit Task-bound approval. An agent or unattended flag cannot approve it."),
      countLine,
      tableHost,
    ]));
    await loadInitialTasks(myGen);
    return;
  }

  const statusChips = el("div", { className: "chips" }, [
    chip("all", filterStatus === null, () => {
      filterStatus = null;
      renderTable();
    }),
    ...STATUSES.map((s) =>
      chip(s, filterStatus === s, () => {
        filterStatus = filterStatus === s ? null : s;
        renderTable();
      }),
    ),
  ]);

  const searchInput = el("input", {
    type: "text",
    placeholder: "Search title / id / owner…",
    className: "search",
  });
  if (search) searchInput.setAttribute("value", search);
  searchInput.addEventListener("input", () => {
    search = (searchInput as HTMLInputElement).value;
    renderTable();
  });

  const allTimeoutInput = el("input", {
    type: "number",
    placeholder: "Timeout for all tasks (min)",
    className: "search timeout-input",
  });
  const allTimeoutBtn = el("button", { className: "btn btn-sm" }, "Set all");
  allTimeoutBtn.addEventListener("click", () => {
    const minutes = Number((allTimeoutInput as HTMLInputElement).value);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      toast("Enter a positive timeout in minutes.");
      return;
    }
    void (async () => {
      try {
        const res = await api.setAllTaskTimeouts(minutesToTimeoutMs(minutes));
        toast(res.message || (res.ok ? "ok" : "failed"));
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : "update failed");
      }
    })();
  });

  selectedIds = new Set(store.summary?.selectedTaskIds ?? []);
  selectionScope = store.summary?.selectionScope ?? null;

  const rangeStart = el("select", { className: "replay-select" });
  const rangeEnd = el("select", { className: "replay-select" });
  rangeStartControl = rangeStart as HTMLSelectElement;
  rangeEndControl = rangeEnd as HTMLSelectElement;
  const addRange = el("button", { className: "btn btn-sm" }, "Add range");
  const saveSelection = el("button", { className: "btn btn-sm" }, "Save selection");
  const clearSelection = el("button", { className: "btn btn-sm" }, "Clear");
  const runSelection = el("button", { className: "btn btn-sm btn-primary" }, "Run selected");
  const resumeSelection = el("button", { className: "btn btn-sm" }, "Resume selected");
  runSelectionStatus = el("p", { className: "dim small", role: "status", "aria-live": "polite" });
  runSelectionControl = runSelection as HTMLButtonElement;
  resumeSelectionControl = resumeSelection as HTMLButtonElement;
  syncFeatureTaskReviewGate();

  const launch = el("button", { className: "btn btn-sm" }, `Launch ${store.summary?.harness ?? "harness"} CLI`);
  launch.addEventListener("click", () => void launchCli());

  container.appendChild(
    el("div", { className: "panel" }, [
      el("div", { className: "row between wrap" }, [
        el("h3", null, "All tasks"),
        el("div", { className: "row gap" }, [launch, countLine]),
      ]),
      statusChips,
      el("div", { className: "row gap", style: "margin:8px 0" }, [searchInput]),
      el("div", { className: "row gap wrap", style: "margin:0 0 8px" }, [
        el("span", { className: "dim small" }, "Manual selection"),
        rangeStart,
        rangeEnd,
        addRange,
        saveSelection,
        clearSelection,
        runSelection,
        resumeSelection,
      ]),
      runSelectionStatus,
      el("div", { className: "row gap", style: "margin:0 0 8px" }, [
        el("span", { className: "dim small" }, "Set every task's timeout:"),
        allTimeoutInput,
        allTimeoutBtn,
      ]),
      tableHost,
    ]),
  );

  addRange.addEventListener("click", () => {
    const ordered = allTasks.map((task) => task.id);
    const from = ordered.indexOf((rangeStart as HTMLSelectElement).value);
    const to = ordered.indexOf((rangeEnd as HTMLSelectElement).value);
    if (from === -1 || to === -1) return;
    const [start, end] = from <= to ? [from, to] : [to, from];
    for (const id of ordered.slice(start, end + 1)) selectedIds.add(id);
    selectionScope = "range";
    renderTable();
  });
  saveSelection.addEventListener("click", () => {
    void persistSelection();
  });
  clearSelection.addEventListener("click", () => {
    selectedIds.clear();
    selectionScope = null;
    void persistSelection();
  });
  runSelection.addEventListener("click", () => {
    void runSelectionAction("run");
  });
  resumeSelection.addEventListener("click", () => {
    void runSelectionAction("resume");
  });

  await loadInitialTasks(myGen);
}

function renderFeatureTaskReview(): HTMLElement {
  const summary = store.summary;
  if (!summary) {
    return el("section", { className: "panel error-text", role: "alert" }, "Project status is unavailable. Refresh before reviewing generated Tasks.");
  }
  const ids = featureTaskReviewIds(summary);
  if (ids.length === 0) {
    return el("section", { className: "panel hint" }, [
      el("h2", null, "No feature Tasks need review"),
      el("p", { className: "dim small" }, "This Project has no pending feature Task review."),
      el("a", { className: "btn", href: "#/overview" }, "Return to Build status"),
    ]);
  }

  const tasks = ids.map((id) => allTasks.find((task) => task.id === id)).filter((task): task is TaskRow => Boolean(task));
  const missing = ids.filter((id) => !allTasks.some((task) => task.id === id));
  const alreadyReviewed = featureTasksReviewed(summary);
  const status = el("p", { className: "dim small", role: "status", "aria-live": "polite" }, alreadyReviewed
    ? "This generated Task review has been recorded."
    : missing.length > 0
      ? "Some generated Tasks are unavailable. Refresh the Task list before confirming review."
      : "Review the generated Task descriptions and acceptance criteria before confirming.");
  const confirm = el("button", {
    className: "btn btn-primary",
    type: "button",
    disabled: alreadyReviewed || missing.length > 0 ? true : null,
  }, "I reviewed these Tasks") as HTMLButtonElement;
  confirm.addEventListener("click", () => {
    if (missing.length > 0 || featureTasksReviewed(summary)) return;
    recordFeatureTaskReview(summary);
    if (featureTasksReviewed(summary)) {
      status.textContent = "Task review recorded. Build execution is now available.";
      location.hash = "#/overview";
    } else {
      status.className = "error-text small";
      status.textContent = "The review could not be saved in this browser. Execution remains gated.";
    }
  });

  return el("section", { className: "panel feature-task-review", "aria-labelledby": "feature-task-review-heading" }, [
    el("h2", { id: "feature-task-review-heading" }, "Review generated Tasks"),
    el("p", { className: "dim" }, "Check that the additive feature work matches what you authored. These Tasks cannot run until you confirm this review."),
    missing.length > 0
      ? el("p", { className: "error-text", role: "alert" }, `Unavailable Tasks: ${missing.join(", ")}.`)
      : null,
    el("div", { className: "feature-task-review-list" }, tasks.map((task) => el("article", { className: "feature-task-review-item" }, [
      el("h3", null, `${task.id} · ${task.title}`),
      task.phaseTitle ? el("p", { className: "dim small" }, task.phaseTitle) : null,
      task.description ? el("p", null, task.description) : null,
      task.acceptanceCriteria.length > 0
        ? el("div", null, [
            el("strong", null, "Acceptance criteria"),
            el("ul", null, task.acceptanceCriteria.map((criterion) => el("li", null, criterion))),
          ])
        : el("p", { className: "dim small" }, "No acceptance criteria are recorded for this Task."),
    ]))),
    status,
    el("div", { className: "actions" }, [
      confirm,
      el("a", { className: "btn", href: "#/overview" }, "Return to Build status"),
    ]),
  ]);
}

function featureTaskReviewRequired(): boolean {
  const summary = store.summary;
  return Boolean(summary && featureTaskReviewIds(summary).length > 0 && !featureTasksReviewed(summary));
}

function syncFeatureTaskReviewGate(): void {
  const required = featureTaskReviewRequired();
  if (runSelectionControl) runSelectionControl.disabled = required;
  if (resumeSelectionControl) resumeSelectionControl.disabled = required;
}

function syncFeatureTaskReviewPanel(): void {
  syncFeatureTaskReviewGate();
  if (taskViewMode !== "all" || !taskViewContainer) return;

  if (!explicitFeatureReview && !featureTaskReviewRequired()) {
    featureReviewHost?.remove();
    featureReviewHost = null;
    return;
  }
  if (!featureReviewHost) {
    featureReviewHost = el("div", { className: "feature-task-review-host" });
    taskViewContainer.prepend(featureReviewHost);
  }
  featureReviewHost.replaceChildren(renderFeatureTaskReview());
}

async function loadInitialTasks(myGen: number): Promise<void> {
  const request = ++refreshGeneration;
  try {
    allTasks = await api.tasks();
  } catch {
    allTasks = [];
  }
  if (request !== refreshGeneration || myGen !== gen) return;
  syncRangeOptions();
  if (myGen !== gen) return;
  renderCurrentTasks();
  syncFeatureTaskReviewPanel();
}

function chip(label: string, active: boolean, onClick: () => void): HTMLElement {
  const node = el("button", { className: active ? "chip active" : "chip", type: "button", "aria-pressed": String(active) }, label);
  node.addEventListener("click", onClick);
  return node;
}

/** Opens the project's harness CLI (opencode/copilot/claude) in a new terminal. */
async function launchCli(): Promise<void> {
  try {
    const res = await api.launchCli();
    toast(res.message ?? (res.ok ? "harness CLI launched." : "launch failed"));
  } catch (err) {
    toast(err instanceof Error ? err.message : "launch failed");
  }
}

async function refresh(): Promise<void> {
  const request = ++refreshGeneration;
  try {
    const tasks = await api.tasks();
    if (request !== refreshGeneration) return;
    allTasks = tasks;
  } catch {
    // keep the existing rows on failure
  }
  syncRangeOptions();
  renderCurrentTasks();
  syncFeatureTaskReviewPanel();
}

function renderCurrentTasks(): void {
  if (taskViewMode === "review-queue") renderReviewQueue();
  else renderTable();
}

function syncRangeOptions(): void {
  if (!rangeStartControl || !rangeEndControl) return;
  const previousStart = rangeStartControl.value;
  const previousEnd = rangeEndControl.value;
  const options = allTasks.map((task) => el("option", { value: task.id }, `${task.id} — ${task.title}`));
  rangeStartControl.replaceChildren(...options.map((option) => option.cloneNode(true)));
  rangeEndControl.replaceChildren(...options);
  if (allTasks.some((task) => task.id === previousStart)) rangeStartControl.value = previousStart;
  if (allTasks.some((task) => task.id === previousEnd)) rangeEndControl.value = previousEnd;
}

function visibleTasks(): TaskRow[] {
  const q = search.trim().toLowerCase();
  const filtered = allTasks.filter((t) => {
    if (filterStatus && t.status !== filterStatus) return false;
    if (q) {
      const hay = `${t.id} ${t.title} ${t.ownerAgent ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  filtered.sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case "status":
        cmp = a.status.localeCompare(b.status);
        break;
      case "phase":
        cmp = a.phaseTitle.localeCompare(b.phaseTitle);
        break;
      case "owner":
        cmp = (a.ownerAgent ?? "").localeCompare(b.ownerAgent ?? "");
        break;
      case "attempt":
        cmp = a.attempt - b.attempt;
        break;
      case "duration":
        cmp = (a.durationMs ?? -1) - (b.durationMs ?? -1);
        break;
    }
    return cmp * sortDir;
  });
  return filtered;
}

function renderTable(): void {
  if (!tableHost) return;
  tableHost.textContent = "";

  const rows = visibleTasks();
  const counts = new Map<string, number>();
  for (const t of allTasks) counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
  if (countLine) {
    countLine.textContent = `${rows.length}/${allTasks.length} — ${[...counts.entries()]
      .map(([s, n]) => `${s}: ${n}`)
      .join(", ")} — selected: ${selectedIds.size}`;
  }

  if (rows.length === 0) {
    tableHost.appendChild(el("div", { className: "dim" }, "No tasks match."));
    return;
  }

  const tbody = el("tbody", null);
  for (const t of rows) {
    const tr = el("tr", { className: "clickable" }, [
      el("td", null, checkboxCell(t.id)),
      el("td", null, statusBadge(t.status)),
      el("td", { className: "mono small" }, t.id),
      el("td", null, t.title),
      el("td", null, t.phaseTitle),
       el("td", null, t.ownerAgent ?? "—"),
       el("td", { className: "mono small" }, t.effectiveModel ?? "default"),
      el("td", null, String(t.attempt)),
      el("td", null, fmtDuration(t.durationMs)),
      el("td", { className: "mono small" }, usageCell(t.usage)),
    ]);
    tr.addEventListener("click", () => {
      expandedId = expandedId === t.id ? null : t.id;
      renderTable();
    });
    tbody.appendChild(tr);
    if (expandedId === t.id) {
       tbody.appendChild(el("tr", { className: "detail-row" }, [el("td", { colspan: "10" }, detail(t))]));
    }
  }

  tableHost.appendChild(
    el("div", { className: "table-scroll" }, [el("table", null, [
      el("thead", null, [
        el("tr", null, [
          plainTh("Pick"),
          th("Status", "status"),
          plainTh("ID"),
          plainTh("Title"),
          th("Phase", "phase"),
          th("Owner", "owner"),
          plainTh("Model"),
          th("Attempt", "attempt"),
          th("Duration", "duration"),
          plainTh("Tokens"),
        ]),
      ]),
      tbody,
    ])]),
  );
}

function checkboxCell(taskId: string): HTMLElement {
  const input = el("input", { type: "checkbox", checked: selectedIds.has(taskId) ? true : null }) as HTMLInputElement;
  input.setAttribute("aria-label", `Select task ${taskId}`);
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("change", () => {
    if (input.checked) selectedIds.add(taskId);
    else selectedIds.delete(taskId);
    selectionScope = inferSelectionScope();
    renderTable();
  });
  return input;
}

function inferSelectionScope(): SelectionScope | null {
  const ordered = allTasks.map((task) => task.id);
  const picked = ordered.filter((id) => selectedIds.has(id));
  if (picked.length === 0) return null;
  if (picked.length === 1) return "single";
  const indices = picked.map((id) => ordered.indexOf(id)).filter((i) => i >= 0).sort((a, b) => a - b);
  const contiguous = indices.every((value, index) => index === 0 || value === indices[index - 1]! + 1);
  return contiguous ? "range" : "list";
}

async function persistSelection(): Promise<void> {
  try {
    const ids = allTasks.map((task) => task.id).filter((id) => selectedIds.has(id));
    const res = await api.setTaskSelection(selectionScope ?? inferSelectionScope(), ids);
    toast(res.message || "saved");
  } catch (err) {
    toast(err instanceof Error ? err.message : "save failed");
  }
  await refresh();
}

async function runSelectionAction(action: "run" | "resume"): Promise<void> {
  if (featureTaskReviewRequired()) {
    toast("Review generated Tasks before starting or resuming execution.");
    syncFeatureTaskReviewPanel();
    return;
  }
  const summary = await api.summary().catch(() => null);
  if (!summary) {
    runSelectionStatus?.replaceChildren(
      "Build status could not be confirmed. ",
      el("a", { href: "#/overview" }, "Open Build status"),
      " and refresh before running selected tasks.",
    );
    return;
  }
  if (!summary?.run && !(summary?.job?.type === "engine-run" && summary.job.status === "running")) {
    runSelectionStatus?.replaceChildren(
      "This Project's Build has not started. ",
      el("a", { href: "#/overview" }, "Open Build status"),
      " to review the prepared plan and choose Start build.",
    );
    return;
  }
  if (runSelectionStatus) runSelectionStatus.textContent = "";
  const mode = summary?.executionMode ?? "auto";
  const ids = allTasks.map((task) => task.id).filter((id) => selectedIds.has(id));
  if (ids.length === 0) {
    toast(mode === "manual"
      ? "Manual mode is enabled. Select at least one task before starting the build."
      : "Select at least one task before starting the build.");
    return;
  }
  try {
    if (mode !== "manual") {
      const setMode = await api.setExecutionMode("manual");
      if (!setMode.ok) {
        toast(setMode.message || "failed to enable manual mode");
        return;
      }
    }
    const save = await api.setTaskSelection(selectionScope ?? inferSelectionScope(), ids);
    if (!save.ok) {
      toast(save.message || "save failed");
      return;
    }
    const res = await api.control(action);
    toast(res.message || (res.ok ? "ok" : "failed"));
  } catch (err) {
    toast(err instanceof Error ? err.message : "control failed");
  }
  await refresh();
}

function plainTh(label: string): HTMLElement {
  return el("th", null, label);
}

function th(label: string, key: SortKey): HTMLElement {
  const node = el("th", { className: "sortable" }, sortKey === key ? `${label} ${sortDir === 1 ? "▲" : "▼"}` : label);
  const sort = (): void => {
    if (sortKey === key) sortDir = sortDir === 1 ? -1 : 1;
    else {
      sortKey = key;
      sortDir = 1;
    }
    renderTable();
  };
  node.addEventListener("click", sort);
  node.setAttribute("tabindex", "0");
  node.setAttribute("role", "button");
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      sort();
    }
  });
  return node;
}

function detail(t: TaskRow): HTMLElement {
  const list = (title: string, items: string[] | null): HTMLElement | null => {
    if (!items || items.length === 0) return null;
    return el("div", null, [
      el("div", { className: "k" }, title),
      el("ul", { className: "detail-list" }, items.map((x) => el("li", null, x))),
    ]);
  };

  const fields: Array<HTMLElement | null> = [
    el("div", null, [el("div", { className: "k" }, "Description"), el("div", null, t.description || "—")]),
    el("div", null, [el("div", { className: "k" }, "Effective model"), el("div", { className: "mono" }, t.effectiveModel ?? "Harness/default")]),
    el("div", null, [el("div", { className: "k" }, "Token usage"), el("div", { className: "mono" }, formatUsage(t.usage))]),
    list("Expected outputs", t.expectedOutputs),
    list("Validation commands", t.validationCommands),
    list("Dependencies", t.dependencies),
    list("Inputs", t.inputs),
    t.produces
      ? el("div", null, [el("div", { className: "k" }, "Produces"), el("div", { className: "mono" }, t.produces)])
      : null,
    list("Output files", t.outputFiles),
    t.errorMessage
      ? el("div", { className: "error-text" }, [el("div", { className: "k" }, "Error"), el("div", { className: "mono" }, t.errorMessage)])
      : null,
    t.artifactId
      ? el("div", null, [el("div", { className: "k" }, "Artifact"), el("span", { className: "mono" }, t.artifactId)])
      : null,
    t.contractKind === "human-review" ? humanReviewAction(t) : null,
    el("div", { className: "stats" }, [
      isFinished(t) ? readOnlyTimeout(t) : timeoutEditor(t),
      el("div", { className: "stat" }, [el("div", { className: "k" }, "Started"), el("div", { className: "v" }, fmtTime(t.startedAt))]),
      el("div", { className: "stat" }, [el("div", { className: "k" }, "Completed"), el("div", { className: "v" }, fmtTime(t.completedAt))]),
      el("div", { className: "stat" }, [el("div", { className: "k" }, "Approval"), el("div", { className: "v" }, t.approvalRequired ? "yes" : "no")]),
    ]),
  ];

  return el("div", { className: "detail" }, fields.filter(Boolean) as HTMLElement[]);
}

export type HumanReviewGate =
  | { state: "complete" }
  | { state: "blocked"; unmet: string[] }
  | { state: "ready" };

/**
 * Whether a human-review row can offer its approval action.
 *
 * A review attests to delivered work, and the engine will not dispatch the task
 * until its prerequisites are done - so before then the work under review does
 * not exist. The action is withheld rather than offered and then refused, and
 * `unmetPrerequisites` is what the server computed from the same rule.
 */
export function humanReviewGate(t: TaskRow): HumanReviewGate {
  const unmet = t.unmetPrerequisites ?? [];
  if (t.status === "complete") return { state: "complete" };
  if (unmet.length > 0) return { state: "blocked", unmet };
  return { state: "ready" };
}

export interface HumanReviewQueueEntry {
  task: TaskRow;
  state: "ready" | "waiting" | "complete";
  blocker: string;
  nextResponsible: string;
  nextAction: string;
}

/** Project-facing summary for the Human review queue, derived from Task contracts and engine gates. */
export function humanReviewQueueEntries(tasks: TaskRow[]): HumanReviewQueueEntry[] {
  return tasks
    .filter((task) => task.contractKind === "human-review")
    .map((task) => {
      const gate = humanReviewGate(task);
      if (gate.state === "complete") {
        return {
          task,
          state: "complete",
          blocker: "None — Task approval is recorded.",
          nextResponsible: "No action required",
          nextAction: `Review evidence is recorded at ${task.reviewFile ?? "the configured review file"}.`,
        };
      }
      if (gate.state === "blocked") {
        const taskDependencies = gate.unmet.filter((id) => !id.startsWith("phase:"));
        const phaseGates = gate.unmet.filter((id) => id.startsWith("phase:")).map((id) => id.slice("phase:".length));
        const blockers = [
          taskDependencies.length === 1
            ? `Prerequisite task ${taskDependencies[0]} is not complete.`
            : taskDependencies.length > 1
              ? `Prerequisite tasks ${taskDependencies.join(", ")} are not complete.`
              : "",
          phaseGates.length === 1
            ? `Phase completion gate ${phaseGates[0]} is not complete.`
            : phaseGates.length > 1
              ? `Phase completion gates ${phaseGates.join(", ")} are not complete.`
              : "",
        ].filter(Boolean);
        const responsible = [
          taskDependencies.length ? "Prerequisite task owners" : "",
          phaseGates.length ? "Owners of prerequisite phases" : "",
        ].filter(Boolean);
        return {
          task,
          state: "waiting",
          blocker: blockers.join(" "),
          nextResponsible: responsible.join(" and "),
          nextAction: "Wait for the listed prerequisites to complete; a person can review this Task once it is ready.",
        };
      }
      return {
        task,
        state: "ready",
        blocker: "None — prerequisites are complete.",
        nextResponsible: "Human reviewer",
        nextAction: "Review the criteria and references, record your findings, and explicitly approve this Task.",
      };
    });
}

function renderReviewQueue(): void {
  if (!tableHost) return;
  tableHost.textContent = "";
  const entries = humanReviewQueueEntries(allTasks);
  if (countLine) {
    const ready = entries.filter((entry) => entry.state === "ready").length;
    const waiting = entries.filter((entry) => entry.state === "waiting").length;
    const complete = entries.filter((entry) => entry.state === "complete").length;
    countLine.textContent = `${entries.length} Human review Task${entries.length === 1 ? "" : "s"} · ${ready} ready · ${waiting} waiting · ${complete} complete`;
  }
  if (entries.length === 0) {
    tableHost.appendChild(el("div", { className: "panel" }, "No Human review Tasks are defined for this Project yet."));
    return;
  }
  for (const entry of entries) tableHost.appendChild(renderReviewQueueEntry(entry));
}

function renderReviewQueueEntry(entry: HumanReviewQueueEntry): HTMLElement {
  const { task } = entry;
  const label = entry.state === "ready" ? "Ready for human review" : entry.state === "waiting" ? "Waiting" : "Human review recorded";
  const list = (title: string, values: string[]): HTMLElement => el("div", { className: "review-queue-field" }, [
    el("div", { className: "k" }, title),
    values.length
      ? el("ul", { className: "detail-list" }, values.map((value) => el("li", null, value)))
      : el("p", { className: "dim small" }, "Not specified in this Task contract."),
  ]);
  const stateDetail = el("div", { className: "review-queue-state" }, [
    el("div", { className: "row between wrap" }, [el("strong", null, label), statusBadge(entry.state)]),
    el("p", null, [el("strong", null, "Blocker: "), entry.blocker]),
    el("p", null, [el("strong", null, "Next responsible: "), entry.nextResponsible]),
    el("p", { className: "dim small" }, entry.nextAction),
  ]);
  return el("article", { className: "panel review-queue-card" }, [
    el("div", { className: "row between wrap" }, [
      el("h2", null, `${task.id} · ${task.title}`),
      statusBadge(task.status),
    ]),
    el("p", { className: "dim small" }, `${task.phaseTitle} · ${task.description || "No Task description provided."}`),
    list("Requirements", task.requirements),
    list("Acceptance criteria", task.acceptanceCriteria),
    list("Constraints", task.constraints),
    list("References", task.references),
    list("Unverified upstream checks", task.validationGaps),
    stateDetail,
    humanReviewAction(task),
  ]);
}

function humanReviewAction(t: TaskRow): HTMLElement {
  const gate = humanReviewGate(t);
  const complete = gate.state === "complete";
  if (gate.state === "blocked") {
    const unmet = gate.unmet;
    const taskDependencies = unmet.filter((id) => !id.startsWith("phase:"));
    const phaseGates = unmet.filter((id) => id.startsWith("phase:")).map((id) => id.slice("phase:".length));
    const waiting = [
      ...(taskDependencies.length ? [`prerequisite task${taskDependencies.length === 1 ? "" : "s"} ${taskDependencies.join(", ")}`] : []),
      ...(phaseGates.length ? [`phase completion gate${phaseGates.length === 1 ? "" : "s"} ${phaseGates.join(", ")}`] : []),
    ];
    return el("div", { class: "review-action" }, [
      el("div", { class: "k" }, "Human review blocked"),
      el("p", { class: "dim small" },
        `Waiting on ${waiting.join(" and ")}. The review action appears once the prerequisites and phase gates pass.`),
    ]);
  }
  const button = el("button", {
    className: complete ? "btn btn-review-complete" : "btn btn-primary",
    type: "button",
    disabled: complete ? true : null,
  }, complete ? "Human review complete" : "Complete human review");
  if (!complete) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openHumanReview(t);
    });
  }
  return el("div", { className: "review-action" }, [
    el("div", { className: "k" }, complete ? "Human review recorded" : "Human review required"),
    el("p", { className: "dim small" }, complete
      ? `Approval record: ${t.reviewFile ?? "configured in the manifest"}.`
      : `Review the task criteria, record your findings, and approve it as ${t.reviewFile ?? "configured in the manifest"}.`),
    button,
  ]);
}

function openHumanReview(t: TaskRow): void {
  const reviewer = el("input", { type: "text", required: true, placeholder: "Your name" }) as HTMLInputElement;
  const notes = el("textarea", { required: true, rows: "8", placeholder: "Describe what you exercised (e.g. the primary user journey against the live system), what you found, and why this task is approved." }) as HTMLTextAreaElement;
  const confirm = el("input", { type: "checkbox" }) as HTMLInputElement;
  const close = el("button", { className: "btn", type: "button" }, "Cancel");
  const submit = el("button", { className: "btn btn-primary", type: "submit" }, "Approve and resume");
  const dialog = el("dialog", { className: "review-dialog" }, [
    el("form", { method: "dialog" }, [
      el("h3", null, `Review ${t.id}`),
      el("p", null, t.description || t.title),
      reviewList("Requirements", t.requirements),
      reviewList("Acceptance criteria", t.acceptanceCriteria),
      reviewList("Constraints", t.constraints),
      reviewList("References", t.references),
      reviewList("Unverified upstream checks (validate these yourself before approving)", t.validationGaps ?? []),
      el("p", { className: "dim small" }, `Approval record: ${t.reviewFile ?? "manifest reviewFile"}`),
      el("label", { className: "field" }, [el("span", null, "Reviewer name"), reviewer]),
      el("label", { className: "field" }, [el("span", null, "Review notes"), notes]),
      el("label", { className: "checkbox-row" }, [confirm, el("span", null, "I performed this review and approve this task." )]),
      el("div", { className: "actions" }, [close, submit]),
    ]),
  ]) as HTMLDialogElement;
  close.addEventListener("click", () => dialog.close());
  dialog.querySelector("form")!.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!reviewer.value.trim() || !notes.value.trim() || !confirm.checked) {
      toast("Enter your name, review notes, and confirm the attestation.");
      return;
    }
    if (notes.value.trim().length < 40) {
      toast("Review notes must describe what you exercised and found (at least 40 characters).");
      return;
    }
    submit.setAttribute("disabled", "true");
    void api.completeHumanReview(t.id, reviewer.value, notes.value).then((result) => {
      toast(result.message ?? "Human review approved.");
      dialog.close();
      void refresh();
    }).catch((error) => {
      submit.removeAttribute("disabled");
      toast(error instanceof Error ? error.message : "Human review failed.");
    });
  });
  document.body.appendChild(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
}

function reviewList(title: string, values: string[]): HTMLElement | null {
  if (values.length === 0) return null;
  return el("div", null, [el("div", { className: "k" }, title), el("ul", { className: "detail-list" }, values.map((value) => el("li", null, value)))]);
}

function isFinished(t: TaskRow): boolean {
  return t.status === "complete" || t.status === "skipped";
}

function readOnlyTimeout(t: TaskRow): HTMLElement {
  const own = t.timeoutMs != null ? `${timeoutToMinutes(t.timeoutMs)} min` : null;
  const def = store.summary?.defaultTimeoutMs ?? null;
  const text = own ?? (def != null ? `default · ${timeoutToMinutes(def)} min` : "default");
  return el("div", { className: "stat" }, [
    el("div", { className: "k" }, "Timeout"),
    el("div", { className: "v" }, text),
  ]);
}

function timeoutEditor(t: TaskRow): HTMLElement {
  const input = el("input", {
    type: "number",
    placeholder: "min",
    className: "timeout-input",
    value: timeoutToMinutes(t.timeoutMs),
  });
  const apply = el("button", { className: "btn btn-sm" }, "Apply");
  apply.addEventListener("click", () => {
    const minutes = Number((input as HTMLInputElement).value);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      toast("Enter a positive timeout in minutes.");
      return;
    }
    void (async () => {
      try {
        const res = await api.setTaskTimeout(t.id, minutesToTimeoutMs(minutes));
        toast(res.message || (res.ok ? "ok" : "failed"));
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : "update failed");
      }
    })();
  });

  return el("div", { className: "stat" }, [
    el("div", { className: "k" }, "Timeout (min)"),
    el("div", { className: "row gap" }, [input, apply]),
  ]);
}
