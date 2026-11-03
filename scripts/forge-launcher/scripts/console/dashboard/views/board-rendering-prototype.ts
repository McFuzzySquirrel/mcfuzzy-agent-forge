// Three Board rendering variants on the existing #/board route, switchable via ?prototype=1&variant=A.

type TaskStatus = "review" | "blocked" | "failed" | "ready" | "running" | "complete";
type VariantKey = "A" | "B" | "C";
type FilterKey = "all" | "needs-action" | "failed" | "ready" | "running";

interface BoardTask {
  id: string;
  title: string;
  shortTitle: string;
  phase: string;
  status: TaskStatus;
  assignedAgent: string;
  nextResponsible: string;
  nextAction: string;
  blocker?: string;
  dependencies: string[];
  diagnostic: string;
}

const VARIANTS: Array<{ key: VariantKey; name: string; description: string }> = [
  { key: "A", name: "Semantic lanes", description: "HTML/CSS baseline" },
  { key: "B", name: "SVG relationships", description: "SVG is optional" },
  { key: "C", name: "Canvas enhancement", description: "PixiJS stays optional" },
];

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All tasks" },
  { key: "needs-action", label: "Needs your action" },
  { key: "failed", label: "Failed" },
  { key: "ready", label: "Ready" },
  { key: "running", label: "In progress" },
];

const TASKS: BoardTask[] = [
  {
    id: "T-01",
    title: "Review the Project brief",
    shortTitle: "Review brief",
    phase: "Requirements",
    status: "review",
    assignedAgent: "Brief Writer",
    nextResponsible: "You",
    nextAction: "Review the Project brief",
    dependencies: [],
    diagnostic: "The brief is ready for human review.",
  },
  {
    id: "T-02",
    title: "Prepare the Build plan",
    shortTitle: "Prepare plan",
    phase: "Preparation",
    status: "blocked",
    assignedAgent: "Planner",
    nextResponsible: "You",
    nextAction: "Approve the Project brief",
    blocker: "Waiting for T-01, Review the Project brief.",
    dependencies: ["T-01"],
    diagnostic: "Preparation cannot continue until the Project brief is approved.",
  },
  {
    id: "T-03",
    title: "Implement project setup",
    shortTitle: "Project setup",
    phase: "Build",
    status: "running",
    assignedAgent: "Builder",
    nextResponsible: "Builder",
    nextAction: "Implementation is in progress",
    dependencies: ["T-02"],
    diagnostic: "The task is actively running.",
  },
  {
    id: "T-04",
    title: "Run focused checks",
    shortTitle: "Focused checks",
    phase: "Validation",
    status: "failed",
    assignedAgent: "Verifier",
    nextResponsible: "You",
    nextAction: "Review the failure, then retry",
    blocker: "A focused check failed.",
    dependencies: ["T-03"],
    diagnostic: "The test command returned a failing result.",
  },
  {
    id: "T-05",
    title: "Prepare handoff notes",
    shortTitle: "Handoff notes",
    phase: "Release",
    status: "ready",
    assignedAgent: "Release Writer",
    nextResponsible: "Release Writer",
    nextAction: "Ready to start",
    dependencies: [],
    diagnostic: "This task is ready to be picked up.",
  },
  {
    id: "T-06",
    title: "Create the project workspace",
    shortTitle: "Create workspace",
    phase: "Setup",
    status: "complete",
    assignedAgent: "Project Creator",
    nextResponsible: "You",
    nextAction: "Complete",
    dependencies: [],
    diagnostic: "The project workspace was created.",
  },
];

const STATUS_LABELS: Record<TaskStatus, string> = {
  review: "Needs your review",
  blocked: "Blocked",
  failed: "Failed",
  ready: "Ready",
  running: "In progress",
  complete: "Complete",
};

const POSITIONS: Record<string, { x: number; y: number }> = {
  "T-01": { x: 28, y: 38 },
  "T-02": { x: 258, y: 38 },
  "T-03": { x: 488, y: 38 },
  "T-04": { x: 488, y: 152 },
  "T-05": { x: 258, y: 152 },
  "T-06": { x: 28, y: 152 },
};

const CSS = `
.board-rendering-prototype { min-height: 100%; padding: 22px clamp(14px, 2.5vw, 36px) 96px; color: var(--text); }
.board-rendering-prototype * { box-sizing: border-box; }
.board-rendering-prototype button { color: inherit; font: inherit; }
.board-rendering-prototype button:focus-visible, .board-rendering-prototype a:focus-visible, .board-rendering-prototype [tabindex="0"]:focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
.bp-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 18px; }
.bp-heading h1 { margin: 3px 0 5px; font-size: clamp(22px, 3vw, 30px); }
.bp-kicker, .bp-dim { color: var(--text-dim); }
.bp-kicker { font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
.bp-dim { margin: 0; }
.bp-progress { min-width: 230px; padding: 12px 14px; border: 1px solid var(--panel-border); border-radius: var(--radius); background: var(--panel-bg); }
.bp-progress-top, .bp-row, .bp-filterbar, .bp-toolbar, .bp-switcher { display: flex; align-items: center; gap: 9px; }
.bp-progress-top { justify-content: space-between; font-size: 12px; }
.bp-progress progress { display: block; width: 100%; height: 7px; margin-top: 9px; accent-color: var(--accent); }
.bp-prototype-note { margin: 0 0 14px; padding: 9px 12px; border-left: 3px solid var(--accent); background: var(--surface); color: var(--text-soft); font-size: 12px; }
.bp-filterbar { flex-wrap: wrap; margin-bottom: 14px; }
.bp-filter { padding: 6px 10px; border: 1px solid var(--panel-border); border-radius: 999px; background: transparent; cursor: pointer; }
.bp-filter[aria-pressed="true"] { border-color: var(--accent); background: var(--active); }
.bp-status { display: inline-flex; align-items: center; gap: 6px; width: fit-content; padding: 3px 8px; border-radius: 999px; background: var(--surface-deep); font-size: 11px; white-space: nowrap; }
.bp-status::before { width: 7px; height: 7px; border-radius: 50%; background: var(--blue); content: ""; }
.bp-status-review::before, .bp-status-blocked::before { background: var(--accent); }
.bp-status-failed::before { background: var(--red); }
.bp-status-ready::before { background: var(--green); }
.bp-status-complete::before { background: var(--text-dim); }
.bp-panel { min-width: 0; padding: 14px; border: 1px solid var(--panel-border); border-radius: var(--radius); background: var(--panel-bg); }
.bp-panel h2, .bp-panel h3 { margin: 0 0 10px; font-size: 14px; }
.bp-panel h3 { color: var(--text-soft); font-size: 12px; }
.bp-layout { display: grid; gap: 14px; align-items: start; }
.bp-layout-a { grid-template-columns: minmax(190px, .75fr) minmax(340px, 1.65fr) minmax(230px, .95fr); }
.bp-lanes { display: grid; gap: 10px; }
.bp-lane { padding: 10px; border: 1px solid var(--panel-border-soft); border-radius: 8px; background: var(--surface-deep); }
.bp-task-list { display: grid; gap: 7px; margin: 0; padding: 0; list-style: none; }
.bp-task { display: grid; gap: 6px; width: 100%; padding: 10px; border: 1px solid var(--panel-border-soft); border-radius: 8px; background: var(--surface); text-align: left; cursor: pointer; }
.bp-task:hover, .bp-task[aria-pressed="true"] { border-color: var(--accent); background: var(--active); }
.bp-task-title { font-weight: 650; }
.bp-task-meta, .bp-task-cue { color: var(--text-dim); font-size: 11px; }
.bp-task-cue { color: var(--text-soft); }
.bp-attention { display: grid; gap: 10px; }
.bp-attention-group { display: grid; gap: 7px; }
.bp-attention-label { color: var(--text-dim); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
.bp-detail dl { display: grid; grid-template-columns: minmax(95px, .7fr) minmax(0, 1.3fr); gap: 8px 12px; margin: 0; font-size: 12px; }
.bp-detail dt { color: var(--text-dim); }
.bp-detail dd { margin: 0; overflow-wrap: anywhere; }
.bp-detail details { margin-top: 13px; padding-top: 10px; border-top: 1px solid var(--panel-border-soft); }
.bp-detail summary { cursor: pointer; color: var(--text-soft); font-size: 12px; }
.bp-detail details p { margin: 8px 0 0; color: var(--text-dim); font-size: 12px; }
.bp-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 14px; }
.bp-summary-item { padding: 10px; border-radius: 8px; background: var(--surface); }
.bp-summary-item strong { display: block; font-size: 18px; }
.bp-summary-item span { color: var(--text-dim); font-size: 11px; }
.bp-layout-b { grid-template-columns: minmax(0, 1.8fr) minmax(250px, 1fr); }
.bp-relationship-map { overflow-x: auto; padding: 4px; }
.bp-relationship-map svg { display: block; width: 100%; min-width: 660px; height: auto; }
.bp-edge { stroke: var(--panel-border); stroke-width: 2; fill: none; }
.bp-node { cursor: pointer; }
.bp-node rect { fill: var(--bg-elevated); stroke: var(--panel-border); stroke-width: 1.5; }
.bp-node text { fill: var(--text); font: 12px system-ui, sans-serif; }
.bp-node .bp-node-status { fill: var(--text-dim); font-size: 10px; }
.bp-node.selected rect { stroke: var(--accent); stroke-width: 3; }
.bp-node-review rect, .bp-node-blocked rect { stroke: var(--accent); }
.bp-node-failed rect { stroke: var(--red); }
.bp-node-ready rect { stroke: var(--green); }
.bp-layout-c { grid-template-columns: minmax(260px, 1.2fr) minmax(250px, 1fr) minmax(230px, .9fr); }
.bp-canvas-wrap { display: grid; gap: 10px; }
.bp-canvas { display: block; width: 100%; height: 300px; border: 1px solid var(--panel-border-soft); border-radius: 8px; background: var(--bg-elevated); cursor: pointer; }
.bp-canvas-toggle { justify-self: start; padding: 7px 10px; border: 1px solid var(--panel-border); border-radius: 7px; background: var(--surface); cursor: pointer; }
.bp-canvas-off { min-height: 300px; display: grid; place-items: center; padding: 20px; border: 1px dashed var(--panel-border); border-radius: 8px; color: var(--text-dim); text-align: center; }
.bp-live { margin: 8px 0 0; color: var(--text-dim); font-size: 11px; }
.bp-switcher { position: fixed; z-index: 20; left: 50%; bottom: 16px; transform: translateX(-50%); padding: 7px; border: 1px solid var(--panel-border); border-radius: 999px; background: var(--bar-bg); box-shadow: var(--shadow-md); backdrop-filter: blur(8px); }
.bp-switcher button { width: 34px; height: 34px; border: 0; border-radius: 50%; background: var(--control-bg); cursor: pointer; }
.bp-switcher button:hover { background: var(--control-bg-hover); }
.bp-switcher-label { min-width: 205px; text-align: center; font-size: 12px; }
.bp-switcher-label strong { display: block; }
.bp-switcher-label span { color: var(--text-dim); font-size: 10px; }
@media (max-width: 1050px) { .bp-layout-a, .bp-layout-c { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .bp-layout-a .bp-detail, .bp-layout-c .bp-detail { grid-column: 1 / -1; } }
@media (max-width: 720px) { .bp-heading { display: grid; } .bp-progress { min-width: 0; } .bp-layout-a, .bp-layout-b, .bp-layout-c { grid-template-columns: minmax(0, 1fr); } .bp-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } .bp-layout-a .bp-detail, .bp-layout-c .bp-detail { grid-column: auto; } .bp-switcher-label { min-width: 160px; } }
`;

let activeRoot: HTMLElement | null = null;
let cleanup: (() => void) | null = null;

function readParams(): URLSearchParams {
  return new URLSearchParams(location.hash.split("?")[1] ?? "");
}

function readVariant(params: URLSearchParams): VariantKey {
  const key = params.get("variant");
  return VARIANTS.some((variant) => variant.key === key) ? key as VariantKey : "A";
}

function readFilter(params: URLSearchParams): FilterKey {
  const key = params.get("filter");
  return FILTERS.some((filter) => filter.key === key) ? key as FilterKey : "all";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function taskById(id: string): BoardTask {
  return TASKS.find((task) => task.id === id) ?? TASKS[0]!;
}

function visibleTasks(filter: FilterKey): BoardTask[] {
  switch (filter) {
    case "needs-action":
      return TASKS.filter((task) => task.status === "review" || task.status === "blocked");
    case "failed":
    case "ready":
    case "running":
      return TASKS.filter((task) => task.status === filter);
    default:
      return TASKS;
  }
}

function statusClass(status: TaskStatus): string {
  return `bp-status-${status}`;
}

function taskButton(task: BoardTask, selectedId: string): string {
  const cue = task.blocker ?? task.nextAction;
  return `<button type="button" class="bp-task" data-task-id="${escapeHtml(task.id)}" aria-pressed="${task.id === selectedId}">
    <span class="bp-status ${statusClass(task.status)}">${STATUS_LABELS[task.status]}</span>
    <span class="bp-task-title">${escapeHtml(task.title)}</span>
    <span class="bp-task-meta">${escapeHtml(task.id)} · ${escapeHtml(task.phase)} · Up next: ${escapeHtml(task.nextResponsible)}</span>
    <span class="bp-task-cue">${escapeHtml(cue)}</span>
  </button>`;
}

function attentionHtml(tasks: BoardTask[], selectedId: string): string {
  const groups: Array<[string, TaskStatus[]]> = [
    ["Human action", ["review", "blocked"]],
    ["Recovery", ["failed"]],
    ["Ready", ["ready"]],
  ];
  return `<section class="bp-panel bp-attention" aria-labelledby="bp-attention-title">
    <h2 id="bp-attention-title">Needs your attention</h2>
    ${groups.map(([label, statuses]) => {
      const group = tasks.filter((task) => statuses.includes(task.status));
      return group.length
        ? `<div class="bp-attention-group"><span class="bp-attention-label">${label}</span><ul class="bp-task-list">${group.map((task) => `<li>${taskButton(task, selectedId)}</li>`).join("")}</ul></div>`
        : "";
    }).join("")}
    ${tasks.some((task) => task.status === "running" || task.status === "complete")
      ? `<p class="bp-dim">Running and completed work remains in the progress view.</p>`
      : ""}
  </section>`;
}

function detailHtml(task: BoardTask): string {
  return `<aside class="bp-panel bp-detail" aria-live="polite" aria-labelledby="bp-detail-title">
    <h2 id="bp-detail-title">Task details</h2>
    <span class="bp-status ${statusClass(task.status)}">${STATUS_LABELS[task.status]}</span>
    <h3>${escapeHtml(task.title)}</h3>
    <dl>
      <dt>Phase</dt><dd>${escapeHtml(task.phase)}</dd>
      <dt>Next responsible</dt><dd>${escapeHtml(task.nextResponsible)}</dd>
      <dt>Next action</dt><dd>${escapeHtml(task.nextAction)}</dd>
      <dt>Assigned agent</dt><dd>${escapeHtml(task.assignedAgent)}</dd>
      ${task.blocker ? `<dt>Blocked by</dt><dd>${escapeHtml(task.blocker)}</dd>` : ""}
      ${task.dependencies.length ? `<dt>Prerequisites</dt><dd>${task.dependencies.map(escapeHtml).join(", ")}</dd>` : ""}
    </dl>
    <details><summary>Technical details</summary><p>${escapeHtml(task.diagnostic)} Full errors, inputs, outputs, timing, and validation live here in a real Board.</p></details>
  </aside>`;
}

function laneHtml(tasks: BoardTask[], selectedId: string): string {
  const phases = [...new Set(tasks.map((task) => task.phase))];
  return `<div class="bp-lanes">${phases.map((phase) => `<section class="bp-lane">
    <h3>${escapeHtml(phase)}</h3>
    <ul class="bp-task-list">${tasks.filter((task) => task.phase === phase).map((task) => `<li>${taskButton(task, selectedId)}</li>`).join("")}</ul>
  </section>`).join("")}</div>`;
}

function svgHtml(tasks: BoardTask[], selectedId: string): string {
  const edges = TASKS.flatMap((task) => task.dependencies.map((dependency) => {
    const from = POSITIONS[dependency];
    const to = POSITIONS[task.id];
    if (!from || !to) return "";
    return `<path class="bp-edge" d="M ${from.x + 185} ${from.y + 35} C ${from.x + 210} ${from.y + 35}, ${to.x - 25} ${to.y + 35}, ${to.x} ${to.y + 35}" marker-end="url(#bp-arrow)" />`;
  })).join("");
  const nodes = tasks.map((task) => {
    const position = POSITIONS[task.id]!;
    return `<g class="bp-node bp-node-${task.status}${task.id === selectedId ? " selected" : ""}" transform="translate(${position.x} ${position.y})" data-task-id="${escapeHtml(task.id)}" tabindex="0" role="button" aria-pressed="${task.id === selectedId}" aria-label="${escapeHtml(`${task.title}, ${STATUS_LABELS[task.status]}`)}">
      <rect width="190" height="70" rx="9" />
      <text x="12" y="25">${escapeHtml(task.shortTitle)}</text>
      <text class="bp-node-status" x="12" y="48">${escapeHtml(STATUS_LABELS[task.status])} · ${escapeHtml(task.phase)}</text>
    </g>`;
  }).join("");
  return `<svg viewBox="0 0 710 265" role="group" aria-label="Task relationship map">
    <defs><marker id="bp-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="currentColor" /></marker></defs>
    ${edges}${nodes}
  </svg>`;
}

function drawCanvas(canvas: HTMLCanvasElement, tasks: BoardTask[], selectedId: string): void {
  const width = Math.max(360, canvas.clientWidth);
  const height = 300;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.scale(ratio, ratio);
  const styles = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string): string => styles.getPropertyValue(name).trim() || fallback;
  const text = color("--text", "#dbe4ff");
  const muted = color("--text-dim", "#8b96b8");
  const border = color("--panel-border", "rgba(140,170,255,.25)");
  context.clearRect(0, 0, width, height);
  context.font = "12px system-ui, sans-serif";
  context.fillStyle = muted;
  context.fillText("Optional visual layer · task list remains the accessible source", 14, 22);
  tasks.forEach((task, index) => {
    const y = 38 + index * 42;
    context.fillStyle = task.id === selectedId ? color("--active", "#26314b") : color("--surface", "#11182a");
    context.strokeStyle = border;
    context.beginPath();
    context.roundRect(10, y, width - 20, 34, 7);
    context.fill();
    context.stroke();
    context.fillStyle = text;
    context.fillText(`${task.id}  ${task.shortTitle}`, 20, y + 15);
    context.fillStyle = muted;
    context.font = "10px system-ui, sans-serif";
    context.fillText(`${STATUS_LABELS[task.status]} · Up next: ${task.nextResponsible}`, 20, y + 28);
    context.font = "12px system-ui, sans-serif";
  });
}

function updateParams(changes: Record<string, string>): void {
  const params = readParams();
  params.set("prototype", "1");
  for (const [key, value] of Object.entries(changes)) params.set(key, value);
  history.replaceState(history.state, "", `${location.pathname}${location.search}#/board?${params.toString()}`);
}

export function unmountBoardRenderingPrototype(): void {
  cleanup?.();
  cleanup = null;
  activeRoot = null;
}

export function renderBoardRenderingPrototype(container: HTMLElement): void {
  const root = document.createElement("div");
  root.className = "board-rendering-prototype";
  container.replaceChildren(root);
  activeRoot = root;

  const render = (): void => {
    const params = readParams();
    const variant = readVariant(params);
    const filter = readFilter(params);
    const selected = taskById(params.get("selected") ?? "T-01");
    const tasks = visibleTasks(filter);
    const completed = TASKS.filter((task) => task.status === "complete").length;
    const needAction = TASKS.filter((task) => task.status === "review" || task.status === "blocked").length;
    const failed = TASKS.filter((task) => task.status === "failed").length;
    const ready = TASKS.filter((task) => task.status === "ready").length;
    const running = TASKS.filter((task) => task.status === "running").length;
    const variantInfo = VARIANTS.find((item) => item.key === variant)!;
    const filterButtons = FILTERS.map((item) => `<button type="button" class="bp-filter" data-filter="${item.key}" aria-pressed="${item.key === filter}">${item.label}</button>`).join("");
    let body: string;

    if (variant === "A") {
      body = `<div class="bp-layout bp-layout-a">
        ${attentionHtml(tasks, selected.id)}
        <section class="bp-panel"><h2>Work by phase</h2><p class="bp-dim">Native HTML lists and CSS layout; no canvas required.</p>${laneHtml(tasks, selected.id)}</section>
        ${detailHtml(selected)}
      </div>`;
    } else if (variant === "B") {
      body = `${attentionHtml(tasks, selected.id)}
      <div class="bp-summary" aria-label="Build status summary">
        <div class="bp-summary-item"><strong>${needAction}</strong><span>Need your action</span></div>
        <div class="bp-summary-item"><strong>${failed}</strong><span>Failed</span></div>
        <div class="bp-summary-item"><strong>${ready}</strong><span>Ready</span></div>
        <div class="bp-summary-item"><strong>${running}</strong><span>In progress</span></div>
      </div>
      <div class="bp-layout bp-layout-b">
        <section class="bp-panel"><h2>Tasks and prerequisites</h2><p class="bp-dim">SVG relationships are an optional visual aid; the task list stays operable.</p>
          <div class="bp-relationship-map">${svgHtml(tasks, selected.id)}</div>
          <ul class="bp-task-list">${tasks.map((task) => `<li>${taskButton(task, selected.id)}</li>`).join("")}</ul>
        </section>
        ${detailHtml(selected)}
      </div>`;
    } else {
      const enhancementOff = params.get("canvas") === "off";
      body = `${attentionHtml(tasks, selected.id)}
      <div class="bp-layout bp-layout-c">
        <section class="bp-panel bp-canvas-wrap"><h2>Optional visual enhancement</h2>
          <p class="bp-dim">A PixiJS layer can improve spatial overview; it is not the source of truth.</p>
          ${enhancementOff
            ? `<div class="bp-canvas-off">Visual enhancement is off.<br />The semantic task list and detail remain available.</div>`
            : `<canvas class="bp-canvas" data-canvas="tasks" aria-hidden="true"></canvas>`}
          <button type="button" class="bp-canvas-toggle" data-enhancement="toggle">${enhancementOff ? "Enable visual preview" : "Disable visual preview"}</button>
        </section>
        <section class="bp-panel"><h2>Accessible task list</h2><p class="bp-dim">Keyboard and pointer selection use the same task and detail state.</p><ul class="bp-task-list">${tasks.map((task) => `<li>${taskButton(task, selected.id)}</li>`).join("")}</ul></section>
        ${detailHtml(selected)}
      </div>`;
    }

    root.innerHTML = `<style>${CSS}</style>
      <section class="bp-main" aria-labelledby="bp-title">
        <header class="bp-heading">
          <div><div class="bp-kicker">Board prototype · sample scenario</div><h1 id="bp-title">One task model, three rendering choices</h1>
            <p class="bp-dim">The selected task, filters, next actor, and blocker cue stay consistent across variants.</p></div>
          <div class="bp-progress"><div class="bp-progress-top"><strong>Build progress</strong><span>${completed} of ${TASKS.length} complete</span></div><progress max="${TASKS.length}" value="${completed}" aria-label="Build progress"></progress></div>
        </header>
        <p class="bp-prototype-note">Prototype only: controls use sample data; nothing is persisted or executed. Selected: <strong>${escapeHtml(selected.title)}</strong> · Filter: <strong>${filter}</strong></p>
        <div class="bp-filterbar" role="group" aria-label="Filter sample tasks">${filterButtons}</div>
        ${body}
        <p class="bp-live" aria-live="polite">Variant ${variant}: ${escapeHtml(variantInfo.name)}. Selected ${escapeHtml(selected.id)}, ${escapeHtml(STATUS_LABELS[selected.status])}; filter ${filter}.</p>
      </section>
      <nav class="bp-switcher" aria-label="Prototype variants">
        <button type="button" data-step="-1" aria-label="Previous variant">←</button>
        <span class="bp-switcher-label"><strong>${variant} · ${escapeHtml(variantInfo.name)}</strong><span>${escapeHtml(variantInfo.description)} · use ← → keys</span></span>
        <button type="button" data-step="1" aria-label="Next variant">→</button>
      </nav>`;

    const canvas = root.querySelector<HTMLCanvasElement>("canvas[data-canvas]");
    if (canvas) drawCanvas(canvas, tasks, selected.id);
  };

  const onClick = (event: Event): void => {
    if (!(event.target instanceof Element) || !activeRoot) return;
    const target = event.target;
    const task = target.closest<HTMLElement>("[data-task-id]");
    if (task?.dataset.taskId) {
      updateParams({ selected: task.dataset.taskId });
      render();
      return;
    }
    const filter = target.closest<HTMLButtonElement>("[data-filter]");
    if (filter?.dataset.filter) {
      updateParams({ filter: filter.dataset.filter });
      render();
      return;
    }
    const step = target.closest<HTMLButtonElement>("[data-step]");
    if (step?.dataset.step) {
      const params = readParams();
      const index = VARIANTS.findIndex((variant) => variant.key === readVariant(params));
      const direction = Number(step.dataset.step);
      const next = VARIANTS[(index + direction + VARIANTS.length) % VARIANTS.length]!;
      updateParams({ variant: next.key });
      render();
      return;
    }
    const enhancement = target.closest<HTMLButtonElement>("[data-enhancement]");
    if (enhancement) {
      const params = readParams();
      updateParams({ canvas: params.get("canvas") === "off" ? "on" : "off" });
      render();
      return;
    }
    const canvas = target.closest<HTMLCanvasElement>("canvas[data-canvas]");
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const y = event instanceof MouseEvent ? event.clientY - rect.top : 0;
      const index = Math.floor((y - 38) / 42);
      const task = visibleTasks(readFilter(readParams()))[index];
      if (task) {
        updateParams({ selected: task.id });
        render();
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.target instanceof Element)) return;
    const node = event.target;
    const task = node.closest<HTMLElement>('g[data-task-id][role="button"]');
    if (!task || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    const id = task.dataset.taskId;
    if (id) {
      updateParams({ selected: id });
      render();
    }
  };

  const onVariantKey = (event: KeyboardEvent): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    event.preventDefault();
    const params = readParams();
    const index = VARIANTS.findIndex((variant) => variant.key === readVariant(params));
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = VARIANTS[(index + direction + VARIANTS.length) % VARIANTS.length]!;
    updateParams({ variant: next.key });
    render();
  };

  const onResize = (): void => {
    const canvas = activeRoot?.querySelector<HTMLCanvasElement>("canvas[data-canvas]");
    if (canvas) drawCanvas(canvas, visibleTasks(readFilter(readParams())), taskById(readParams().get("selected") ?? "T-01").id);
  };

  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKeyDown);
  document.addEventListener("keydown", onVariantKey);
  window.addEventListener("resize", onResize);
  cleanup = () => {
    root.removeEventListener("click", onClick);
    root.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("keydown", onVariantKey);
    window.removeEventListener("resize", onResize);
    root.remove();
  };
  render();
}
