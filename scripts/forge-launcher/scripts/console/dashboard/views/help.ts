// ─── Help: modal overlay with a quick reference and the full user guide ──────

import { api } from "../api.js";
import { el } from "../render/dom.js";
import { renderMarkdown } from "../render/md.js";

let overlay: HTMLElement | null = null;
let onKeydown: ((e: KeyboardEvent) => void) | null = null;
let guideReady: Promise<string> | null = null;

export function openHelp(): void {
  closeHelp();
  overlay = el("div", { className: "help-overlay" });

  const closeBtn = el("button", { className: "help-close", "aria-label": "Close help" }, "✕");
  closeBtn.addEventListener("click", closeHelp);

  const dialog = el("div", { className: "help-dialog", role: "dialog", "aria-modal": "true" });
  dialog.appendChild(
    el("div", { className: "row between" }, [el("h2", { className: "no-margin" }, "Forge Console help"), closeBtn]),
  );

  const tabs = el("div", { className: "tabs" }, [
    tabButton("Quick help"),
    tabButton("User guide"),
  ]);
  const body = el("div", { className: "help-body" });
  body.appendChild(quickHelp());

  tabs.querySelector<HTMLElement>(".tab")?.classList.add("active");
  tabs.querySelectorAll<HTMLElement>(".tab").forEach((tab, i) => {
    tab.addEventListener("click", () => {
      tabs.querySelectorAll<HTMLElement>(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      dialog.classList.toggle("guide-mode", i === 1);
      body.textContent = "";
      if (i === 0) body.appendChild(quickHelp());
      else void renderGuide(body);
    });
  });

  dialog.appendChild(tabs);
  dialog.appendChild(body);
  overlay.appendChild(dialog);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeHelp();
  });

  document.body.appendChild(overlay);

  onKeydown = (e) => {
    if (e.key === "Escape") closeHelp();
  };
  window.addEventListener("keydown", onKeydown);
}

export function closeHelp(): void {
  if (onKeydown) window.removeEventListener("keydown", onKeydown);
  onKeydown = null;
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
}

function tabButton(label: string): HTMLElement {
  return el("button", { className: "tab", type: "button" }, label);
}

function quickHelp(): HTMLElement {
  return el("div", null, [
    helpSection("What is this?", [
      "Forge Console is a local web UI that fronts forge-launcher and the workflow engine. It lets you create a project, draft its PRD and agent team, run the build, and monitor/control it - all from your browser, without remembering terminal commands. It is served on 127.0.0.1 and reads the same files the terminal tools write.",
    ]),
    helpSection("The pipeline", [
      "Projects flow through four stages: Idea → PRD → Agent team → Build.",
      "The Continue button on the Overview page advances one stage at a time, running the same steps the terminal launcher runs - so you can review each result (for example the drafted PRD in Plan & Team) and come back later to continue. Nothing runs until you click it.",
      dl([
        ["Idea", "your project description in docs/IDEA.md."],
        ["PRD", "a reviewed requirements document (docs/PRD.md, or product-vision + features)."],
        ["Agent team", "specialist agents + skills generated from the PRD."],
        ["Build", "the workflow engine runs the tasks in the execution manifest."],
      ]),
    ]),
    helpSection("Views", [dl([
      ["Home", "create a new project or open an existing one."],
      ["Overview", "run status, progress, the pipeline next step, and run controls."],
      ["Board", "live kanban of tasks flowing To Do → In Progress → Done → Failed."],
      ["Tasks", "filterable, sortable table of every task with detail."],
      ["Logs", "the engine's output log plus the audit event stream."],
      ["Plan & Team", "the project documents (IDEA, PRD, vision, features, progress) and its agent team."],
      ["Artifacts", "the files and records each task produced."],
      ["Timeline", "chronological audit events, failures highlighted."],
      ["Projects", "switch to a different project or add a folder."],
    ])]),
    helpSection("Key terms", [dl([
      ["PRD", "Product Requirements Document - the review gate before building."],
      ["Product vision / feature", "a decomposed PRD's split form (overview + per-feature docs)."],
      ["Agent", "a specialist persona that does a job (e.g. qa-engineer)."],
      ["Skill", "a reusable instruction set an agent follows."],
      ["Manifest", "the compiled task list the engine executes."],
      ["Task / Phase", "one unit of work, grouped into phases."],
      ["Run", "one execution of the build (has a run id and status)."],
      ["Artifact", "a structured output a task produced."],
      ["Audit", "the event log (task started/completed/failed, …)."],
      ["Pause / Stop / Resume / Replay", "graceful controls over a running build."],
    ])]),
    helpSection("Full walkthrough", [
      "For the step-by-step walkthrough (startup, creating/opening projects, monitoring and controlling builds), open the User guide tab.",
    ]),
  ]);
}

/** Loads and renders the user guide, caching the rendered result. */
function loadGuide(): Promise<string> {
  if (!guideReady) {
    guideReady = api
      .guideMarkdown()
      .then((md) => guideHtml(md))
      .catch((err) => {
        guideReady = null;
        throw err;
      });
  }
  return guideReady;
}

/**
 * Renders the guide markdown, dropping links to local files (e.g. forge-console.md)
 * that cannot resolve in the browser - they would open a 404 in a new tab.
 * External (http/https) and fragment links are preserved.
 */
function guideHtml(md: string): string {
  return renderMarkdown(md).replace(
    /<a href="(?![a-z]+:|#)([^"]*)" target="_blank" rel="noopener">([^<]*)<\/a>/g,
    (_m, _href: string, text: string) => text,
  );
}

async function renderGuide(host: HTMLElement): Promise<void> {
  host.appendChild(el("div", { className: "dim" }, "Loading…"));
  try {
    const html = await loadGuide();
    host.textContent = "";
    host.appendChild(el("div", { className: "md" }, [el("div", { html })]));
  } catch {
    host.textContent = "";
    host.appendChild(el("div", { className: "dim" }, "Could not load the user guide."));
  }
}

function helpSection(title: string, content: Array<HTMLElement | string>): HTMLElement {
  return el("div", { className: "help-section" }, [
    el("h3", null, title),
    ...content,
  ]);
}

function dl(terms: Array<[string, string]>): HTMLElement {
  return el("dl", { className: "help-dl" }, terms.map(([dt, dd]) => el("div", null, [el("dt", null, dt), el("dd", null, dd)])));
}
