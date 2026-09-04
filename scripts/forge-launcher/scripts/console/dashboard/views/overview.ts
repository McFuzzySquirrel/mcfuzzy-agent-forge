// ─── Overview: run header, progress, actions, pipeline guidance ─────────────

import { api } from "../api.js";
import { store } from "../state.js";
import { el, fmtDuration, fmtTime, minutesToTimeoutMs, statusBadge, toast } from "../render/dom.js";
import type { Actions, BackgroundJob, ControlAction, ExecutionMode, RunSummary, Summary, TaskRow } from "../types.js";

let gen = 0;
let unsub: Array<() => void> = [];
let pollTimer: number | undefined;
let rerenderTimer: number | undefined;

function stopPoll(): void {
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

function stopScheduledRender(): void {
  if (rerenderTimer !== undefined) {
    window.clearTimeout(rerenderTimer);
    rerenderTimer = undefined;
  }
}

function scheduleRender(container: HTMLElement): void {
  if (rerenderTimer !== undefined) return;
  rerenderTimer = window.setTimeout(() => {
    rerenderTimer = undefined;
    void renderOverview(container);
  }, 500);
}

function replaceContentPreserveScroll(container: HTMLElement, nodes: HTMLElement[]): void {
  const { scrollX, scrollY } = window;
  container.replaceChildren(...nodes);
  window.scrollTo(scrollX, scrollY);
}

export function unmountOverview(): void {
  for (const u of unsub) u();
  unsub = [];
  stopPoll();
  stopScheduledRender();
}

export async function renderOverview(container: HTMLElement): Promise<void> {
  // Clear the live-audit subscription before re-subscribing (not a full
  // unmount — pending pipeline state + polling must survive re-renders).
  for (const u of unsub) u();
  unsub = [];
  const myGen = ++gen;
  unsub.push(store.onAudit(() => scheduleRender(container)));

  // Re-fetch on every render (navigation, snapshot, or audit event) so counts
  // and actions stay current during a live run.
  let summary: Summary | null;
  let actions: Actions;
  let tasks: TaskRow[] = [];
  try {
    [summary, actions, tasks] = await Promise.all([api.summary(), api.actions(), api.tasks()]);
  } catch {
    summary = store.summary;
    actions = { canRun: false, canResume: false, canPause: false, canStop: false, failedTasks: [] };
  }
  if (myGen !== gen) return;

  if (!summary) {
    replaceContentPreserveScroll(container, [
      el("div", { className: "panel" }, [
        el("h2", null, "No project selected"),
        el("p", { className: "dim" }, "Pick a project from the list to open its console."),
        el("a", { href: "#/home", className: "btn btn-primary" }, "Choose project"),
      ]),
    ]);
    return;
  }

  replaceContentPreserveScroll(container, [
    renderHeader(summary),
    renderRun(summary.run),
    renderManifest(summary),
    renderGuidance(container, summary, actions),
    renderActions(container, summary, actions, tasks),
    summary.hasPrd && summary.hasTeam ? renderFeatureIncrement(container) : renderFeaturePrd(container),
  ]);
}

function renderFeatureIncrement(container: HTMLElement): HTMLElement {
  const input = el("textarea", { rows: "3", placeholder: "Describe the feature to add…" });
  const run = el("input", { type: "checkbox" }) as HTMLInputElement;
  const button = el("button", { className: "btn btn-primary" }, "Run Feature Increment");
  button.addEventListener("click", () => {
    const prompt = (input as HTMLTextAreaElement).value.trim();
    if (!prompt) { toast("Describe the feature first."); return; }
    button.setAttribute("disabled", "true");
    void api.featureIncrement(prompt, run.checked).then((r) => toast(r.message)).catch((e) => toast(e instanceof Error ? e.message : "feature increment failed"));
  });
  return el("div", { className: "panel" }, [el("h4", null, "Increment the project"), el("p", { className: "dim small" }, "Authors the feature, updates affected agents, recompiles the manifest, and optionally runs it."), input, el("label", { className: "checkbox-row" }, [run, el("span", null, "Run the workflow after preparing")]), el("div", { className: "actions" }, [button])]);
}

function renderFeaturePrd(container: HTMLElement): HTMLElement {
  const input = el("textarea", { rows: "3", placeholder: "Describe the feature to add…" });
  const button = el("button", { className: "btn btn-primary" }, "Author Feature PRD");
  button.addEventListener("click", () => {
    const prompt = (input as HTMLTextAreaElement).value.trim();
    if (!prompt) { toast("Describe the feature first."); return; }
    button.setAttribute("disabled", "true");
    void api.featurePrd(prompt).then((r) => toast(r.message)).catch((e) => toast(e instanceof Error ? e.message : "feature PRD failed"));
  });
  return el("div", { className: "panel" }, [el("h4", null, "Add a feature"), el("p", { className: "dim small" }, "Authoring writes a new document under docs/features/ and does not start the workflow engine."), input, el("div", { className: "actions" }, [button])]);
}

function renderHeader(summary: Summary): HTMLElement {
  const live = el(
    "span",
    { className: "live" },
    [el("span", { className: summary.live ? "live-dot on" : "live-dot" }), summary.live ? "Live" : "Idle"],
  );
  const harness = summary.harness ? el("span", { className: "badge" }, summary.harness) : null;
  const control = summary.control
    ? el("span", { className: "badge badge-paused" }, `control: ${summary.control}`)
    : null;

  const launch = el("button", { className: "btn btn-sm" }, `Launch ${summary.harness ?? "harness"} CLI`);
  launch.addEventListener("click", () => void launchCli());

  return el("div", { className: "panel" }, [
    el("div", { className: "row between" }, [
      el("div", null, [el("h1", { className: "no-margin" }, summary.repoName), el("div", { className: "dim mono small" }, summary.repoRoot)]),
      el("div", { className: "row gap" }, [live, harness, control, launch].filter(Boolean) as HTMLElement[]),
    ]),
  ]);
}

/** Opens the project's harness CLI (opencode/copilot/claude) in a new terminal. */
async function launchCli(): Promise<void> {
  try {
    const res = await api.launchCli();
    toast(res.message ?? (res.ok ? "harness CLI launched." : "launch failed"));
  } catch (err) {
    toast(err instanceof Error ? err.message : "launch failed");
  }
}

function renderRun(run: RunSummary | null): HTMLElement {
  if (!run) {
    return el("div", { className: "panel" }, [
      el("div", { className: "row gap" }, [statusBadge("no run"), el("span", { className: "dim" }, "No workflow run yet.")]),
    ]);
  }

  const counts = run.counts;
  const done = counts.complete + counts.skipped;
  const pct = run.total > 0 ? Math.round((done / run.total) * 100) : 0;
  const elapsed = fmtDuration(run.completedDurationMs);

  const stats = el("div", { className: "stats" }, [
    stat("Pending", String(counts.pending)),
    stat("Running", String(counts.running), "running"),
    stat("Complete", String(counts.complete), "complete"),
    stat("Failed", String(counts.failed), "failed"),
    stat("Skipped", String(counts.skipped), "skipped"),
    stat("Total", String(run.total)),
    stat("Started", fmtTime(run.startedAt)),
    stat("Elapsed", elapsed),
    stat("Phase", run.currentPhaseTitle ?? run.currentPhase ?? "—"),
  ]);

  const blockers = run.blockers.length > 0
    ? el("div", { className: "blockers" }, [
        el("h4", null, "Blockers"),
        el("ul", null, run.blockers.map((b) => el("li", null, b))),
      ])
    : null;

  return el("div", { className: "panel" }, [
    el("div", { className: "row between" }, [
      el("div", { className: "row gap" }, [statusBadge(run.status), el("span", { className: "dim mono small" }, run.runId)]),
    ]),
    el("div", { className: "progress" }, [
      el("div", { className: "progress-bar" }, el("div", { className: "progress-fill", style: `width:${pct}%` })),
      el("div", { className: "progress-counts" }, `${done}/${run.total} done — ${counts.failed} failed`),
    ]),
    stats,
    blockers,
  ]);
}

function renderManifest(summary: Summary): HTMLElement {
  const m = summary.manifest;
  const links = el("div", { className: "row gap" }, [
    el("a", { href: "#/documents", className: "btn btn-sm" }, "Open Plan & Team"),
  ]);

  return el("div", { className: "panel" }, [
    el("div", { className: "row between" }, [
      el("h3", null, "Manifest"),
      links,
    ]),
    m
      ? el("div", { className: "stats" }, [
          stat("Version", m.version),
          stat("Phases", String(m.phases)),
          stat("Tasks", String(m.tasks)),
          stat("Generated", fmtTime(m.generatedAt)),
        ])
      : el("p", { className: "dim" }, "No execution manifest yet."),
    m?.reconciliation
      ? el("div", { className: "detail" }, [
          el("h4", null, "Reconciliation"),
          el("p", { className: "dim small" }, "Completed task records are preserved by stable task ID. Review changed contracts before running."),
          el("div", { className: "stats" }, [
            stat("Preserved", String(m.reconciliation.preservedTaskIds.length)),
            stat("New", String(m.reconciliation.newTaskIds.length)),
            stat("Changed", String(m.reconciliation.changedTaskIds.length)),
            stat("Removed", String(m.reconciliation.removedTaskIds.length)),
          ]),
          m.reconciliation.changedTaskIds.length > 0
            ? el("p", { className: "dim small mono" }, `Changed: ${m.reconciliation.changedTaskIds.join(", ")}`)
            : null,
          m.reconciliation.newTaskIds.length > 0
            ? el("p", { className: "dim small" }, "Next action: review and select the new pending tasks in Tasks, then run the targeted workflow.")
            : null,
        ])
      : null,
  ]);
}

interface PipelineStep {
  label: string;
  action: ControlAction;
  hint: string;
}

/** Determines the next pipeline step, or null when there's nothing to advance. */
function nextStep(summary: Summary, actions: Actions): PipelineStep | null {
  if (!summary.hasPrd) {
    return {
      label: summary.hasIdea ? "Draft PRD" : "Author project PRD",
      action: summary.hasIdea ? "draft-prd" : "draft-existing-prd",
      hint: summary.hasIdea
        ? "Turns docs/IDEA.md into a reviewed PRD (headless). Review it in Plan & Team, then come back to continue."
        : "Inspects this existing repository and authors docs/PRD.md using forge-build-prd semantics.",
    };
  }
  if (!summary.hasTeam) {
    return {
      label: "Generate team",
      action: "draft-team",
      hint: "Generates the agent team from the PRD (headless). Review it, then come back to continue.",
    };
  }
  if (!summary.hasManifest && summary.executionMode === "manual" && actions.canRun) {
    return {
      label: "Create manifest",
      action: "compile-manifest",
      hint: "Compiles the manifest without starting a full build so you can choose tasks first.",
    };
  }
  if (!summary.hasManifest && actions.canRun) {
    return { label: "Start build", action: "run", hint: "Compiles the manifest and runs the workflow engine." };
  }
  return null;
}

function jobLabel(job: BackgroundJob): string {
  if (job.status === "failed") return job.message || "Background job failed.";
  if (job.status === "paused") return job.message || "Background job paused.";
  return job.message || "Background job running.";
}

function startPoll(container: HTMLElement): void {
  if (pollTimer !== undefined) return;
  pollTimer = window.setInterval(() => {
    void api.summary()
      .then((s) => {
        if (!s) return;
        if (!s.job || s.job.status !== "running") {
          stopPoll();
        }
      })
      .catch(() => {});
    void renderOverview(container);
  }, 4000);
}

async function continuePipeline(container: HTMLElement, step: PipelineStep): Promise<void> {
  try {
    const res = await api.control(step.action);
    toast(res.message || (res.ok ? "ok" : "failed"));
  } catch (err) {
    toast(err instanceof Error ? err.message : "control failed");
  }
  void renderOverview(container);
  startPoll(container);
}

function renderGuidance(container: HTMLElement, summary: Summary, actions: Actions): HTMLElement {
  const step = nextStep(summary, actions);
  const working = summary.job?.status === "running";

  let text: string;
  let hint: string;
  if (!summary.hasPrd) {
    text = summary.hasIdea ? "Draft a PRD to get started." : "Author a project PRD from this existing repository.";
  } else if (!summary.hasTeam) {
    text = "Generate the agent team.";
  } else if (!summary.hasManifest && summary.executionMode === "manual") {
    text = "Manual build enabled — create the manifest first.";
  } else if (actions.canRun) {
    text = "Ready to build.";
  } else if (actions.canResume) {
    text = "Build paused — use Controls to continue.";
  } else if (summary.hasManifest) {
    text = "Manifest ready.";
  } else {
    text = "Build in progress.";
  }

  const children: Array<HTMLElement> = [
    el("h4", null, "Pipeline"),
    el("strong", null, text),
    renderPipelineManualToggle(container, summary.executionMode),
  ];

  if (step) {
    hint = step.hint;
    const btn = el("button", { className: "btn btn-primary" }, step.label);
    if (!working) {
      btn.addEventListener("click", () => void continuePipeline(container, step));
    }
    if (!working) children.push(el("div", { className: "actions", style: "margin-top:10px" }, [btn]));
  } else if (!summary.hasPrd && !summary.hasIdea) {
    hint = "Add docs/IDEA.md to describe the project idea, then come back.";
  } else if (summary.hasManifest) {
    hint = "Use the Controls panel below to choose tasks, run, resume, or stop the build.";
  } else {
    hint = "Pipeline setup is complete.";
  }

  if (working && summary.job) {
    children.push(el("div", { className: "spinner-row", style: "margin-top:10px" }, [
      el("span", { className: "spinner", "aria-hidden": "true" }),
      el("span", { className: "dim small" }, jobLabel(summary.job)),
    ]));
    children.push(el("p", { className: "dim small" }, ["Working in the background — watch the ", el("a", { href: "#/logs" }, "Logs"), " tab."]));
  }

  if (summary.job && summary.job.status !== "running") {
    children.push(el("p", { className: summary.job.status === "failed" ? "error-text" : "dim" }, [
      `${jobLabel(summary.job)} `,
      el("a", { href: "#/logs" }, "Open logs"),
    ]));
  }

  children.push(el("p", { className: "dim" }, hint));
  return el("div", { className: "panel hint" }, children);
}

function renderActions(container: HTMLElement, summary: Summary, actions: Actions, tasks: TaskRow[]): HTMLElement {
  if (!summary.hasManifest) {
    return el("div", { className: "panel controls-disabled" }, [
      el("h4", null, "Controls"),
      el("p", { className: "dim small" }, "Controls unlock after the execution manifest is generated."),
    ]);
  }
  const ctl = (action: ControlAction, taskId?: string): void => {
    void (async () => {
      try {
        const res = await api.control(action, taskId);
        toast(res.message || (res.ok ? "ok" : "failed"));
        if (res.job?.status === "running") startPoll(container);
      } catch (err) {
        toast(err instanceof Error ? err.message : "control failed");
      }
      void renderOverview(container);
    })();
  };

  const manualNeedsSelection = summary.executionMode === "manual" && summary.selectedTaskCount === 0;
  const buttons = [
    el("button", { className: "btn btn-primary", disabled: actions.canRun && !manualNeedsSelection ? null : true }, summary.executionMode === "manual" ? "Run selected" : "Run"),
    el("button", { className: "btn", disabled: actions.canResume && !manualNeedsSelection ? null : true }, summary.executionMode === "manual" ? "Resume selected" : "Resume"),
    el("button", { className: "btn", disabled: actions.canPause ? null : true }, "Pause"),
    el("button", { className: "btn btn-danger", disabled: actions.canStop ? null : true }, "Stop"),
  ];
  buttons[0]!.addEventListener("click", () => ctl("run"));
  buttons[1]!.addEventListener("click", () => ctl("resume"));
  buttons[2]!.addEventListener("click", () => ctl("pause"));
  buttons[3]!.addEventListener("click", () => ctl("stop"));

  let replay: HTMLElement | null = null;
  if (actions.failedTasks.length > 0) {
    const select = el("select", { className: "replay-select" });
    for (const id of actions.failedTasks) select.appendChild(el("option", { value: id }, id));
    const replayBtn = el("button", { className: "btn btn-sm" }, "Replay failed");
    replayBtn.addEventListener("click", () => ctl("replay", (select as HTMLSelectElement).value));
    replay = el("div", { className: "row gap" }, [select, replayBtn]);
  }

  const timeouts = renderTimeoutControls(container, tasks);
  const mode = renderBuildModeControl(container, summary.executionMode, summary.selectedTaskCount);
  const commit = renderAutoCommitToggle(container, store.summary?.autoCommit ?? true);
  const concurrency = renderConcurrencyControl(container, store.summary?.concurrency ?? 0);
  const reset = el("button", { className: "btn btn-sm" }, "Reset changed tasks for review");
  reset.addEventListener("click", () => {
    void api.resetChangedTasks().then((res) => { toast(res.message); void renderOverview(container); }).catch((err) => toast(err instanceof Error ? err.message : "reset failed"));
  });

  return el("div", { className: "panel" }, [
    el("h4", null, "Controls"),
    mode,
    el("div", { className: "actions" }, buttons),
    manualNeedsSelection
      ? el("p", { className: "dim small" }, ["Manual mode needs at least one selected task. ", el("a", { href: "#/tasks" }, "Choose tasks")])
      : null,
    replay,
    timeouts,
    commit,
    concurrency,
    el("div", { style: "margin-top:10px" }, [reset, el("span", { className: "dim small" }, " Re-run completed tasks whose manifest contract changed.")]),
  ]);
}

function updateExecutionMode(container: HTMLElement, mode: ExecutionMode): void {
  void (async () => {
    try {
      const res = await api.setExecutionMode(mode);
      toast(res.message || (res.ok ? "updated" : "update failed"));
    } catch (err) {
      toast(err instanceof Error ? err.message : "update failed");
    }
    void renderOverview(container);
  })();
}

function renderPipelineManualToggle(container: HTMLElement, mode: ExecutionMode): HTMLElement {
  const cb = el("input", { type: "checkbox", checked: mode === "manual" ? true : null }) as HTMLInputElement;
  cb.addEventListener("change", () => updateExecutionMode(container, cb.checked ? "manual" : "auto"));
  return el("div", { style: "margin-bottom:10px" }, [
    el("label", { className: "checkbox-row" }, [
      cb,
      el("span", null, "Manual build (do not auto-run the full workflow)"),
    ]),
  ]);
}

function renderBuildModeControl(container: HTMLElement, mode: ExecutionMode, selectedCount: number): HTMLElement {
  const select = el("select", null, [
    el("option", { value: "auto", selected: mode === "auto" }, "auto (full workflow)"),
    el("option", { value: "manual", selected: mode === "manual" }, "manual (selected tasks)"),
  ]);
  select.addEventListener("change", () => updateExecutionMode(container, (select as HTMLSelectElement).value as ExecutionMode));
  return el("div", { style: "margin-bottom:10px" }, [
    el("div", { className: "row gap" }, [
      el("span", { className: "dim small" }, "Build mode"),
      select,
      el("span", { className: "dim small" }, mode === "manual" ? `${selectedCount} task(s) selected` : "full workflow"),
      el("a", { href: "#/tasks", className: "btn btn-sm" }, "Choose tasks"),
    ]),
  ]);
}

function renderAutoCommitToggle(container: HTMLElement, enabled: boolean): HTMLElement {
  const cb = el("input", { type: "checkbox", checked: enabled ? true : null });
  const label = el("label", { className: "checkbox-row" }, [
    cb,
    el("span", null, "Auto-commit after each task (one commit per completed task)"),
  ]);
  cb.addEventListener("change", () => {
    const value = (cb as HTMLInputElement).checked;
    void (async () => {
      try {
        const res = await api.setAutoCommit(value);
        toast(res.message || (res.ok ? "updated" : "update failed"));
      } catch (err) {
        toast(err instanceof Error ? err.message : "update failed");
      }
      void renderOverview(container);
    })();
  });
  return el("div", { style: "margin-top:10px" }, [label]);
}

function renderConcurrencyControl(container: HTMLElement, current: number): HTMLElement {
  const input = el("input", {
    type: "number",
    placeholder: "1",
    min: "0",
    className: "timeout-input",
    value: current > 0 ? String(current) : "",
  });
  const btn = el("button", { className: "btn btn-sm" }, "Set");
  btn.addEventListener("click", () => {
    const raw = Number((input as HTMLInputElement).value);
    if (!Number.isInteger(raw) || raw < 0) {
      toast("Enter a positive integer (or 0 for engine default).");
      return;
    }
    void (async () => {
      try {
        const res = await api.setConcurrency(raw);
        toast(res.message || (res.ok ? "updated" : "update failed"));
      } catch (err) {
        toast(err instanceof Error ? err.message : "update failed");
      }
      void renderOverview(container);
    })();
  });
  const hint = el("span", { className: "dim small" }, current > 0 ? `current: ${current}` : "current: engine default");
  return el("div", { style: "margin-top:10px" }, [
    el("div", { className: "row gap" }, [
      el("span", { className: "dim small" }, "Concurrency (parallel agents)"),
      input,
      btn,
      hint,
    ]),
  ]);
}

function renderTimeoutControls(container: HTMLElement, tasks: TaskRow[]): HTMLElement {
  const reload = (): void => {
    void renderOverview(container);
  };

  const sorted = [...tasks].sort((a, b) => {
    const af = a.status === "failed" ? 0 : 1;
    const bf = b.status === "failed" ? 0 : 1;
    return af - bf || a.id.localeCompare(b.id);
  });

  const taskSelect = el("select", { className: "replay-select" });
  for (const t of sorted) {
    taskSelect.appendChild(el("option", { value: t.id }, `${t.id} — ${t.title}`));
  }

  const taskInput = el("input", { type: "number", placeholder: "min", className: "timeout-input" });
  const setTask = el("button", { className: "btn btn-sm" }, "Set");
  setTask.addEventListener("click", () => {
    const minutes = Number((taskInput as HTMLInputElement).value);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      toast("Enter a positive timeout in minutes.");
      return;
    }
    const id = (taskSelect as HTMLSelectElement).value;
    if (!id) {
      toast("Select a task.");
      return;
    }
    void (async () => {
      try {
        const res = await api.setTaskTimeout(id, minutesToTimeoutMs(minutes));
        toast(res.message || (res.ok ? "ok" : "failed"));
        reload();
      } catch (err) {
        toast(err instanceof Error ? err.message : "update failed");
      }
    })();
  });

  const allInput = el("input", { type: "number", placeholder: "min", className: "timeout-input" });
  const setAll = el("button", { className: "btn btn-sm" }, "Set all");
  setAll.addEventListener("click", () => {
    const minutes = Number((allInput as HTMLInputElement).value);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      toast("Enter a positive timeout in minutes.");
      return;
    }
    void (async () => {
      try {
        const res = await api.setAllTaskTimeouts(minutesToTimeoutMs(minutes));
        toast(res.message || (res.ok ? "ok" : "failed"));
        reload();
      } catch (err) {
        toast(err instanceof Error ? err.message : "update failed");
      }
    })();
  });

  return el("div", { className: "timeout-controls" }, [
    el("h4", null, "Timeouts"),
    el("div", { className: "row gap", style: "margin:6px 0" }, [
      el("span", { className: "dim small" }, "Task"),
      taskSelect,
      taskInput,
      setTask,
    ]),
    el("div", { className: "row gap" }, [
      el("span", { className: "dim small" }, "All tasks"),
      allInput,
      setAll,
    ]),
  ]);
}

function stat(label: string, value: string, cls?: string): HTMLElement {
  return el("div", { className: "stat" }, [
    el("div", { className: "k" }, label),
    el("div", { className: cls ? `v v-${cls}` : "v" }, value),
  ]);
}
