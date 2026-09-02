// ─── New project: wizard that creates a repo via the launcher ────────────────

import { api } from "../api.js";
import { el, toast } from "../render/dom.js";
import type { CreateProjectRequest, ProjectInfo } from "../types.js";

let createRepoDir: string | null = null;
let createPoll: number | undefined;

export function unmountNew(): void {
  if (createPoll !== undefined) {
    window.clearInterval(createPoll);
    createPoll = undefined;
  }
}

export function renderNew(container: HTMLElement): void {
  container.textContent = "";
  container.appendChild(el("h1", null, "New project"));
  container.appendChild(el("p", { className: "dim" }, "Creates the repo and bootstraps MyForge, then drafts the PRD and agent team."));
  container.appendChild(buildForm());
  if (createRepoDir) {
    const host = el("div");
    container.appendChild(host);
    void renderCreateStatus(host, createRepoDir);
  }
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
  const concurrency = el("input", { type: "number", placeholder: "1 (optional)", min: "1" });
  const idea = el("textarea", { rows: "5", placeholder: "Describe the project idea…" });
  const autoDraft = el("input", { type: "checkbox" });

  // ── Project documents (PRD + research/seed) ──────────────────────────────
  // Mirrors the CLI's Step 6 (addPrdAndResearch): both a file-picker browse and
  // an absolute-path input. Picked files are uploaded to the server; paths are
  // validated and copied. Either way the docs land in docs/PRD.md / docs/research/
  // and inform the later PRD build (forge-auto-build-prd reads docs/research/).
  const prdPicker = buildFilePicker(".md,.txt", false);
  const researchPicker = buildFilePicker(".md,.txt,.pdf,.docx", true);
  const prdPath = el("input", { type: "text", placeholder: "…or an absolute path to a PRD file" });
  const researchPaths = el("input", { type: "text", placeholder: "…or comma-separated absolute paths" });

  const submit = el("button", { className: "btn btn-primary", type: "submit" }, "Create project");
  const cancel = el("a", { className: "btn", href: "#/home" }, "Cancel");

  const form = el("form", null, [
    el("div", { className: "form-row" }, [field("Name", name), field("Harness", harness), field("Visibility", visibility)]),
    field("Description", description),
    field("Parent directory", parentDir),
    field("Concurrency (parallel agents)", concurrency),
    field("Idea", idea),
    el("div", { className: "doc-section" }, [
      el("h4", null, "Project documents (optional, recommended)"),
      field("Existing PRD", prdPicker.root),
      field("", prdPath),
      field("Research / seed documents", researchPicker.root),
      field("", researchPaths),
      el("p", { className: "dim small" }, "Research and seed docs (design specs, market research, technical notes) are copied to docs/research/ and give the PRD build extra context. An existing PRD is used as-is instead of drafting from the idea."),
    ]),
    el("label", { className: "checkbox-row" }, [autoDraft, el("span", null, "Auto-run setup after creation (draft PRD + generate team)")]),
    el("div", { className: "actions" }, [submit, cancel]),
  ]);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitNewProject({
      name: (name as HTMLInputElement).value.trim(),
      description: (description as HTMLInputElement).value.trim() || undefined,
      harness: (harness as HTMLSelectElement).value,
      visibility: (visibility as HTMLSelectElement).value,
      parentDir: (parentDir as HTMLInputElement).value.trim() || undefined,
      concurrency: Number((concurrency as HTMLInputElement).value) || undefined,
      idea: (idea as HTMLTextAreaElement).value,
      autoDraft: (autoDraft as HTMLInputElement).checked,
      prdFile: prdPicker.input.files,
      prdPath: (prdPath as HTMLInputElement).value.trim() || undefined,
      researchFiles: researchPicker.input.files,
      researchPaths: (researchPaths as HTMLInputElement).value.trim() || undefined,
    });
  });

  return el("div", { className: "panel" }, [form]);
}

interface FilePicker {
  root: HTMLElement;
  input: HTMLInputElement;
}

/** A styled "Browse…" button that opens a hidden native file picker. */
function buildFilePicker(accept: string, multiple: boolean): FilePicker {
  const input = el("input", { type: "file", accept, className: "file-input-hidden" }) as HTMLInputElement;
  if (multiple) input.setAttribute("multiple", "true");
  const status = el("span", { className: "file-name" }, "No file selected");
  const browse = el("button", { className: "btn", type: "button" }, "Browse…");
  browse.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const files = input.files;
    if (!files || files.length === 0) {
      status.textContent = "No file selected";
    } else if (multiple) {
      status.textContent = `${files.length} file${files.length === 1 ? "" : "s"} selected`;
    } else {
      status.textContent = files[0]!.name;
    }
  });
  const root = el("div", { className: "file-pick" }, [browse, status]);
  return { root, input };
}

function field(label: string, control: HTMLElement): HTMLElement {
  return el("div", { className: "field" }, [el("label", null, label), control]);
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  });
}

/** Uploads picked files to the server, returning their staged paths. */
async function uploadPicked(files: FileList | null, label: string): Promise<string[]> {
  const paths: string[] = [];
  if (!files || files.length === 0) return paths;
  for (const file of Array.from(files)) {
    const content = await readFileAsText(file);
    if (!content.trim()) continue;
    const res = await api.upload(file.name, content);
    if (!res.ok || !res.path) {
      toast(`${label}: failed to stage ${file.name}`);
      continue;
    }
    paths.push(res.path);
  }
  return paths;
}

function splitPaths(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

async function submitNewProject(req: {
  name: string;
  description?: string;
  harness?: string;
  visibility?: string;
  parentDir?: string;
  concurrency?: number;
  idea: string;
  autoDraft?: boolean;
  prdFile: FileList | null;
  prdPath?: string;
  researchFiles: FileList | null;
  researchPaths?: string;
}): Promise<void> {
  if (!req.name || !req.idea) {
    toast("Name and idea are required.");
    return;
  }

  // Stage any picked files first (the server returns paths it can copy from).
  let prdPath = req.prdPath;
  let researchPaths = splitPaths(req.researchPaths);
  try {
    const stagedPrd = await uploadPicked(req.prdFile, "PRD");
    if (stagedPrd.length > 0) prdPath = stagedPrd[0];
    researchPaths = [...researchPaths, ...(await uploadPicked(req.researchFiles, "Research"))];
  } catch (err) {
    toast(err instanceof Error ? err.message : "failed to stage files");
    return;
  }

  const payload: CreateProjectRequest = {
    name: req.name,
    description: req.description,
    harness: req.harness,
    visibility: req.visibility,
    parentDir: req.parentDir,
    idea: req.idea,
    autoDraft: req.autoDraft,
    concurrency: req.concurrency && req.concurrency > 0 ? req.concurrency : undefined,
  };
  if (prdPath) payload.prdPath = prdPath;
  if (researchPaths.length > 0) payload.researchPaths = researchPaths;

  try {
    const res = await api.createProject(payload);
    if (!res.ok) {
      toast(res.message || "creation failed");
      return;
    }
    toast(res.message);
    if (res.repoDir) {
      createRepoDir = res.repoDir;
      const view = document.querySelector<HTMLElement>("#view");
      const host = view ? el("div") : null;
      if (host && view) {
        view.appendChild(host);
        void renderCreateStatus(host, res.repoDir);
      }
    }
  } catch (err) {
    toast(err instanceof Error ? err.message : "creation failed");
  }
}

async function renderCreateStatus(host: HTMLElement, repoDir: string): Promise<void> {
  const project = await lookupProject(repoDir);
  const running = project?.job?.status === "running";
  const message = project?.job?.message ?? "Project creation started in the background.";
  let panel = host.querySelector<HTMLElement>(".create-status-panel");
  if (!panel) {
    panel = el("div", { className: "panel hint create-status-panel" }, [
      el("strong", { className: "create-status-title" }, "Background progress"),
      el("div", { className: "mono small", style: "margin:6px 0" }, repoDir),
      el("div", { className: "spinner-row create-status-spinner" }, [
        el("span", { className: "spinner", "aria-hidden": "true" }),
        el("span", { className: "dim small" }, "Still running…"),
      ]),
      el("p", { className: "create-status-message dim" }, `${project?.stage ?? "creating"} — ${message}`),
      el("div", { className: "actions" }, [
        el("button", { className: "btn btn-primary", disabled: project ? null : true }, "Select this project"),
        el("a", { className: "btn", href: "#/projects" }, "View projects"),
      ]),
    ]);
    const selectBtn = panel.querySelector<HTMLElement>("button");
    if (selectBtn) {
      selectBtn.addEventListener("click", () => {
        void api.selectRepo(repoDir).then((r) => {
          if (r.ok) location.hash = "#/overview";
          else toast(r.message ?? "select failed");
        });
      });
    }
    host.textContent = "";
    host.appendChild(panel);
  }

  const title = panel.querySelector<HTMLElement>(".create-status-title");
  const status = panel.querySelector<HTMLElement>(".create-status-message");
  const spinner = panel.querySelector<HTMLElement>(".create-status-spinner");
  const selectBtn = panel.querySelector<HTMLButtonElement>("button");
  if (title) title.textContent = running ? "Background progress" : "Background result";
  if (status) {
    status.className = project?.job?.status === "failed" ? "create-status-message error-text" : "create-status-message dim";
    status.textContent = `${project?.stage ?? "creating"} — ${message}`;
  }
  if (spinner) spinner.style.display = running ? "" : "none";
  if (selectBtn) selectBtn.disabled = !project;

  if (createPoll !== undefined) window.clearInterval(createPoll);
  if (running) {
    createPoll = window.setInterval(() => void renderCreateStatus(host, repoDir), 2000);
  }
}

async function lookupProject(repoDir: string): Promise<ProjectInfo | null> {
  try {
    const index = await api.projects();
    return index.projects.find((project) => project.path === repoDir) ?? null;
  } catch {
    return null;
  }
}
