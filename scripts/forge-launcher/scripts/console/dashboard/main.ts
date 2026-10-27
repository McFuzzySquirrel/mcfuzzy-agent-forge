// ─── Forge Console entry point: hash router + SSE wiring ────────────────────

import { api } from "./api.js";
import { store, type Snapshot } from "./state.js";
import { el, toast } from "./render/dom.js";
import type { AuditEvent, JobsSummary, ProjectsIndex } from "./types.js";
import { renderBoard, unmountBoard } from "./views/board.js";
import { renderHome, unmountHome } from "./views/home.js";
import { refreshOverview, renderOverview, unmountOverview } from "./views/overview.js";
import { renderTasks, unmountTasks } from "./views/tasks.js";
import { renderLogs, unmountLogs } from "./views/logs.js";
import { refreshDocuments, renderDocuments, unmountDocuments } from "./views/documents.js";
import { renderArtifacts, unmountArtifacts } from "./views/artifacts.js";
import { renderTimeline, unmountTimeline } from "./views/timeline.js";
import { refreshProjectList, renderProjects, unmountProjects } from "./views/projects.js";
import { renderNew, unmountNew } from "./views/new.js";
import { refreshSettings, renderSettings, unmountSettings } from "./views/settings.js";
import { openHelp } from "./views/help.js";
import { isTerminalSessionActive, onTerminalSessionChange, renderTerminal, unmountTerminal } from "./views/terminal.js";
import { applyTheme, parseThemePreference, readCachedThemePreference } from "./theme.js";

interface View {
  id: string;
  label: string;
  group: string;
  render: (container: HTMLElement) => void;
  unmount: () => void;
  refresh?: () => void;
}

const views: View[] = [
  { id: "home", label: "Home", group: "Start", render: renderHome, unmount: unmountHome },
  { id: "projects", label: "Projects", group: "Start", render: renderProjects, unmount: unmountProjects },
  { id: "overview", label: "Overview", group: "Pipeline", render: renderOverview, unmount: unmountOverview, refresh: refreshOverview },
  { id: "board", label: "Board", group: "Monitor", render: renderBoard, unmount: unmountBoard },
  { id: "tasks", label: "Tasks", group: "Monitor", render: renderTasks, unmount: unmountTasks },
  { id: "logs", label: "Logs", group: "Monitor", render: renderLogs, unmount: unmountLogs },
  { id: "timeline", label: "Timeline", group: "Monitor", render: renderTimeline, unmount: unmountTimeline },
  { id: "documents", label: "Plan & Team", group: "Review", render: renderDocuments, unmount: unmountDocuments, refresh: refreshDocuments },
  { id: "artifacts", label: "Artifacts", group: "Review", render: renderArtifacts, unmount: unmountArtifacts },
  { id: "terminal", label: "Terminal", group: "Review", render: renderTerminal, unmount: unmountTerminal },
  { id: "settings", label: "Settings", group: "Settings", render: renderSettings, unmount: unmountSettings, refresh: refreshSettings },
  { id: "new", label: "New project", group: "", render: renderNew, unmount: unmountNew },
];

/** Sidebar sections in display order; the "new" wizard is intentionally absent. */
const NAV_GROUPS: Array<[string, string[]]> = [
  ["Start", ["home", "projects"]],
  ["Pipeline", ["overview"]],
  ["Monitor", ["board", "tasks", "logs", "timeline"]],
  ["Review", ["documents", "artifacts", "terminal"]],
  ["Settings", ["settings"]],
];

// Views that make sense without a selected repo (the landing surface).
const NO_REPO_ROUTES = new Set(["home", "new", "projects"]);

let active: View | null = null;
let activeProject = "none";
let unsubscribeStore: (() => void) | undefined;

function currentRouteId(): string {
  const raw = location.hash.replace(/^#\/?/, "").split("?")[0]!;
  return raw || "home";
}

function renderNav(activeId: string): void {
  const nav = document.querySelector<HTMLElement>("#nav");
  if (!nav) return;
  nav.textContent = "";
  const terminalRunning = isTerminalSessionActive();

  for (const [group, ids] of NAV_GROUPS) {
    const groupViews = ids
      .map((id) => views.find((view) => view.id === id))
      .filter((view): view is View => Boolean(view));
    if (groupViews.length === 0) continue;
    const active = groupViews.some((view) => view.id === activeId);
    const dot = terminalRunning && groupViews.some((view) => view.id === "terminal");

    // A single-item category (Settings) is a direct link, not a dropdown.
    if (groupViews.length === 1) {
      const view = groupViews[0]!;
      const link = document.createElement("a");
      link.href = `#/${view.id}`;
      link.textContent = dot ? `${group} ●` : group;
      if (dot) link.title = "A terminal session is running in the background.";
      link.className = `nav-category-btn nav-direct${active ? " active" : ""}`;
      nav.appendChild(link);
      continue;
    }

    const category = el("div", { className: "nav-category" });
    const button = el("button", {
      type: "button",
      className: `nav-category-btn${active ? " active" : ""}`,
      "aria-haspopup": "true",
      "aria-expanded": "false",
    }, [dot ? `${group} ●` : group, el("span", { className: "nav-caret", "aria-hidden": "true" }, "▾")]);
    const menu = el("div", { className: "nav-menu", role: "menu" });
    for (const view of groupViews) {
      const link = document.createElement("a");
      link.href = `#/${view.id}`;
      link.textContent = view.id === "terminal" && terminalRunning ? `${view.label} ●` : view.label;
      link.setAttribute("role", "menuitem");
      if (view.id === activeId) link.setAttribute("aria-current", "page");
      menu.appendChild(link);
    }
    category.append(button, menu);
    nav.appendChild(category);
  }
}

/** Closes any category flyouts that were pinned open by a click. */
function closeNavMenus(): void {
  const nav = document.querySelector<HTMLElement>("#nav");
  if (!nav) return;
  for (const category of nav.querySelectorAll<HTMLElement>(".nav-category.open")) {
    category.classList.remove("open");
    category.querySelector<HTMLElement>(".nav-category-btn")?.setAttribute("aria-expanded", "false");
  }
}

function setNavExpanded(category: HTMLElement, expanded: boolean): void {
  category.querySelector<HTMLElement>(".nav-category-btn")?.setAttribute("aria-expanded", expanded ? "true" : "false");
}

/** On narrow screens the flyout is fixed; anchor it under its category button. */
function positionNavMenu(category: HTMLElement): void {
  const button = category.querySelector<HTMLElement>(".nav-category-btn");
  if (!button) return;
  const rect = button.getBoundingClientRect();
  document.documentElement.style.setProperty("--nav-menu-top", `${Math.round(rect.bottom + 6)}px`);
}

/**
 * Wires the category navigation once. The bar is rebuilt on every route change,
 * so the handlers are delegated from the persistent `#nav` element: hover and
 * focus reveal a menu via CSS, while a click pins it open for touch.
 */
function wireNav(): void {
  const nav = document.querySelector<HTMLElement>("#nav");
  if (!nav || nav.dataset.wired === "true") return;
  nav.dataset.wired = "true";

  nav.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(".nav-category-btn");
    if (!button || button.classList.contains("nav-direct")) return;
    event.preventDefault();
    const category = button.closest<HTMLElement>(".nav-category");
    if (!category) return;
    const willOpen = !category.classList.contains("open");
    closeNavMenus();
    if (willOpen) {
      category.classList.add("open");
      setNavExpanded(category, true);
      positionNavMenu(category);
    }
  });

  nav.addEventListener("pointerover", (event) => {
    const category = (event.target as HTMLElement).closest<HTMLElement>(".nav-category");
    if (!category) return;
    positionNavMenu(category);
    setNavExpanded(category, true);
  });
  nav.addEventListener("pointerout", (event) => {
    const category = (event.target as HTMLElement).closest<HTMLElement>(".nav-category");
    if (!category || category.contains(event.relatedTarget as Node)) return;
    if (!category.classList.contains("open")) setNavExpanded(category, false);
  });
  nav.addEventListener("focusin", (event) => {
    const category = (event.target as HTMLElement).closest<HTMLElement>(".nav-category");
    if (category) setNavExpanded(category, true);
  });
  nav.addEventListener("focusout", (event) => {
    const category = (event.target as HTMLElement).closest<HTMLElement>(".nav-category");
    if (!category || category.contains(event.relatedTarget as Node)) return;
    if (!category.classList.contains("open")) setNavExpanded(category, false);
  });

  document.addEventListener("click", (event) => {
    if (!nav.contains(event.target as Node)) closeNavMenus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeNavMenus();
  });
}

// ─── Project context bar ──────────────────────────────────────────────────────

let projectsCache: ProjectsIndex | null = null;
let contextSwitcher: HTMLSelectElement | null = null;
let contextName: HTMLElement | null = null;
let contextRoot: HTMLElement | null = null;
let contextHarness: HTMLElement | null = null;
let contextLiveDot: HTMLElement | null = null;
let contextLiveLabel: HTMLElement | null = null;
let contextBuilt = false;

async function ensureProjects(force = false): Promise<ProjectsIndex | null> {
  if (!force && projectsCache) return projectsCache;
  try {
    projectsCache = await api.projects();
  } catch {
    projectsCache = { projects: [], current: null };
  }
  return projectsCache;
}

/** (Re)builds the switcher's options from the cached project list. */
function populateSwitcher(): void {
  if (!contextSwitcher) return;
  void ensureProjects().then((index) => {
    if (!contextSwitcher || !index) return;
    const currentPath = store.summary?.repoRoot ?? index.current ?? "";
    const placeholder = contextSwitcher.options[0];
    contextSwitcher.textContent = "";
    if (placeholder) contextSwitcher.appendChild(placeholder);
    for (const project of index.projects) {
      contextSwitcher.appendChild(el("option", { value: project.path }, project.name));
    }
    if (currentPath && !index.projects.some((project) => project.path === currentPath)) {
      contextSwitcher.appendChild(el("option", { value: currentPath }, store.summary?.repoName ?? currentPath));
    }
    contextSwitcher.value = currentPath;
  });
}

/**
 * Updates the context bar in place. The bar is built once and only its dynamic
 * values (name, root, harness, live state, switcher selection) are refreshed, so
 * a frequent snapshot never rebuilds the switcher and steals focus while a user
 * is interacting with it.
 */
function renderContextBar(): void {
  const host = document.querySelector<HTMLElement>("#contextbar-project");
  if (!host) return;

  if (!contextBuilt) {
    contextBuilt = true;
    const switcher = el("select", { className: "context-switcher", "aria-label": "Switch project" }) as HTMLSelectElement;
    switcher.appendChild(el("option", { value: "" }, "Switch project…"));
    switcher.addEventListener("change", () => {
      const path = switcher.value;
      if (!path) return;
      void api.selectRepo(path)
        .then((res) => {
          if (res.ok) {
            projectsCache = null;
            location.hash = "#/overview";
          } else {
            toast(res.message ?? "switch failed");
          }
        })
        .catch((err) => toast(err instanceof Error ? err.message : "switch failed"));
    });
    contextSwitcher = switcher;

    contextName = el("span", { className: "context-project-name" });
    contextRoot = el("span", { className: "context-project-root mono", hidden: true });
    contextHarness = el("span", { className: "badge", hidden: true });
    contextLiveDot = el("span", { className: "live-dot" });
    contextLiveLabel = el("span");
    const nameRoot = el("div", { className: "context-project" }, [contextName, contextRoot]);
    const live = el("span", { className: "live" }, [contextLiveDot, contextLiveLabel]);

    host.replaceChildren(switcher, nameRoot, contextHarness, live);
    populateSwitcher();
  }

  const summary = store.summary;
  if (contextName) contextName.textContent = summary?.repoName ?? "No project selected";
  if (contextRoot) {
    contextRoot.textContent = summary?.repoRoot ?? "";
    contextRoot.hidden = !summary;
  }
  if (contextHarness) {
    contextHarness.textContent = summary?.harness ?? "";
    contextHarness.hidden = !summary?.harness;
  }
  if (contextLiveDot) contextLiveDot.className = summary?.live ? "live-dot on" : "live-dot";
  if (contextLiveLabel) contextLiveLabel.textContent = summary ? (summary.live ? "Live" : "Idle") : "—";

  if (contextSwitcher) {
    const currentPath = summary?.repoRoot ?? "";
    if (!currentPath) {
      contextSwitcher.value = "";
    } else if (![...contextSwitcher.options].some((opt) => opt.value === currentPath)) {
      // A project not yet in the cached list (e.g. freshly created) — refetch.
      projectsCache = null;
      populateSwitcher();
    } else {
      contextSwitcher.value = currentPath;
    }
  }
}

// ─── Background-job badge ─────────────────────────────────────────────────────

let jobsBadge: HTMLElement | null = null;

/** Updates the persistent "N running / N failed" badge from the jobs summary. */
function renderJobsBadge(summary: JobsSummary): void {
  if (!jobsBadge) return;
  const running = summary.jobs.filter((job) => job.status === "running" || job.status === "paused");
  const failed = summary.jobs.filter((job) => job.status === "failed");
  const text = summary.failed > 0
    ? (summary.active > 0 ? `${summary.active} running · ${summary.failed} failed` : `${summary.failed} failed`)
    : (summary.active > 0 ? `${summary.active} running` : "");
  jobsBadge.hidden = text === "";
  if (!text) return;
  jobsBadge.textContent = text;
  jobsBadge.classList.toggle("jobs-badge-error", summary.failed > 0);
  jobsBadge.title = [...running, ...failed].map((job) => `${job.type}: ${job.message}`).join("\n");
}

// ─── Routing ──────────────────────────────────────────────────────────────────

function render(): void {
  const id = currentRouteId();
  const view = views.find((v) => v.id === id) ?? views[0]!;
  active?.unmount();
  active = view;
  renderNav(view.id);
  renderContextBar();
  document.body.dataset.view = view.id;
  const container = document.querySelector<HTMLElement>("#view");
  if (!container) return;
  container.textContent = "";
  view.render(container);
  activeProject = store.projectKey();
}

function connectEvents(): void {
  const es = new EventSource("/api/events");
  es.addEventListener("open", () => setConnectionState("connected"));
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
  es.addEventListener("authoring", (event: Event) => {
    const data = JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>;
    store.emitAuthoring(data);
  });
  es.addEventListener("jobs", (event: Event) => {
    const data = JSON.parse((event as MessageEvent).data as string) as JobsSummary;
    renderJobsBadge(data);
  });
  es.onerror = () => {
    setConnectionState("reconnecting");
  };
}

function setConnectionState(state: "connected" | "reconnecting"): void {
  const node = document.querySelector<HTMLElement>("#connection-status");
  if (!node) return;
  node.dataset.state = state;
  node.textContent = state === "connected" ? "Connected" : "Reconnecting…";
}

async function init(): Promise<void> {
  unsubscribeStore = store.subscribe(() => {
    renderContextBar();
    const route = currentRouteId();
    if (!store.summary && !NO_REPO_ROUTES.has(route)) {
      location.hash = "#/home";
      return;
    }
    if (store.projectKey() !== activeProject) {
      // Registry actions can change the current repo via SSE before their HTTP
      // response arrives. Keep this repo-independent view and its outcomes alive.
      if (active?.id === "projects" && route === "projects") {
        activeProject = store.projectKey();
        refreshProjectList();
      } else {
        render();
      }
      return;
    }
    active?.refresh?.();
  });

  // The inline script in index.html painted the cached palette already; mirror
  // the cached preference into module state, then reconcile with the saved
  // global settings so a change made in another browser session wins.
  applyTheme(readCachedThemePreference() ?? "auto", { persist: false });

  const [summary, settings] = await Promise.all([
    api.summary().catch(() => null),
    api.settings().catch(() => null),
  ]);
  store.setSummary(summary);
  if (settings) {
    applyTheme(parseThemePreference(settings.ui?.theme) ?? "auto");
  }

  connectEvents();

  // Category flyouts: wire once; the bar itself is rebuilt per route.
  wireNav();

  // Keep the "Terminal ●" nav marker in sync as a background session starts,
  // exits, or stops without a route change.
  onTerminalSessionChange(() => renderNav(currentRouteId()));

  // Help button + connection status (right side of the persistent context bar).
  const actions = document.querySelector<HTMLElement>("#contextbar-actions");
  if (actions && !actions.querySelector(".help-btn")) {
    const helpBtn = el("button", { className: "btn btn-sm help-btn" }, "Help");
    helpBtn.addEventListener("click", openHelp);
    actions.appendChild(helpBtn);
    actions.appendChild(elConnectionStatus());
  }

  // Background-job badge (right side of the context bar). Links to Projects,
  // which lists every project's job state; background jobs can belong to a repo
  // that is not yet the selected one.
  if (actions && !actions.querySelector(".jobs-badge")) {
    jobsBadge = el("a", {
      href: "#/projects",
      className: "btn btn-sm jobs-badge",
      role: "status",
      "aria-live": "polite",
      hidden: true,
    });
    actions.appendChild(jobsBadge);
    void api.jobs().then(renderJobsBadge).catch(() => {});
  }

  function elConnectionStatus(): HTMLElement {
    const node = document.createElement("span");
    node.id = "connection-status";
    node.className = "connection-status";
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    node.textContent = "Connecting…";
    return node;
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
