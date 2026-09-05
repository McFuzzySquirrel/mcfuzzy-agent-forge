// ─── Board: full-screen legacy PixiJS board in an iframe ────────────────────

import { el } from "../render/dom.js";

export function unmountBoard(): void {
  // nothing to tear down
}

export function renderBoard(container: HTMLElement): void {
  unmountBoard();
  container.textContent = "";
  const frame = el("iframe", { src: "/board", title: "Forge task board", className: "board-frame" });
  const fallback = el("p", { className: "dim board-fallback" }, [
    "If the board does not load, use ",
    el("a", { href: "#/tasks" }, "Tasks"),
    " for the accessible table view.",
  ]);
  container.appendChild(el("div", { className: "board-wrap" }, [frame, fallback]));
}
