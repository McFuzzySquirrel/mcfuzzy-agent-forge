// ─── Tasks: filterable/sortable table with expandable detail ────────────────

import { api } from "../api.js";
import { el, fmtDuration, fmtTime, statusBadge, toast } from "../render/dom.js";
import type { TaskRow } from "../types.js";

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
    placeholder: "Timeout for all tasks (ms)",
    className: "search timeout-input",
  });
  const allTimeoutBtn = el("button", { className: "btn btn-sm" }, "Set all");
  allTimeoutBtn.addEventListener("click", () => {
    const value = Number((allTimeoutInput as HTMLInputElement).value);
    if (!Number.isInteger(value) || value <= 0) {
      toast("Enter a positive timeout in milliseconds.");
      return;
    }
    void (async () => {
      try {
        const res = await api.setAllTaskTimeouts(value);
        toast(res.message || (res.ok ? "ok" : "failed"));
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : "update failed");
      }
    })();
  });

  countLine = el("div", { className: "dim small" });
  tableHost = el("div", null);

  container.appendChild(
    el("div", { className: "panel" }, [
      el("div", { className: "row between wrap" }, [el("h3", null, "Tasks"), countLine]),
      statusChips,
      el("div", { className: "row gap", style: "margin:8px 0" }, [searchInput]),
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
  if (myGen !== gen) return;
  renderTable();
}

function chip(label: string, active: boolean, onClick: () => void): HTMLElement {
  const node = el("span", { className: active ? "chip active" : "chip" }, label);
  node.addEventListener("click", onClick);
  return node;
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
      .join(", ")}`;
  }

  if (rows.length === 0) {
    tableHost.appendChild(el("div", { className: "dim" }, "No tasks match."));
    return;
  }

  const tbody = el("tbody", null);
  for (const t of rows) {
    const tr = el("tr", { className: "clickable" }, [
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
      tbody.appendChild(el("tr", { className: "detail-row" }, [el("td", { colspan: "7" }, detail(t))]));
    }
  }

  tableHost.appendChild(
    el("table", null, [
      el("thead", null, [
        el("tr", null, [
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
      timeoutEditor(t),
      el("div", { className: "stat" }, [el("div", { className: "k" }, "Started"), el("div", { className: "v" }, fmtTime(t.startedAt))]),
      el("div", { className: "stat" }, [el("div", { className: "k" }, "Completed"), el("div", { className: "v" }, fmtTime(t.completedAt))]),
      el("div", { className: "stat" }, [el("div", { className: "k" }, "Approval"), el("div", { className: "v" }, t.approvalRequired ? "yes" : "no")]),
    ]),
  ];

  return el("div", { className: "detail" }, fields.filter(Boolean) as HTMLElement[]);
}

function timeoutEditor(t: TaskRow): HTMLElement {
  const input = el("input", {
    type: "number",
    placeholder: "ms",
    className: "timeout-input",
    value: t.timeoutMs != null ? String(t.timeoutMs) : "",
  });
  const apply = el("button", { className: "btn btn-sm" }, "Apply");
  apply.addEventListener("click", () => {
    const value = Number((input as HTMLInputElement).value);
    if (!Number.isInteger(value) || value <= 0) {
      toast("Enter a positive timeout in milliseconds.");
      return;
    }
    void (async () => {
      try {
        const res = await api.setTaskTimeout(t.id, value);
        toast(res.message || (res.ok ? "ok" : "failed"));
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : "update failed");
      }
    })();
  });

  return el("div", { className: "stat" }, [
    el("div", { className: "k" }, "Timeout (ms)"),
    el("div", { className: "row gap" }, [input, apply]),
  ]);
}
