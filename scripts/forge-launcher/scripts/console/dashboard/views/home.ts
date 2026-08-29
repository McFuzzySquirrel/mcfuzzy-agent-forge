// ─── Home: landing with create/open choices + recent projects ────────────────

import { api } from "../api.js";
import { el, fmtTime, toast } from "../render/dom.js";
import type { ProjectsIndex } from "../types.js";

export function unmountHome(): void {
  // nothing to tear down
}

export function renderHome(container: HTMLElement): void {
  container.textContent = "";

  container.appendChild(
    el("div", { className: "hero" }, [
      el("h1", null, "Forge Console"),
      el("p", { className: "dim" }, "Create a new MyForge project or open an existing one."),
    ]),
  );

  container.appendChild(
    el("div", { className: "action-cards" }, [
      actionCard(
        "Create a new project",
        "Start from an idea — sets up a repo, bootstraps the agent harness, and drafts the PRD and team.",
        "#/new",
        "Create new",
      ),
      actionCard(
        "Open an existing project",
        "Pick a forge repo to monitor its build, resume a run, or browse artifacts and docs.",
        "#/projects",
        "Open existing",
      ),
    ]),
  );

  container.appendChild(renderRecent());
}

function actionCard(title: string, desc: string, href: string, cta: string): HTMLElement {
  return el(
    "a",
    { className: "action-card", href },
    [
      el("h3", null, title),
      el("p", { className: "dim" }, desc),
      el("span", { className: "btn btn-primary" }, cta),
    ],
  );
}

function renderRecent(): HTMLElement {
  const select = el("select", { className: "project-select" });
  const open = el("button", { className: "btn", disabled: true }, "Open");
  const meta = el("div", { className: "dim small" });

  select.appendChild(el("option", { value: "" }, "Loading projects…"));

  void api.projects().then((index: ProjectsIndex) => {
    select.textContent = "";
    if (index.projects.length === 0) {
      select.appendChild(el("option", { value: "" }, "No projects yet"));
      open.setAttribute("disabled", "");
      meta.textContent = "Create a new project or add an existing folder to get started.";
      return;
    }
    for (const project of index.projects) {
      select.appendChild(
        el("option", { value: project.path }, `${project.name} — ${project.stage}`),
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
    if (!path) return;
    void api.selectRepo(path).then((res) => {
      if (res.ok) location.hash = "#/overview";
      else toast(res.message ?? "open failed");
    });
  });

  return el("div", { className: "panel" }, [
    el("h4", null, "Recent projects"),
    el("div", { className: "dropdown-row" }, [select, open]),
    meta,
  ]);
}
