// ─── Help: modal overlay with a quick reference and the full user guide ──────

import { api } from "../api.js";
import { el } from "../render/dom.js";
import { renderMarkdown } from "../render/md.js";

let overlay: HTMLElement | null = null;
let onKeydown: ((e: KeyboardEvent) => void) | null = null;
let guideReady: Promise<string> | null = null;
let returnFocus: HTMLElement | null = null;

export function openHelp(): void {
  closeHelp();
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
    if (e.key === "Tab" && dialog) {
      const focusable = [...dialog.querySelectorAll<HTMLElement>("button, a, input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((node) => !node.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  window.addEventListener("keydown", onKeydown);
  window.setTimeout(() => closeBtn.focus(), 0);
}

export function closeHelp(): void {
  if (onKeydown) window.removeEventListener("keydown", onKeydown);
  onKeydown = null;
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  returnFocus?.focus();
  returnFocus = null;
}

function tabButton(label: string): HTMLElement {
  return el("button", { className: "tab", type: "button" }, label);
}

function quickHelp(): HTMLElement {
  return el("div", null, [
    helpSection("What is this?", [
      "Forge Console is a local web UI that fronts forge-launcher and the workflow engine. It lets you create a project, start interactive PRD authoring, generate the agent team, run the build, and monitor/control it - all from your browser, without remembering terminal commands. The Terminal view runs OpenCode, Copilot, Claude, or an interactive authoring session inside the browser; external-terminal launch remains available as a fallback. It is served on 127.0.0.1 and reads the same files the terminal tools write.",
    ]),
    helpSection("The pipeline", [
      "New Projects follow a guided path: explore an Idea, author a Project brief interactively, review it, approve preparation, then choose Start build after the prepared plan is ready. Brief approval never starts execution. Existing Projects enter at their current lifecycle state; non-completed Projects return to their next action on Build status, while completed Projects open Project files.",
      "Requirements authoring stays interactive. Team, project guidance, and Build-plan preparation follow review; runtime Human review remains a separate Task-bound decision. Use the Terminal view to keep an authoring session in the browser, or choose the external-terminal fallback.",
      dl([
        ["Idea", "your project description in docs/IDEA.md."],
        ["Requirements", "reviewed docs/PRD.md plus docs/features/*.md, required for every solution."],
        ["Agent team", "specialist agents + skills generated from the PRD."],
        ["Build", "the workflow engine runs the tasks in the execution manifest."],
      ]),
    ]),
    helpSection("Prepare and control a build", [
      "Before a manifest exists, enable Manual build if you want the pipeline to stop at Create manifest instead of starting the full workflow.",
      "After the manifest exists, Controls offers auto (full workflow) or manual (selected tasks). Manual mode requires a saved task selection from All tasks; dependencies are expanded automatically.",
      dl([
        ["Run / Resume", "Run selected and Resume selected require a Build that has already been explicitly started from the prepared plan on Build status."],
        ["Pause / Stop", "Pause waits for the current task to finish; Stop asks for confirmation before terminating the running engine."],
        ["Replay failed", "retry a selected failed task."],
      ]),
      "Execution preferences — timeouts, concurrency, auto-commit, and harness-activity logging — are set in the Settings view.",
    ]),
    helpSection("Incremental work", [
      "Add a feature authors an additive document under docs/features/ without replacing the original PRD.",
      "Author a Feature PRD interactively, then continue the increment to update affected agents and recompile the manifest.",
      "Review preserved, new, changed, and removed task IDs in Manifest. Reset changed tasks for review only when changed completed tasks should run again.",
    ]),
    helpSection("Views", [
      "Home and Projects are global destinations. Project destinations belong to the selected Project, while Advanced keeps the full technical views available. Hover a group to open its destinations, or select it to pin the list open on touch. The persistent Project context bar shows the selected Project and switcher; switching follows the same lifecycle entry as the Projects list, and ordinary links never change Projects.",
      helpSection("Global", [dl([
        ["Home", "start a Project from an Idea, open a recent Project, or set up an existing application."],
        ["Projects", "open or switch Projects, add a folder, and manage the local Project list."],
      ])]),
      helpSection("Current Project", [dl([
        ["Build status", "the selected Project's next action, guided brief review and preparation, prepared plan, blockers, and run controls. Completed Projects open Project files."],
        ["Board", "semantic Kanban and Gantt views with shared Task summaries, attention cues, and compact details."],
        ["Project brief", "read the selected Project's brief. Use Build status for the editable review and approval actions."],
        ["Project files", "read the Project idea, brief, progress, and feature documents, and open delivered files without Task-by-Task history."],
        ["Human review", "focused queue for explicit Task-bound reviews, separate from Project brief approval."],
      ])]),
      helpSection("Advanced", [dl([
        ["All tasks", "filterable, sortable Task table with details, timeout editing, and saved task selection."],
        ["Logs", "engine and authoring output plus audit and lifecycle event streams."],
        ["Timeline", "chronological audit events, with failures highlighted."],
        ["Terminal", "run the selected harness CLI or an interactive authoring session in the browser."],
        ["Plan & Team", "authoring stages, technical Project documents, agents, and skills."],
        ["Artifacts", "Task-produced files and records with detailed provenance."],
        ["Settings", "authoring models, execution preferences, timeouts, and per-agent model overrides."],
      ])]),
    ]),
    helpSection("Key terms", [dl([
      ["Project brief", "the agreed outcome and scope reviewed before preparation."],
      ["PRD / feature", "the canonical requirements layout: shared overview plus one or more owning features."],
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
