import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { api } from "../api.js";
import { el } from "../render/dom.js";

declare global {
  interface Window {
    Terminal: typeof import("@xterm/xterm").Terminal;
    FitAddon: { FitAddon: typeof import("@xterm/addon-fit").FitAddon };
  }
}

interface TerminalViewState {
  terminal: XtermTerminal;
  socket: WebSocket | null;
  resizeObserver: ResizeObserver;
  status: HTMLElement;
  startButton: HTMLButtonElement;
  stopButton: HTMLButtonElement;
}

let view: TerminalViewState | null = null;

function token(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="forge-token"]')?.content ?? "";
}

function send(message: unknown): void {
  if (view?.socket?.readyState === WebSocket.OPEN) view.socket.send(JSON.stringify(message));
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
  const status = el("span", { className: "dim small", role: "status" }, "No terminal session running.");
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
  terminal.writeln("Select a session type, then start. Input and terminal output stay in this page.");
  terminal.onData((data) => send({ type: "input", data }));

  const resizeObserver = new ResizeObserver(() => {
    if (!view || view.terminal !== terminal) return;
    try {
      fitAddon.fit();
      send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
    } catch {
      // The terminal can briefly have zero dimensions while its route is hidden.
    }
  });
  resizeObserver.observe(terminalHost);

  mode.addEventListener("change", () => {
    authoringFields.hidden = mode.value !== "authoring";
    prompt.hidden = target.value !== "feature-prd" || mode.value !== "authoring";
  });
  target.addEventListener("change", () => {
    prompt.hidden = target.value !== "feature-prd" || mode.value !== "authoring";
  });
  prompt.hidden = true;
  authoringFields.hidden = true;

  view = { terminal, socket: null, resizeObserver, status, startButton, stopButton };

  startButton.addEventListener("click", () => {
    if (view?.socket) return;
    if (mode.value === "authoring" && target.value === "feature-prd" && !prompt.value.trim()) {
      status.textContent = "Describe the feature before starting its authoring session.";
      return;
    }
    terminal.clear();
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${scheme}//${location.host}/api/terminal`, ["forge-console-terminal", token()]);
    view!.socket = socket;
    startButton.disabled = true;
    stopButton.disabled = false;
    status.textContent = "Connecting…";
    socket.addEventListener("open", () => {
      const request = mode.value === "harness"
        ? { type: "start", mode: "harness" }
        : { type: "start", mode: "authoring", target: target.value, ...(prompt.value.trim() ? { prompt: prompt.value.trim() } : {}) };
      socket.send(JSON.stringify(request));
    });
    socket.addEventListener("message", (event) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        terminal.writeln("\r\n[Console] Received an invalid terminal response.");
        return;
      }
      if (message.type === "output" && typeof message.data === "string") {
        terminal.write(message.data);
      } else if (message.type === "started") {
        status.textContent = `Connected to ${String(message.cli)} in ${String(message.cwd)}.`;
        fitAddon.fit();
        socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
        terminal.focus();
      } else if (message.type === "error") {
        const detail = typeof message.message === "string" ? message.message : "Session failed.";
        status.textContent = detail;
        terminal.writeln(`\r\n[Console] ${detail}`);
      } else if (message.type === "exit") {
        status.textContent = `Session ended (exit ${String(message.exitCode)}).`;
      }
    });
    socket.addEventListener("close", () => {
      if (view?.socket === socket) {
        view.socket = null;
        startButton.disabled = false;
        stopButton.disabled = true;
      }
      if (status.textContent === "Connecting…") status.textContent = "Terminal connection closed.";
    });
    socket.addEventListener("error", () => {
      status.textContent = "Could not connect to the Console terminal.";
    });
  });

  stopButton.addEventListener("click", () => {
    send({ type: "stop" });
    status.textContent = "Stopping session…";
  });

  externalButton.addEventListener("click", () => {
    const fallback = mode.value === "harness"
      ? api.launchCli()
      : api.startAuthoringSession(target.value as "idea" | "prd" | "feature-prd", prompt.value.trim() || undefined);
    void fallback
      .then((result) => { status.textContent = result.message ?? "External terminal requested."; })
      .catch((error: unknown) => { status.textContent = error instanceof Error ? error.message : "Could not open external terminal."; });
  });

  container.appendChild(el("section", { className: "panel" }, [
    el("h1", null, "Interactive terminal"),
    el("p", { className: "dim" }, "Run the selected harness or an authoring interview in this Console. Only the supported harness CLI is launched; no general-purpose shell is exposed."),
    el("div", { className: "row gap wrap terminal-controls" }, [mode, authoringFields, startButton, stopButton, externalButton]),
    status,
    terminalHost,
  ]));
}

export function unmountTerminal(): void {
  if (!view) return;
  view.resizeObserver.disconnect();
  if (view.socket?.readyState === WebSocket.OPEN || view.socket?.readyState === WebSocket.CONNECTING) view.socket.close();
  view.terminal.dispose();
  view = null;
}
