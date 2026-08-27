import type { ExecutionManifest } from "../../../forge-execution-adapter/scripts/types.ts";

// ─── Kanban layout ────────────────────────────────────────────────────────────
//
// Pure layout: maps the manifest onto a kanban board. Phases become horizontal
// bands stacked top-to-bottom; each band holds its tasks in four status
// columns (To Do / In Progress / Done / Failed). Dependency and artifact edges
// connect the cards. Keeping this a pure function makes it unit-testable and
// keeps rendering concerns out of the engine.

export type ColumnKey = "pending" | "running" | "complete" | "failed";

export interface KanbanColumn {
  key: ColumnKey;
  label: string;
  /** Left edge of the column (screen coords). */
  x: number;
  width: number;
}

export interface LayoutTask {
  id: string;
  title: string;
  ownerAgent?: string;
  phaseId: string;
  phaseIndex: number;
  /** 0-based manifest order within its phase. */
  indexInPhase: number;
  /** Initial top-left of the card (To Do column). The dashboard re-positions
   *  cards dynamically as their status changes. */
  x: number;
  y: number;
  produces?: string;
  inputs: string[];
  dependencies: string[];
}

export interface LayoutPhase {
  id: string;
  title: string;
  description?: string;
  index: number;
  /** Top edge of the band (screen coords, lower = earlier phase). */
  y: number;
  height: number;
}

export type LayoutEdgeKind = "dependency" | "artifact";

export interface LayoutEdge {
  from: string;
  to: string;
  kind: LayoutEdgeKind;
}

export interface KanbanLayout {
  width: number;
  height: number;
  columns: KanbanColumn[];
  phases: LayoutPhase[];
  tasks: LayoutTask[];
  edges: LayoutEdge[];
}

export interface LayoutOptions {
  width?: number;
  height?: number;
  /** Left rail width for phase labels. */
  labelWidth?: number;
  /** Horizontal padding inside columns. */
  padX?: number;
  /** Vertical padding inside bands. */
  padY?: number;
  /** Vertical gap between bands. */
  bandGap?: number;
  /** Space above the first band (reserves room for the column header row). */
  topMargin?: number;
  bottomMargin?: number;
  /** Space between a band's top edge and its first card. */
  headerSpace?: number;
  /** Card height. */
  cardHeight?: number;
  /** Vertical gap between stacked cards. */
  cardGap?: number;
  /** Extra padding below the last card in a band. */
  bottomPad?: number;
}

const DEFAULTS: Required<LayoutOptions> = {
  width: 1280,
  height: 800,
  labelWidth: 170,
  padX: 18,
  padY: 12,
  bandGap: 20,
  topMargin: 84,
  bottomMargin: 40,
  headerSpace: 40,
  cardHeight: 62,
  cardGap: 16,
  bottomPad: 8,
};

const COLUMN_LABELS: Record<ColumnKey, string> = {
  pending: "To Do",
  running: "In Progress",
  complete: "Done",
  failed: "Failed",
};

export function layoutManifest(
  manifest: ExecutionManifest,
  options: LayoutOptions = {},
): KanbanLayout {
  const opts = { ...DEFAULTS, ...options };
  const avail = opts.width - opts.labelWidth - opts.padX * 2;
  const colW = avail / Object.keys(COLUMN_LABELS).length;

  const columns: KanbanColumn[] = (Object.keys(COLUMN_LABELS) as ColumnKey[]).map((key, i) => ({
    key,
    label: COLUMN_LABELS[key]!,
    x: opts.labelWidth + opts.padX + i * colW,
    width: colW,
  }));

  // Each band auto-sizes to its busiest column (all tasks sit in To Do until
  // they run), so stacked cards never overflow into the next band.
  const phases: LayoutPhase[] = [];
  let bandY = opts.topMargin;
  for (const phase of manifest.phases) {
    const height =
      opts.headerSpace +
      phase.tasks.length * (opts.cardHeight + opts.cardGap) +
      opts.bottomPad;
    phases.push({
      id: phase.id,
      title: phase.title,
      description: phase.description,
      index: phases.length,
      y: bandY,
      height,
    });
    bandY += height + opts.bandGap;
  }

  const phasesById = new Map(phases.map((p) => [p.id, p]));

  const toDo = columns.find((c) => c.key === "pending")!;

  const tasks: LayoutTask[] = [];
  for (const phase of manifest.phases) {
    const band = phasesById.get(phase.id);
    if (!band) continue;
    for (let i = 0; i < phase.tasks.length; i += 1) {
      const task = phase.tasks[i]!;
      tasks.push({
        id: task.id,
        title: task.title,
        ownerAgent: task.ownerAgent,
        phaseId: phase.id,
        phaseIndex: band.index,
        indexInPhase: i,
        x: toDo.x + opts.padX,
        y: band.y + opts.headerSpace + i * (opts.cardHeight + opts.cardGap),
        produces: task.produces,
        inputs: task.inputs ?? [],
        dependencies: task.dependencies,
      });
    }
  }

  const tasksById = new Map(tasks.map((t) => [t.id, t]));

  const edges: LayoutEdge[] = [];
  for (const task of tasks) {
    for (const depId of task.dependencies) {
      if (tasksById.has(depId)) edges.push({ from: depId, to: task.id, kind: "dependency" });
    }
    for (const inputType of task.inputs) {
      const producer = tasks.find((t) => t.produces === inputType);
      if (producer && producer.id !== task.id) {
        edges.push({ from: producer.id, to: task.id, kind: "artifact" });
      }
    }
  }

  const height = (phases.length
    ? phases[phases.length - 1]!.y + phases[phases.length - 1]!.height
    : opts.topMargin) + opts.bottomMargin;

  return { width: opts.width, height, columns, phases, tasks, edges };
}
