// ─── Plan & Team: authoring docs + agent team (collapsible sections) ─────────

import { api } from "../api.js";
import { el, toast } from "../render/dom.js";
import { renderMarkdown } from "../render/md.js";
import type { AgentInfo, DocEntry, DocsIndex, SkillInfo, TeamIndex } from "../types.js";

let unsub: Array<() => void> = [];
let detailHost: HTMLElement | null = null;

export function unmountDocuments(): void {
  for (const u of unsub) u();
  unsub = [];
  detailHost = null;
}

interface Section {
  root: HTMLElement;
  body: HTMLElement;
}

/** A collapsible top-level section (native <details>, open by default). */
function section(title: string): Section {
  const root = el("details", { className: "section" });
  const summary = el("summary", null, title);
  const body = el("div", { className: "section-body" });
  root.appendChild(summary);
  root.appendChild(body);
  return { root, body };
}

export function renderDocuments(container: HTMLElement): void {
  unmountDocuments();
  container.textContent = "";

  // ── Documents ─────────────────────────────────────────────────────────────
  const docsSection = section("Documents");
  const grid = el("div", { className: "grid-2" });
  const list = el("div", { className: "panel list-pane" });
  detailHost = el("div", { className: "panel detail-pane" });
  grid.appendChild(list);
  grid.appendChild(detailHost);
  docsSection.body.appendChild(grid);
  container.appendChild(docsSection.root);

  void api.docs()
    .then((docs) => renderDocList(list, docs))
    .catch(() => list.appendChild(el("div", { className: "dim" }, "Failed to load documents.")));

  // ── Agents ────────────────────────────────────────────────────────────────
  const agentsSection = section("Agents");
  container.appendChild(agentsSection.root);
  void api.team()
    .then((team) => renderAgents(agentsSection.body, team))
    .catch(() => agentsSection.body.appendChild(el("div", { className: "dim" }, "Failed to load team.")));

  // ── Skills ────────────────────────────────────────────────────────────────
  const skillsSection = section("Skills");
  container.appendChild(skillsSection.root);
  void api.team()
    .then((team) => renderSkills(skillsSection.body, team))
    .catch(() => skillsSection.body.appendChild(el("div", { className: "dim" }, "Failed to load skills.")));
}

function renderDocList(list: HTMLElement, docs: DocsIndex): void {
  list.textContent = "";
  if (docs.entries.length === 0) {
    list.appendChild(el("div", { className: "dim" }, "No documents."));
    return;
  }
  const ul = el("ul", { className: "doc-list" });
  for (const entry of docs.entries) {
    const item = el("li", { className: entry.exists ? "doc-item" : "doc-item missing" }, [
      el("span", { className: "kind" }, entry.kind),
      el("span", null, entry.title),
      entry.exists ? null : el("span", { className: "dim" }, "— not created yet"),
    ]);
    if (entry.exists) item.addEventListener("click", () => void openDoc(entry));
    ul.appendChild(item);
  }
  list.appendChild(ul);
}

async function openDoc(entry: DocEntry): Promise<void> {
  if (!detailHost) return;
  detailHost.textContent = "";
  detailHost.appendChild(el("div", { className: "dim" }, "Loading…"));
  try {
    const file = await api.docContent(entry.relPath);
    detailHost.textContent = "";
    const openBtn = el("button", { className: "btn btn-sm" }, "Open externally");
    openBtn.addEventListener("click", () => void openExternal(entry.relPath));
    detailHost.appendChild(
      el("div", { className: "row between" }, [el("h3", null, entry.title), openBtn]),
    );
    detailHost.appendChild(el("div", { className: "md" }, [el("div", { html: renderMarkdown(file.content) })]));
  } catch {
    detailHost.textContent = "";
    detailHost.appendChild(el("div", { className: "dim" }, "Could not load document."));
  }
}

async function openExternal(relPath: string): Promise<void> {
  try {
    const res = await api.openExternal(relPath);
    if (!res.ok) toast(res.message ?? "open failed");
  } catch (err) {
    toast(err instanceof Error ? err.message : "open failed");
  }
}

function renderAgents(host: HTMLElement, team: TeamIndex): void {
  host.textContent = "";
  if (team.agents.length === 0) {
    host.appendChild(el("div", { className: "dim" }, "No agent team generated yet."));
    return;
  }
  const grid = el("div", { className: "cards" });
  void api.modelInventory().then((inventory) => {
    const terminal = modelTerminalPanel();
    host.appendChild(terminal);
    for (const agent of team.agents) grid.appendChild(agentCard(agent, inventory.models));
    host.appendChild(grid);
  }).catch(() => {
    for (const agent of team.agents) grid.appendChild(agentCard(agent, []));
    host.appendChild(grid);
  });
}

function modelTerminalPanel(): HTMLElement {
  const provider = el("select", null, [el("option", { value: "opencode" }, "OpenCode"), el("option", { value: "copilot" }, "Copilot")]);
  const message = el("textarea", { rows: "3", placeholder: "Ask the model assistant to review or improve MODEL-PLAN.md" });
  (message as HTMLTextAreaElement).value = "/forge-assign-models Discover the available models from OpenCode, Copilot, Ollama, and BYOK, normalize the model IDs, enrich capabilities with BenchLM, and update the model inventory and plan.";
  const button = el("button", { className: "btn btn-sm btn-primary" }, "Launch model terminal");
  button.addEventListener("click", () => {
    const text = (message as HTMLTextAreaElement).value.trim();
    if (!text) { toast("Enter a message first."); return; }
    button.setAttribute("disabled", "true");
    void api.launchModelTerminal((provider as HTMLSelectElement).value as "opencode" | "copilot", text)
      .then((result) => toast(result.message ?? "terminal launch requested"))
      .catch((err) => toast(err instanceof Error ? err.message : "terminal launch failed"))
      .finally(() => button.removeAttribute("disabled"));
  });
  return el("div", { className: "panel" }, [el("h4", null, "Model planning terminal"), el("p", { className: "dim small" }, "Launch an interactive assistant in this repository. Changes are not applied automatically."), el("div", { className: "row gap wrap" }, [provider, message, button])]);
}

function renderSkills(host: HTMLElement, team: TeamIndex): void {
  host.textContent = "";
  if (team.skills.length === 0) {
    host.appendChild(el("div", { className: "dim" }, "No skills generated yet."));
    return;
  }
  const forge = team.skills.filter((s) => s.category === "forge");
  const project = team.skills.filter((s) => s.category !== "forge");
  if (project.length > 0) appendSkillGroup(host, "Project skills", project);
  if (forge.length > 0) appendSkillGroup(host, "Forge skills", forge);
}

function appendSkillGroup(host: HTMLElement, title: string, skills: SkillInfo[]): void {
  host.appendChild(el("h4", { className: "group-title" }, `${title} (${skills.length})`));
  const grid = el("div", { className: "cards" });
  for (const skill of skills) grid.appendChild(skillCard(skill));
  host.appendChild(grid);
}

function skillCard(skill: SkillInfo): HTMLElement {
  const card = el("div", { className: "card" }, [
    el("div", { className: "card-title" }, [
      el("strong", null, skill.name),
      el("span", { className: `badge badge-${skill.category}` }, skill.category),
      el("button", { className: "btn btn-sm" }, "Open"),
    ]),
    el("p", { className: "dim" }, skill.description),
    el("p", { className: "small mono dim" }, skill.relPath),
  ]);
  const openBtn = card.querySelector<HTMLElement>(".card-title .btn");
  if (openBtn) openBtn.addEventListener("click", () => void openExternal(skill.relPath));
  return card;
}

function agentCard(agent: AgentInfo, models: Array<{ id: string; provider?: string }>): HTMLElement {
  const collapse = (title: string, items: string[]): HTMLElement | null => {
    if (items.length === 0) return null;
    return el("details", { className: "collapsible" }, [
      el("summary", null, title),
      el("ul", null, items.map((x) => el("li", null, x))),
    ]);
  };

  const primary = el("select", { className: "model-select" }, [el("option", { value: "" }, "Use recommendation"), ...models.map((model) => el("option", { value: model.id }, `${model.id}${model.provider ? ` · ${model.provider}` : ""}`))]);
  const fallback = el("select", { className: "model-select" }, [el("option", { value: "" }, "Use recommendation"), ...models.map((model) => el("option", { value: model.id }, `${model.id}${model.provider ? ` · ${model.provider}` : ""}`))]);
  if (agent.modelOverride) (primary as HTMLSelectElement).value = agent.modelOverride;
  if (agent.modelFallbackOverride) (fallback as HTMLSelectElement).value = agent.modelFallbackOverride;
  const save = el("button", { className: "btn btn-sm" }, "Save model override");
  save.addEventListener("click", () => void api.setModelOverride(agent.name, (primary as HTMLSelectElement).value || undefined, (fallback as HTMLSelectElement).value || undefined).then((result) => toast(result.message)).catch((err) => toast(err instanceof Error ? err.message : "override failed")));
  const card = el("div", { className: "card" }, [
    el("div", { className: "card-title" }, [
      el("strong", null, agent.name),
      agent.model ? el("span", { className: "badge badge-running" }, agent.model) : null,
      el("button", { className: "btn btn-sm" }, "Open"),
    ]),
    el("p", { className: "dim" }, agent.description),
    el("div", { className: "row gap wrap" }, [el("label", { className: "small" }, ["Primary ", primary]), el("label", { className: "small" }, ["Fallback ", fallback]), save]),
    collapse("Expertise", agent.expertise),
    collapse("Collaboration", agent.collaboration),
    collapse("Constraints", agent.constraints),
  ]);

  const openBtn = card.querySelector<HTMLElement>(".card-title .btn");
  if (openBtn) openBtn.addEventListener("click", () => void openExternal(agent.relPath));

  return card;
}
