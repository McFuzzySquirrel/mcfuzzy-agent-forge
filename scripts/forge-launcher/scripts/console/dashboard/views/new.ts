// ─── New project: wizard that creates a repo via the launcher ────────────────

import { api } from "../api.js";
import { el, toast } from "../render/dom.js";
import type { CreateProjectRequest } from "../types.js";

export function unmountNew(): void {
  // nothing to tear down
}

export function renderNew(container: HTMLElement): void {
  container.textContent = "";
  container.appendChild(el("h1", null, "New project"));
  container.appendChild(el("p", { className: "dim" }, "Creates the repo and bootstraps MyForge, then drafts the PRD and agent team."));
  container.appendChild(buildForm());
}

function buildForm(): HTMLElement {
  const name = el("input", { type: "text", placeholder: "my-project" });
  const description = el("input", { type: "text", placeholder: "Short description (optional)" });
  const harness = el("select", null, [
    el("option", { value: "opencode" }, "opencode"),
    el("option", { value: "github" }, "github"),
    el("option", { value: "claude" }, "claude"),
    el("option", { value: "agents" }, "agents"),
  ]);
  const visibility = el("select", null, [
    el("option", { value: "private" }, "private"),
    el("option", { value: "public" }, "public"),
  ]);
  const parentDir = el("input", { type: "text", placeholder: "/path/to/parent (optional)" });
  const idea = el("textarea", { rows: "5", placeholder: "Describe the project idea…" });
  const autoDraft = el("input", { type: "checkbox" });

  const submit = el("button", { className: "btn btn-primary", type: "submit" }, "Create project");
  const cancel = el("a", { className: "btn", href: "#/home" }, "Cancel");

  const form = el("form", null, [
    el("div", { className: "form-row" }, [field("Name", name), field("Harness", harness), field("Visibility", visibility)]),
    field("Description", description),
    field("Parent directory", parentDir),
    field("Idea", idea),
    el("label", { className: "checkbox-row" }, [autoDraft, el("span", null, "Auto-draft PRD after creation")]),
    el("div", { className: "actions" }, [submit, cancel]),
  ]);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const req: CreateProjectRequest = {
      name: (name as HTMLInputElement).value.trim(),
      description: (description as HTMLInputElement).value.trim() || undefined,
      harness: (harness as HTMLSelectElement).value,
      visibility: (visibility as HTMLSelectElement).value,
      parentDir: (parentDir as HTMLInputElement).value.trim() || undefined,
      idea: (idea as HTMLTextAreaElement).value,
      autoDraft: (autoDraft as HTMLInputElement).checked,
    };
    void submitNewProject(req);
  });

  return el("div", { className: "panel" }, [form]);
}

function field(label: string, control: HTMLElement): HTMLElement {
  return el("div", { className: "field" }, [el("label", null, label), control]);
}

async function submitNewProject(req: CreateProjectRequest): Promise<void> {
  if (!req.name || !req.idea) {
    toast("Name and idea are required.");
    return;
  }
  try {
    const res = await api.createProject(req);
    if (!res.ok) {
      toast(res.message || "creation failed");
      return;
    }
    toast(res.message);
    if (res.repoDir) {
      const panel = el("div", { className: "panel hint" }, [
        el("strong", null, "Project creation started."),
        el("div", { className: "mono small", style: "margin:6px 0" }, res.repoDir),
        el("button", { className: "btn btn-primary" }, "Select this project"),
      ]);
      const selectBtn = panel.querySelector<HTMLElement>("button");
      if (selectBtn) {
        selectBtn.addEventListener("click", () => {
          void api.selectRepo(res.repoDir!).then((r) => {
            if (r.ok) location.hash = "#/overview";
            else toast(r.message ?? "select failed");
          });
        });
      }
      const forms = document.querySelectorAll<HTMLElement>("#view .panel");
      const last = forms[forms.length - 1];
      if (last) last.after(panel);
    }
  } catch (err) {
    toast(err instanceof Error ? err.message : "creation failed");
  }
}
