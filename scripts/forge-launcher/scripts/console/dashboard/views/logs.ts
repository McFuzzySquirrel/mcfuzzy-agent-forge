// ─── Logs: engine log + audit, live-appended from SSE ───────────────────────

import { api } from "../api.js";
import { store } from "../state.js";
import { el, fmtTime } from "../render/dom.js";
import type { AuditEvent } from "../types.js";

const MAX_LINES = 500;

let unsub: Array<() => void> = [];
let logsGeneration = 0;

export function unmountLogs(): void {
  for (const u of unsub) u();
  unsub = [];
  logsGeneration += 1;
}

export function renderLogs(container: HTMLElement): void {
  unmountLogs();
  container.textContent = "";

  const engineTab = el("button", { className: "tab active", type: "button", "aria-selected": "true" }, "Engine log");
  const auditTab = el("button", { className: "tab", type: "button", "aria-selected": "false" }, "Audit");
  const enginePanel = el("div", { className: "tab-panel" });
  const auditPanel = el("div", { className: "tab-panel", style: "display:none" });

  const show = (engine: boolean): void => {
    engineTab.className = engine ? "tab active" : "tab";
    auditTab.className = engine ? "tab" : "tab active";
    engineTab.setAttribute("aria-selected", String(engine));
    auditTab.setAttribute("aria-selected", String(!engine));
    enginePanel.style.display = engine ? "" : "none";
    auditPanel.style.display = engine ? "none" : "";
  };
  engineTab.addEventListener("click", () => show(true));
  auditTab.addEventListener("click", () => show(false));

  container.appendChild(
    el("div", { className: "panel" }, [
      el("div", { className: "tabs" }, [engineTab, auditTab]),
      enginePanel,
      auditPanel,
    ]),
  );

  renderEngineLog(enginePanel);
  renderAudit(auditPanel);
}

function renderEngineLog(panel: HTMLElement): void {
  const pre = el("pre", { className: "log-view" });
  let follow = true;
  let unread = 0;
  const followToggle = el("input", { type: "checkbox", checked: true }) as HTMLInputElement;
  const unreadLabel = el("span", { className: "dim small", role: "status", "aria-live": "polite" });
  followToggle.addEventListener("change", () => {
    follow = followToggle.checked;
    if (follow) {
      unread = 0;
      unreadLabel.textContent = "";
      pre.scrollTop = pre.scrollHeight;
    }
  });
  panel.appendChild(el("div", { className: "row gap wrap log-controls" }, [
    el("label", { className: "checkbox-row" }, [followToggle, " Follow new lines"]),
    unreadLabel,
  ]));
  panel.appendChild(pre);

  const appendLine = (line: string): void => {
    pre.appendChild(el("div", { className: "log-line" }, line));
    while (pre.childElementCount > MAX_LINES) {
      pre.removeChild(pre.firstElementChild!);
    }
    if (follow) pre.scrollTop = pre.scrollHeight;
    else {
      unread += 1;
      unreadLabel.textContent = `${unread} unread line${unread === 1 ? "" : "s"}`;
    }
  };

  const myGeneration = logsGeneration;
  void api.logs(400).then((res) => {
    if (myGeneration !== logsGeneration) return;
    for (const line of res.lines) appendLine(line);
  }).catch(() => {
    if (myGeneration === logsGeneration) unreadLabel.textContent = "Unable to load log; reconnecting…";
  });

  unsub.push(store.onLog(appendLine));
}

function renderAudit(panel: HTMLElement): void {
  const table = el("table", null, [
    el("thead", null, [el("tr", null, [el("th", null, "Time"), el("th", null, "Action"), el("th", null, "Task"), el("th", null, "Note")])]),
  ]);
  const tbody = el("tbody", null);
  table.appendChild(tbody);
  panel.appendChild(table);

  const appendRow = (e: AuditEvent): void => {
    tbody.appendChild(
      el("tr", null, [
        el("td", { className: "small" }, fmtTime(e.timestamp)),
        el("td", null, el("span", { className: "badge" }, e.action)),
        el("td", { className: "mono small" }, e.taskId ?? "—"),
        el("td", null, e.note ?? ""),
      ]),
    );
    while (tbody.childElementCount > MAX_LINES) {
      tbody.removeChild(tbody.firstElementChild!);
    }
  };

  const myGeneration = logsGeneration;
  void api.audit().then((events) => {
    if (myGeneration !== logsGeneration) return;
    for (const e of events) appendRow(e);
  }).catch(() => {
    if (myGeneration === logsGeneration) panel.appendChild(el("div", { className: "error-text", role: "alert" }, "Unable to load audit events."));
  });

  unsub.push(store.onAudit(appendRow));
}
