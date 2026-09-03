// ─── Projects: open an existing project (dropdown picker + add folder) ───────

import { api } from "../api.js";
import { el, fmtTime, toast } from "../render/dom.js";
import type { ProjectInfo, ProjectsIndex } from "../types.js";

let select: HTMLSelectElement | null = null;
let meta: HTMLElement | null = null;

export function unmountProjects(): void {
  select = null;
  meta = null;
}

export function renderProjects(container: HTMLElement): void {
  unmountProjects();
  container.textContent = "";

  container.appendChild(el("h1", null, "Open an existing project"));
  container.appendChild(
    el("p", { className: "dim" }, "Select a forge repo from your list, or add a folder you have on disk."),
  );

  const list = el("div", { className: "panel" }, [
    el("h4", null, "Your projects"),
    el("div", { className: "dropdown-row" }, [
      (select = el("select", { className: "project-select" }) as HTMLSelectElement),
      el("button", { className: "btn btn-primary" }, "Open"),
    ]),
    (meta = el("div", { className: "dim small" })),
  ]);
  const openBtn = list.querySelector<HTMLElement>("button");
  if (openBtn) openBtn.addEventListener("click", () => openSelected());

  container.appendChild(list);
  container.appendChild(buildAddFolder());
  container.appendChild(buildBootstrap());

  void refreshProjects();
}

function buildBootstrap(): HTMLElement {
  const input = el("input", { type: "text", placeholder: "/path/to/existing repository" });
  const init = el("input", { type: "checkbox" });
  const force = el("input", { type: "checkbox" });
  const button = el("button", { className: "btn btn-primary" }, "Bootstrap repository");
  button.addEventListener("click", () => void api.bootstrap({ path: (input as HTMLInputElement).value.trim(), initGit: (init as HTMLInputElement).checked, force: (force as HTMLInputElement).checked }).then((r) => toast(r.message)));
  return el("div", { className: "panel" }, [
    el("h4", null, "Bootstrap an existing repository"),
    el("p", { className: "dim small" }, "Copy the Forge harness and skills into a repository. This runs as a tracked background job."),
    el("div", { className: "dropdown-row" }, [input, button]),
    el("label", { className: "checkbox-row" }, [init, el("span", null, "Initialize git if needed")]),
    el("label", { className: "checkbox-row" }, [force, el("span", null, "Overwrite existing Forge files")]),
  ]);
}

function openSelected(): void {
  const path = select?.value;
  if (!path) return;
  void api.selectRepo(path).then((res) => {
    if (res.ok) location.hash = "#/overview";
    else toast(res.message ?? "open failed");
  });
}

async function refreshProjects(): Promise<void> {
  if (!select || !meta) return;
  select.textContent = "";
  meta.textContent = "Loading…";
  try {
    const index = await api.projects();
    renderProjectOptions(index);
  } catch {
    meta.textContent = "Failed to load projects.";
  }
}

function renderProjectOptions(index: ProjectsIndex): void {
  if (!select || !meta) return;
  select.textContent = "";

  if (index.projects.length === 0) {
    select.appendChild(el("option", { value: "" }, "No projects yet"));
    meta.textContent = "Nothing here yet — create a new project or add an existing folder.";
    return;
  }

  const currentPath = index.current;
  let currentSelected = false;
  for (const project of index.projects) {
    const isCurrent = project.path === currentPath;
    const label = `${project.name} — ${project.stage}${isCurrent ? "  (current)" : ""}`;
    select.appendChild(el("option", { value: project.path, selected: isCurrent }, label));
    if (isCurrent) currentSelected = true;
  }
  if (!currentSelected && index.projects[0]) {
    select.value = index.projects[0].path;
  }
  meta.textContent = `${index.projects.length} project${index.projects.length === 1 ? "" : "s"} on record.`;
  void describeSelection(index.projects);
}

function describeSelection(projects: ProjectInfo[]): void {
  if (!select || !meta) return;
  const selected = projects.find((p) => p.path === select!.value);
  if (!selected) return;
  const opened = selected.lastOpenedAt ? `last opened ${fmtTime(selected.lastOpenedAt)}` : "never opened";
  meta.textContent = `${projects.length} project${projects.length === 1 ? "" : "s"} — selected: ${selected.name} (${selected.stage}, ${opened})`;
}

function buildAddFolder(): HTMLElement {
  const input = el("input", { type: "text", placeholder: "/absolute/path/to/forge/repo" });
  const button = el("button", { className: "btn" }, "Add folder");

  button.addEventListener("click", () => {
    const path = (input as HTMLInputElement).value.trim();
    if (!path) return;
    void (async () => {
      try {
        const res = await api.addRepo(path);
        toast(res.ok ? "Folder added." : (res.message ?? "add failed"));
        if (res.ok) void refreshProjects();
      } catch (err) {
        toast(err instanceof Error ? err.message : "add failed");
      }
    })();
  });

  return el("div", { className: "panel" }, [
    el("h4", null, "Add an existing folder"),
    el("div", { className: "dropdown-row" }, [input, button]),
  ]);
}
