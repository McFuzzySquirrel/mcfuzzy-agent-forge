// ─── Timeline: chronological audit events, live-appended from SSE ───────────

import { api } from "../api.js";
import { store } from "../state.js";
import { el, fmtTime } from "../render/dom.js";
import type { AuditEvent } from "../types.js";

const MAX_EVENTS = 500;

let unsub: Array<() => void> = [];
let allEvents: AuditEvent[] = [];
let filterAction: string | null = null;
let listHost: HTMLElement | null = null;
let filterHost: HTMLElement | null = null;

export function unmountTimeline(): void {
  for (const u of unsub) u();
  unsub = [];
  allEvents = [];
  filterAction = null;
  listHost = null;
  filterHost = null;
}

export function renderTimeline(container: HTMLElement): void {
  unmountTimeline();
  container.textContent = "";

  filterHost = el("div", { className: "chips" });
  listHost = el("div", { className: "timeline" });
  container.appendChild(el("h2", null, "Timeline"));
  container.appendChild(el("div", { className: "panel" }, [filterHost, listHost]));

  unsub.push(store.onAudit((e) => {
    allEvents.push(e);
    if (allEvents.length > MAX_EVENTS) allEvents.shift();
    if (matchesFilter(e)) appendEvent(e);
  }));

  void api.audit().then((events) => {
    allEvents = events.slice(-MAX_EVENTS);
    renderFilters();
    renderAll();
  });
}

function matchesFilter(e: AuditEvent): boolean {
  return filterAction === null || e.action === filterAction;
}

function isFailure(e: AuditEvent): boolean {
  return /failed/i.test(e.action);
}

function renderFilters(): void {
  if (!filterHost) return;
  filterHost.textContent = "";
  const actions = [...new Set(allEvents.map((e) => e.action))].sort();
  const make = (label: string, value: string | null, active: boolean): HTMLElement => {
    const c = el("span", { className: active ? "chip active" : "chip" }, label);
    c.addEventListener("click", () => {
      filterAction = value;
      renderFilters();
      renderAll();
    });
    return c;
  };
  filterHost.appendChild(make("All", null, filterAction === null));
  for (const a of actions) filterHost.appendChild(make(a, a, filterAction === a));
}

function renderAll(): void {
  if (!listHost) return;
  listHost.textContent = "";
  for (const e of allEvents) {
    if (matchesFilter(e)) listHost.appendChild(eventItem(e));
  }
}

function appendEvent(e: AuditEvent): void {
  if (listHost) listHost.appendChild(eventItem(e));
}

function eventItem(e: AuditEvent): HTMLElement {
  const taskLink = e.taskId
    ? el("a", { href: `#/tasks?task=${encodeURIComponent(e.taskId)}`, className: "mono small" }, e.taskId)
    : el("span", { className: "dim" }, "—");

  const note = e.note ? el("div", { className: "dim" }, e.note) : null;

  return el("div", { className: isFailure(e) ? "tl-item failure" : "tl-item" }, [
    el("div", { className: "tl-time" }, fmtTime(e.timestamp)),
    el("div", { className: "row gap" }, [el("span", { className: "badge" }, e.action), taskLink]),
    note,
  ]);
}
