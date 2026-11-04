import { api } from "../api.js";
import { store } from "../state.js";
import { el, fmtAgo, fmtDuration, statusBadge } from "../render/dom.js";
import type { BoardGanttBar, BoardGanttLayout, BoardLayout } from "../types.js";
import { boardTaskChangeAnnouncement, boardTaskTitlesById, shouldDimBoardTask, summarizeBoardTasks, type BoardTaskSummary } from "./board-model.js";
import { BoardPreferences, type BoardMode, type BoardStatusFilter } from "./board-preferences.js";

const STATUSES: Array<{ value: BoardStatusFilter; label: string }> = [
  { value: "pending", label: "To do" },
  { value: "running", label: "In progress" },
  { value: "complete", label: "Done" },
  { value: "failed", label: "Failed" },
  { value: "skipped", label: "Skipped" },
];
const MODES: Array<[BoardMode, string]> = [["kanban", "Kanban"], ["gantt", "Gantt"]];
const STALE_AFTER_MS = 5 * 60 * 1000;

let container: HTMLElement | null = null;
let boardShell: HTMLElement | null = null;
let liveRegion: HTMLElement | null = null;
let originalAriaLive: string | null = null;
let scrollHost: HTMLElement | null = null;
let horizontalScrollHost: HTMLElement | null = null;
let scrollHostMode: BoardMode | null = null;
let preferences: BoardPreferences | null = null;
let tasks: BoardTaskSummary[] = [];
let layout: BoardLayout | null = null;
let tasksLoaded = false;
let loading = true;
let refreshing = false;
let taskError: string | null = null;
let layoutError: string | null = null;
let lastRefreshedAt: number | null = null;
let refreshGeneration = 0;
let refreshTimer: number | undefined;
let resizeRestoreFrame: number | undefined;
let resizeReleaseFrame: number | undefined;
let restoringResponsivePosition = false;
let lastViewportSize: { width: number; height: number } | null = null;
let unsubscribe: (() => void) | null = null;
let focusAfterRender: string | null = null;
let returnFocusKey: string | null = null;
let staleNoticeActive = false;

function currentProject(): string {
  return store.projectKey();
}

function boardStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function currentPreferences() {
  return preferences?.get() ?? {
    mode: "kanban" as const,
    statuses: [] as BoardStatusFilter[],
    selectedTaskId: null,
    positions: { kanban: { left: 0, top: 0 }, gantt: { left: 0, top: 0 } },
  };
}

function taskById(id: string | null): BoardTaskSummary | null {
  return id ? tasks.find((task) => task.id === id) ?? null : null;
}

function taskFocusKey(taskId: string): string {
  return `task:${encodeURIComponent(taskId)}`;
}

function restoreResponsivePosition(): void {
  const size = { width: window.innerWidth, height: window.innerHeight };
  if (lastViewportSize?.width === size.width && lastViewportSize.height === size.height) return;
  lastViewportSize = size;
  restoringResponsivePosition = true;
  if (resizeRestoreFrame !== undefined) window.cancelAnimationFrame(resizeRestoreFrame);
  if (resizeReleaseFrame !== undefined) window.cancelAnimationFrame(resizeReleaseFrame);
  resizeRestoreFrame = window.requestAnimationFrame(() => {
    resizeRestoreFrame = undefined;
    if (scrollHost && scrollHostMode && preferences) {
      const position = preferences.get().positions[scrollHostMode];
      scrollHost.scrollTop = position.top;
      if (horizontalScrollHost) horizontalScrollHost.scrollLeft = position.left;
      else scrollHost.scrollLeft = position.left;
    }
    resizeReleaseFrame = window.requestAnimationFrame(() => {
      resizeReleaseFrame = undefined;
      restoringResponsivePosition = false;
    });
  });
}

function preferredHorizontalPosition(mode: BoardMode, viewport: HTMLElement, horizontal: HTMLElement | null): number {
  const current = horizontal?.scrollLeft ?? viewport.scrollLeft;
  const saved = preferences?.get().positions[mode].left ?? 0;
  const maximum = horizontal
    ? Math.max(0, horizontal.scrollWidth - horizontal.clientWidth)
    : Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  return saved > current && current >= maximum - 1 ? saved : current;
}

function saveScrollPosition(): void {
  if (!scrollHost || !scrollHostMode || !preferences) return;
  if (restoringResponsivePosition || lastViewportSize?.width !== window.innerWidth
    || lastViewportSize.height !== window.innerHeight) {
    restoreResponsivePosition();
    return;
  }
  preferences.setPosition(scrollHostMode, {
    left: preferredHorizontalPosition(scrollHostMode, scrollHost, horizontalScrollHost),
    top: scrollHost.scrollTop,
  });
}

function activeFocusKey(): string | null {
  if (!container || !(document.activeElement instanceof HTMLElement) || !container.contains(document.activeElement)) return null;
  return document.activeElement.dataset.boardFocus ?? null;
}

function announce(message: string): void {
  if (!liveRegion || liveRegion.textContent === message) return;
  liveRegion.textContent = message;
}

function focusByKey(root: HTMLElement, key: string | null): void {
  if (!key) return;
  const targets = [...root.querySelectorAll<HTMLElement>("[data-board-focus]")];
  const target = targets.find((element) => element.dataset.boardFocus === key)
    ?? (key.startsWith("bar:") || key.startsWith("attention:task:")
      ? targets.find((element) => element.dataset.boardFocus === `task:${key.slice(key.lastIndexOf(":") + 1)}`)
      : undefined);
  target?.focus({ preventScroll: true });
}

function taskStatusLabel(task: BoardTaskSummary): string {
  if (task.attention === "blocked") return "Blocked";
  if (task.attention === "human-review") return "Needs your review";
  return STATUSES.find((status) => status.value === task.status)?.label ?? task.status;
}

function taskControl(task: BoardTaskSummary, selectedId: string | null, statuses: readonly BoardStatusFilter[], focusKey = taskFocusKey(task.id)): HTMLElement {
  const control = el("button", {
    type: "button",
    className: [
      "board-task-control",
      task.attention ? `board-task-attention-${task.attention}` : "",
      shouldDimBoardTask(task, statuses) ? "board-task-dimmed" : "",
    ].filter(Boolean).join(" "),
    "data-board-task-id": task.id,
    "data-board-focus": focusKey,
    "aria-pressed": task.id === selectedId ? "true" : "false",
  }, [
    el("span", { className: "board-task-heading" }, [
      statusBadge(taskStatusLabel(task)),
    ]),
    el("strong", { className: "board-task-title" }, task.title),
  ]);
  return control;
}

function renderAttention(tasksToShow: BoardTaskSummary[], selectedId: string | null, statuses: readonly BoardStatusFilter[]): HTMLElement | null {
  const attentionTasks = tasksToShow.filter((task) => task.attention !== null);
  if (attentionTasks.length === 0) return null;
  return el("section", { className: "board-attention", "aria-labelledby": "board-attention-title" }, [
    el("div", null, [
      el("h2", { id: "board-attention-title" }, "Needs attention"),
      el("p", { className: "dim small" }, "Failures, blocked work, and Human review Tasks stay visible in either view."),
    ]),
    el("ul", { className: "board-attention-list" }, attentionTasks.map((task) =>
      el("li", null, taskControl(task, selectedId, statuses, `attention:${taskFocusKey(task.id)}`)),
    )),
  ]);
}

function renderModeTabs(mode: BoardMode): HTMLElement {
  return el("div", { className: "board-mode-tabs", role: "tablist", "aria-label": "Board view" },
    MODES.map(([value, label]) => el("button", {
      type: "button",
      role: "tab",
      className: value === mode ? "active" : "",
      "data-board-mode": value,
      "data-board-focus": `mode:${value}`,
      "aria-selected": value === mode ? "true" : "false",
    }, label)),
  );
}

function renderFilters(statuses: readonly BoardStatusFilter[]): HTMLElement {
  const allSelected = statuses.length === 0;
  return el("div", { className: "board-status-filters", role: "group", "aria-label": "Filter Tasks by status" }, [
    el("span", { className: "dim small" }, "Show status:"),
    el("button", {
      type: "button",
      className: allSelected ? "chip active" : "chip",
      "data-board-filter": "all",
      "data-board-focus": "filter:all",
      "aria-pressed": allSelected ? "true" : "false",
    }, "All"),
    ...STATUSES.map(({ value, label }) => el("button", {
      type: "button",
      className: statuses.includes(value) ? "chip active" : "chip",
      "data-board-filter": value,
      "data-board-focus": `filter:${value}`,
      "aria-pressed": statuses.includes(value) ? "true" : "false",
    }, label)),
  ]);
}

function renderKanban(statuses: readonly BoardStatusFilter[], selectedId: string | null): HTMLElement {
  const phaseNames = new Map<string, string>();
  for (const task of tasks) phaseNames.set(task.phaseId, task.phaseTitle);
  const table = el("table", { className: "board-kanban-table", "aria-label": "Tasks by phase and workflow status" });
  table.appendChild(el("caption", { className: "sr-only" }, "Kanban Board grouped by phase and workflow status."));
  table.appendChild(el("thead", null, [
    el("tr", null, [
      el("th", { scope: "col" }, "Phase"),
      ...STATUSES.map(({ label }) => el("th", { scope: "col" }, label)),
    ]),
  ]));

  const body = el("tbody");
  for (const [phaseId, phaseTitle] of phaseNames) {
    const cells: HTMLElement[] = [
      el("th", { scope: "row", className: "board-kanban-phase" }, [
        el("strong", null, phaseTitle),
        el("span", { className: "dim small mono" }, phaseId),
      ]),
    ];
    for (const { value } of STATUSES) {
      const phaseTasks = tasks.filter((task) => task.phaseId === phaseId && task.status === value);
      cells.push(el("td", { className: "board-kanban-cell" }, phaseTasks.length
        ? el("ul", { className: "board-task-list" }, phaseTasks.map((task) =>
          el("li", null, taskControl(task, selectedId, statuses)),
        ))
        : el("span", { className: "board-empty-cell", "aria-label": "No Tasks" }, "—"),
      ));
    }
    body.appendChild(el("tr", null, cells));
  }
  table.appendChild(body);
  return el("div", { className: "board-kanban-scroll", "aria-label": "Horizontally navigable Kanban columns" }, [table]);
}

function estimateSourceLabel(source: BoardGanttBar["estimateSource"]): string {
  switch (source) {
    case "actual": return "measured";
    case "audit": return "observed attempts";
    case "owner": return "same agent's tasks";
    case "default": return "default estimate";
  }
}

function barDescription(bar: BoardGanttBar): string {
  if (bar.milestone) return "Human review milestone";
  const kind = bar.kind === "actual" ? (bar.status === "running" ? "Measured so far" : "Actual") : "Forecast";
  const source = bar.kind === "planned" ? ` · ${estimateSourceLabel(bar.estimateSource)}` : "";
  return `${kind}: ${fmtDuration(bar.durationMs)}${source}`;
}

function renderGanttAxis(gantt: BoardGanttLayout): HTMLElement {
  const axis = el("div", { className: "board-gantt-axis", "aria-label": "Timeline" });
  const span = Math.max(1, gantt.axis.max - gantt.axis.min);
  for (const tick of gantt.axis.ticks ?? []) {
    const label = el("span", {
      className: tick.dayBoundary ? "board-gantt-tick day-boundary" : "board-gantt-tick",
      "aria-hidden": "true",
    }, tick.label);
    label.style.left = `${Math.max(0, Math.min(100, ((tick.at - gantt.axis.min) / span) * 100))}%`;
    axis.appendChild(label);
  }
  return axis;
}

function renderGanttBar(
  task: BoardTaskSummary,
  bar: BoardGanttBar | undefined,
  gantt: BoardGanttLayout,
  selectedId: string | null,
): HTMLElement {
  const track = el("div", { className: "board-gantt-track" });
  if (!bar) {
    track.appendChild(el("span", { className: "dim small" }, "No timeline estimate"));
    return track;
  }
  const span = Math.max(1, gantt.axis.max - gantt.axis.min);
  const left = Math.max(0, Math.min(100, ((bar.startMs - gantt.axis.min) / span) * 100));
  const width = bar.milestone ? 0 : Math.max(2, Math.min(100 - left, ((bar.endMs - bar.startMs) / span) * 100));
  const details = [
    task.title,
    barDescription(bar),
    bar.critical ? "on the critical path" : "",
  ].filter(Boolean).join(", ");
  const button = el("button", {
    type: "button",
    className: [
      "board-gantt-bar",
      bar.kind === "planned" ? "is-forecast" : "is-actual",
      bar.critical ? "is-critical" : "",
      bar.milestone ? "is-milestone" : "",
    ].filter(Boolean).join(" "),
    "data-board-task-id": task.id,
    "data-board-focus": `bar:${encodeURIComponent(task.id)}`,
    "aria-label": details,
    "aria-pressed": task.id === selectedId ? "true" : "false",
  });
  button.style.left = `${left}%`;
  button.style.width = `${width}%`;
  track.appendChild(button);
  return track;
}

function renderGantt(statuses: readonly BoardStatusFilter[], selectedId: string | null): HTMLElement {
  const gantt = layout?.gantt;
  if (!gantt) {
    const unavailable = el("section", { className: "board-timeline-unavailable" }, [
      el("h2", null, "Timeline unavailable"),
      el("p", null, layoutError
        ? "Timeline data could not be loaded. Refresh to try again; Tasks remain available below."
        : "Timeline estimates are available after a Build plan is prepared."),
      layoutError ? el("button", {
        type: "button",
        className: "btn btn-sm",
        "data-board-refresh": "true",
        "data-board-focus": "refresh",
      }, "Refresh") : null,
    ]);
    return el("div", null, [
      unavailable,
      el("ul", { className: "board-gantt-fallback-list", "aria-label": "Tasks and summaries" }, tasks.map((task) =>
        el("li", null, taskControl(task, selectedId, statuses)),
      )),
    ]);
  }

  const barByTask = new Map(gantt.bars.map((bar) => [bar.taskId, bar]));
  const titleById = boardTaskTitlesById(tasks);
  const criticalTasks = gantt.criticalPath.map((id) => titleById.get(id) ?? id);
  const table = el("table", { className: "board-gantt-table", "aria-label": "Task timeline and duration" });
  table.appendChild(el("caption", { className: "sr-only" }, "Gantt timeline with actual and forecast durations."));
  table.appendChild(el("thead", null, [
    el("tr", null, [
      el("th", { scope: "col" }, "Task"),
      el("th", { scope: "col", className: "board-gantt-timeline-heading" }, renderGanttAxis(gantt)),
      el("th", { scope: "col" }, "Duration"),
      el("th", { scope: "col" }, "Path"),
    ]),
  ]));

  const body = el("tbody");
  const phaseNames = new Map<string, string>();
  for (const task of tasks) phaseNames.set(task.phaseId, task.phaseTitle);
  for (const [phaseId, phaseTitle] of phaseNames) {
    body.appendChild(el("tr", { className: "board-gantt-phase" }, [
      el("th", { scope: "rowgroup", colspan: "4" }, [el("strong", null, phaseTitle), el("span", { className: "dim small mono" }, ` · ${phaseId}`)]),
    ]));
    for (const task of tasks.filter((entry) => entry.phaseId === phaseId)) {
      const bar = barByTask.get(task.id);
      const dimmed = shouldDimBoardTask(task, statuses);
      const row = el("tr", { className: dimmed ? "board-gantt-row is-dimmed" : "board-gantt-row" }, [
        el("td", null, taskControl(task, selectedId, statuses)),
        el("td", null, renderGanttBar(task, bar, gantt, selectedId)),
        el("td", { className: "board-gantt-duration" }, bar ? barDescription(bar) : "Not scheduled"),
        el("td", null, bar?.critical ? el("span", { className: "board-critical-tag" }, "Critical path") : "—"),
      ]);
      body.appendChild(row);
    }
  }
  table.appendChild(body);
  return el("div", { className: "board-gantt-scroll" }, [
    el("p", { className: "board-critical-summary" }, criticalTasks.length > 0
      ? `Critical path: ${criticalTasks.join(" → ")}`
      : "No remaining critical path."),
    table,
  ]);
}

function renderDetails(task: BoardTaskSummary): HTMLElement {
  const titleById = boardTaskTitlesById(tasks);
  const dependencies = task.dependencies.map((id) => titleById.get(id) ?? id);
  const heading = el("h2", {
    id: "board-details-title",
    tabindex: "-1",
    "data-board-focus": "details-heading",
  }, "Task details");
  const definition = (label: string, value: string | HTMLElement): HTMLElement =>
    el("div", null, [el("dt", null, label), el("dd", null, value)]);
  const rows: HTMLElement[] = [
    definition("Status", taskStatusLabel(task)),
    definition("Phase", task.phaseTitle),
    definition("Next responsible", task.nextResponsible),
    definition("Next action", task.nextAction),
  ];
  if (task.blocker) rows.push(definition("Blocked by / failure", task.blocker));
  const textList = (values: readonly string[]): HTMLElement => el("ul", { className: "board-detail-list" },
    values.map((value) => el("li", null, value)),
  );
  rows.push(definition("Prerequisites", dependencies.length ? textList(dependencies) : "None"));
  rows.push(definition("Artifact inputs", task.artifactInputs.length ? textList(task.artifactInputs) : "None"));
  const artifactsProduced: HTMLElement[] = [];
  if (task.artifactId) artifactsProduced.push(el("li", null, `Artifact ID: ${task.artifactId}`));
  if (task.artifactType) artifactsProduced.push(el("li", null, `Artifact type: ${task.artifactType}`));
  rows.push(definition("Artifacts produced", artifactsProduced.length
    ? el("ul", { className: "board-detail-list" }, artifactsProduced)
    : "None"));
  if (task.outputFiles.length > 0) rows.push(definition("Files changed", textList(task.outputFiles)));

  return el("aside", {
    className: "board-details",
    role: "region",
    "aria-labelledby": "board-details-title",
  }, [
    el("div", { className: "board-details-heading" }, [
      heading,
      el("button", {
        type: "button",
        className: "btn btn-sm",
        "data-board-close": "true",
        "data-board-focus": "details-close",
        "aria-label": "Close Task details",
      }, "Close"),
    ]),
    statusBadge(taskStatusLabel(task)),
    el("h3", null, task.title),
    el("p", { className: "board-details-summary" }, task.summary),
    task.attentionCue ? el("p", { className: `board-details-cue board-details-cue-${task.attention}` }, task.attentionCue) : null,
    el("dl", null, rows),
    el("a", { className: "btn btn-sm", href: `#/tasks?task=${encodeURIComponent(task.id)}` }, "Open full diagnostics in All tasks"),
  ]);
}

function staleRunMessage(): string | null {
  const state = store.state;
  if (!state || !["running", "paused"].includes(state.status.toLowerCase())) return null;
  const updatedAt = Date.parse(state.lastUpdatedAt);
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt <= STALE_AFTER_MS) return null;
  return `Build data has not changed since ${fmtAgo(state.lastUpdatedAt)}. Check Logs or refresh the Board.`;
}

function renderStateMessage(): HTMLElement | null {
  if (loading && tasks.length === 0) {
    return el("p", { className: "board-message" }, "Loading Board…");
  }
  if (taskError && tasks.length === 0) {
    return el("div", { className: "board-message board-message-error" }, [
      el("strong", null, "Board data could not be loaded."),
      el("span", null, taskError),
      el("button", {
        type: "button",
        className: "btn btn-sm",
        "data-board-refresh": "true",
        "data-board-focus": "refresh",
      }, "Try again"),
    ]);
  }
  if (tasksLoaded && tasks.length === 0) {
    const hasManifest = store.summary?.hasManifest ?? false;
    return el("div", { className: "board-message board-message-empty" }, [
      el("h2", null, hasManifest ? "No Tasks are in this Build." : "Your Board is ready when Tasks are prepared."),
      el("p", null, hasManifest
        ? "This Project's execution manifest currently contains no Tasks."
        : "Continue in Build status to prepare the Project before starting a Build."),
      el("a", { className: "btn btn-sm btn-primary", href: "#/overview" }, "Open Build status"),
    ]);
  }
  return null;
}

function renderBoardUi(): void {
  if (!container || !preferences) return;
  const focusKey = focusAfterRender ?? activeFocusKey();
  focusAfterRender = null;
  saveScrollPosition();
  let savePosition: (() => void) | null = null;
  let restorePosition: { left: number; top: number } | null = null;
  const state = currentPreferences();
  const selected = taskById(state.selectedTaskId);
  const root = el("section", {
    className: "semantic-board",
    "aria-labelledby": "board-title",
    "aria-busy": loading || refreshing ? "true" : "false",
  });
  root.appendChild(el("header", { className: "board-heading" }, [
    el("div", null, [
      el("p", { className: "board-kicker" }, "Project Board"),
      el("h1", { id: "board-title" }, "Board"),
      el("p", { className: "dim" }, "Kanban foregrounds workflow state; Gantt adds actual and forecast timing. Task details stay the same."),
    ]),
    el("button", {
      type: "button",
      className: "btn btn-sm",
      "data-board-refresh": "true",
      "data-board-focus": "refresh",
      disabled: refreshing ? true : null,
    }, refreshing ? "Refreshing…" : "Refresh"),
  ]));

  root.appendChild(el("div", { className: "board-toolbar" }, [
    renderModeTabs(state.mode),
    renderFilters(state.statuses),
  ]));

  if (taskError && tasks.length > 0) {
    root.appendChild(el("p", { className: "board-notice board-notice-warning" }, [
      `Could not refresh Task data. Showing the last available Board data. ${taskError} `,
      el("a", { href: "#/logs" }, "Open Logs"),
    ]));
  }
  const staleMessage = staleRunMessage();
  if (staleMessage) {
    if (!staleNoticeActive) announce("Build data may be stale. Check Logs or refresh the Board.");
    staleNoticeActive = true;
    root.appendChild(el("p", { className: "board-notice board-notice-stale" }, [
      staleMessage,
      " ",
      el("a", { href: "#/logs" }, "Open Logs"),
    ]));
  } else if (staleNoticeActive) {
    staleNoticeActive = false;
    announce("Build data is current again.");
  }
  if (lastRefreshedAt) {
    root.appendChild(el("p", { className: "board-last-updated" }, `Board data refreshed ${fmtAgo(new Date(lastRefreshedAt).toISOString())}.`));
  }

  const message = renderStateMessage();
  if (message) {
    root.appendChild(message);
  } else {
    const attention = renderAttention(tasks, state.selectedTaskId, state.statuses);
    if (attention) root.appendChild(attention);
    const viewport = el("div", {
      className: `board-viewport board-viewport-${state.mode}`,
      tabindex: "0",
      "aria-label": state.mode === "kanban" ? "Kanban Board content" : "Gantt Board content",
    });
    const content = state.mode === "kanban"
      ? renderKanban(state.statuses, state.selectedTaskId)
      : renderGantt(state.statuses, state.selectedTaskId);
    viewport.appendChild(content);
    const horizontalContent = content.matches(".board-kanban-scroll, .board-gantt-scroll")
      ? content
      : content.querySelector<HTMLElement>(".board-kanban-scroll, .board-gantt-scroll");
    horizontalScrollHost = horizontalContent;
    savePosition = (): void => {
      if (!preferences) return;
      preferences.setPosition(state.mode, {
        left: preferredHorizontalPosition(state.mode, viewport, horizontalContent),
        top: viewport.scrollTop,
      });
    };
    root.appendChild(el("div", { className: selected ? "board-body has-details" : "board-body" }, [
      viewport,
      selected ? renderDetails(selected) : null,
    ]));
    scrollHost = viewport;
    scrollHostMode = state.mode;
    restorePosition = state.positions[state.mode];
  }

  boardShell?.replaceChildren(root);
  if (restorePosition && scrollHost) {
    scrollHost.scrollTop = restorePosition.top;
    if (horizontalScrollHost) horizontalScrollHost.scrollLeft = restorePosition.left;
    else scrollHost.scrollLeft = restorePosition.left;
  }
  if (savePosition) {
    scrollHost?.addEventListener("scroll", savePosition);
    horizontalScrollHost?.addEventListener("scroll", savePosition);
  }
  focusByKey(root, focusKey);
}

function scheduleRefresh(): void {
  if (!container) return;
  if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    refreshTimer = undefined;
    void refreshBoard();
  }, 350);
}

async function refreshBoard(): Promise<void> {
  if (!container) return;
  const request = ++refreshGeneration;
  loading = !tasksLoaded;
  refreshing = true;
  renderBoardUi();
  const layoutRequest = api.layout().then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );
  try {
    const taskSummaries = summarizeBoardTasks(await api.tasks());
    if (tasksLoaded) {
      const changeAnnouncement = boardTaskChangeAnnouncement(tasks, taskSummaries);
      if (changeAnnouncement) announce(changeAnnouncement);
    }
    else tasksLoaded = true;
    if (taskError) announce("Board Task data is current again.");
    tasks = taskSummaries;
    taskError = null;
    lastRefreshedAt = Date.now();
    const selectedId = currentPreferences().selectedTaskId;
    if (selectedId && !tasks.some((task) => task.id === selectedId)) {
      preferences?.setSelectedTaskId(null);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "The Task request failed.";
    if (taskError !== message) {
      announce(tasksLoaded
        ? "Task data could not be refreshed. The most recent Board data remains visible."
        : "Board Task data could not be loaded. Try refreshing.");
    }
    taskError = message;
  }
  if (request !== refreshGeneration || !container) return;
  loading = false;
  refreshing = false;
  renderBoardUi();

  const layoutResult = await layoutRequest;
  if (request !== refreshGeneration || !container) return;
  if (layoutResult.status === "fulfilled") {
    layout = layoutResult.value;
    if (layoutError) announce("Gantt timeline data is available again.");
    layoutError = null;
  } else {
    const message = layoutResult.reason instanceof Error ? layoutResult.reason.message : "The timeline request failed.";
    if (layoutError !== message) announce("Gantt timeline data could not be loaded. Refresh to try again.");
    layoutError = message;
  }
  renderBoardUi();
}

function setMode(mode: BoardMode): void {
  if (!preferences || currentPreferences().mode === mode) return;
  saveScrollPosition();
  preferences.setMode(mode);
  focusAfterRender = `mode:${mode}`;
  renderBoardUi();
}

function handleClick(event: Event): void {
  if (!(event.target instanceof Element) || !preferences) return;
  const target = event.target;
  const mode = target.closest<HTMLButtonElement>("[data-board-mode]")?.dataset.boardMode;
  if (mode === "kanban" || mode === "gantt") {
    setMode(mode);
    return;
  }
  if (target.closest("[data-board-refresh]")) {
    void refreshBoard();
    return;
  }
  const filter = target.closest<HTMLButtonElement>("[data-board-filter]")?.dataset.boardFilter;
  if (filter === "all") {
    preferences.setStatuses([]);
    renderBoardUi();
    return;
  }
  if (filter && STATUSES.some((status) => status.value === filter)) {
    const statuses = currentPreferences().statuses;
    preferences.setStatuses(statuses.includes(filter as BoardStatusFilter)
      ? statuses.filter((status) => status !== filter)
      : [...statuses, filter as BoardStatusFilter]);
    renderBoardUi();
    return;
  }
  if (target.closest("[data-board-close]")) {
    const selectedId = currentPreferences().selectedTaskId;
    preferences.setSelectedTaskId(null);
    focusAfterRender = returnFocusKey ?? (selectedId ? taskFocusKey(selectedId) : null);
    returnFocusKey = null;
    renderBoardUi();
    return;
  }
  const taskId = target.closest<HTMLElement>("[data-board-task-id]")?.dataset.boardTaskId;
  if (taskId && taskById(taskId)) {
    returnFocusKey = target.closest<HTMLElement>("[data-board-focus]")?.dataset.boardFocus ?? taskFocusKey(taskId);
    preferences.setSelectedTaskId(taskId);
    focusAfterRender = "details-heading";
    renderBoardUi();
  }
}

function handleKeyDown(event: KeyboardEvent): void {
  if (!(event.target instanceof HTMLElement)) return;
  const modeButton = event.target.closest<HTMLElement>("[data-board-mode]");
  if (!modeButton || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
  event.preventDefault();
  const current = modeButton.dataset.boardMode === "gantt" ? 1 : 0;
  const next = MODES[(current + (event.key === "ArrowRight" ? 1 : MODES.length - 1)) % MODES.length]![0];
  setMode(next);
}

export function unmountBoard(): void {
  if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
  refreshTimer = undefined;
  if (resizeRestoreFrame !== undefined) window.cancelAnimationFrame(resizeRestoreFrame);
  if (resizeReleaseFrame !== undefined) window.cancelAnimationFrame(resizeReleaseFrame);
  resizeRestoreFrame = undefined;
  resizeReleaseFrame = undefined;
  restoringResponsivePosition = false;
  lastViewportSize = null;
  window.removeEventListener("resize", restoreResponsivePosition);
  unsubscribe?.();
  unsubscribe = null;
  const previousContainer = container;
  previousContainer?.removeEventListener("click", handleClick);
  previousContainer?.removeEventListener("keydown", handleKeyDown);
  if (previousContainer && originalAriaLive === null) previousContainer.removeAttribute("aria-live");
  else if (previousContainer && originalAriaLive !== null) previousContainer.setAttribute("aria-live", originalAriaLive);
  container = null;
  boardShell = null;
  liveRegion = null;
  originalAriaLive = null;
  scrollHost = null;
  horizontalScrollHost = null;
  scrollHostMode = null;
  preferences = null;
  tasks = [];
  layout = null;
  tasksLoaded = false;
  loading = true;
  refreshing = false;
  taskError = null;
  layoutError = null;
  lastRefreshedAt = null;
  refreshGeneration += 1;
  focusAfterRender = null;
  returnFocusKey = null;
  staleNoticeActive = false;
}

export function renderBoard(host: HTMLElement): void {
  unmountBoard();
  container = host;
  originalAriaLive = container.getAttribute("aria-live");
  container.setAttribute("aria-live", "off");
  boardShell = el("div", { className: "board-shell" });
  liveRegion = el("div", { className: "sr-only", "aria-live": "polite", "aria-atomic": "true" });
  container.replaceChildren(boardShell, liveRegion);
  preferences = new BoardPreferences(boardStorage(), currentProject());
  lastViewportSize = { width: window.innerWidth, height: window.innerHeight };
  window.addEventListener("resize", restoreResponsivePosition);
  container.addEventListener("click", handleClick);
  container.addEventListener("keydown", handleKeyDown);
  unsubscribe = store.subscribe(scheduleRefresh);
  announce("Loading Board data.");
  renderBoardUi();
  void refreshBoard();
}
