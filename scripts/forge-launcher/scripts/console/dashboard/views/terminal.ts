import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { api } from "../api.js";
import { el } from "../render/dom.js";
import { appendReplay } from "./terminal-replay.js";

declare global {
  interface Window {
    Terminal: typeof import("@xterm/xterm").Terminal;
    FitAddon: { FitAddon: typeof import("@xterm/addon-fit").FitAddon };
  }
}

interface Surface {
  terminal: XtermTerminal;
  resizeObserver: ResizeObserver;
  status: HTMLElement;
  startButton: HTMLButtonElement;
  stopButton: HTMLButtonElement;
}

interface SessionState {
  socket: WebSocket | null;
  /** Output held while the view is unmounted, replayed on remount. */
  buffer: string;
  exited: boolean;
  exitLabel: string | null;
  statusText: string;
  /** The attached DOM surface, or null while the view is unmounted. */
  surface: Surface | null;
}

function freshSession(): SessionState {
  return { socket: null, buffer: "", exited: false, exitLabel: null, statusText: "No terminal session running.", surface: null };
}

// The session outlives the view: navigating to another page unmounts the view
// but keeps the WebSocket (and therefore the server-side PTY) alive.
let state: SessionState = freshSession();
const listeners = new Set<() => void>();

/** True while a terminal session is connected or connecting. */
export function isTerminalSessionActive(): boolean {
  const socket = state.socket;
  return !!socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING);
}

/** Subscribe to session start/stop/exit changes (used for the nav indicator). */
export function onTerminalSessionChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}

function token(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="forge-token"]')?.content ?? "";
}

function send(message: unknown): void {
  if (state.socket?.readyState === WebSocket.OPEN) state.socket.send(JSON.stringify(message));
}

function write(text: string): void {
  state.surface?.terminal.write(text);
}

function setStatus(text: string): void {
  state.statusText = text;
  if (state.surface) state.surface.status.textContent = text;
}

function syncControls(): void {
  const active = isTerminalSessionActive();
  if (!state.surface) return;
  state.surface.startButton.disabled = active;
  state.surface.stopButton.disabled = !active;
}

export function renderTerminal(container: HTMLElement): void {
  const mode = el("select", { "aria-label": "Session type" }, [
    el("option", { value: "harness" }, "Harness session"),
    el("option", { value: "authoring" }, "Interactive authoring"),
  ]) as HTMLSelectElement;
  const target = el("select", { "aria-label": "Authoring session" }, [
    el("option", { value: "prd" }, "Author a PRD"),
    el("option", { value: "idea" }, "Grill an idea"),
    el("option", { value: "feature-prd" }, "Author a feature"),
  ]) as HTMLSelectElement;
  const prompt = el("input", {
    type: "text",
    placeholder: "Describe the feature to add",
    "aria-label": "Feature description",
  }) as HTMLInputElement;
  const authoringFields = el("div", { className: "row gap wrap" }, [target, prompt]);
  const startButton = el("button", { className: "btn btn-primary", type: "button" }, "Start in Console") as HTMLButtonElement;
  const externalButton = el("button", { className: "btn", type: "button" }, "Open in external terminal") as HTMLButtonElement;
  const stopButton = el("button", { className: "btn", type: "button", disabled: true }, "Stop session") as HTMLButtonElement;
  const status = el("span", { className: "dim small", role: "status" }, state.statusText);
  const terminalHost = el("div", { className: "console-terminal", "aria-label": "Interactive terminal" });
  const terminal = new window.Terminal({
    cursorBlink: true,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 13,
    scrollback: 5000,
    theme: { background: "#070b16", foreground: "#dbe4ff" },
  });
  const fitAddon = new window.FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(terminalHost);
  if (!state.socket && !state.buffer && !state.exited) {
    terminal.writeln("Select a session type, then start. Input and terminal output stay in this page.");
  }
  // Input always targets the live session, including one started before this
  // view mounted (the session survives navigation).
  terminal.onData((data) => send({ type: "input", data }));

  const resizeObserver = new ResizeObserver(() => {
    if (state.surface?.terminal !== terminal) return;
    try {
      fitAddon.fit();
      send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
    } catch {
      // The terminal can briefly have zero dimensions while its route is hidden.
    }
  });
  resizeObserver.observe(terminalHost);

  state.surface = { terminal, resizeObserver, status, startButton, stopButton };

  // Replay output produced while this view was unmounted.
  if (state.buffer) terminal.write(state.buffer);
  if (state.exitLabel && !isTerminalSessionActive()) terminal.writeln(`\r\n[Console] ${state.exitLabel}`);
  status.textContent = state.statusText;
  syncControls();
  if (isTerminalSessionActive()) {
    try {
      fitAddon.fit();
      send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
    } catch {
      // ignore zero-size fit
    }
    terminal.focus();
  }

  mode.addEventListener("change", () => {
    authoringFields.hidden = mode.value !== "authoring";
    prompt.hidden = target.value !== "feature-prd" || mode.value !== "authoring";
  });
  target.addEventListener("change", () => {
    prompt.hidden = target.value !== "feature-prd" || mode.value !== "authoring";
  });

  // Pre-select an authoring target when arriving from an authoring entry point
  // (e.g. #/terminal?authoring=idea&prompt=…), so the user can start it in the
  // Console or an external terminal without re-selecting it.
  const preselection = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const preselectedTarget = preselection.get("authoring");
  if (preselectedTarget === "idea" || preselectedTarget === "prd" || preselectedTarget === "feature-prd") {
    mode.value = "authoring";
    target.value = preselectedTarget;
    const preselectedPrompt = preselection.get("prompt");
    if (preselectedPrompt) prompt.value = preselectedPrompt;
  }
  authoringFields.hidden = mode.value !== "authoring";
  prompt.hidden = target.value !== "feature-prd" || mode.value !== "authoring";

  startButton.addEventListener("click", () => {
    if (state.socket) return;
    if (mode.value === "authoring" && target.value === "feature-prd" && !prompt.value.trim()) {
      setStatus("Describe the feature before starting its authoring session.");
      return;
    }
    terminal.clear();
    state = { ...freshSession(), surface: state.surface };
    setStatus("Connecting…");
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${scheme}//${location.host}/api/terminal`, ["forge-console-terminal", token()]);
    state.socket = socket;
    syncControls();
    notify();
    socket.addEventListener("open", () => {
      const request = mode.value === "harness"
        ? { type: "start", mode: "harness" }
        : { type: "start", mode: "authoring", target: target.value, ...(prompt.value.trim() ? { prompt: prompt.value.trim() } : {}) };
      socket.send(JSON.stringify(request));
    });
    socket.addEventListener("message", (event) => {
      if (state.socket !== socket) return;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        write("\r\n[Console] Received an invalid terminal response.");
        return;
      }
      if (message.type === "output" && typeof message.data === "string") {
        state.buffer = appendReplay(state.buffer, message.data);
        write(message.data);
      } else if (message.type === "started") {
        setStatus(`Connected to ${String(message.cli)} in ${String(message.cwd)}.`);
        syncControls();
        // Only touch the terminal if this view is still the attached surface;
        // a remount replays the buffer and re-sends its own resize.
        if (state.surface?.terminal === terminal) {
          try {
            fitAddon.fit();
            send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
          } catch {
            // ignore zero-size fit
          }
          terminal.focus();
        }
      } else if (message.type === "error") {
        const detail = typeof message.message === "string" ? message.message : "Session failed.";
        state.exitLabel = detail;
        setStatus(detail);
        write(`\r\n[Console] ${detail}`);
      } else if (message.type === "exit") {
        state.exited = true;
        state.exitLabel = `Session ended (exit ${String(message.exitCode)}).`;
        setStatus(state.exitLabel);
      }
    });
    socket.addEventListener("close", () => {
      if (state.socket !== socket) return;
      state.socket = null;
      syncControls();
      if (!state.exited) {
        state.exitLabel = state.exitLabel ?? "Terminal connection closed.";
        setStatus(state.exitLabel);
      }
      notify();
    });
    socket.addEventListener("error", () => {
      setStatus("Could not connect to the Console terminal.");
    });
  });

  stopButton.addEventListener("click", () => {
    send({ type: "stop" });
    setStatus("Stopping session…");
  });

  externalButton.addEventListener("click", () => {
    const fallback = mode.value === "harness"
      ? api.launchCli()
      : api.startAuthoringSession(target.value as "idea" | "prd" | "feature-prd", prompt.value.trim() || undefined);
    void fallback
      .then((result) => { setStatus(result.message ?? "External terminal requested."); })
      .catch((error: unknown) => { setStatus(error instanceof Error ? error.message : "Could not open external terminal."); });
  });

  container.appendChild(el("section", { className: "panel" }, [
    el("h1", null, "Interactive terminal"),
    el("p", { className: "dim" }, "Run the selected harness or an authoring interview in this Console. The session keeps running if you navigate away. Only the supported harness CLI is launched; no general-purpose shell is exposed."),
    el("div", { className: "row gap wrap terminal-controls" }, [mode, authoringFields, startButton, stopButton, externalButton]),
    status,
    terminalHost,
  ]));
}

export function unmountTerminal(): void {
  const surface = state.surface;
  if (!surface) return;
  surface.resizeObserver.disconnect();
  surface.terminal.dispose();
  state.surface = null;
  // Keep state.socket alive so the session continues in the background.
}
