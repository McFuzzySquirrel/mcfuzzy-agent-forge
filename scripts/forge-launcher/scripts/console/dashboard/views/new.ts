// ─── New project: wizard that creates a repo via the launcher ────────────────

import { api } from "../api.js";
import { store } from "../state.js";
import { el, toast } from "../render/dom.js";
import { AUTHORING_RUNNER_OPTIONS, effectiveRunner } from "../runners.js";
import { initialProjectToolChoice, initializeGuidedAuthoring, suggestProjectName } from "../project-authoring.js";
import type { AuthoringConfig, CreateProjectRequest, ProjectInfo } from "../types.js";

let createRepoDir: string | null = null;
let createPoll: number | undefined;
let submitting = false;

export function unmountNew(): void {
  if (createPoll !== undefined) {
    window.clearInterval(createPoll);
    createPoll = undefined;
  }
  submitting = false;
}

export function renderNew(container: HTMLElement): void {
  container.textContent = "";
  container.appendChild(el("h1", null, "Start with an idea"));
  container.appendChild(el("p", { className: "dim" }, "Create a Project workspace first. Then explore your Idea and work through an interactive Project-brief authoring session."));
  container.appendChild(buildForm());
  if (createRepoDir) {
    const host = el("div");
    container.appendChild(host);
    void renderCreateStatus(host, createRepoDir);
  }
}

function buildForm(): HTMLElement {
  const name = el("input", { type: "text", placeholder: "A suggested name will appear from your Idea", required: true });
  const description = el("input", { type: "text", placeholder: "Short description (optional)" });
  const harness = el("select", null, [
    el("option", { value: "" }, "Choose an AI coding tool"),
    el("option", { value: "opencode" }, "OpenCode"),
    el("option", { value: "github" }, "GitHub Copilot"),
    el("option", { value: "claude" }, "Claude Code"),
    el("option", { value: "agents" }, "Other compatible agent setup"),
  ]) as HTMLSelectElement;
  harness.required = true;
  const visibility = el("select", null, [
    el("option", { value: "private" }, "private"),
    el("option", { value: "public" }, "public"),
  ]);
  const parentDir = el("input", { type: "text", placeholder: "/path/to/parent (optional)" });
  const concurrency = el("input", { type: "number", placeholder: "1 (optional)", min: "1" });
  const idea = el("textarea", { rows: "5", placeholder: "What would you like to build? It is fine if some details are still unknown.", required: true });

  const prdPicker = buildFilePicker(".md,.txt", false);
  const researchPicker = buildFilePicker(".md,.txt", true);
  const prdPath = el("input", { type: "text", placeholder: "…or an absolute path to a PRD file" });
  const researchPaths = el("input", { type: "text", placeholder: "…or comma-separated absolute paths" });
  const authoring = buildAuthoringControls(harness as HTMLSelectElement);

  const submit = el("button", { className: "btn btn-primary", type: "submit" }, "Create Project workspace") as HTMLButtonElement;
  const cancel = el("a", { className: "btn", href: "#/home" }, "Cancel");

  const form = el("form", null, [
    field("Your Idea", idea),
    field("Suggested Project name (editable)", name),
    field("AI coding tool", harness),
    el("p", { className: "dim small" }, "The configured default is selected when available. Choose a tool to continue if no default is configured."),
    el("details", { className: "collapsible" }, [
      el("summary", null, "Advanced setup (optional)"),
      el("div", { className: "doc-section" }, [
        field("Description", description),
        field("Project visibility", visibility),
        field("Parent directory", parentDir),
        field("Concurrency (parallel tasks)", concurrency),
        el("h4", null, "Project documents (optional)"),
        field("Existing PRD as source material", prdPicker.root),
        field("PRD source path", prdPath),
        field("Research / seed documents", researchPicker.root),
        field("Research source paths", researchPaths),
        el("p", { className: "dim small" }, "These documents provide context for your interactive authoring sessions; they do not replace Idea exploration or Project-brief authoring."),
        authoring.root,
      ]),
    ]),
    el("p", { className: "dim small" }, "Both Idea exploration and Project-brief authoring are interactive. You can leave unknown details as open questions and return to your saved Project."),
    el("div", { className: "actions" }, [submit, cancel]),
  ]);
  const project = store.projectKey();
  let nameEdited = false;
  for (const [key, control] of [["name", name], ["description", description], ["parentDir", parentDir], ["idea", idea], ["prdPath", prdPath], ["researchPaths", researchPaths]] as const) {
    const input = control as HTMLInputElement | HTMLTextAreaElement;
    input.value = store.getDraft(project, key, "");
    input.addEventListener("input", () => store.setDraft(project, key, input.value));
  }
  nameEdited = Boolean((name as HTMLInputElement).value);
  const ideaInput = idea as HTMLTextAreaElement;
  const nameInput = name as HTMLInputElement;
  if (!nameEdited && ideaInput.value.trim()) nameInput.value = suggestProjectName(ideaInput.value);
  ideaInput.addEventListener("input", () => {
    if (nameEdited) return;
    nameInput.value = suggestProjectName(ideaInput.value);
    store.setDraft(project, "name", nameInput.value);
  });
  nameInput.addEventListener("input", () => { nameEdited = true; });
  const configuredTool = store.getDraft(project, "harness", "");
  if (configuredTool) harness.value = configuredTool;
  harness.addEventListener("change", () => store.setDraft(project, "harness", harness.value));

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    submit.disabled = true;
    void submitNewProject({
      name: (name as HTMLInputElement).value.trim(),
      description: (description as HTMLInputElement).value.trim() || undefined,
      harness: harness.value,
      visibility: (visibility as HTMLSelectElement).value,
      parentDir: (parentDir as HTMLInputElement).value.trim() || undefined,
      concurrency: Number((concurrency as HTMLInputElement).value) || undefined,
      idea: (idea as HTMLTextAreaElement).value,
      prdFile: prdPicker.input.files,
      prdPath: (prdPath as HTMLInputElement).value.trim() || undefined,
      researchFiles: researchPicker.input.files,
      researchPaths: (researchPaths as HTMLInputElement).value.trim() || undefined,
      authoringConfig: authoring.getConfig(),
    }).finally(() => {
      submitting = false;
      submit.disabled = false;
    });
  });

  void prefillFromSettings(harness, concurrency as HTMLInputElement, authoring.runner);

  return el("div", { className: "panel" }, [form]);
}

/** Applies system-level defaults (harness, concurrency, authoring runner) to the wizard. */
async function prefillFromSettings(harness: HTMLSelectElement, concurrency: HTMLInputElement, runner: HTMLSelectElement): Promise<void> {
  try {
    const settings = await api.settings();
    const configuredTool = initialProjectToolChoice(settings.harness);
    if (configuredTool && !store.getDraft(store.projectKey(), "harness", "")) {
      harness.value = configuredTool;
      store.setDraft(store.projectKey(), "harness", configuredTool);
      harness.dispatchEvent(new Event("change"));
    }
    if (settings.execution?.concurrency && !concurrency.value) {
      concurrency.value = String(settings.execution.concurrency);
    }
    if (settings.authoring?.runner && (!runner.value || runner.value === "inherit")) {
      runner.value = settings.authoring.runner;
      runner.dispatchEvent(new Event("change"));
    }
  } catch {
    // Global settings are best-effort; keep the form defaults on failure.
  }
}

interface AuthoringControls {
  root: HTMLElement;
  getConfig: () => AuthoringConfig;
  runner: HTMLSelectElement;
}

function buildAuthoringControls(harness: HTMLSelectElement): AuthoringControls {
  const stages = [
    ["prd", "PRD authoring model"],
    ["team", "Team authoring model"],
    ["skills", "Skills authoring model"],
  ] as const;
  const selects = new Map<string, HTMLSelectElement>();
  const status = el("div", { className: "dim small", role: "status", "aria-live": "polite" }, "Choose a supported harness to load models.");
  const refresh = el("button", { className: "btn btn-sm", type: "button" }, "Refresh models");
  const runnerSelect = el("select", { id: "new-authoring-runner", "aria-label": "Authoring runner" }, AUTHORING_RUNNER_OPTIONS.map(([value, label]) => el("option", { value }, label))) as HTMLSelectElement;
  const project = store.projectKey();
  runnerSelect.value = store.getDraft(project, "runner", "inherit");
  let requestId = 0;

  const load = async (force: boolean): Promise<void> => {
    const selectedHarness = harness.value;
    if (!selectedHarness) {
      status.textContent = "Choose an AI coding tool to load model choices.";
      return;
    }
    const runner = effectiveRunner(runnerSelect.value, selectedHarness);
    const id = ++requestId;
    status.textContent = force ? "Refreshing authoring models…" : "Loading authoring models…";
    for (const select of selects.values()) select.disabled = true;
    try {
      const inventory = force
        ? await api.refreshAuthoringInventory(runner)
        : await api.authoringInventory(runner);
      if (id !== requestId) return;
      for (const [stage, select] of selects) {
        const previous = select.value;
        const available = new Set(inventory.models.map((model) => model.id));
        select.replaceChildren(
          el("option", { value: "" }, "Inherit runner default"),
          ...(previous && !available.has(previous)
            ? [el("option", { value: previous }, `Unavailable for ${selectedHarness}: ${previous}`)]
            : []),
          ...inventory.models.map((model) => el("option", { value: model.id }, model.provider ? `${model.id} (${model.provider})` : model.id)),
        );
        if (previous) select.value = previous;
        select.disabled = false;
        select.setAttribute("aria-label", `${stage} authoring model`);
      }
      status.textContent = inventory.models.length > 0
        ? `${inventory.models.length} authoring models available${inventory.last_verified ? ` · verified ${inventory.last_verified}` : ""}.`
        : (inventory.diagnostics?.join(" ") || "No models reported; selections inherit the runner default.");
    } catch (error) {
      if (id !== requestId) return;
      status.textContent = error instanceof Error ? `Unable to load authoring models: ${error.message}` : "Unable to load authoring models.";
    }
  };
  refresh.addEventListener("click", () => void load(true));
  harness.addEventListener("change", () => void load(false));
  runnerSelect.addEventListener("change", () => {
    store.setDraft(project, "runner", runnerSelect.value);
    void load(false);
  });
  for (const [stage, label] of stages) {
    const select = el("select", { id: `new-authoring-model-${stage}`, disabled: true, "aria-label": label }) as HTMLSelectElement;
    select.appendChild(el("option", { value: "" }, "Inherit runner default"));
    selects.set(stage, select);
  }
  void load(false);
  return {
    runner: runnerSelect,
    root: el("div", { className: "doc-section authoring-config" }, [
      el("h4", null, "Authoring models"),
      el("p", { className: "dim small" }, "Optional per-stage models for PRD, team, and project-skill authoring. Empty selections inherit the selected runner default."),
      el("div", { className: "field" }, [el("label", { for: "new-authoring-runner" }, "Authoring runner"), runnerSelect]),
      ...stages.map(([stage, label]) => el("div", { className: "field" }, [el("label", { for: `new-authoring-model-${stage}` }, label), selects.get(stage)!])),
      el("div", { className: "row gap wrap" }, [refresh, status]),
    ]),
    getConfig: () => {
      const config = {
        version: 1,
        models: Object.fromEntries([...selects].map(([stage, select]) => [stage, select.value || "inherit"])),
      } as AuthoringConfig;
      if (runnerSelect.value && runnerSelect.value !== "inherit") config.runner = runnerSelect.value as NonNullable<AuthoringConfig["runner"]>;
      return config;
    },
  };
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

export function validateTextUpload(file: Pick<File, "name" | "type">, label: string): void {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  const supportedExtensions = new Set([".md", ".txt"]);
  if (!supportedExtensions.has(extension)) {
    throw new Error(`${label}: ${file.name} is not a supported text file. Choose a .md or .txt file.`);
  }
  const type = file.type.toLowerCase();
  const supportedTypes = new Set(["", "text/plain", "text/markdown", "application/x-markdown"]);
  if (!supportedTypes.has(type) && !type.startsWith("text/")) {
    throw new Error(`${label}: ${file.name} reports an unsupported MIME type (${file.type}). Choose a plain-text or Markdown file.`);
  }
}

/** Uploads picked files to the server, returning their staged paths. */
async function uploadPicked(files: FileList | null, label: string): Promise<string[]> {
  const paths: string[] = [];
  if (!files || files.length === 0) return paths;
  for (const file of Array.from(files)) {
    validateTextUpload(file, label);
    const content = await readFileAsText(file);
    if (!content.trim()) throw new Error(`${label}: ${file.name} is empty.`);
    const res = await api.upload(file.name, content);
    if (!res.ok || !res.path) {
      throw new Error(res.message || `${label}: failed to stage ${file.name}`);
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
  prdFile: FileList | null;
  prdPath?: string;
  researchFiles: FileList | null;
  researchPaths?: string;
  authoringConfig: AuthoringConfig;
}): Promise<void> {
  if (!req.name || !req.idea.trim() || !req.harness) {
    toast("Add an Idea, keep the suggested Project name, and choose an AI coding tool.");
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
    concurrency: req.concurrency && req.concurrency > 0 ? req.concurrency : undefined,
  };
  if (prdPath) payload.prdPath = prdPath;
  if (researchPaths.length > 0) payload.researchPaths = researchPaths;
  payload.authoringConfig = req.authoringConfig;

  try {
    const res = await api.createProject(payload);
    if (!res.ok) {
      toast(res.message || "creation failed");
      return;
    }
    toast(res.message);
    if (res.repoDir) {
      createRepoDir = res.repoDir;
      initializeGuidedAuthoring(res.repoDir);
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
        el("button", { className: "btn btn-primary", "data-action": "select", disabled: !project || running ? true : null }, "Open your Project guide"),
        el("a", { className: "btn", href: "#/projects" }, "View projects"),
      ]),
    ]);
    panel.querySelector<HTMLElement>('[data-action="select"]')?.addEventListener("click", () => {
      void api.selectRepo(repoDir).then((r) => {
        if (r.ok) location.hash = "#/overview";
        else toast(r.message ?? "select failed");
      });
    });
    host.textContent = "";
    host.appendChild(panel);
  }

  const title = panel.querySelector<HTMLElement>(".create-status-title");
  const status = panel.querySelector<HTMLElement>(".create-status-message");
  const spinner = panel.querySelector<HTMLElement>(".create-status-spinner");
  if (title) title.textContent = running ? "Background progress" : "Background result";
  if (status) {
    status.className = project?.job?.status === "failed" ? "create-status-message error-text" : "create-status-message dim";
    status.textContent = `${project?.stage ?? "creating"} — ${message}`;
  }
  if (spinner) spinner.style.display = running ? "" : "none";
  for (const btn of panel.querySelectorAll<HTMLButtonElement>("[data-action]")) btn.disabled = !project || running;

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
