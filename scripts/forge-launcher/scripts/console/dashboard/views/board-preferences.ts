export type BoardMode = "kanban" | "gantt";
export type BoardStatusFilter = "pending" | "running" | "complete" | "failed" | "skipped";

export interface BoardPosition {
  left: number;
  top: number;
}

export interface BoardPreferenceState {
  mode: BoardMode;
  statuses: BoardStatusFilter[];
  selectedTaskId: string | null;
  positions: Record<BoardMode, BoardPosition>;
}

export interface BoardPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_PREFIX = "forge-console.board.";
const FILTERS: BoardStatusFilter[] = ["pending", "running", "complete", "failed", "skipped"];

function emptyState(): BoardPreferenceState {
  return {
    mode: "kanban",
    statuses: [],
    selectedTaskId: null,
    positions: {
      kanban: { left: 0, top: 0 },
      gantt: { left: 0, top: 0 },
    },
  };
}

function readPosition(value: unknown): BoardPosition {
  if (!value || typeof value !== "object") return { left: 0, top: 0 };
  const position = value as Record<string, unknown>;
  return {
    left: typeof position.left === "number" && Number.isFinite(position.left) ? Math.max(0, position.left) : 0,
    top: typeof position.top === "number" && Number.isFinite(position.top) ? Math.max(0, position.top) : 0,
  };
}

function readState(raw: string | null): BoardPreferenceState {
  if (!raw) return emptyState();
  try {
    const saved = JSON.parse(raw) as Record<string, unknown>;
    const state = emptyState();
    if (saved.mode === "kanban" || saved.mode === "gantt") state.mode = saved.mode;
    if (Array.isArray(saved.statuses)) {
      state.statuses = saved.statuses.filter(
        (status, index, list): status is BoardStatusFilter =>
          typeof status === "string" && FILTERS.includes(status as BoardStatusFilter) && list.indexOf(status) === index,
      );
    }
    if (typeof saved.selectedTaskId === "string" && saved.selectedTaskId.length > 0) {
      state.selectedTaskId = saved.selectedTaskId;
    }
    if (saved.positions && typeof saved.positions === "object") {
      const positions = saved.positions as Record<string, unknown>;
      state.positions.kanban = readPosition(positions.kanban);
      state.positions.gantt = readPosition(positions.gantt);
    }
    return state;
  } catch {
    return emptyState();
  }
}

export class BoardPreferences {
  private readonly key: string;
  private state: BoardPreferenceState;

  constructor(private readonly storage: BoardPreferenceStorage | null, project: string) {
    this.key = `${STORAGE_PREFIX}${encodeURIComponent(project)}`;
    this.state = readState(this.readStored());
  }

  get(): BoardPreferenceState {
    return {
      ...this.state,
      statuses: [...this.state.statuses],
      positions: {
        kanban: { ...this.state.positions.kanban },
        gantt: { ...this.state.positions.gantt },
      },
    };
  }

  setMode(mode: BoardMode): void {
    this.state.mode = mode;
    this.save();
  }

  setStatuses(statuses: string[]): void {
    this.state.statuses = statuses.filter(
      (status, index, list): status is BoardStatusFilter =>
        FILTERS.includes(status as BoardStatusFilter) && list.indexOf(status) === index,
    );
    this.save();
  }

  setSelectedTaskId(taskId: string | null): void {
    this.state.selectedTaskId = taskId;
    this.save();
  }

  setPosition(mode: BoardMode, position: BoardPosition): void {
    this.state.positions[mode] = readPosition(position);
    this.save();
  }

  private readStored(): string | null {
    try {
      return this.storage?.getItem(this.key) ?? null;
    } catch {
      return null;
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.state));
    } catch {
      // The Board remains usable when browser storage is disabled or full.
    }
  }
}
