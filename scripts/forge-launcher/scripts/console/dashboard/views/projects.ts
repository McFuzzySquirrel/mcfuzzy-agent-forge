// ─── Projects: open, register, and remove existing projects ──────────────────

import { api } from "../api.js";
import { el, fmtTime, toast } from "../render/dom.js";
import { AUTHORING_RUNNER_OPTIONS } from "../runners.js";
import type { ProjectInfo, ProjectRemovalResult, ProjectsIndex } from "../types.js";

interface ProjectsView {
  container: HTMLElement;
  rows: HTMLElement;
  meta: HTMLElement;
  outcomes: HTMLElement;
  selectAll: HTMLInputElement;
  removeSelected: HTMLButtonElement;
  selected: Set<string>;
  index: ProjectsIndex;
  results: Map<string, ProjectRemovalResult>;
  busy: boolean;
  request: number;
  bootstrapPoll?: number;
  bootstrapStop?: number;
  focusTimer?: number;
}

let activeView: ProjectsView | null = null;

export function refreshProjectList(): void {
  if (activeView && !activeView.busy) void refreshProjects(activeView);
}

export function unmountProjects(): void {
  if (activeView) {
    window.clearInterval(activeView.bootstrapPoll);
    window.clearTimeout(activeView.bootstrapStop);
    window.clearTimeout(activeView.focusTimer);
  }
  activeView = null;
}

export function renderProjects(container: HTMLElement): void {
  unmountProjects();
  container.textContent = "";

  container.appendChild(el("h1", null, "Open an existing project"));
  container.appendChild(
    el("p", { className: "dim" }, "Open a Forge project from your list, or add a folder you have on disk."),
  );

  const view: ProjectsView = {
    container,
    rows: el("tbody"),
    meta: el("div", { className: "dim small", role: "status" }),
    outcomes: el("div", { className: "project-outcomes", role: "status", "aria-live": "polite", "aria-atomic": "true" }),
    selectAll: el("input", { type: "checkbox", "aria-label": "Select all projects", disabled: true }) as HTMLInputElement,
    removeSelected: el("button", { type: "button", className: "btn btn-danger", disabled: true }, "Remove selected (0)") as HTMLButtonElement,
    selected: new Set(),
    index: { projects: [], current: null },
    results: new Map(),
    busy: false,
    request: 0,
  };
  activeView = view;
  view.selectAll.addEventListener("change", () => {
    if (view.busy) return;
    for (const project of view.index.projects) {
      if (view.selectAll.checked) view.selected.add(project.path);
      else view.selected.delete(project.path);
    }
    updateSelection(view);
  });
  view.removeSelected.addEventListener("click", () => void removeProjects(view, [...view.selected]));
  const list = el("div", { className: "panel" }, [
    el("h4", null, "Your projects"),
    el("div", { className: "project-toolbar" }, [view.removeSelected]),
    el("div", { className: "table-scroll", tabindex: "0", role: "region", "aria-label": "Your projects" },
      el("table", { className: "projects-table", "aria-label": "Registered projects" }, [
        el("thead", null, el("tr", null, [
          el("th", { scope: "col", className: "project-selection" }, el("label", { className: "project-select-all" }, [
            view.selectAll,
          ])),
          el("th", { scope: "col" }, "Name"),
          el("th", { scope: "col" }, "State"),
          el("th", { scope: "col" }, "Last accessed"),
          el("th", { scope: "col" }, "Actions"),
        ])),
        view.rows,
      ])),
    view.meta,
    view.outcomes,
  ]);

  container.appendChild(list);
  container.appendChild(buildAddFolder(view));
  container.appendChild(buildBootstrap(view));

  // Home links here with a query flag so the intended action is immediately
  // visible (rather than leaving the user to find it below the project list).
  if (new URLSearchParams(location.hash.split("?")[1] ?? "").get("bootstrap") === "1") {
    const form = container.querySelector<HTMLElement>("[data-bootstrap-form]");
    if (form) {
      form.scrollIntoView({ block: "center" });
      view.focusTimer = window.setTimeout(() => {
        if (activeView === view) form.querySelector<HTMLInputElement>("input[type=text]")?.focus();
      }, 0);
    }
  }

  void refreshProjects(view);
}

function buildBootstrap(view: ProjectsView): HTMLElement {
  const input = el("input", { type: "text", placeholder: "/path/to/existing repository", "aria-label": "Repository folder to bootstrap" });
  const harness = el("select", { "aria-label": "Bootstrap harness" }, [
    el("option", { value: "agents" }, "agents (.agents)"),
    el("option", { value: "github" }, "copilot (.github)"),
    el("option", { value: "claude" }, "claude (.claude)"),
    el("option", { value: "opencode" }, "opencode (.opencode)"),
  ]) as HTMLSelectElement;
  // Same axis as the wizard's select: `inherit` keeps the harness rule, any
  // other value is saved into the bootstrapped repository's authoring config.
  const runner = el("select", { id: "bootstrap-authoring-runner", "aria-label": "Authoring runner" },
    AUTHORING_RUNNER_OPTIONS.map(([value, label]) => el("option", { value }, label))) as HTMLSelectElement;
  const init = el("input", { type: "checkbox" });
  const force = el("input", { type: "checkbox" });
  const button = el("button", { className: "btn btn-primary" }, "Bootstrap repository");
  const status = el("div", { className: "dim small", role: "status" });
  button.addEventListener("click", () => {
    if (view.busy || activeView !== view) return;
    const target = (input as HTMLInputElement).value.trim();
    if (!target) { status.textContent = "Repository path is required."; return; }
    setBusy(view, true);
    status.textContent = "Starting bootstrap…";
    const chosenRunner = runner.value && runner.value !== "inherit" ? runner.value : undefined;
    void api.bootstrap({
      path: target,
      harness: harness.value,
      initGit: (init as HTMLInputElement).checked,
      force: (force as HTMLInputElement).checked,
      ...(chosenRunner ? { runner: chosenRunner } : {}),
    })
      .then((r) => {
        if (activeView !== view) return;
        status.textContent = r.ok ? `${r.message} Monitor the project stage for completion.` : `Bootstrap failed: ${r.message}`;
        toast(r.message);
        if (r.ok) {
          window.clearInterval(view.bootstrapPoll);
          window.clearTimeout(view.bootstrapStop);
          view.bootstrapPoll = window.setInterval(() => {
            if (!view.busy) void refreshProjects(view);
          }, 1500);
          view.bootstrapStop = window.setTimeout(() => {
            window.clearInterval(view.bootstrapPoll);
            view.bootstrapPoll = undefined;
          }, 30000);
        }
      })
      .catch((err) => {
        if (activeView !== view) return;
        const message = err instanceof Error ? err.message : "request failed";
        status.textContent = `Bootstrap failed: ${message}`;
        toast(message);
      })
      .finally(() => {
        if (activeView !== view) return;
        setBusy(view, false);
        void refreshProjects(view);
      });
  });
  return el("div", { className: "panel", "data-bootstrap-form": "true" }, [
    el("h4", null, "Bootstrap an existing repository"),
    el("p", { className: "dim small" }, "Copy the Forge harness and skills into a repository. This runs as a tracked background job."),
    el("div", { className: "dropdown-row" }, [input, harness, runner, button]),
    el("label", { className: "checkbox-row" }, [init, el("span", null, "Initialize git if needed")]),
    el("label", { className: "checkbox-row" }, [force, el("span", null, "Overwrite existing Forge files")]),
    status,
  ]);
}

async function openProject(view: ProjectsView, project: ProjectInfo): Promise<void> {
  if (view.busy || activeView !== view) return;
  setBusy(view, true);
  try {
    const res = await api.selectRepo(project.path);
    if (activeView !== view) return;
    if (res.ok) location.hash = "#/overview";
    else view.meta.textContent = `Could not open ${project.name}. Check that the folder is available and try again.`;
  } catch {
    if (activeView === view) view.meta.textContent = `Could not open ${project.name}. Check the Console connection and try again.`;
  } finally {
    if (activeView === view) setBusy(view, false);
  }
}

async function refreshProjects(view: ProjectsView): Promise<void> {
  if (activeView !== view) return;
  const request = ++view.request;
  view.meta.textContent = "Loading…";
  try {
    const index = await api.projects();
    if (activeView !== view || request !== view.request) return;
    view.index = index;
    const paths = new Set(index.projects.map((project) => project.path));
    for (const path of view.selected) if (!paths.has(path)) view.selected.delete(path);
    renderProjectRows(view);
    view.meta.textContent = index.projects.length
      ? `${index.projects.length} project${index.projects.length === 1 ? "" : "s"} on record.`
      : "Nothing here yet — create a new project or add an existing folder.";
  } catch {
    if (activeView === view && request === view.request) view.meta.textContent = "Failed to load projects. Reload this page to try again.";
  }
}

function renderProjectRows(view: ProjectsView): void {
  view.rows.textContent = "";
  for (const project of view.index.projects) {
    const checkbox = el("input", { type: "checkbox", "aria-label": `Select ${project.name}` }) as HTMLInputElement;
    checkbox.addEventListener("change", () => {
      if (view.busy) return;
      if (checkbox.checked) view.selected.add(project.path);
      else view.selected.delete(project.path);
      updateSelection(view);
    });
    const open = el("button", { type: "button", className: "btn btn-primary", "aria-label": `Open ${project.name}` }, "Open");
    open.addEventListener("click", () => void openProject(view, project));
    const remove = el("button", { type: "button", className: "btn btn-danger", "aria-label": `Remove ${project.name} from Forge` }, "Remove from Forge");
    remove.addEventListener("click", () => void removeProjects(view, [project.path]));
    view.rows.appendChild(el("tr", null, [
      el("td", { className: "project-selection" }, checkbox),
      el("th", { scope: "row", className: "project-name" }, `${project.name}${project.path === view.index.current ? " (current)" : ""}`),
      el("td", null, project.stage),
      el("td", null, project.lastOpenedAt
        ? el("time", { datetime: project.lastOpenedAt }, fmtTime(project.lastOpenedAt))
        : "Never opened"),
      el("td", null, el("div", { className: "project-actions" }, [open, remove])),
    ]));
  }
  updateSelection(view);
}

function updateSelection(view: ProjectsView): void {
  const count = view.selected.size;
  view.selectAll.checked = count > 0 && count === view.index.projects.length;
  view.selectAll.indeterminate = count > 0 && count < view.index.projects.length;
  view.selectAll.disabled = view.busy || view.index.projects.length === 0;
  view.removeSelected.textContent = `Remove selected (${count})`;
  view.removeSelected.disabled = view.busy || count === 0;
  view.rows.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((checkbox, i) => {
    checkbox.checked = view.selected.has(view.index.projects[i].path);
    checkbox.disabled = view.busy;
  });
  view.rows.querySelectorAll<HTMLButtonElement>("button").forEach((button) => { button.disabled = view.busy; });
}

function setBusy(view: ProjectsView, busy: boolean): void {
  view.busy = busy;
  // Invalidate any refresh started before a mutation so it cannot restore old rows.
  if (busy) view.request++;
  view.container.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")
    .forEach((control) => { control.disabled = busy; });
  updateSelection(view);
}

async function removeProjects(view: ProjectsView, paths: string[]): Promise<void> {
  if (view.busy || !paths.length || activeView !== view) return;
  const projects = view.index.projects.filter((project) => paths.includes(project.path));
  if (!projects.length) return;
  if (!window.confirm(
    `Remove ${projects.length === 1 ? projects[0].name : `${projects.length} selected projects`} from Forge?\n\n`
    + "This removes registry entries, Console job history, and verified external Forge job results only.\n\n"
    + "No files inside project folders will be changed or deleted.",
  )) return;
  setBusy(view, true);
  view.meta.textContent = "Removing from Forge…";
  try {
    const response = await api.removeProjects(projects.map((project) => project.path));
    if (activeView !== view) return;
    for (const result of response.results) {
      view.results.set(result.path, result);
      if (result.status === "removed") view.selected.delete(result.path);
    }
    const removed = new Set(response.results.filter((result) => result.status === "removed").map((result) => result.path));
    view.index = { current: response.current, projects: view.index.projects.filter((project) => !removed.has(project.path)) };
    renderProjectRows(view);
  } catch {
    if (activeView !== view) return;
    for (const project of projects) {
      view.results.set(project.path, {
        path: project.path, name: project.name, status: "failed",
        message: "The removal request could not be completed. Refresh the list before retrying.",
      });
    }
  } finally {
    if (activeView === view) {
      renderOutcomes(view);
      await refreshProjects(view);
      if (activeView === view) setBusy(view, false);
    }
  }
}

function renderOutcomes(view: ProjectsView): void {
  view.outcomes.textContent = "";
  if (!view.results.size) return;
  const labels = { removed: "Removed", blocked: "Blocked", failed: "Failed" };
  const messages = {
    removed: "Removed from Forge. Files inside the project folder were not changed.",
    blocked: "Not removed. Stop or wait for active Forge work before trying again.",
    failed: "Removal could not be completed. Check the Console connection and job history before trying again.",
  };
  view.outcomes.appendChild(el("h4", null, "Removal results"));
  // Server errors can contain filesystem paths. Keep this project list name-only.
  view.outcomes.appendChild(el("ul", null, [...view.results.values()].map((result) =>
    el("li", { className: `project-outcome project-outcome-${result.status}` }, [
      el("strong", null, `${result.name}: ${labels[result.status]}. `),
      el("span", null, result.message && !/[\\/]|\b[A-Za-z]:/.test(result.message)
        ? result.message
        : messages[result.status]),
    ]),
  )));
}

function buildAddFolder(view: ProjectsView): HTMLElement {
  const input = el("input", { type: "text", placeholder: "/absolute/path/to/forge/repo", "aria-label": "Existing project folder" });
  const button = el("button", { className: "btn" }, "Add folder");

  button.addEventListener("click", () => {
    if (view.busy || activeView !== view) return;
    const path = (input as HTMLInputElement).value.trim();
    if (!path) return;
    setBusy(view, true);
    void (async () => {
      try {
        const res = await api.addRepo(path);
        if (activeView !== view) return;
        toast(res.ok ? "Folder added." : (res.message ?? "add failed"));
        if (res.ok) await refreshProjects(view);
      } catch (err) {
        if (activeView === view) toast(err instanceof Error ? err.message : "add failed");
      } finally {
        if (activeView === view) setBusy(view, false);
      }
    })();
  });

  return el("div", { className: "panel" }, [
    el("h4", null, "Add an existing folder"),
    el("div", { className: "dropdown-row" }, [input, button]),
  ]);
}
