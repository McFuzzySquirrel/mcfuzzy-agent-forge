// ─── Board: full-screen PixiJS board in an iframe ───────────────────────────
//
// The board itself is the engine's PixiJS dashboard (Kanban + Gantt), served at
// `/board` and framed here. This view owns the chrome around it: the mode
// switch, filters and the accessible-table toggle are mirrored in the iframe's
// own HUD, so the two stay in step via `postMessage`.

import { el } from "../render/dom.js";
import { store } from "../state.js";

type BoardMode = "kanban" | "gantt";

const MODES: Array<[BoardMode, string]> = [["kanban", "Kanban"], ["gantt", "Gantt"]];
const STATUSES = ["pending", "running", "complete", "failed", "skipped"];

let frame: HTMLIFrameElement | null = null;
let modeButtons: HTMLButtonElement[] = [];
let unsubscribe: (() => void) | null = null;

function currentProject(): string {
  return store.projectKey();
}

function storedMode(): BoardMode {
  return store.getDraft(currentProject(), "boardMode", "kanban") as BoardMode;
}

/** Active status filters. Drafts hold strings, so the set is stored as CSV. */
function storedStatuses(): string[] {
  const raw = store.getDraft<string>(currentProject(), "boardStatuses", "");
  return raw ? raw.split(",").filter(Boolean) : [];
}

/** The iframe URL, carrying mode and filters so a reload keeps the same view. */
function frameSrc(): string {
  const params = new URLSearchParams();
  params.set("mode", storedMode());
  const statuses = storedStatuses();
  if (statuses.length > 0) params.set("status", statuses.join(","));
  return `/board?${params.toString()}`;
}

function setMode(mode: BoardMode): void {
  store.setDraft(currentProject(), "boardMode", mode);
  for (const button of modeButtons) {
    const active = button.dataset.mode === mode;
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.classList.toggle("active", active);
  }
  // The iframe owns the canvas and its own copy of the switch; reload it so the
  // two render the same mode without either having to poll the other.
  if (frame) frame.src = frameSrc();
}

export function unmountBoard(): void {
  unsubscribe?.();
  unsubscribe = null;
  frame = null;
  modeButtons = [];
}

export function renderBoard(container: HTMLElement): void {
  unmountBoard();
  container.textContent = "";

  const project = currentProject();
  container.appendChild(el("div", { className: "board-toolbar" }, [
    el("div", { className: "mode-tabs", role: "tablist", "aria-label": "Board view" },
      MODES.map(([mode, label]) => {
        const button = el("button", {
          type: "button",
          role: "tab",
          className: "tab",
          "data-mode": mode,
          "aria-selected": mode === storedMode() ? "true" : "false",
        }, label) as HTMLButtonElement;
        button.classList.toggle("active", mode === storedMode());
        button.addEventListener("click", () => setMode(mode));
        button.addEventListener("keydown", (event) => {
          if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
          event.preventDefault();
          const index = MODES.findIndex(([id]) => id === mode);
          const next = MODES[(index + (event.key === "ArrowRight" ? 1 : MODES.length - 1)) % MODES.length]!;
          setMode(next[0]);
          const target = container.querySelector<HTMLButtonElement>(`[data-mode="${next[0]}"]`);
          target?.focus();
        });
        modeButtons.push(button);
        return button;
      })),
    el("div", { className: "chips", role: "group", "aria-label": "Filter by status" },
      STATUSES.map((status) => {
        const active = storedStatuses().includes(status);
        const chip = el("span", { className: active ? "chip active" : "chip", tabindex: "0", role: "button", "aria-pressed": active ? "true" : "false" }, status);
        const toggle = (): void => {
          const current = storedStatuses();
          const next = current.includes(status) ? current.filter((entry) => entry !== status) : [...current, status];
          store.setDraft(project, "boardStatuses", next.join(","));
          chip.classList.toggle("active", next.includes(status));
          chip.setAttribute("aria-pressed", next.includes(status) ? "true" : "false");
          if (frame) frame.src = frameSrc();
        };
        chip.addEventListener("click", toggle);
        chip.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          toggle();
        });
        return chip;
      })),
    el("div", { className: "row gap" }, [
      el("a", { href: "#/tasks", className: "btn btn-sm" }, "Tasks"),
      el("a", { href: "#/logs", className: "btn btn-sm" }, "Logs"),
    ]),
  ]));

  frame = el("iframe", { src: frameSrc(), title: "Forge task board", className: "board-frame" }) as HTMLIFrameElement;
  const fallback = el("p", { className: "dim board-fallback" }, [
    "If the board does not load, use ",
    el("a", { href: "#/tasks" }, "Tasks"),
    " for the accessible table view.",
  ]);
  container.appendChild(el("div", { className: "board-wrap" }, [frame, fallback]));

  // The board navigates out of the iframe rather than trapping the reader in it:
  // a card's "Open in Tasks" posts a hash and this applies it.
  const onMessage = (event: MessageEvent): void => {
    const data = event.data as { type?: string; mode?: string; href?: string } | null;
    if (!data || typeof data !== "object") return;
    if (event.source !== frame?.contentWindow) return;
    if (data.type === "forge:board-mode" && typeof data.mode === "string") {
      store.setDraft(currentProject(), "boardMode", data.mode);
      for (const button of modeButtons) {
        const active = button.dataset.mode === data.mode;
        button.setAttribute("aria-selected", active ? "true" : "false");
        button.classList.toggle("active", active);
      }
      return;
    }
    if (data.type === "forge:navigate" && typeof data.href === "string") {
      location.hash = data.href.replace(/^#/, "");
    }
  };
  window.addEventListener("message", onMessage);
  unsubscribe = () => window.removeEventListener("message", onMessage);
}