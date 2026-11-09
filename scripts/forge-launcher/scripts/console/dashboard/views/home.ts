// ─── Home: landing with create/open choices + recent projects ────────────────

import { api } from "../api.js";
import { selectProjectDestination } from "../project-navigation.js";
import { el, fmtTime, toast } from "../render/dom.js";
import type { ProjectsIndex } from "../types.js";

export function unmountHome(): void {
  // nothing to tear down
}

export function renderHome(container: HTMLElement): void {
  container.textContent = "";

  container.appendChild(
    el("section", { className: "home-hero", "aria-labelledby": "home-heading" }, [
      el("div", { className: "home-hero-copy" }, [
        el("h1", { id: "home-heading" }, "Start a Project from an Idea"),
        el("p", { className: "dim" }, "Create a new Project workspace, or pick up one you already have."),
      ]),
      el("a", { className: "btn btn-primary home-primary-action", href: "#/new" }, "Start with an idea"),
    ]),
  );

  container.appendChild(
    el("div", { className: "home-support-grid" }, [
      renderRecent(),
      el("section", { className: "panel home-support-card", "aria-labelledby": "home-existing-heading" }, [
        el("h2", { id: "home-existing-heading" }, "Working with an existing application?"),
        el("p", { className: "dim" }, "Open a Project or add Forge to an app without replacing its code."),
        el("div", { className: "home-support-actions" }, [
          el("a", { className: "btn", href: "#/projects" }, "Open a Project"),
          el("a", { className: "btn", href: "#/projects?bootstrap=1" }, "Set up an app"),
        ]),
      ]),
    ]),
  );
}

function renderRecent(): HTMLElement {
  const select = el("select", { className: "project-select", "aria-label": "Choose a recent Project" });
  const open = el("button", { className: "btn", disabled: true }, "Open");
  const meta = el("div", { className: "dim small" });
  let projectIndex: ProjectsIndex | null = null;

  select.appendChild(el("option", { value: "" }, "Loading projects…"));

  void api.projects().then((index: ProjectsIndex) => {
    projectIndex = index;
    select.textContent = "";
    if (index.projects.length === 0) {
      select.appendChild(el("option", { value: "" }, "No projects yet"));
      open.setAttribute("disabled", "");
      meta.textContent = "Start with an idea or open an existing folder to get started.";
      return;
    }
    for (const project of index.projects) {
      select.appendChild(
        el("option", { value: project.path }, `${project.name} — ${project.lifecycleState ?? project.stage}`),
      );
    }
    open.removeAttribute("disabled");
    const recent = index.projects[0]!;
    meta.textContent = recent.lastOpenedAt
      ? `Most recent: ${recent.name} (opened ${fmtTime(recent.lastOpenedAt)})`
      : `Most recent: ${recent.name}`;
  }).catch(() => {
    select.textContent = "";
    select.appendChild(el("option", { value: "" }, "Failed to load projects"));
    open.setAttribute("disabled", "");
  });

  open.addEventListener("click", () => {
    const path = (select as HTMLSelectElement).value;
    if (!path || !projectIndex) return;
    const project = projectIndex.projects.find((entry) => entry.path === path);
    if (!project) return;
    void selectProjectDestination(path, project.lifecycleState)
      .then((destination) => { location.hash = destination; })
      .catch((error: unknown) => toast(error instanceof Error ? error.message : "open failed"));
  });

  return el("section", { className: "panel home-support-card", "aria-labelledby": "home-recent-heading" }, [
    el("h2", { id: "home-recent-heading" }, "Recent Projects"),
    el("div", { className: "dropdown-row" }, [select, open]),
    meta,
  ]);
}
