import type { ExecutionManifest } from "../../../forge-execution-adapter/scripts/types.ts";

// ─── Whorl-tree layout ────────────────────────────────────────────────────────
//
// Pure layout: maps the manifest DAG onto a single growing oak. Phases are
// whorls/levels up the trunk (time grows upward), tasks hang from the whorl's
// branch line left-to-right across the trunk, and dependency / artifact edges
// become acorn trails. Keeping this a pure function makes it unit-testable and
// keeps rendering concerns out of the engine.

export interface LayoutTask {
  id: string;
  title: string;
  ownerAgent?: string;
  phaseId: string;
  phaseIndex: number;
  /** 0-based position along the whorl's branch line. */
  indexInPhase: number;
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
  /** Y of the whorl's branch line (screen coords, lower = first phase). */
  y: number;
}

export type LayoutEdgeKind = "dependency" | "artifact" | "phase";

export interface LayoutEdge {
  from: string;
  to: string;
  kind: LayoutEdgeKind;
}

export interface TreeLayout {
  width: number;
  height: number;
  trunkX: number;
  trunkTop: number;
  trunkBottom: number;
  phases: LayoutPhase[];
  tasks: LayoutTask[];
  edges: LayoutEdge[];
}

export interface LayoutOptions {
  width?: number;
  height?: number;
  /** Vertical space between whorls. */
  phaseHeight?: number;
  /** Distance the branch line spans from the trunk to each side. */
  branchSpan?: number;
  /** Bottom margin for the first whorl. */
  bottomMargin?: number;
  /** Top margin for the highest whorl. */
  topMargin?: number;
}

const DEFAULTS: Required<LayoutOptions> = {
  width: 1280,
  height: 800,
  phaseHeight: 180,
  branchSpan: 460,
  bottomMargin: 110,
  topMargin: 90,
};

export function layoutManifest(
  manifest: ExecutionManifest,
  options: LayoutOptions = {},
): TreeLayout {
  const opts = { ...DEFAULTS, ...options };
  const trunkX = opts.width / 2;
  const baseY = opts.height - opts.bottomMargin;

  const phases: LayoutPhase[] = manifest.phases.map((phase, index) => ({
    id: phase.id,
    title: phase.title,
    description: phase.description,
    index,
    y: baseY - index * opts.phaseHeight,
  }));

  const phasesById = new Map(phases.map((p) => [p.id, p]));

  const tasks: LayoutTask[] = [];
  for (const phase of manifest.phases) {
    const phaseLayout = phasesById.get(phase.id);
    if (!phaseLayout) continue;
    const n = phase.tasks.length;
    for (let i = 0; i < n; i += 1) {
      const task = phase.tasks[i]!;
      // Spread tasks evenly along the whorl's branch line, across the trunk.
      const frac = n <= 1 ? 0 : (i / (n - 1)) * 2 - 1;
      tasks.push({
        id: task.id,
        title: task.title,
        ownerAgent: task.ownerAgent,
        phaseId: phase.id,
        phaseIndex: phaseLayout.index,
        indexInPhase: i,
        x: trunkX + frac * opts.branchSpan,
        y: phaseLayout.y + 34,
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
  for (let i = 0; i < manifest.phases.length - 1; i += 1) {
    const current = manifest.phases[i]!;
    const next = manifest.phases[i + 1]!;
    const lastOfCurrent = current.tasks[current.tasks.length - 1];
    const firstOfNext = next.tasks[0];
    if (lastOfCurrent && firstOfNext) {
      edges.push({ from: lastOfCurrent.id, to: firstOfNext.id, kind: "phase" });
    }
  }

  const lastPhase = phases[phases.length - 1];

  return {
    width: opts.width,
    height: opts.height,
    trunkX,
    trunkTop: Math.max(lastPhase?.y ?? 0, opts.topMargin),
    trunkBottom: baseY,
    phases,
    tasks,
    edges,
  };
}
