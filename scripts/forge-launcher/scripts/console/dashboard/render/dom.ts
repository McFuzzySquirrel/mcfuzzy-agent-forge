// ─── Tiny DOM helpers (no dependencies) ──────────────────────────────────────

type Child = Node | string | null | undefined;
type Props = Record<string, string | number | boolean | null | undefined>;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function append(parent: Node, children: Child | Child[]): void {
  if (Array.isArray(children)) {
    for (const child of children) append(parent, child);
    return;
  }
  if (children === null || children === undefined) return;
  parent.appendChild(typeof children === "string" ? document.createTextNode(children) : children);
}

/**
 * Creates an element. `props` supports a few special keys: `className`
 * (element.className), `html` (trusted innerHTML — only pass escaped/markdown
 * output), and everything else is set via setAttribute (a boolean `true` emits
 * a valueless attribute; `false`/`null`/`undefined` are skipped).
 */
export function el(tag: string, props?: Props | null, children?: Child | Child[]): HTMLElement {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "className") node.className = String(value);
      else if (key === "html") node.innerHTML = String(value);
      else if (value === true) node.setAttribute(key, "");
      else node.setAttribute(key, String(value));
    }
  }
  if (children !== undefined && children !== null) append(node, children);
  return node;
}

export function statusClass(status: string): string {
  return status.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

export function statusBadge(status: string): HTMLElement {
  return el("span", { className: `badge badge-${statusClass(status)}` }, status);
}

export function fmtDuration(ms: number | null): string {
  if (ms === null || Number.isNaN(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m`;
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function toast(message: string): void {
  const node = el("div", { className: "toast" }, message);
  document.body.appendChild(node);
  window.setTimeout(() => node.remove(), 3500);
}
