import { prerequisites } from "../task-graph.ts";
import type { ExecutionManifest, ManifestTask } from "../../../forge-execution-adapter/scripts/types.ts";

// ─── Gantt layout ─────────────────────────────────────────────────────────────
//
// Pure layout: maps the manifest plus run state onto a dependency Gantt. One row
// per task, grouped under phase headers, with a time axis across the top. A bar
// is either *actual* (the engine measured it) or *planned* (this module
// forecast it from observed durations).
//
// Two rules keep the forecast honest:
//
//   * Dependencies come from `task-graph.ts`, the engine's own dispatch rule. A
//     different rule would happily schedule tasks the engine can never dispatch.
//   * Forecasts are concurrency-aware. Scheduling on dependencies alone ignores
//     that only N tasks run at once, which makes every projection optimistic.
//
// Keeping this pure is what makes it testable and keeps the renderer free of
// scheduling logic.

export type EstimateSource = "actual" | "audit" | "owner" | "default";

export interface GanttBar {
  taskId: string;
  /** Row index into `rows` of the owning task row. */
  row: number;
  kind: "actual" | "planned";
  startMs: number;
  endMs: number;
  status: string;
  ownerAgent?: string;
  /** On the longest dependency chain by forecast duration. */
  critical: boolean;
  /** Zero-length review gate, drawn as a diamond rather than a bar. */
  milestone: boolean;
  /** Where the duration came from, so the UI never implies more precision. */
  estimateSource: EstimateSource;
  /** Measured duration when known; the forecast otherwise. */
  durationMs: number;
}

export interface GanttRow {
  kind: "phase" | "task";
  id: string;
  label: string;
  y: number;
  height: number;
  /** Index of the owning phase row, for task rows. */
  phaseRow?: number;
}

export interface GanttEdge {
  from: string;
  to: string;
  /** An edge into a task that has already started is a satisfied dependency. */
  satisfied: boolean;
}

export interface GanttTick {
  at: number;
  label: string;
  /** Midnight, drawn as a full-height rule rather than a short tick. */
  dayBoundary: boolean;
}

export interface GanttAxis {
  min: number;
  max: number;
  ticks: GanttTick[];
}

export interface GanttLayout {
  width: number;
  height: number;
  rows: GanttRow[];
  bars: GanttBar[];
  edges: GanttEdge[];
  axis: GanttAxis;
  /** Phase rollups, spanning each phase's earliest start to latest finish. */
  phaseBars: Array<{ phaseId: string; row: number; startMs: number; endMs: number; critical: boolean }>;
  /** Task ids on the longest chain, in dependency order. */
  criticalPath: string[];
  /** Latest finish across all bars: the forecast completion, or the real one. */
  forecastEndMs: number;
  /** "now", so the renderer can draw the live marker without re-deriving it. */
  nowMs: number;
  /** Plot area the bars occupy, excluding the label rail. */
  plot: { left: number; width: number };
  /** Gutter reserved above the first row for the time axis. */
  axisHeight: number;
}

/**
 * Projects a timestamp onto an x coordinate within a layout's plot area.
 *
 * A closure on the layout would be more convenient, but the layout travels over
 * JSON and `JSON.stringify` silently drops functions — a `xFor` method arrives
 * at the renderer as `undefined`. The engine owns the *domain* (axis extents and
 * plot geometry); the renderer owns the projection from domain to pixels, which
 * is a per-view concern anyway.
 */
export function xFor(layout: Pick<GanttLayout, "axis" | "plot">, ms: number): number {
  const span = Math.max(layout.axis.max - layout.axis.min, MINUTE);
  return layout.plot.left + ((ms - layout.axis.min) / span) * layout.plot.width;
}

export interface GanttOptions {
  /** Total layout width; the plot area is what remains after the label rail. */
  width?: number;
  /** Left rail width for the phase and task labels. */
  labelWidth?: number;
  /** Horizontal padding inside the plot area. */
  padX?: number;
  /** Time-axis gutter height. */
  axisHeight?: number;
  phaseRowHeight?: number;
  taskRowHeight?: number;
  rowGap?: number;
  bottomMargin?: number;
  /**
   * Parallel task limit from engine config. 0 or absent means the engine
   * default, which is 1, so forecasts stay serial unless told otherwise.
   */
  concurrency?: number;
  /** Now, injectable so tests and screenshots are deterministic. */
  nowMs?: number;
  /**
   * Observed durations keyed by task id, normally harvested from the audit
   * stream's `task.complete` events across every attempt of the run.
   */
  observedDurationsMs?: Record<string, number[]>;
  /** Used when nothing observed can inform the estimate. */
  defaultDurationMs?: number;
}

const DEFAULTS = {
  width: 1280,
  labelWidth: 260,
  padX: 16,
  axisHeight: 34,
  phaseRowHeight: 26,
  taskRowHeight: 26,
  rowGap: 4,
  bottomMargin: 32,
  defaultDurationMs: 10 * 60_000,
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const isTaskDone = (status: string | undefined): boolean => status === "complete" || status === "skipped";

function median(values: number[]): number {
  const sorted = [...values].filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/**
 * Duration estimate for a task, in descending order of evidence:
 * the task's own observed attempts, then the same agent's observed attempts
 * (agents differ in how long their work takes), then a constant. Never invents
 * precision — `estimateSource` travels with the bar.
 */
export function estimateDuration(
  task: ManifestTask,
  observed: Map<string, number[]>,
  ownerMedian: Map<string, number>,
  fallbackMs: number,
): { durationMs: number; source: EstimateSource } {
  const own = median(observed.get(task.id) ?? []);
  if (own > 0) return { durationMs: own, source: "audit" };
  if (task.ownerAgent) {
    const owner = ownerMedian.get(task.ownerAgent) ?? 0;
    if (owner > 0) return { durationMs: owner, source: "owner" };
  }
  return { durationMs: fallbackMs, source: "default" };
}

/** Reviews are gates, not work: they cost a human decision, not an agent run. */
const isMilestone = (task: ManifestTask): boolean =>
  task.contract?.kind === "human-review" || task.approvalRequired === true;

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function clockLabel(ms: number): string {
  const date = new Date(ms);
  return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}

function dayLabel(ms: number): string {
  const date = new Date(ms);
  return `${date.getDate()}/${date.getMonth() + 1}`;
}

/** Midnight of the local day containing `ms`, in epoch milliseconds. */
function localDayStart(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Time-axis ticks, at a granularity that keeps roughly 6-12 labels across the
 * span: minutes for a short run, hours for a day, days beyond that.
 *
 * Ticks are aligned to the *local* clock, not UTC. A build runs on the reader's
 * wall clock, so "midnight" has to mean their midnight; anchoring ticks to UTC
 * multiples while labelling them with local hours puts every label on the wrong
 * minute and never marks a day boundary at all. Every candidate step divides a
 * day, so stepping from one local midnight lands back on local midnight and the
 * day rules inside the range are found.
 */
export function buildAxis(min: number, max: number): GanttAxis {
  const span = Math.max(max - min, MINUTE);
  const steps = [5 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY];
  const step = steps.find((candidate) => span / candidate <= 12) ?? steps[steps.length - 1]!;
  const daily = step >= DAY;

  const ticks: GanttTick[] = [];
  const dayStart = localDayStart(min);
  for (let at = dayStart + Math.ceil((min - dayStart) / step) * step; at <= max; at += step) {
    ticks.push({
      at,
      label: daily ? dayLabel(at) : clockLabel(at),
      dayBoundary: at === localDayStart(at),
    });
  }
  // A span shorter than one step still deserves at least the start and end.
  if (ticks.length === 0) {
    ticks.push({ at: min, label: daily ? dayLabel(min) : clockLabel(min), dayBoundary: min === localDayStart(min) });
  }
  return { min, max, ticks };
}

/**
 * Schedules every task and returns the Gantt geometry.
 *
 * Actual bars come from the run state. Planned bars come from a forward pass in
 * topological order: a task starts when its prerequisites have finished *and* a
 * concurrency slot is free. Tasks with no prerequisites start at the earliest
 * observed instant in the run, so a never-started run still renders sensibly.
 */
/**
 * The subset of run state this layout reads. Structural rather than
 * `WorkflowState` so the Forge Console — which declares its own wire copy of the
 * same shape — can pass its state without the two drifting into a type error.
 */
export interface GanttState {
  startedAt?: string;
  tasks?: Record<string, { status?: string; startedAt?: string; completedAt?: string }>;
}

export function layoutGantt(
  manifest: ExecutionManifest,
  state: GanttState | null,
  options: GanttOptions = {},
): GanttLayout {
  const opts = { ...DEFAULTS, ...options };
  const nowMs = opts.nowMs ?? Date.now();
  const concurrency = Math.max(1, Math.floor(opts.concurrency || 0) || 1);
  const observed = new Map(Object.entries(options.observedDurationsMs ?? {}));

  const records = state?.tasks ?? {};
  const byId = new Map<string, ManifestTask>();
  const phaseOfTask = new Map<string, string>();
  for (const phase of manifest.phases) {
    for (const task of phase.tasks) {
      byId.set(task.id, task);
      phaseOfTask.set(task.id, phase.id);
    }
  }

  // Owner-level medians, so a task nobody has measured yet is estimated from
  // the agent that will run it rather than from a global average.
  const ownerSamples = new Map<string, number[]>();
  for (const [taskId, durations] of observed) {
    const owner = byId.get(taskId)?.ownerAgent;
    if (!owner) continue;
    ownerSamples.set(owner, [...(ownerSamples.get(owner) ?? []), ...durations]);
  }
  const ownerMedian = new Map([...ownerSamples].map(([owner, samples]) => [owner, median(samples)]));

  const estimates = new Map<string, { durationMs: number; source: EstimateSource }>();
  for (const [id, task] of byId) {
    estimates.set(id, estimateDuration(task, observed, ownerMedian, opts.defaultDurationMs));
  }

  const parse = (value: string | undefined): number | null => {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  };

  // ── Actual spans ───────────────────────────────────────────────────────────
  const actualStart = new Map<string, number>();
  const actualEnd = new Map<string, number>();
  let earliestObserved = Number.POSITIVE_INFINITY;
  const estimateOf = (id: string): number => estimates.get(id)?.durationMs ?? opts.defaultDurationMs;
  for (const [id, record] of Object.entries(records)) {
    const started = parse(record.startedAt);
    if (started === null) continue;
    actualStart.set(id, started);
    earliestObserved = Math.min(earliestObserved, started);
    if (isTaskDone(record.status)) {
      actualEnd.set(id, parse(record.completedAt) ?? started);
    } else {
      // A task that has not completed is bounded by its own forecast. A `running`
      // record older than the task's estimated duration is stale state rather than
      // a fortnight-long task, and honouring it literally — for the bar *and* for
      // scheduling dependents — would stretch the chart across the whole idle gap
      // and push the forecast out to the present.
      actualEnd.set(id, started + Math.max(estimateOf(id), MINUTE));
    }
  }
  const runStart = parse(state?.startedAt ?? undefined);
  if (earliestObserved === Number.POSITIVE_INFINITY) earliestObserved = runStart ?? nowMs;

  // The latest point at which anything actually happened. For a live run this is
  // "now"; for a run the engine has not touched since it was last closed it is
  // the last real event. The forecast is anchored here rather than at `now`, so a
  // Console reopened a week later still shows a readable chart of the run instead
  // of stretching the axis across the idle gap. The gap is shown by the now-line
  // instead, which is more informative than silently absorbing it.
  let observedEnd = Number.NEGATIVE_INFINITY;
  for (const record of Object.values(records)) {
    const at = parse(record.completedAt) ?? parse(record.startedAt);
    if (at !== null && at > observedEnd) observedEnd = at;
  }
  if (observedEnd === Number.NEGATIVE_INFINITY) observedEnd = nowMs;
  // The forecast continues from where the run actually got to. For a live run
  // that is "now" anyway; for a run the engine has not touched since it was last
  // closed it keeps the chart on the run instead of stretching it across the idle
  // gap, and the now-line — drawn only when it falls inside the axis — is what
  // reveals the staleness.
  const scheduleOrigin = Math.max(earliestObserved, observedEnd);

  // When a dependency will finish, for scheduling purposes. `actualEnd` is
  // already bounded by each task's own forecast for anything unfinished, so a
  // running dependency projects forward rather than appearing to complete the
  // instant we looked.
  const projectedEnd = new Map<string, number>(actualEnd);

  // ── Topological order over the engine's own dependency rule ────────────────
  const deps = new Map<string, string[]>();
  for (const id of byId.keys()) {
    // Drop prerequisites outside this manifest: a stale id must not stall the
    // schedule for every task that transitively referenced it.
    deps.set(id, prerequisites(manifest, id).filter((candidate) => byId.has(candidate)));
  }

  const order: string[] = [];
  const visitState = new Map<string, "new" | "open" | "done">();
  for (const id of byId.keys()) visitState.set(id, "new");
  const visit = (id: string): void => {
    const mark = visitState.get(id);
    if (mark === "done" || mark === "open") return;
    visitState.set(id, "open");
    for (const dependency of deps.get(id) ?? []) visit(dependency);
    visitState.set(id, "done");
    order.push(id);
  };
  for (const id of byId.keys()) visit(id);

  const dependents = new Map<string, string[]>();
  for (const [id, list] of deps) {
    for (const dependency of list) dependents.set(dependency, [...(dependents.get(dependency) ?? []), id]);
  }

  // ── Forward pass ───────────────────────────────────────────────────────────
  const plannedStart = new Map<string, number>();
  const plannedEnd = new Map<string, number>();
  // Slot free-times, one per concurrent worker. A task claims the worker that
  // frees first, which is what "concurrency" actually means for the engine.
  const slotFree = new Array<number>(concurrency).fill(scheduleOrigin);

  for (const id of order) {
    const record = records[id];
    if (isTaskDone(record?.status)) continue;

    const depFinish = (deps.get(id) ?? []).reduce((latest, dependency) => {
      const end = projectedEnd.get(dependency) ?? plannedEnd.get(dependency);
      return end !== undefined && end > latest ? end : latest;
    }, scheduleOrigin);

    const worker = slotFree.indexOf(Math.min(...slotFree));

    // A task the engine has already started is not re-planned; it is already
    // holding a worker, and that worker frees when the task is projected to
    // finish. Re-deriving its schedule here instead would reserve the slot to a
    // different end time than `projectedEnd` reports, and dependents would then
    // queue behind a slot that frees later than their own prerequisite does.
    if (actualStart.has(id)) {
      const end = projectedEnd.get(id) ?? depFinish;
      plannedEnd.set(id, end);
      slotFree[worker] = Math.max(slotFree[worker]!, end);
      continue;
    }

    const start = Math.max(depFinish, slotFree[worker] ?? scheduleOrigin);
    // A review gate costs a human decision, not an agent run, so it occupies no
    // time and no worker: it lands the moment its prerequisite finishes.
    const duration = isMilestone(byId.get(id)!) ? 0 : estimates.get(id)?.durationMs ?? opts.defaultDurationMs;
    const end = start + duration;
    plannedStart.set(id, start);
    plannedEnd.set(id, end);
    slotFree[worker] = end;
  }

  // ── Critical path over forecast durations ──────────────────────────────────
  // Longest chain in *dependency* order, so the DP walks dependents: with `order`
  // holding prerequisites first, its reverse visits every dependent before the
  // task it depends on, which is the order this recurrence needs.
  const longestFrom = new Map<string, number>();
  const nextOnPath = new Map<string, string | null>();
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const id = order[i]!;
    // Finished work is no longer outstanding, so it stops extending the path.
    const duration = isTaskDone(records[id]?.status) || isMilestone(byId.get(id)!)
      ? 0
      : estimates.get(id)?.durationMs ?? opts.defaultDurationMs;
    let bestTail = 0;
    let bestNext: string | null = null;
    for (const dependent of dependents.get(id) ?? []) {
      const candidate = longestFrom.get(dependent) ?? 0;
      if (candidate > bestTail) {
        bestTail = candidate;
        bestNext = dependent;
      }
    }
    longestFrom.set(id, duration + bestTail);
    nextOnPath.set(id, bestNext);
  }

  let tail: string | null = null;
  let tailLength = -1;
  for (const id of order) {
    // Only a task whose prerequisites are all finished can begin a chain.
    const canStart = (deps.get(id) ?? []).every((dependency) => isTaskDone(records[dependency]?.status));
    const length = longestFrom.get(id) ?? 0;
    if (canStart && length > tailLength) {
      tail = id;
      tailLength = length;
    }
  }
  // Walking forward from the tail yields prerequisite-first order directly.
  const criticalPath: string[] = [];
  let cursor: string | null = tail;
  while (cursor !== null) {
    criticalPath.push(cursor);
    cursor = nextOnPath.get(cursor) ?? null;
  }
  const critical = new Set(criticalPath);

  // ── Rows ───────────────────────────────────────────────────────────────────
  const rows: GanttRow[] = [];
  const barRows = new Map<string, number>();
  const phaseRowOf = new Map<string, number>();
  // Rows start below the axis gutter: the renderer's tick labels and day rules
  // occupy it, and a phase rollup drawn at y=0 would collide with them.
  let y = opts.axisHeight;
  for (const phase of manifest.phases) {
    const phaseRowIndex = rows.length;
    phaseRowOf.set(phase.id, phaseRowIndex);
    rows.push({ kind: "phase", id: phase.id, label: phase.title || phase.id, y, height: opts.phaseRowHeight });
    y += opts.phaseRowHeight + opts.rowGap;
    for (const task of phase.tasks) {
      barRows.set(task.id, rows.length);
      rows.push({
        kind: "task",
        id: task.id,
        label: `${task.id} · ${task.title}`,
        y,
        height: opts.taskRowHeight,
        phaseRow: phaseRowIndex,
      });
      y += opts.taskRowHeight + opts.rowGap;
    }
    y += opts.rowGap;
  }

  // ── Bars ───────────────────────────────────────────────────────────────────
  const bars: GanttBar[] = [];
  for (const phase of manifest.phases) {
    for (const task of phase.tasks) {
      const record = records[task.id];
      const status = record?.status ?? "pending";
      const milestone = isMilestone(task);
      const started = actualStart.get(task.id);
      const estimate = estimates.get(task.id)!;
      if (started !== undefined) {
        // `actualEnd` is already bounded by the task's own forecast when it has
        // not completed, so a stale `running` record cannot stretch the chart.
        const end = actualEnd.get(task.id) ?? started;
        bars.push({
          taskId: task.id,
          row: barRows.get(task.id)!,
          kind: "actual",
          startMs: started,
          endMs: isTaskDone(status) && end <= started ? started : end,
          status,
          ownerAgent: task.ownerAgent,
          critical: critical.has(task.id),
          milestone,
          estimateSource: isTaskDone(status) ? "actual" : estimate.source,
          durationMs: Math.max(0, end - started),
        });
      } else {
        const start = plannedStart.get(task.id);
        const end = plannedEnd.get(task.id);
        if (start === undefined || end === undefined) continue;
        bars.push({
          taskId: task.id,
          row: barRows.get(task.id)!,
          kind: "planned",
          startMs: milestone ? end : start,
          endMs: end,
          status,
          ownerAgent: task.ownerAgent,
          critical: critical.has(task.id),
          milestone,
          estimateSource: milestone ? "default" : estimate.source,
          durationMs: milestone ? 0 : estimate.durationMs,
        });
      }
    }
  }

  // ── Phase rollups ──────────────────────────────────────────────────────────
  const phaseBars: GanttLayout["phaseBars"] = [];
  for (const phase of manifest.phases) {
    if (phase.tasks.length === 0) continue;
    const spans = phase.tasks
      .map((task) => bars.find((bar) => bar.taskId === task.id))
      .filter((bar): bar is GanttBar => Boolean(bar));
    if (spans.length === 0) continue;
    const startMs = Math.min(...spans.map((bar) => bar.startMs));
    const endMs = Math.max(...spans.map((bar) => bar.endMs));
    phaseBars.push({
      phaseId: phase.id,
      row: phaseRowOf.get(phase.id)!,
      startMs,
      endMs,
      critical: spans.some((bar) => bar.critical),
    });
  }

  const edges: GanttEdge[] = [];
  for (const [id, list] of deps) {
    for (const dependency of list) {
      edges.push({ from: dependency, to: id, satisfied: isTaskDone(records[dependency]?.status) });
    }
  }

  // ── Axis and extents ───────────────────────────────────────────────────────
  const allTimes = bars.flatMap((bar) => [bar.startMs, bar.endMs]);
  const min = allTimes.length > 0 ? Math.min(...allTimes) : earliestObserved;
  const forecastEndMs = allTimes.length > 0 ? Math.max(...allTimes) : nowMs;
  // The axis spans the work, not the calendar. A running task's bar already
  // reaches `now` while the run is live, so including `now` here would add
  // nothing — and for a run the engine has not touched in days it would stretch
  // the chart across the whole idle gap. The now-line is drawn only when it falls
  // inside the axis, which is what reveals a stale run.
  const max = forecastEndMs;
  const plotLeft = opts.labelWidth + opts.padX;
  const plotWidth = Math.max(240, opts.width - plotLeft - opts.padX);

  return {
    width: opts.labelWidth + opts.padX * 2 + plotWidth,
    height: y + opts.bottomMargin,
    axisHeight: opts.axisHeight,
    rows,
    bars,
    edges,
    axis: buildAxis(min, max),
    phaseBars,
    criticalPath,
    forecastEndMs,
    nowMs,
    plot: { left: plotLeft, width: plotWidth },
  };
}