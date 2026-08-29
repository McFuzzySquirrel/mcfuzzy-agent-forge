// ─── Board: full-screen legacy PixiJS board in an iframe ────────────────────

import { el } from "../render/dom.js";

export function unmountBoard(): void {
  // nothing to tear down
}

export function renderBoard(container: HTMLElement): void {
  unmountBoard();
  container.textContent = "";
  container.appendChild(el("div", { className: "board-wrap" }, [el("iframe", { src: "/board", className: "board-frame" })]));
}
