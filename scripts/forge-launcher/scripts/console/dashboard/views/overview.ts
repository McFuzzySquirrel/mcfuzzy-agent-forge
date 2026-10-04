// ─── Overview: run header, progress, actions, pipeline guidance ─────────────

import { api } from "../api.js";
import { Epoch, store } from "../state.js";
import { el, fmtAgo, fmtDuration, fmtTime, minutesToTimeoutMs, statusBadge, toast } from "../render/dom.js";
import type {
  Actions,
  AuthoringSessionTarget,
  AuthoringStageDetail,
  AuthoringStageState,
  BackgroundJob,
  ControlAction,
  ExecutionMode,
  RederiveStepStatus,
  RunSummary,
  Summary,
  TaskRow,
} from "../types.js";

const renderEpoch = new Epoch();
let unsub: Array<() => void> = [];
let pollTimer: number | undefined;
let refreshTimer: number | undefined;
let overviewContainer: HTMLElement | null = null;
let refreshInFlight = false;

function stopPoll(): void {
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

function stopScheduledRender(): void {
  if (refreshTimer !== undefined) {
    window.clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }
}

function scheduleRender(container: HTMLElement): void {
  if (refreshTimer !== undefined) return;
  refreshTimer = window.setTimeout(() => {
    refreshTimer = undefined;
    void refreshOverviewData(container);
  }, 500);
}

export function unmountOverview(): void {
  for (const u of unsub) u();
  unsub = [];
  stopPoll();
  stopScheduledRender();
  overviewContainer = null;
}

export async function renderOverview(container: HTMLElement): Promise<void> {
  if (overviewContainer === container) {
    await refreshOverviewData(container);
    return;
  }
  overviewContainer = container;
  container.replaceChildren(el("div", { className: "panel", role: "status" }, [
    el("div", { className: "spinner-row" }, [el("span", { className: "spinner", "aria-hidden": "true" }), "Loading project status…"]),
  ]));
  for (const u of unsub) u();
  unsub = [];
  const myGen = renderEpoch.next();
  unsub.push(store.onAudit(() => scheduleRender(container)));

  // Re-fetch on every render (navigation, snapshot, or audit event) so counts
  // and actions stay current during a live run.
  let summary: Summary | null;
  let actions: Actions;
  let tasks: TaskRow[] = [];
  let loadError = false;
  try {
    [summary, actions, tasks] = await Promise.all([api.summary(), api.actions(), api.tasks()]);
  } catch {
    loadError = true;
    summary = store.summary;
    actions = { canRun: false, canResume: false, canPause: false, canStop: false, failedTasks: [] };
  }
  if (!renderEpoch.isCurrent(myGen)) return;

  if (!summary) {
    container.replaceChildren(
      ...(loadError ? [el("div", { className: "panel error-text", role: "alert" }, "Live status is temporarily unavailable. Controls are disabled until it reconnects.")] : []),
      el("div", { className: "panel" }, [
        el("h2", null, "No project selected"),
        el("p", { className: "dim" }, "Pick a project from the list to open its console."),
        el("a", { href: "#/home", className: "btn btn-primary" }, "Choose project"),
      ]),
    );
    return;
  }

  container.replaceChildren(
    region("overview-header", renderHeader(summary)),
    region("overview-guidance", renderGuidance(container, summary, actions)),
    ...(summary.authoring ? [region("overview-authoring", renderAuthoringStatus(summary))] : []),
    region("overview-run", renderRun(summary.run)),
    region("overview-manifest", renderManifest(summary)),
    region("overview-actions", renderActions(container, summary, actions, tasks)),
    region("overview-feature", summary.hasPrd && summary.hasTeam ? renderFeatureIncrement(container) : renderFeaturePrd(container)),
  );
  syncRederiveRegion(container, summary);
  announce(`Opened ${summary.repoName}.`);
}

function region(name: string, content: HTMLElement): HTMLElement {
  const host = el("section", { "data-overview-region": name });
  host.appendChild(content);
  return host;
}

function announce(message: string): void {
  const node = document.querySelector<HTMLElement>("#live-announcements");
  if (node) node.textContent = message;
}

export function refreshOverview(): void {
  if (overviewContainer) void refreshOverviewData(overviewContainer);
}

async function refreshOverviewData(container: HTMLElement): Promise<void> {
  if (refreshInFlight || overviewContainer !== container) return;
  if (!container.querySelector("[data-overview-region]")) return;
  refreshInFlight = true;
  const myGen = renderEpoch.next();
  try {
    const [summary, actions, tasks] = await Promise.all([api.summary(), api.actions(), api.tasks()]);
    if (!renderEpoch.isCurrent(myGen) || overviewContainer !== container || !summary) return;
    const update = (name: string, content: HTMLElement): void => {
      const host = container.querySelector<HTMLElement>(`[data-overview-region="${name}"]`);
      if (!host) return;
      const focused = document.activeElement;
      const focusIndex = focused instanceof HTMLElement && host.contains(focused)
        ? [...host.querySelectorAll<HTMLElement>("button, a, input, select, textarea, [tabindex]:not([tabindex='-1'])")].indexOf(focused)
        : -1;
      if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement || focused instanceof HTMLSelectElement) {
        if (host.contains(focused)) return;
      }
      host.replaceChildren(content);
      if (focusIndex >= 0) {
        [...host.querySelectorAll<HTMLElement>("button, a, input, select, textarea, [tabindex]:not([tabindex='-1'])")][focusIndex]?.focus();
      }
    };
    update("overview-header", renderHeader(summary));
    update("overview-guidance", renderGuidance(container, summary, actions));
    if (summary.authoring) update("overview-authoring", renderAuthoringStatus(summary));
    syncRederiveRegion(container, summary);
    update("overview-run", renderRun(summary.run));
    update("overview-manifest", renderManifest(summary));
    update("overview-actions", renderActions(container, summary, actions, tasks));
    const feature = summary.hasPrd && summary.hasTeam ? renderFeatureIncrement(container) : renderFeaturePrd(container);
    update("overview-feature", feature);
    announce(`Status updated: ${summary.run?.status ?? "pipeline ready"}.`);
  } catch (error) {
    const host = container.querySelector<HTMLElement>('[data-overview-region="overview-guidance"]');
    if (host) host.replaceChildren(el("div", { className: "panel error-text", role: "alert" }, "Unable to refresh project status. Retrying…"));
    if (error instanceof Error) console.error(error);
  } finally {
    refreshInFlight = false;
  }
}

// ─── Re-derivation ────────────────────────────────────────────────────────────
//
// Regenerating the team and project skills after a requirements change used to
// be a five-hop scavenger hunt across three views, with each action button
// hidden until the stage it regenerates went stale. This is the single place
// that names what went stale, why, and runs the whole chain in order.

const REDERIVE_STEP_BADGE: Record<RederiveStepStatus, string> = {
  pending: "pending",
  running: "running",
  complete: "done",
  failed: "failed",
};

/** Stale derivation stages the chain can fix, in pipeline order. */
function staleDerivationStages(summary: Summary): AuthoringStageDetail[] {
  return (summary.authoringStages ?? [])
    .filter((entry) => (entry.stage === "team" || entry.stage === "skills") && (entry.stale || entry.status === "failed"));
}

/**
 * The re-derivation panel, or null when there is nothing to act on.
 *
 * Shown when a derivation stage is stale or failed (the chain can fix it), or
 * when a chain is running, failed, or has just completed. Deliberately not
 * shown for an incomplete PRD stage: requirements authoring is interactive
 * (ADR-060) and re-deriving cannot produce requirements.
 */
function renderRederive(container: HTMLElement, summary: Summary): HTMLElement | null {
  const stale = staleDerivationStages(summary);
  const progress = summary.rederive;
  const chainActive = Boolean(progress?.active);
  const failed = progress?.failedStep ?? null;
  const justCompleted = Boolean(progress?.complete) && !chainActive;
  if (stale.length === 0 && !chainActive && !failed && !justCompleted) return null;

  const running = summary.job?.status === "running";
  const children: HTMLElement[] = [
    el("div", { className: "row between wrap" }, [
      el("h3", null, "Re-derive team & skills"),
      el("span", { className: "dim small" }, "PRD → team → project skills → manifest"),
    ]),
  ];

  if (stale.length > 0) {
    const causes = stale.map((entry) => el("li", null, [
      el("strong", null, `${entry.stage === "team" ? "Team" : "Project skills"}: `),
      entry.reason || "this stage is out of date.",
      entry.staleInputs.length > 0
        ? el("span", { className: "dim small" }, ` (changed ${fmtAgo(entry.staleInputs[0]!.modifiedAt)})`)
        : null,
    ]));
    children.push(el("div", { className: "authoring-stage-list" }, [el("ul", { className: "rederive-causes" }, causes)]));
  }

  const start = el("button", { className: "btn btn-primary" }, failed ? `Retry from ${failed}` : "Re-derive team & skills") as HTMLButtonElement;
  start.addEventListener("click", () => {
    if (chainActive) return;
    start.disabled = true;
    void api.rederive(failed ?? undefined)
      .then((result) => {
        toast(result.message);
        if (result.job?.status === "running") startPoll(container);
      })
      .catch((error) => toast(error instanceof Error ? error.message : "re-derivation failed to start"))
      .finally(() => { start.disabled = false; void renderOverview(container); });
  });
  const actions: HTMLElement[] = [start];
  if (failed) {
    const restart = el("button", { className: "btn btn-sm" }, "Restart the whole chain") as HTMLButtonElement;
    restart.addEventListener("click", () => {
      restart.disabled = true;
      void api.rederive()
        .then((result) => { toast(result.message); startPoll(container); })
        .catch((error) => toast(error instanceof Error ? error.message : "re-derivation failed to start"))
        .finally(() => { restart.disabled = false; });
    });
    actions.push(restart);
  }
  actions.push(el("a", { href: "#/documents", className: "btn btn-sm" }, "Open Plan & Team"));
  children.push(el("div", { className: "actions" }, actions));

  if (progress && progress.steps.length > 0) {
    const rows = progress.steps.map((entry) => {
      const rowChildren: Array<HTMLElement | null> = [
        el("span", { className: `badge badge-${REDERIVE_STEP_BADGE[entry.status]}` }, REDERIVE_STEP_BADGE[entry.status]),
        el("span", null, entry.label),
      ];
      if (entry.status === "running") {
        rowChildren.push(el("span", { className: "spinner", "aria-hidden": "true" }));
      }
      const note = entry.message ?? (entry.status === "pending" ? "waiting" : "");
      return el("li", { className: `rederive-step rederive-step-${entry.status}` }, [
        el("div", { className: "row gap wrap" }, rowChildren.filter(Boolean) as HTMLElement[]),
        note ? el("div", { className: "dim small" }, note) : null,
      ]);
    });
    children.push(el("div", { className: "rederive-steps-wrap" }, [
      el("h4", null, chainActive ? "Re-deriving…" : failed ? "Re-derivation failed" : "Re-derivation complete"),
      el("ul", { className: "rederive-steps", role: "status", "aria-live": "polite" }, rows),
    ]));
  }

  if (justCompleted) {
    const changed = summary.manifest?.reconciliation?.changedTaskIds ?? [];
    children.push(el("p", { className: "dim small" }, changed.length > 0
      ? [`Team and skills are up to date. ${changed.length} task contract${changed.length === 1 ? "" : "s"} changed — reset them for review below if they must run again.`]
      : ["Team and skills are up to date. Completed task records were preserved by stable task ID."]));
  }

  if (chainActive) {
    children.push(el("p", { className: "dim small" }, ["Running in the background — watch the ", el("a", { href: "#/logs" }, "Logs"), " tab."]));
  }
  if (running && !chainActive) {
    children.push(el("p", { className: "dim small" }, "Another job is already running in this repository."));
  }

  return el("div", { className: "panel rederive-panel" }, children);
}

/**
 * Replaces the re-derivation region wholesale.
 *
 * Unlike the other Overview regions, this one appears and disappears as
 * staleness comes and goes, so it is removed and re-inserted on every refresh
 * rather than updated in place — otherwise a panel that stops being relevant
 * would linger, and one that stays relevant would accumulate copies.
 */
function syncRederiveRegion(container: HTMLElement, summary: Summary): void {
  for (const stale of container.querySelectorAll('[data-overview-region="overview-rederive"]')) stale.remove();
  const content = renderRederive(container, summary);
  if (!content) return;
  // Sits directly above the run panel: it is a pipeline action, not a run stat.
  const anchor = container.querySelector('[data-overview-region="overview-run"]');
  container.insertBefore(region("overview-rederive", content), anchor);
}

function renderFeatureIncrement(container: HTMLElement): HTMLElement {
  const project = store.projectKey();
  const input = el("textarea", { rows: "3", placeholder: "Describe the feature to add…", "aria-label": "Feature description" });
  input.textContent = store.getDraft(project, "featurePrompt", "");
  input.addEventListener("input", () => store.setDraft(project, "featurePrompt", (input as HTMLTextAreaElement).value));
  const interactive = el("button", { className: "btn btn-primary" }, "Author feature PRD (interactive)");
  const continueButton = el("button", { className: "btn" }, "Continue after authoring");
  interactive.addEventListener("click", () => {
    const prompt = (input as HTMLTextAreaElement).value.trim();
    if (!prompt) { toast("Describe the feature first."); return; }
    void startSession(container, "feature-prd", prompt);
  });
  continueButton.addEventListener("click", () => {
    continueButton.setAttribute("disabled", "");
    void api.continueFeatureIncrement()
      .then((r) => toast(r.message))
      .catch((e) => toast(e instanceof Error ? e.message : "feature increment continuation failed"))
      .finally(() => continueButton.removeAttribute("disabled"));
  });
  return el("div", { className: "panel" }, [el("h4", null, "Increment the project"), el("p", { className: "dim small" }, "Author the feature PRD interactively, then continue to update affected agents and recompile the manifest. Review the new tasks before running them."), input, el("div", { className: "actions" }, [interactive, continueButton])]);
}

function renderAuthoringStatus(summary: Summary): HTMLElement {
  const stages: Array<["prd" | "team" | "skills", string]> = [
    ["prd", "PRD"],
    ["team", "Team"],
    ["skills", "Skills"],
  ];
  return el("div", { className: "panel authoring-status" }, [
    el("div", { className: "row between wrap" }, [
      el("h3", null, "Authoring stages"),
      el("a", { href: "#/documents", className: "btn btn-sm" }, "Configure models"),
    ]),
    el("div", { className: "authoring-stage-list" }, stages.map(([stage, label]) => {
      const state = summary.authoring?.stages[stage];
      const detail = summary.authoringStages?.find((entry) => entry.stage === stage);
      const presentation = authoringStagePresentation(summary, stage, state, detail);
      // The derived reason, not just the recorded error: a stage that completed and
      // then went stale has no `error`, and saying only "complete" here while the
      // panel below reports the same stage as stale would contradict itself.
      const reason = detail?.stale ? detail.reason : state?.error;
      return el("div", { className: "authoring-stage" }, [
        el("strong", null, label),
        el("span", { className: `badge badge-${presentation.className}` }, presentation.label),
        el("span", { className: "dim small" }, state?.invocation?.effectiveModel ?? (presentation.untracked ? "existing project artifact" : "runner default")),
        reason ? el("span", { className: "error-text small" }, reason) : null,
      ]);
    })),
    summary.authoringReady === false
      ? el("p", { className: "error-text small", role: "alert" }, summary.authoringBlocker || "Active authoring is incomplete. Finish or retry the stages before building.")
      : el("p", { className: "dim small" }, "Authoring models and execution controls are independent."),
  ]);
}

function authoringStagePresentation(
  summary: Summary,
  stage: "prd" | "team" | "skills",
  state: AuthoringStageState | undefined,
  detail?: AuthoringStageDetail,
): { label: string; className: string; untracked: boolean } {
  if (state?.noSkillsRequired) return { label: "not required", className: "complete", untracked: false };
  // A stage that completed and then went stale is not complete, whatever its last
  // run recorded.
  if (detail?.stale) return { label: "stale", className: "stale", untracked: false };
  if (state?.status) return { label: state.status, className: state.status, untracked: false };
  const exists = stage === "prd" ? summary.hasPrd : stage === "team" ? summary.hasTeam : summary.hasTeam && summary.authoringReady !== false;
  return exists
    ? { label: "Existing / untracked", className: "no-run", untracked: true }
    : { label: "pending", className: "pending", untracked: false };
}

function renderFeaturePrd(container: HTMLElement): HTMLElement {
  const project = store.projectKey();
  const input = el("textarea", { rows: "3", placeholder: "Describe the feature to add…", "aria-label": "Feature description" });
  input.textContent = store.getDraft(project, "featurePrompt", "");
  input.addEventListener("input", () => store.setDraft(project, "featurePrompt", (input as HTMLTextAreaElement).value));
  const interactive = el("button", { className: "btn btn-primary" }, "Author Feature PRD (interactive)");
  interactive.addEventListener("click", () => {
    const prompt = (input as HTMLTextAreaElement).value.trim();
    if (!prompt) { toast("Describe the feature first."); return; }
    void startSession(container, "feature-prd", prompt);
  });
  return el("div", { className: "panel" }, [el("h4", null, "Add a feature"), el("p", { className: "dim small" }, "Open an interactive session to interview and author the feature requirements. After authoring, continue the increment to update the team and manifest."), input, el("div", { className: "actions" }, [interactive])]);
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
    m?.reconciliation ? renderReconciliation(summary, m.reconciliation) : null,
  ]);
}

/**
 * Reconciliation lives here because this is the data it acts on.
 *
 * The changed IDs used to render as one mono comma-joined string, which gave no
 * way to tell a changed task from a new one and no way to reset without
 * hunting through the Controls panel. Each changed task is now listed with its
 * current status, and the reset — which discards completed work — is gated
 * behind a confirmation naming exactly what it will discard.
 */
function renderReconciliation(summary: Summary, reconciliation: NonNullable<Summary["manifest"]>["reconciliation"]): HTMLElement | null {
  if (!reconciliation) return null;
  const changed = reconciliation.changedTaskIds;
  const added = reconciliation.newTaskIds;
  const rows = changed.map((id) => el("li", null, [
    el("a", { href: `#/tasks?task=${encodeURIComponent(id)}`, className: "mono" }, id),
    el("span", { className: "dim small" }, " contract changed"),
  ]));
  const newRows = added.map((id) => el("li", null, [
    el("a", { href: `#/tasks?task=${encodeURIComponent(id)}`, className: "mono" }, id),
    el("span", { className: "dim small" }, " new"),
  ]));

  const children: HTMLElement[] = [
    el("h4", null, "Reconciliation"),
    el("p", { className: "dim small" }, "Completed task records are preserved by stable task ID. Review changed contracts before running."),
    el("div", { className: "stats" }, [
      stat("Preserved", String(reconciliation.preservedTaskIds.length)),
      stat("New", String(added.length)),
      stat("Changed", String(changed.length)),
      stat("Removed", String(reconciliation.removedTaskIds.length)),
    ]),
  ];

  if (changed.length > 0) {
    children.push(el("h5", { className: "group-title" }, `Changed tasks (${changed.length})`));
    children.push(el("ul", { className: "reconcile-list" }, rows));
    children.push(resetChangedControl(changed));
  }
  if (added.length > 0) {
    children.push(el("h5", { className: "group-title" }, `New tasks (${added.length})`));
    children.push(el("ul", { className: "reconcile-list" }, newRows));
    children.push(el("p", { className: "dim small" }, "Review and select the new pending tasks in Tasks, then run the targeted workflow."));
  }
  if (changed.length === 0 && added.length === 0) {
    children.push(el("p", { className: "dim small" }, "No task contracts changed since the previous compile."));
  }
  return el("div", { className: "detail" }, children);
}

/**
 * Reset completed tasks whose contract changed.
 *
 * This discards their recorded outputs and artifacts so the engine will run them
 * again, so it is never automatic — not even as the tail of a re-derivation —
 * and never a single unconfirmed click.
 */
function resetChangedControl(changedTaskIds: string[]): HTMLElement {
  const button = el("button", { className: "btn btn-sm" }, "Reset changed tasks for review") as HTMLButtonElement;
  const host = el("div", { className: "row gap wrap" }, [
    button,
    el("span", { className: "dim small" }, "Re-run completed tasks whose contract changed."),
  ]);
  button.addEventListener("click", () => {
    if (!window.confirm(
      `Reset ${changedTaskIds.length} changed task${changedTaskIds.length === 1 ? "" : "s"} to pending so they run again?\n\n`
      + `Their recorded outputs, artifacts and timings will be cleared:\n  ${changedTaskIds.join("\n  ")}`,
    )) return;
    button.disabled = true;
    void api.resetChangedTasks()
      .then((res) => {
        toast(res.message);
        if (overviewContainer) void renderOverview(overviewContainer);
      })
      .catch((err) => toast(err instanceof Error ? err.message : "reset failed"))
      .finally(() => { button.disabled = false; });
  });
  return host;
}

interface PipelineStep {
  label: string;
  action: ControlAction;
  hint: string;
  /** When set, the primary button opens an interactive session instead of running `action`. */
  session?: AuthoringSessionTarget;
  /** Label for a headless alternative that runs `action`. Only for stages that
   * are mechanical derivations (ADR-060); never for requirements authoring. */
  autoLabel?: string;
  /** Also offer grilling the idea before authoring the PRD. */
  ideaSession?: boolean;
}

/** Determines the next pipeline step, or null when there's nothing to advance. */
function nextStep(summary: Summary, actions: Actions): PipelineStep | null {
  if (!summary.hasPrd) {
    // ADR-060: requirements authoring is always interactive, so there is no
    // headless alternative to offer on this card.
    return {
      label: "Author PRD (interactive)",
      action: summary.hasIdea ? "draft-prd" : "draft-existing-prd",
      session: "prd",
      ideaSession: summary.hasIdea,
      hint: summary.hasIdea
        ? "Opens your harness in a terminal with the PRD skill queued so it interviews you first. Everything downstream is derived from what you approve, so this stage is never run headlessly."
        : "Opens your harness to interview you against the existing repository, covering what the code cannot tell you. Requirements are never authored headlessly.",
    };
  }
  if (!summary.hasTeam) {
    return {
      label: "Generate team",
      action: "draft-team",
      hint: "Generates the agent team from the PRD (headless). Review it, then come back to continue.",
    };
  }
  const skillsStage = summary.authoring?.stages.skills;
  if (summary.authoringReady === false && skillsStage && skillsStage.status !== "complete" && !skillsStage.noSkillsRequired) {
    return {
      label: "Generate project skills",
      action: "draft-skills",
      hint: "Completes the project-skill stage from the generated team. Review the candidates and outputs before building.",
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

/** Opens an interactive authoring session in a terminal and refreshes when it is done. */
async function startSession(container: HTMLElement, target: AuthoringSessionTarget, prompt?: string): Promise<void> {
  try {
    const res = await api.startAuthoringSession(target, prompt);
    startSessionFeedback(container, res.message || (res.ok ? "interactive session requested" : "launch failed"));
  } catch (err) {
    toast(err instanceof Error ? err.message : "interactive session failed");
  }
  // The session runs in an external terminal, so poll for its committed output.
  for (const delay of [5000, 15000, 30000]) {
    window.setTimeout(() => void renderOverview(container), delay);
  }
}

/** Toast plus the same refresh polling, for callers outside the pipeline card. */
function startSessionFeedback(container: HTMLElement, message: string): void {
  toast(message);
  for (const delay of [5000, 15000, 30000]) {
    window.setTimeout(() => void renderOverview(container), delay);
  }
}

function refreshButton(container: HTMLElement): HTMLButtonElement {
  const button = el("button", { className: "btn btn-sm", type: "button" }, "Refresh") as HTMLButtonElement;
  button.addEventListener("click", () => void renderOverview(container));
  return button;
}

/** Re-runs the read-only PRD validation for documents authored outside the Console. */
function validatePrdButton(): HTMLButtonElement {
  const button = el("button", { className: "btn btn-sm", type: "button" }, "Validate PRD") as HTMLButtonElement;
  button.addEventListener("click", () => {
    button.disabled = true;
    void api.validateAuthoring()
      .then((result) => toast(result.message))
      .catch((error) => toast(error instanceof Error ? error.message : "validation failed"))
      .finally(() => { button.disabled = false; });
  });
  return button;
}

function renderGuidance(container: HTMLElement, summary: Summary, actions: Actions): HTMLElement {
  const step = nextStep(summary, actions);
  const working = summary.job?.status === "running";

  let text: string;
  let hint: string;
  if (!summary.hasPrd) {
    text = summary.hasIdea
      ? "Author the PRD interactively from your idea."
      : "Author a project PRD interactively from this existing repository.";
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
    const primary = el("button", { className: "btn btn-primary" }, step.label);
    const secondary = step.autoLabel ? el("button", { className: "btn" }, step.autoLabel) : null;
    const idea = step.ideaSession ? el("button", { className: "btn" }, "Grill the idea first (interactive)") : null;
    if (!working) {
      primary.addEventListener("click", () => {
        if (step.session) void startSession(container, step.session);
        else void continuePipeline(container, step);
      });
      secondary?.addEventListener("click", () => void continuePipeline(container, step));
      idea?.addEventListener("click", () => void startSession(container, "idea"));
    }
    if (!working) {
      children.push(el("div", { className: "actions", style: "margin-top:10px" }, [primary, secondary, idea].filter(Boolean) as HTMLElement[]));
    }
  } else if (!summary.hasPrd && !summary.hasIdea) {
    hint = "Add docs/IDEA.md to describe the project idea, then come back.";
  } else if (summary.hasManifest) {
    hint = "Use the Controls panel below to choose tasks, run, resume, or stop the build.";
  } else {
    hint = "Pipeline setup is complete.";
  }

  if (!working) {
    const tools: HTMLElement[] = [refreshButton(container)];
    if (summary.hasPrd) tools.push(validatePrdButton());
    children.push(el("div", { className: "row gap wrap", style: "margin-top:6px" }, tools));
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

  const authoringBlocked = summary.authoringReady === false;
  const manualNeedsSelection = summary.executionMode === "manual" && summary.selectedTaskCount === 0;
  const buttons = [
    el("button", { className: "btn btn-primary", disabled: !authoringBlocked && actions.canRun && !manualNeedsSelection ? null : true }, summary.executionMode === "manual" ? "Run selected" : "Run"),
    el("button", { className: "btn", disabled: !authoringBlocked && actions.canResume && !manualNeedsSelection ? null : true }, summary.executionMode === "manual" ? "Resume selected" : "Resume"),
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
  const activity = renderLogHarnessActivityToggle(container, store.summary?.logHarnessActivity ?? false);
  const concurrency = renderConcurrencyControl(container, store.summary?.concurrency ?? 0);
  // Reset lives with the reconciliation data it acts on, in the Manifest panel
  // directly above this one, so this is a pointer rather than a second control.
  const completedTaskIds = new Set(
    tasks.filter((task) => task.status === "complete" || task.status === "skipped").map((task) => task.id),
  );
  const changedCompleted = (summary.manifest?.reconciliation?.changedTaskIds ?? []).filter((id) => completedTaskIds.has(id));

  return el("div", { className: "panel" }, [
    el("h4", null, "Controls"),
    mode,
    el("div", { className: "actions" }, buttons),
    manualNeedsSelection
      ? el("p", { className: "dim small" }, ["Manual mode needs at least one selected task. ", el("a", { href: "#/tasks" }, "Choose tasks")])
      : null,
    authoringBlocked
      ? el("p", { className: "error-text small", role: "alert" }, [summary.authoringBlocker || "Authoring stages are incomplete.", " ", el("a", { href: "#/documents" }, "Review authoring settings and stages")])
      : null,
    replay,
    timeouts,
    commit,
    activity,
    concurrency,
    changedCompleted.length > 0
      ? el("p", { className: "dim small" }, `${changedCompleted.length} changed task${changedCompleted.length === 1 ? " has" : "s have"} already completed; reset them in the Manifest panel above to run them again.`)
      : null,
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

function renderLogHarnessActivityToggle(container: HTMLElement, enabled: boolean): HTMLElement {
  const cb = el("input", { type: "checkbox", checked: enabled ? true : null });
  const label = el("label", { className: "checkbox-row" }, [
    cb,
    el("span", null, "Log harness activity (stream harness CLI output into the engine log)"),
  ]);
  cb.addEventListener("change", () => {
    const value = (cb as HTMLInputElement).checked;
    void (async () => {
      try {
        const res = await api.setLogHarnessActivity(value);
        toast(res.message || (res.ok ? "updated" : "update failed"));
      } catch (err) {
        toast(err instanceof Error ? err.message : "update failed");
      }
      void renderOverview(container);
    })();
  });
  return el("div", { style: "margin-top:10px" }, [
    label,
    el("p", { className: "dim small", role: "note" }, "Off by default. Applies to subsequently started runs; the current run is unchanged. Activity logs can contain sensitive repository content and increase log volume. Command logging is always on."),
  ]);
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
      el("span", { className: "dim small" }, "Concurrency (parallel tasks)"),
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
