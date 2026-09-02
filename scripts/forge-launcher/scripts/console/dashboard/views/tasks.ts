// ─── Tasks: filterable/sortable table with expandable detail ────────────────

import { api } from "../api.js";
import { store } from "../state.js";
import { el, fmtDuration, fmtTime, minutesToTimeoutMs, statusBadge, timeoutToMinutes, toast } from "../render/dom.js";
import type { SelectionScope, TaskRow } from "../types.js";

type SortKey = "status" | "phase" | "owner" | "duration" | "attempt";

const STATUSES = ["pending", "running", "complete", "failed", "skipped"];

let gen = 0;
let unsub: Array<() => void> = [];
let allTasks: TaskRow[] = [];
let filterStatus: string | null = null;
let search = "";
let sortKey: SortKey = "status";
let sortDir: 1 | -1 = 1;
let expandedId: string | null = null;
let tableHost: HTMLElement | null = null;
let countLine: HTMLElement | null = null;
let selectedIds = new Set<string>();
let selectionScope: SelectionScope | null = null;

export function unmountTasks(): void {
  for (const u of unsub) u();
  unsub = [];
  allTasks = [];
  filterStatus = null;
  search = "";
  sortKey = "status";
  sortDir = 1;
  expandedId = null;
  tableHost = null;
  countLine = null;
  selectedIds = new Set<string>();
  selectionScope = null;
}

function taskFilterFromHash(): string | null {
  const m = /[?&]task=([^&]+)/.exec(location.hash);
  return m ? decodeURIComponent(m[1]!) : null;
}

export async function renderTasks(container: HTMLElement): Promise<void> {
  unmountTasks();
  container.textContent = "";
  const myGen = ++gen;

  const fromHash = taskFilterFromHash();
  if (fromHash) {
    search = fromHash;
    expandedId = fromHash;
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

  countLine = el("div", { className: "dim small" });
  tableHost = el("div", null);
  selectedIds = new Set(store.summary?.selectedTaskIds ?? []);
  selectionScope = store.summary?.selectionScope ?? null;

  const rangeStart = el("select", { className: "replay-select" });
  const rangeEnd = el("select", { className: "replay-select" });
  const addRange = el("button", { className: "btn btn-sm" }, "Add range");
  const saveSelection = el("button", { className: "btn btn-sm" }, "Save selection");
  const clearSelection = el("button", { className: "btn btn-sm" }, "Clear");
  const runSelection = el("button", { className: "btn btn-sm btn-primary" }, "Run selected");
  const resumeSelection = el("button", { className: "btn btn-sm" }, "Resume selected");

  const launch = el("button", { className: "btn btn-sm" }, `Launch ${store.summary?.harness ?? "harness"} CLI`);
  launch.addEventListener("click", () => void launchCli());

  container.appendChild(
    el("div", { className: "panel" }, [
      el("div", { className: "row between wrap" }, [
        el("h3", null, "Tasks"),
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
      el("div", { className: "row gap", style: "margin:0 0 8px" }, [
        el("span", { className: "dim small" }, "Set every task's timeout:"),
        allTimeoutInput,
        allTimeoutBtn,
      ]),
      tableHost,
    ]),
  );

  try {
    allTasks = await api.tasks();
  } catch {
    allTasks = [];
  }
  for (const task of allTasks) {
    rangeStart.appendChild(el("option", { value: task.id }, `${task.id} — ${task.title}`));
    rangeEnd.appendChild(el("option", { value: task.id }, `${task.id} — ${task.title}`));
  }
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
  if (myGen !== gen) return;
  renderTable();
}

function chip(label: string, active: boolean, onClick: () => void): HTMLElement {
  const node = el("span", { className: active ? "chip active" : "chip" }, label);
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
  try {
    allTasks = await api.tasks();
  } catch {
    // keep the existing rows on failure
  }
  renderTable();
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
      el("td", null, String(t.attempt)),
      el("td", null, fmtDuration(t.durationMs)),
    ]);
    tr.addEventListener("click", () => {
      expandedId = expandedId === t.id ? null : t.id;
      renderTable();
    });
    tbody.appendChild(tr);
    if (expandedId === t.id) {
      tbody.appendChild(el("tr", { className: "detail-row" }, [el("td", { colspan: "8" }, detail(t))]));
    }
  }

  tableHost.appendChild(
    el("table", null, [
      el("thead", null, [
        el("tr", null, [
          plainTh("Pick"),
          th("Status", "status"),
          plainTh("ID"),
          plainTh("Title"),
          th("Phase", "phase"),
          th("Owner", "owner"),
          th("Attempt", "attempt"),
          th("Duration", "duration"),
        ]),
      ]),
      tbody,
    ]),
  );
}

function checkboxCell(taskId: string): HTMLElement {
  const input = el("input", { type: "checkbox", checked: selectedIds.has(taskId) ? true : null }) as HTMLInputElement;
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
  const mode = store.summary?.executionMode ?? "auto";
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
  node.addEventListener("click", () => {
    if (sortKey === key) sortDir = sortDir === 1 ? -1 : 1;
    else {
      sortKey = key;
      sortDir = 1;
    }
    renderTable();
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
    el("div", { className: "stats" }, [
      isFinished(t) ? readOnlyTimeout(t) : timeoutEditor(t),
      el("div", { className: "stat" }, [el("div", { className: "k" }, "Started"), el("div", { className: "v" }, fmtTime(t.startedAt))]),
      el("div", { className: "stat" }, [el("div", { className: "k" }, "Completed"), el("div", { className: "v" }, fmtTime(t.completedAt))]),
      el("div", { className: "stat" }, [el("div", { className: "k" }, "Approval"), el("div", { className: "v" }, t.approvalRequired ? "yes" : "no")]),
    ]),
  ];

  return el("div", { className: "detail" }, fields.filter(Boolean) as HTMLElement[]);
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
