// ─── Help: modal overlay explaining the UI and pipeline terms ────────────────

import { el } from "../render/dom.js";

let overlay: HTMLElement | null = null;
let onKeydown: ((e: KeyboardEvent) => void) | null = null;

export function openHelp(): void {
  closeHelp();
  overlay = el("div", { className: "help-overlay" });

  const closeBtn = el("button", { className: "help-close", "aria-label": "Close help" }, "✕");
  closeBtn.addEventListener("click", closeHelp);

  const dialog = el("div", { className: "help-dialog", role: "dialog", "aria-modal": "true" });
  dialog.appendChild(
    el("div", { className: "row between" }, [el("h2", { className: "no-margin" }, "Forge Console help"), closeBtn]),
  );
  dialog.appendChild(helpBody());
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

function helpBody(): HTMLElement {
  return el("div", { className: "help-body" }, [
    helpSection("What is this?", [
      "Forge Console is a local web UI that fronts forge-launcher and the workflow engine. It lets you create a project, draft its PRD and agent team, run the build, and monitor/control it — all from your browser, without remembering terminal commands. It is served on 127.0.0.1 and reads the same files the terminal tools write.",
    ]),
    helpSection("The pipeline", [
      "Projects flow through four stages: Idea → PRD → Agent team → Build.",
      "The Continue button on the Overview page advances one stage at a time, running the same steps the terminal launcher runs — so you can review each result (for example the drafted PRD in Plan & Team) and come back later to continue. Nothing runs until you click it.",
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
      ["PRD", "Product Requirements Document — the review gate before building."],
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
  ]);
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
