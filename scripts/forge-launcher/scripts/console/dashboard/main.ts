// ─── Forge Console entry point: hash router + SSE wiring ────────────────────

import { api } from "./api.js";
import { store, type Snapshot } from "./state.js";
import type { AuditEvent } from "./types.js";
import { renderBoard, unmountBoard } from "./views/board.js";
import { renderHome, unmountHome } from "./views/home.js";
import { renderOverview, unmountOverview } from "./views/overview.js";
import { renderTasks, unmountTasks } from "./views/tasks.js";
import { renderLogs, unmountLogs } from "./views/logs.js";
import { renderDocuments, unmountDocuments } from "./views/documents.js";
import { renderArtifacts, unmountArtifacts } from "./views/artifacts.js";
import { renderTimeline, unmountTimeline } from "./views/timeline.js";
import { renderProjects, unmountProjects } from "./views/projects.js";
import { renderNew, unmountNew } from "./views/new.js";
import { openHelp } from "./views/help.js";

interface View {
  id: string;
  label: string;
  render: (container: HTMLElement) => void;
  unmount: () => void;
}

const views: View[] = [
  { id: "home", label: "Home", render: renderHome, unmount: unmountHome },
  { id: "overview", label: "Overview", render: renderOverview, unmount: unmountOverview },
  { id: "board", label: "Board", render: renderBoard, unmount: unmountBoard },
  { id: "tasks", label: "Tasks", render: renderTasks, unmount: unmountTasks },
  { id: "logs", label: "Logs", render: renderLogs, unmount: unmountLogs },
  { id: "documents", label: "Plan & Team", render: renderDocuments, unmount: unmountDocuments },
  { id: "artifacts", label: "Artifacts", render: renderArtifacts, unmount: unmountArtifacts },
  { id: "timeline", label: "Timeline", render: renderTimeline, unmount: unmountTimeline },
  { id: "projects", label: "Projects", render: renderProjects, unmount: unmountProjects },
  { id: "new", label: "New project", render: renderNew, unmount: unmountNew },
];

// Views that make sense without a selected repo (the landing surface).
const NO_REPO_ROUTES = new Set(["home", "new", "projects"]);

let active: View | null = null;

function currentRouteId(): string {
  const raw = location.hash.replace(/^#\/?/, "").split("?")[0]!;
  return raw || "home";
}

function renderNav(activeId: string): void {
  const nav = document.querySelector<HTMLElement>("#nav");
  if (!nav) return;
  nav.textContent = "";
  // Hide the "new" wizard from the top nav (reachable from Home); keep it terse.
  for (const view of views.filter((v) => v.id !== "new")) {
    const link = document.createElement("a");
    link.href = `#/${view.id}`;
    link.textContent = view.label;
    link.className = view.id === activeId ? "nav-link active" : "nav-link";
    nav.appendChild(link);
  }
}

function render(): void {
  const id = currentRouteId();
  const view = views.find((v) => v.id === id) ?? views[0]!;
  active?.unmount();
  active = view;
  renderNav(view.id);
  document.body.dataset.view = view.id;
  const container = document.querySelector<HTMLElement>("#view");
  if (!container) return;
  container.textContent = "";
  view.render(container);
}

function connectEvents(): void {
  const es = new EventSource("/api/events");
  es.addEventListener("snapshot", (event: Event) => {
    const data = JSON.parse((event as MessageEvent).data as string) as Snapshot;
    store.applySnapshot(data);
  });
  es.addEventListener("audit", (event: Event) => {
    const data = JSON.parse((event as MessageEvent).data as string) as AuditEvent;
    store.emitAudit(data);
  });
  es.addEventListener("log", (event: Event) => {
    const data = JSON.parse((event as MessageEvent).data as string) as { line: string };
    store.emitLog(data.line);
  });
  es.onerror = () => {
    // EventSource auto-reconnects; nothing to do here.
  };
}

async function init(): Promise<void> {
  store.subscribe(() => {
    const route = currentRouteId();
    if (!store.summary && !NO_REPO_ROUTES.has(route)) {
      location.hash = "#/home";
      return;
    }
    render();
  });

  try {
    store.setSummary(await api.summary());
  } catch {
    store.setSummary(null);
  }

  connectEvents();

  // Help button (top-right of the top bar).
  const topbar = document.querySelector<HTMLElement>("#topbar");
  if (topbar && !topbar.querySelector(".help-btn")) {
    const helpBtn = document.createElement("button");
    helpBtn.className = "btn btn-sm help-btn";
    helpBtn.textContent = "Help";
    helpBtn.addEventListener("click", openHelp);
    topbar.appendChild(helpBtn);
  }

  // Initial landing: explicit hash wins; otherwise overview when a repo is
  // selected, home when it is not.
  if (!location.hash || location.hash === "#" || location.hash === "#/") {
    location.hash = store.summary ? "#/overview" : "#/home";
  }
  render();
}

window.addEventListener("hashchange", render);
void init();
