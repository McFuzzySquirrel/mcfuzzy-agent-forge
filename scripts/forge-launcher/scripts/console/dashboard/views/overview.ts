// ─── Overview: run header, progress, actions, pipeline guidance ─────────────

import { api } from "../api.js";
import {
  clearFeatureTaskReviewPending,
  featureTaskReviewIds,
  featureTasksReviewed,
  markFeatureTaskReviewPending,
} from "../feature-task-review.js";
import {
  getGuidedAuthoringStep,
  pendingExternalAuthoringSession,
  reconcileExternalAuthoringSession,
  setGuidedAuthoringStep,
  type GuidedAuthoringStep,
} from "../project-authoring.js";
import { Epoch, store } from "../state.js";
import { el, fmtAgo, fmtDuration, fmtTime, fmtTokens, fmtUsd, statusBadge, toast } from "../render/dom.js";
import { isTerminalSessionActive, onTerminalSessionChange } from "./terminal.js";
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
let cachedBrief: { repoRoot: string; content: string } | null = null;
let pendingBrief: { repoRoot: string; load: Promise<string> } | null = null;
const preparationStarting = new Set<string>();
const buildStarting = new Set<string>();
const reviewDecisionInFlight = new Set<string>();

function stopPoll(): void {
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

async function reconcileExternalAuthoringProgress(summary: Summary): Promise<void> {
  const pending = pendingExternalAuthoringSession(summary.repoRoot);
  if (!pending) return;
  const artifactReady = pending.target === "idea" ? summary.hasIdea : summary.hasPrd;
  if (!artifactReady) return;
  const path = pending.target === "idea" ? "docs/IDEA.md" : "docs/PRD.md";
  try {
    const file = await api.docContent(path);
    reconcileExternalAuthoringSession(summary.repoRoot, pending.target, file.content);
  } catch {
    // A missing or unreadable artifact is not evidence that authoring completed.
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
  cachedBrief = null;
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
  unsub.push(onTerminalSessionChange(() => scheduleRender(container)));

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
  if (summary) await reconcileExternalAuthoringProgress(summary);
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

  const guided = Boolean(activeGuidedStep(summary));
  container.replaceChildren(
    region("overview-header", renderHeader(summary)),
    region("overview-guidance", renderGuidance(container, summary, actions)),
    ...(summary.authoring ? [region("overview-authoring", guided ? el("div") : renderAuthoringStatus(summary))] : []),
    region("overview-run", renderRun(summary.run)),
    region("overview-manifest", guided ? el("div") : renderManifest(summary)),
    region("overview-actions", renderActions(container, summary, actions, tasks)),
    region("overview-feature", guided ? el("div") : summary.hasPrd && summary.hasTeam ? renderFeatureIncrement(container, summary) : renderFeaturePrd(container)),
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
    await reconcileExternalAuthoringProgress(summary);
    if (!renderEpoch.isCurrent(myGen) || overviewContainer !== container) return;
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
    const guided = Boolean(activeGuidedStep(summary));
    if (summary.authoring) update("overview-authoring", guided ? el("div") : renderAuthoringStatus(summary));
    syncRederiveRegion(container, summary);
    update("overview-run", renderRun(summary.run));
    update("overview-manifest", guided ? el("div") : renderManifest(summary));
    update("overview-actions", renderActions(container, summary, actions, tasks));
    const feature = guided ? el("div") : summary.hasPrd && summary.hasTeam ? renderFeatureIncrement(container, summary) : renderFeaturePrd(container);
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
  if (activeGuidedStep(summary)) return;
  const content = renderRederive(container, summary);
  if (!content) return;
  // Sits directly above the run panel: it is a pipeline action, not a run stat.
  const anchor = container.querySelector('[data-overview-region="overview-run"]');
  container.insertBefore(region("overview-rederive", content), anchor);
}

function renderFeatureIncrement(container: HTMLElement, summary: Summary): HTMLElement {
  const project = store.projectKey();
  const input = el("textarea", { rows: "3", placeholder: "Describe the feature to add…", "aria-label": "Feature description" });
  input.textContent = store.getDraft(project, "featurePrompt", "");
  input.addEventListener("input", () => store.setDraft(project, "featurePrompt", (input as HTMLTextAreaElement).value));
  const taskIds = featureTaskReviewIds(summary);
  const reviewRequired = taskIds.length > 0 && !featureTasksReviewed(summary);
  const interactive = el("button", { className: "btn btn-primary" }, "Author feature PRD (interactive)");
  const continueButton = el("button", { className: "btn", disabled: reviewRequired ? true : null }, "Continue after authoring");
  interactive.addEventListener("click", () => {
    const prompt = (input as HTMLTextAreaElement).value.trim();
    if (!prompt) { toast("Describe the feature first."); return; }
    void startSession(container, "feature-prd", prompt);
  });
  continueButton.addEventListener("click", () => {
    const attempt = markFeatureTaskReviewPending(summary.repoRoot);
    if (!attempt) {
      toast("Task review could not be saved in this browser; the feature increment was not started.");
      return;
    }
    continueButton.setAttribute("disabled", "");
    void api.continueFeatureIncrement()
      .then((r) => {
        toast(r.message);
        if (!r.ok) clearFeatureTaskReviewPending(summary.repoRoot, attempt);
        if (r.job?.status === "running") startPoll(container);
      })
      .catch((e) => {
        clearFeatureTaskReviewPending(summary.repoRoot, attempt);
        toast(e instanceof Error ? e.message : "feature increment continuation failed");
      })
      .finally(() => {
        continueButton.removeAttribute("disabled");
        void renderOverview(container);
      });
  });
  return el("div", { className: "panel" }, [
    el("h4", null, "Add a feature"),
    el("p", { className: "dim small" }, "Author the feature requirements in an interactive session, then continue to update affected agents and recompile the manifest. New Tasks must be reviewed before they can run."),
    input,
    taskIds.length > 0 && !featureTasksReviewed(summary)
      ? el("p", { className: "dim small" }, [
          `${taskIds.length} generated Task${taskIds.length === 1 ? "" : "s"} need review before execution. `,
          el("a", { href: "#/tasks?feature-review=1" }, "Review new Tasks"),
        ])
      : null,
    el("div", { className: "actions" }, [interactive, continueButton]),
  ]);
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
      el("a", { href: "#/settings", className: "btn btn-sm" }, "Configure models"),
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
    ...(run.usage.tasksWithUsage > 0
      ? [
          stat("Tokens", `in ${fmtTokens(run.usage.inputTokens)} · out ${fmtTokens(run.usage.outputTokens)}`),
          ...(run.usage.costUsd > 0 ? [stat("Cost", fmtUsd(run.usage.costUsd))] : []),
          ...(run.usage.credits > 0 ? [stat("Credits", run.usage.credits.toFixed(2))] : []),
        ]
      : [stat("Tokens", "not reported")]),
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
        ? "Opens the authoring terminal (in the Console or an external terminal) with the PRD skill queued so it interviews you first. Everything downstream is derived from what you approve, so this stage is never run headlessly."
        : "Opens the authoring terminal to interview you against the existing repository, covering what the code cannot tell you. Requirements are never authored headlessly.",
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

/** Opens the authoring terminal view, pre-seeded with the target, so the user can start it in the Console or an external terminal. */
function startSession(_container: HTMLElement, target: AuthoringSessionTarget, prompt?: string): void {
  const query = new URLSearchParams({ authoring: target });
  if (prompt) query.set("prompt", prompt);
  location.hash = `#/terminal?${query.toString()}`;
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
  if (summary.run || (summary.job?.type === "engine-run" && summary.job.status !== "running")) {
    buildStarting.delete(summary.repoRoot);
  }
  const guidedStep = activeGuidedStep(summary);
  if (guidedStep) {
    return renderGuidedAuthoring(container, summary, guidedStep);
  }

  const recovery = renderFailureGuidance(container, summary, actions);
  if (recovery) return recovery;
  const blocked = renderBlockedGuidance(container, summary, actions);
  if (blocked) return blocked;

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
  } else if (summary.run?.status === "running") {
    text = "Build is running.";
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
    hint = summary.run?.status === "running"
      ? "The Project remains Running. Review the action above while other work continues."
      : "Use the Controls panel below to choose tasks, run, resume, or stop the build.";
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

  if (summary.run?.status === "running" && summary.run.blockers.length > 0) {
    children.push(renderRunBlockers(summary.run.blockers, true));
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

function activeGuidedStep(summary: Summary): GuidedAuthoringStep | null {
  if (summary.run) return null;
  const preparationJob = summary.job?.type === "rederive" || summary.job?.type === "compile-manifest"
    || summary.job?.type === "draft-team" || summary.job?.type === "draft-skills"
    || summary.job?.type === "feature-increment";
  if (preparationJob && (summary.job?.status === "running" || summary.job?.status === "failed")
    || summary.rederive?.active) return "preparing";
  if (summary.job?.status === "failed" || summary.authoringStages?.some((stage) => stage.status === "failed")) return null;

  const step = getGuidedAuthoringStep(summary.repoRoot);
  if (step) {
    if ((step === "idea" || step === "brief") && summary.hasManifest) {
      return isPreparationComplete(summary, "ready") ? "ready" : "preparing";
    }
    if ((step === "idea" || step === "brief") && summary.hasPrd) {
      setGuidedAuthoringStep(summary.repoRoot, "review");
      return "review";
    }
    if (step === "review" && summary.hasManifest) {
      return isPreparationComplete(summary, "ready") ? "ready" : "preparing";
    }
    if (step === "preparing" || step === "ready") {
      return isPreparationComplete(summary, "ready") ? "ready" : "preparing";
    }
    return step;
  }
  if (!summary.hasPrd && summary.hasIdea && !summary.hasManifest) return "idea";
  if (summary.hasPrd && !summary.hasManifest && !summary.run) return "review";
  if (summary.hasManifest && summary.authoringReady !== false
    && !summary.rederive?.active && !summary.rederive?.failedStep
    && staleDerivationStages(summary).length === 0) return "ready";
  return null;
}

function renderBlockedGuidance(container: HTMLElement, summary: Summary, actions: Actions): HTMLElement | null {
  if (summary.run?.status === "running") return null;
  const paused = summary.run?.status === "paused" || summary.run?.status === "blocked"
    || summary.job?.status === "paused";
  const blockers = [
    ...(summary.run?.blockers ?? []),
    ...(!summary.run?.blockers.length && summary.authoringBlocker ? [summary.authoringBlocker] : []),
  ];
  if (!paused && blockers.length === 0) return null;
  const taskReviewRequired = featureTaskReviewIds(summary).length > 0 && !featureTasksReviewed(summary);

  const children: HTMLElement[] = [
    el("h3", null, paused ? "Project needs your attention" : "What is blocking progress"),
    blockers.length > 0
      ? renderRunBlockers(blockers, false)
      : el("p", { className: "dim" }, "The Project is paused. Review the current state and choose Resume when you are ready."),
  ];
  if (paused && summary.run) {
    children.push(el("p", { className: "dim small" }, "Completed Tasks and Project history are preserved. Resolve the blocking action before choosing Resume."));
  }
  children.push(el("div", { className: "actions" }, [
    !summary.hasPrd ? sessionButton(container, "prd", "Continue interactive Project brief authoring") : null,
    el("a", { className: "btn", href: "#/tasks" }, "Review Tasks"),
    el("a", { className: "btn", href: "#/logs" }, "Open logs"),
    taskReviewRequired ? el("a", { className: "btn btn-primary", href: "#/tasks?feature-review=1" }, "Review generated Tasks") : null,
    paused && actions.canResume && !taskReviewRequired ? resumeRecoveryButton(container, "Resume after resolving the blocker") : null,
  ].filter(Boolean) as HTMLElement[]));
  return el("section", { className: "panel hint project-blocked", "aria-labelledby": "project-blocked-heading" }, [
    el("h2", { id: "project-blocked-heading" }, paused ? "Blocked" : "Needs your action"),
    ...children,
  ]);
}

function renderRunBlockers(blockers: string[], continuing: boolean): HTMLElement {
  return el("section", { className: "project-blockers", "aria-label": "Blocking actions" }, [
    el("h4", null, continuing ? "Action needed while work continues" : "Action blocking progress"),
    continuing
      ? el("p", { className: "dim small" }, "The Project remains Running while work can continue.")
      : null,
    el("ul", null, blockers.map((blocker) => el("li", null, blocker))),
  ]);
}

function renderFailureGuidance(container: HTMLElement, summary: Summary, actions: Actions): HTMLElement | null {
  const failedStage = summary.job?.status === "failed" ? failedJobStage(summary)
    : summary.run && ["failed", "error"].includes(summary.run.status) ? "Build execution"
      : summary.authoringStages?.find((stage) => stage.status === "failed")?.stage ?? null;
  if (!failedStage) return null;

  const runFailed = summary.run && ["failed", "error"].includes(summary.run.status);
  const taskReviewRequired = featureTaskReviewIds(summary).length > 0 && !featureTasksReviewed(summary);
  const details = runFailed
    ? summary.job?.status === "failed" && summary.job.message
      ? summary.job.message
      : `Build failed during ${summary.run?.currentPhaseTitle ?? summary.run?.currentPhase ?? "execution"}.`
    : summary.job?.message || summary.authoringStages?.find((stage) => stage.status === "failed")?.reason;
  const children: HTMLElement[] = [
    el("h2", null, `${failedStage} failed`),
    el("p", { className: "error-text", role: "alert" }, details || `The ${failedStage.toLowerCase()} stage did not finish.`),
  ];

  if (runFailed) {
    children.push(
      el("p", { className: "dim small" }, "Review the failed Tasks, then Resume or Replay the failed Task. Completed work and Project history are preserved."),
      el("div", { className: "actions" }, [
        el("a", { className: "btn btn-primary", href: "#/tasks" }, "Review failed Tasks"),
        el("a", { className: "btn", href: "#/logs" }, "Open logs"),
        taskReviewRequired ? el("a", { className: "btn btn-primary", href: "#/tasks?feature-review=1" }, "Review generated Tasks") : null,
        actions.canResume && !taskReviewRequired ? resumeRecoveryButton(container, "Resume Build") : null,
      ].filter(Boolean) as HTMLElement[]),
    );
  } else {
    const retry = retryFailedStage(container, summary);
    children.push(
      el("p", { className: "dim small" }, "Retry the failed stage only. Completed Project work and history are preserved."),
      el("div", { className: "actions" }, [
        retry,
        el("a", { className: "btn", href: "#/logs" }, "Open logs"),
      ]),
    );
  }
  return el("section", { className: "panel hint project-failed", "aria-labelledby": "project-failed-heading" }, [
    el("h2", { id: "project-failed-heading" }, `${failedStage} failed`),
    ...children.slice(1),
  ]);
}

function resumeRecoveryButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = el("button", { className: "btn", type: "button" }, label) as HTMLButtonElement;
  button.addEventListener("click", () => {
    button.disabled = true;
    void api.control("resume")
      .then((result) => {
        toast(result.message || (result.ok ? "Build resumed." : "Build could not be resumed."));
        if (result.job?.status === "running") startPoll(container);
        void renderOverview(container);
      })
      .catch((error: unknown) => toast(error instanceof Error ? error.message : "Build could not be resumed."))
      .finally(() => { button.disabled = false; });
  });
  return button;
}

function failedJobStage(summary: Summary): string {
  const job = summary.job!;
  if (job.type === "rederive") {
    const failed = summary.rederive?.failedStep;
    return failed ? `${failed[0]!.toUpperCase()}${failed.slice(1)} preparation` : "Project preparation";
  }
  if (job.type === "compile-manifest") return "Build plan preparation";
  if (job.type === "engine-run" || job.type === "engine-resume" || job.type === "engine-replay") return "Build execution";
  if (job.type === "draft-prd" || job.type === "draft-existing-prd") return "Project brief authoring";
  if (job.type === "draft-team") return "Team preparation";
  if (job.type === "draft-skills") return "Project guidance preparation";
  if (job.type === "feature-prd") return "Feature authoring";
  if (job.type === "feature-increment") return "Feature preparation";
  return job.type === "bootstrap" ? "Existing Project setup" : "Project setup";
}

function retryFailedStage(container: HTMLElement, summary: Summary): HTMLButtonElement {
  const job = summary.job;
  const authoringStage = summary.authoringStages?.find((stage) => stage.status === "failed")?.stage;
  let label = "Retry preparation";
  const retry = el("button", { className: "btn btn-primary", type: "button" }, label) as HTMLButtonElement;
  retry.addEventListener("click", () => {
    retry.disabled = true;
    if (job?.type === "draft-prd" || job?.type === "draft-existing-prd" || authoringStage === "prd") {
      retry.textContent = "Opening interactive authoring…";
      startSession(container, "prd");
      return;
    }
    if (job?.type === "feature-prd") {
      retry.textContent = "Opening interactive authoring…";
      startSession(container, "feature-prd");
      return;
    }
    if (job?.type === "compile-manifest") {
      label = "Retry Build plan preparation";
      void api.control("compile-manifest").then((result) => toast(result.message)).catch((error: unknown) =>
        toast(error instanceof Error ? error.message : "Build plan preparation failed"));
    } else {
      const step = summary.rederive?.failedStep
        ?? (authoringStage === "team" ? "team" : authoringStage === "skills" ? "skills" : undefined);
      void api.rederive(step).then((result) => {
        toast(result.message);
        if (result.job?.status === "running") startPoll(container);
      }).catch((error: unknown) => toast(error instanceof Error ? error.message : "preparation retry failed"));
    }
    retry.textContent = label;
    window.setTimeout(() => { retry.disabled = false; }, 1000);
  });
  return retry;
}

function renderGuidedAuthoring(
  container: HTMLElement,
  summary: Summary,
  step: GuidedAuthoringStep,
): HTMLElement {
  const displayStep = step === "preparing" && isPreparationComplete(summary, step) ? "ready" : step;
  const children: HTMLElement[] = [renderGuidedPhases(displayStep)];
  if (displayStep === "idea" || displayStep === "brief") {
    const ideaPhase = displayStep === "idea";
    children.push(
      el("h3", null, ideaPhase ? "First: explore your Idea" : "Next: author your Project brief"),
      el("p", { className: "dim" }, ideaPhase
        ? "Use an interactive conversation to clarify the idea. It is fine to leave details unknown; assumptions and questions should stay visible."
        : "Use an interactive conversation to shape the Project brief. Existing notes or PRD material provide context but do not replace this step."),
      el("div", { className: "actions" }, [
        sessionButton(container, ideaPhase ? "idea" : "prd", ideaPhase ? "Explore your idea" : "Author the Project brief"),
      ]),
    );
    if (isTerminalSessionActive()) {
      children.push(el("p", { className: "dim small", role: "status" }, [
        "Your interactive session is still running. ",
        el("a", { href: "#/terminal" }, "Return to the session"),
        " when you are ready.",
      ]));
    }
  } else if (displayStep === "review") {
    children.push(renderBriefReview(container, summary));
  } else {
    children.push(renderPreparation(container, summary, displayStep));
  }

  return el("section", { className: "panel hint", "aria-labelledby": "guided-authoring-heading" }, [
    el("h2", { id: "guided-authoring-heading" }, "Your Project guide"),
    ...children,
  ]);
}

function renderGuidedPhases(step: GuidedAuthoringStep): HTMLElement {
  const current = step === "idea" ? 0 : step === "brief" ? 1 : step === "review" ? 2 : -1;
  const briefStatus = step === "idea" ? "Next" : step === "brief" ? "Current step" : "Complete";
  const reviewStatus = step === "review" ? "Current step"
    : step === "preparing" ? "Approved · preparing"
      : step === "ready" ? "Approved · ready to start"
        : "Next";
  return el("ol", { className: "guided-authoring-phases" }, [
    el("li", current === 0 ? { "aria-current": "step" } : null, [
      el("strong", null, "Explore your Idea"),
      el("span", { className: "dim small" }, current === 0 ? "Current step" : "Complete"),
    ]),
    el("li", current === 1 ? { "aria-current": "step" } : null, [
      el("strong", null, "Author your Project brief"),
      el("span", { className: "dim small" }, briefStatus),
    ]),
    el("li", current === 2 ? { "aria-current": "step" } : null, [
      el("strong", null, "Review and prepare"),
      el("span", { className: "dim small" }, reviewStatus),
    ]),
  ]);
}

function renderBriefReview(container: HTMLElement, summary: Summary): HTMLElement {
  const repoRoot = summary.repoRoot;
  if (!summary.hasPrd) {
    return el("div", { className: "project-brief-review" }, [
      el("h3", null, "Project brief unavailable"),
      el("p", { className: "error-text", role: "alert" }, "The brief could not be found at docs/PRD.md. Author it interactively before reviewing."),
      sessionButton(container, "prd", "Author the Project brief"),
    ]);
  }

  const editor = el("textarea", {
    id: "project-brief-editor",
    className: "project-brief-editor",
    rows: "22",
    disabled: true,
    "aria-label": "Editable Project brief",
  }) as HTMLTextAreaElement;
  const highlights = el("div", {
    className: "project-brief-highlights",
    role: "region",
    "aria-label": "At-a-glance Project brief",
  }, "Loading the brief summary…");
  const status = el("p", { className: "dim small", role: "status", "aria-live": "polite" },
    store.getDraft(repoRoot, "reviewStatus", "Edit the brief here. Changes are saved when you request changes or approve."));
  const requestChanges = el("button", {
    className: "btn",
    type: "button",
    disabled: true,
  }, "Request changes") as HTMLButtonElement;
  const approve = el("button", {
    className: "btn btn-primary",
    type: "button",
    disabled: true,
  }, "Approve") as HTMLButtonElement;
  const busy = reviewDecisionInFlight.has(repoRoot) || isTerminalSessionActive();
  if (busy) {
    requestChanges.disabled = true;
    approve.disabled = true;
    status.textContent = "Saving and checking the Project brief…";
  }

  editor.addEventListener("input", () => {
    store.setDraft(repoRoot, "reviewBrief", editor.value);
    store.clearDraft(repoRoot, "reviewStatus");
    status.className = "dim small";
    status.textContent = "Changes are saved when you request changes or approve.";
    highlights.replaceChildren(renderBriefHighlights(editor.value));
  });
  requestChanges.addEventListener("click", () => {
    if (reviewDecisionInFlight.has(repoRoot)) return;
    reviewDecisionInFlight.add(repoRoot);
    requestChanges.disabled = true;
    approve.disabled = true;
    status.textContent = "Saving the brief before returning to interactive authoring…";
    void saveProjectBrief(repoRoot, editor.value)
      .then(() => {
        setGuidedAuthoringStep(repoRoot, "brief");
        store.clearDraft(repoRoot, "reviewStatus");
        startSession(container, "prd");
      })
      .catch((error: unknown) => setBriefReviewError(repoRoot, status, error))
      .finally(() => {
        reviewDecisionInFlight.delete(repoRoot);
        if (status.isConnected && !location.hash.includes("terminal")) {
          requestChanges.disabled = false;
          approve.disabled = false;
        }
      });
  });
  approve.addEventListener("click", () => {
    if (reviewDecisionInFlight.has(repoRoot)) return;
    reviewDecisionInFlight.add(repoRoot);
    requestChanges.disabled = true;
    approve.disabled = true;
    status.textContent = "Saving and validating the Project brief…";
    void (async () => {
      try {
        await saveProjectBrief(repoRoot, editor.value);
        const validation = await api.validateAuthoring();
        if (!validation.ok) throw new Error(validation.message || "The Project brief needs changes before preparation.");
        setGuidedAuthoringStep(repoRoot, "preparing");
        store.clearDraft(repoRoot, "reviewStatus");
        reviewDecisionInFlight.delete(repoRoot);
        await startPreparation(container, repoRoot);
      } catch (error) {
        setBriefReviewError(repoRoot, status, error);
      } finally {
        reviewDecisionInFlight.delete(repoRoot);
        if (status.isConnected) {
          requestChanges.disabled = false;
          approve.disabled = false;
        }
      }
    })();
  });

  const grid = el("div", { className: "project-brief-review-grid" }, [
    el("div", { className: "project-brief-editor-wrap" }, [
      el("label", { for: "project-brief-editor" }, "Project brief (editable)"),
      editor,
    ]),
    el("aside", { className: "project-brief-at-a-glance" }, [
      el("h4", null, "At a glance"),
      highlights,
    ]),
  ]);
  const review = el("div", { className: "project-brief-review" }, [
    el("h3", null, "Review your Project brief"),
    el("p", { className: "dim" }, "Check the outcome, scope, success criteria, assumptions, and open questions. Approval starts preparation only; it does not start a Build."),
    grid,
    status,
    el("div", { className: "actions" }, [
      requestChanges,
      approve,
      el("a", { className: "btn", href: "#/project-files" }, "Project files"),
    ]),
  ]);

  void loadProjectBrief(repoRoot).then((content) => {
    if (!editor.isConnected) return;
    editor.value = store.getDraft(repoRoot, "reviewBrief", content);
    editor.disabled = false;
    highlights.replaceChildren(renderBriefHighlights(editor.value));
    if (!reviewDecisionInFlight.has(repoRoot) && !isTerminalSessionActive()) {
      requestChanges.disabled = false;
      approve.disabled = false;
    }
  }).catch((error: unknown) => {
    if (!editor.isConnected) return;
    editor.disabled = true;
    status.className = "error-text small";
    status.textContent = error instanceof Error ? `Could not load the Project brief: ${error.message}` : "Could not load the Project brief.";
  });
  return review;
}

function renderBriefHighlights(content: string): HTMLElement {
  const sections: Array<{ heading: string; body: string }> = [];
  let heading = "";
  let lines: string[] = [];
  const finish = (): void => {
    const body = lines.join("\n").trim();
    if (heading && body) sections.push({ heading, body });
  };
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s{0,3}#{1,4}\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      finish();
      heading = match[1]!.trim();
      lines = [];
    } else {
      lines.push(line);
    }
  }
  finish();

  const selected = sections.filter(({ heading: title }) =>
    /vision|outcome|goal|audience|user|scope|capabilit|feature|success|acceptance|assumption|open question|risk|constraint/i.test(title))
    .slice(0, 7);
  const shown = selected.length > 0
    ? selected
    : [{ heading: "Brief preview", body: content.trim() }];
  const items = shown.map(({ heading: title, body }) => {
    const excerpt = body.replace(/\s+/g, " ").trim();
    return el("section", { className: "project-brief-highlight" }, [
      el("strong", null, title),
      el("p", { className: "dim small" }, excerpt.length > 360 ? `${excerpt.slice(0, 357)}…` : excerpt),
    ]);
  });
  const hasOpenItems = sections.some(({ heading: title }) => /assumption|open question/i.test(title));
  if (!hasOpenItems) {
    items.push(el("p", { className: "dim small" }, "Assumptions and open questions are not called out under a section heading. Check the editable brief for anything that still needs attention."));
  }
  return el("div", { className: "project-brief-highlights-list" }, items);
}

function renderPreparation(container: HTMLElement, summary: Summary, step: GuidedAuthoringStep): HTMLElement {
  const repoRoot = summary.repoRoot;
  if (isPreparationComplete(summary, step)) {
    setGuidedAuthoringStep(repoRoot, "ready");
    return renderPreparedPlan(container, summary);
  }

  const progress = summary.rederive;
  const failedStep = progress?.failedStep ?? null;
  const failedEntry = progress?.steps.find((entry) => entry.id === failedStep);
  const savedError = store.getDraft(repoRoot, "preparationError", "");
  const jobFailed = summary.job?.type === "rederive" && summary.job.status === "failed";
  const failure = failedEntry?.message
    || (failedStep ? `The ${failedStep} preparation step did not complete.` : "")
    || (jobFailed ? summary.job?.message : "")
    || savedError;
  const current = progress?.steps.find((entry) => entry.status === "running")
    ?? progress?.steps.find((entry) => entry.status === "pending");
  const labels: Record<string, string> = {
    team: "Setting up your Project team",
    skills: "Preparing guidance for the work",
    manifest: "Organizing the Build plan",
  };
  const requestStarting = preparationStarting.has(repoRoot);
  const children: HTMLElement[] = [
    el("h3", null, failure ? "Preparation needs attention" : "Preparing your Build"),
    el("p", { className: failure ? "error-text" : "dim", role: failure ? "alert" : "status", "aria-live": "polite" },
      failure
        ? `Preparation stopped: ${failure}`
        : requestStarting
          ? "Starting the guided preparation step…"
          : current
            ? `${labels[current.id] ?? current.label}…`
            : "Your approved brief is being prepared into a ready-to-start plan."),
  ];

  if (progress?.active || summary.job?.status === "running" || requestStarting) {
    children.push(
      el("div", { className: "spinner-row", role: "status", "aria-live": "polite" }, [
        el("span", { className: "spinner", "aria-hidden": "true" }),
        el("span", null, "Preparation runs in the background. You can leave this page and return to the same Project."),
      ]),
      el("p", { className: "dim small" }, ["For details, ", el("a", { href: "#/logs" }, "open the preparation logs"), "."]),
    );
  } else {
    const retry = el("button", { className: "btn btn-primary", type: "button" }, "Retry preparation") as HTMLButtonElement;
    retry.addEventListener("click", () => void startPreparation(container, repoRoot, failedStep ?? undefined));
    children.push(
      el("p", { className: "dim small" }, "Preparation has not completed, so the Build remains stopped. Retry preparation or inspect the logs for details."),
      el("div", { className: "actions" }, [
        retry,
        el("a", { className: "btn", href: "#/logs" }, "Open logs"),
      ]),
    );
  }
  return el("div", { className: "project-preparation" }, children);
}

function isPreparationComplete(summary: Summary, step: GuidedAuthoringStep): boolean {
  if (
    !summary.hasTeam ||
    !summary.hasManifest ||
    summary.authoringReady === false ||
    summary.rederive?.active ||
    summary.rederive?.failedStep ||
    summary.job?.type === "rederive" && (summary.job.status === "running" || summary.job.status === "failed") ||
    staleDerivationStages(summary).length > 0
  ) return false;
  if (summary.rederive?.complete) return true;
  return step === "ready";
}

function renderPreparedPlan(container: HTMLElement, summary: Summary): HTMLElement {
  const repoRoot = summary.repoRoot;
  const featureTasks = featureTaskReviewIds(summary);
  const taskReviewRequired = featureTasks.length > 0 && !featureTasksReviewed(summary);
  const status = el("p", {
    className: "dim small",
    role: "status",
    "aria-live": "polite",
  }, taskReviewRequired
    ? `Review the ${featureTasks.length} generated Task${featureTasks.length === 1 ? "" : "s"} before starting this Build.`
    : store.getDraft(repoRoot, "buildStartError", "Preparation is complete. A Build has not started."));
  const start = el("button", {
    className: "btn btn-primary",
    type: "button",
    disabled: buildStarting.has(repoRoot) ? true : null,
  }, buildStarting.has(repoRoot) ? "Starting build…" : "Start build") as HTMLButtonElement;
  start.addEventListener("click", () => void startPreparedBuild(container, summary, start, status));
  const content = el("div", { className: "prepared-plan-content" }, "Loading the prepared plan…");
  const panel = el("div", { className: "project-prepared-plan" }, [
    el("h3", null, "Your Build is ready"),
    el("p", { className: "dim" }, "Review the plan before you decide. Preparation is complete; no Build execution has started."),
    content,
    status,
    el("div", { className: "actions" }, [
      start,
      taskReviewRequired ? el("a", { className: "btn btn-primary", href: "#/tasks?feature-review=1" }, "Review new Tasks") : null,
      el("a", { className: "btn", href: "#/project-files" }, "Project files"),
    ]),
  ]);
  void Promise.all([loadProjectBrief(repoRoot), api.manifest()]).then(([brief, manifest]) => {
    if (!content.isConnected) return;
    const sections: HTMLElement[] = [
      el("h4", null, "Project brief at a glance"),
      renderBriefHighlights(brief),
      el("h4", null, "Major phases"),
    ];
    if (manifest?.phases.length) {
      sections.push(el("ol", { className: "prepared-plan-phases" }, manifest.phases.map((phase) =>
        el("li", null, [
          el("strong", null, phase.title),
          phase.description ? el("p", { className: "dim small" }, phase.description) : null,
        ]))));
    } else {
      sections.push(el("p", { className: "dim small" }, "No phase summary is available. Refresh to check the prepared plan."));
    }
    if (manifest?.warnings.length) {
      sections.push(el("section", { className: "prepared-plan-attention" }, [
        el("h4", null, "Items needing attention"),
        el("ul", null, manifest.warnings.map((warning) => el("li", null, warning))),
      ]));
    } else {
      sections.push(el("p", { className: "dim small" }, "No additional preparation warnings were reported."));
    }
    content.replaceChildren(...sections);
  }).catch((error: unknown) => {
    if (content.isConnected) content.replaceChildren(el("p", { className: "error-text", role: "alert" },
      error instanceof Error ? `Could not load the prepared plan: ${error.message}` : "Could not load the prepared plan."));
  });
  return panel;
}

async function saveProjectBrief(repoRoot: string, content: string): Promise<void> {
  const result = await api.saveProjectBrief(repoRoot, content);
  if (!result.ok) throw new Error(result.message || "Could not save the Project brief.");
  cachedBrief = { repoRoot, content };
  store.clearDraft(repoRoot, "reviewBrief");
}

function setBriefReviewError(repoRoot: string, status: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? error.message : "The Project brief could not be saved.";
  store.setDraft(repoRoot, "reviewStatus", message);
  status.className = "error-text small";
  status.textContent = message;
}

async function startPreparation(container: HTMLElement, repoRoot: string, from?: "team" | "skills" | "manifest"): Promise<void> {
  if (preparationStarting.has(repoRoot)) return;
  preparationStarting.add(repoRoot);
  setGuidedAuthoringStep(repoRoot, "preparing");
  store.clearDraft(repoRoot, "preparationError");
  try {
    const result = await api.rederive(from);
    if (!result.ok) {
      store.setDraft(repoRoot, "preparationError", result.message || "Preparation could not be started.");
    } else if (result.job?.status === "running") {
      startPoll(container);
    } else if (result.job?.status === "failed") {
      store.setDraft(repoRoot, "preparationError", result.job.message);
    }
  } catch (error) {
    store.setDraft(repoRoot, "preparationError", error instanceof Error ? error.message : "Preparation could not be started.");
  } finally {
    preparationStarting.delete(repoRoot);
    void renderOverview(container);
  }
}

async function startPreparedBuild(
  container: HTMLElement,
  summary: Summary,
  button: HTMLButtonElement,
  status: HTMLElement,
): Promise<void> {
  const repoRoot = summary.repoRoot;
  const featureTasks = featureTaskReviewIds(summary);
  if (featureTasks.length > 0 && !featureTasksReviewed(summary)) {
    status.className = "error-text small";
    status.textContent = `Review the ${featureTasks.length} generated Task${featureTasks.length === 1 ? "" : "s"} before starting this Build.`;
    return;
  }
  if (!isPreparationComplete(summary, "ready") || summary.run) {
    status.className = "error-text small";
    status.textContent = "The prepared plan is no longer ready. Refresh and complete preparation before starting a Build.";
    return;
  }
  if (buildStarting.has(repoRoot)) return;
  buildStarting.add(repoRoot);
  button.disabled = true;
  button.textContent = "Starting build…";
  status.textContent = "Starting the Build you approved…";
  store.clearDraft(repoRoot, "buildStartError");
  try {
    const result = await api.control("run");
    if (!result.ok) {
      store.setDraft(repoRoot, "buildStartError", result.message || "The Build could not be started.");
      buildStarting.delete(repoRoot);
    } else if (result.job?.status === "running") {
      startPoll(container);
    } else {
      store.setDraft(repoRoot, "buildStartError", result.message || "The Build did not start.");
      buildStarting.delete(repoRoot);
    }
  } catch (error) {
    store.setDraft(repoRoot, "buildStartError", error instanceof Error ? error.message : "The Build could not be started.");
    buildStarting.delete(repoRoot);
  } finally {
    void renderOverview(container);
  }
}

function sessionButton(container: HTMLElement, target: "idea" | "prd", label: string): HTMLButtonElement {
  const button = el("button", { className: "btn btn-primary", disabled: isTerminalSessionActive() ? true : null }, label) as HTMLButtonElement;
  button.addEventListener("click", () => startSession(container, target));
  return button;
}

function loadProjectBrief(repoRoot: string): Promise<string> {
  if (cachedBrief?.repoRoot === repoRoot) return Promise.resolve(cachedBrief.content);
  if (pendingBrief?.repoRoot === repoRoot) return pendingBrief.load;
  const load = api.docContent("docs/PRD.md").then((file) => {
    cachedBrief = { repoRoot, content: file.content };
    return file.content;
  }).finally(() => {
    if (pendingBrief?.load === load) pendingBrief = null;
  });
  pendingBrief = { repoRoot, load };
  return load;
}

function renderActions(container: HTMLElement, summary: Summary, actions: Actions, tasks: TaskRow[]): HTMLElement {
  if (activeGuidedStep(summary)) {
    return el("div", { className: "panel controls-disabled" }, [
      el("h4", null, "Build controls"),
      el("p", { className: "dim small" }, "This Project's Build has not started. Complete preparation, then choose Start build when you are ready."),
    ]);
  }
  const featureTasks = featureTaskReviewIds(summary);
  if (featureTasks.length > 0 && !featureTasksReviewed(summary) && (actions.canRun || actions.canResume)) {
    return el("div", { className: "panel controls-disabled feature-task-review-gate" }, [
      el("h4", null, "Review generated Tasks before execution"),
      el("p", { className: "dim small" }, `Review the ${featureTasks.length} Task${featureTasks.length === 1 ? "" : "s"} added or changed by this feature before starting or resuming a Build. Existing execution history remains intact.`),
      el("a", { className: "btn btn-primary", href: "#/tasks?feature-review=1" }, "Review new Tasks"),
    ]);
  }
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
  const runFailed = summary.run !== null && ["failed", "error"].includes(summary.run.status);
  const buttons = [
    el("button", { className: "btn btn-primary", disabled: !runFailed && !authoringBlocked && actions.canRun && !manualNeedsSelection ? null : true }, summary.executionMode === "manual" ? "Run selected" : "Run"),
    el("button", { className: "btn", disabled: !authoringBlocked && actions.canResume && !manualNeedsSelection ? null : true }, summary.executionMode === "manual" ? "Resume selected" : "Resume"),
    el("button", { className: "btn", disabled: actions.canPause ? null : true }, "Pause"),
    el("button", { className: "btn btn-danger", disabled: actions.canStop ? null : true }, "Stop"),
  ];
  buttons[0]!.addEventListener("click", () => ctl("run"));
  buttons[1]!.addEventListener("click", () => ctl("resume"));
  buttons[2]!.addEventListener("click", () => ctl("pause"));
  buttons[3]!.addEventListener("click", () => {
    if (!window.confirm("Stop this Build now? The current Build will be stopped.")) return;
    ctl("stop");
  });

  let replay: HTMLElement | null = null;
  if (actions.failedTasks.length > 0) {
    const select = el("select", { className: "replay-select" });
    for (const id of actions.failedTasks) select.appendChild(el("option", { value: id }, id));
    const replayBtn = el("button", { className: "btn btn-sm" }, "Replay failed");
    replayBtn.addEventListener("click", () => ctl("replay", (select as HTMLSelectElement).value));
    replay = el("div", { className: "row gap" }, [select, replayBtn]);
  }

  const mode = renderBuildModeControl(container, summary.executionMode, summary.selectedTaskCount);
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
      ? el("p", { className: "error-text small", role: "alert" }, [summary.authoringBlocker || "Authoring stages are incomplete.", " ", el("a", { href: "#/documents" }, "Review authoring stages")])
      : null,
    runFailed
      ? el("p", { className: "dim small" }, "To preserve completed work, choose Resume or Replay failed instead of starting a fresh run.")
      : null,
    replay,
    el("p", { className: "dim small" }, ["Execution settings (timeouts, concurrency, auto-commit, harness logging) now live in ", el("a", { href: "#/settings" }, "Settings"), "."]),
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

function stat(label: string, value: string, cls?: string): HTMLElement {
  return el("div", { className: "stat" }, [
    el("div", { className: "k" }, label),
    el("div", { className: cls ? `v v-${cls}` : "v" }, value),
  ]);
}
