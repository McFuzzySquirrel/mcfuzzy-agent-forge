// ─── Artifacts: browse generated artifacts with type filter + detail ────────

import { api } from "../api.js";
import { el, fmtTime, statusBadge } from "../render/dom.js";
import type { ArtifactIndex, ArtifactMeta } from "../types.js";

let unsub: Array<() => void> = [];
let detailHost: HTMLElement | null = null;
let fileHost: HTMLElement | null = null;

export function unmountArtifacts(): void {
  for (const u of unsub) u();
  unsub = [];
  detailHost = null;
  fileHost = null;
}

export function renderArtifacts(container: HTMLElement): void {
  unmountArtifacts();
  container.textContent = "";

  container.appendChild(el("h2", null, "Artifacts"));

  const grid = el("div", { className: "grid-2" });
  const list = el("div", { className: "panel list-pane" });
  const right = el("div", null);
  detailHost = el("div", { className: "panel" });
  fileHost = el("div", { className: "panel" });
  right.appendChild(detailHost);
  right.appendChild(fileHost);
  grid.appendChild(list);
  grid.appendChild(right);
  container.appendChild(grid);

  void api.artifacts()
    .then((index) => renderArtifactList(list, index))
    .catch(() => list.appendChild(el("div", { className: "dim" }, "Failed to load artifacts.")));
}

function renderArtifactList(list: HTMLElement, index: ArtifactIndex): void {
  list.textContent = "";

  if (index.artifacts.length === 0) {
    list.appendChild(el("div", { className: "dim" }, "No artifacts yet."));
    return;
  }

  const select = el("select", null, [
    el("option", { value: "" }, "All types"),
    ...index.types.map((t) => el("option", { value: t }, t)),
  ]);
  list.appendChild(select);

  const ul = el("ul", { className: "doc-list" });
  list.appendChild(ul);

  const renderRows = (): void => {
    const type = (select as HTMLSelectElement).value;
    ul.textContent = "";
    const items = index.artifacts.filter((a) => !type || a.type === type);
    if (items.length === 0) {
      ul.appendChild(el("li", { className: "dim" }, "No artifacts of this type."));
      return;
    }
    for (const a of items) {
      const item = el("li", { className: "doc-item" }, [
        el("span", { className: "kind" }, a.type),
        el("span", { className: "mono small" }, a.artifactId),
        statusBadge(a.status),
      ]);
      item.addEventListener("click", () => void openArtifact(a));
      ul.appendChild(item);
    }
  };

  select.addEventListener("change", renderRows);
  renderRows();
}

async function openArtifact(meta: ArtifactMeta): Promise<void> {
  if (!detailHost || !fileHost) return;
  detailHost.textContent = "";
  fileHost.textContent = "";
  detailHost.appendChild(el("div", { className: "dim" }, "Loading…"));
  try {
    const raw = await api.artifact(meta.artifactId) as Record<string, unknown>;

    const field = (label: string, value: unknown): HTMLElement =>
      el("div", { className: "stat" }, [
        el("div", { className: "k" }, label),
        el("div", { className: "v mono" }, value == null ? "—" : String(value)),
      ]);

    detailHost.textContent = "";
    detailHost.appendChild(
      el("div", { className: "row between" }, [el("h3", null, meta.artifactId), statusBadge(meta.status)]),
    );
    detailHost.appendChild(
      el("div", { className: "stats" }, [
        field("Type", meta.type),
        field("Category", meta.category || "—"),
        field("Task", meta.taskId || "—"),
        field("Produced by", meta.producedBy || "—"),
        field("Created", fmtTime(meta.createdAt)),
        field("Files", meta.filesChanged.length),
        ...(meta.confidence != null ? [field("Confidence", meta.confidence)] : []),
      ]),
    );
    detailHost.appendChild(el("p", { className: "dim" }, meta.summary || "No summary."));

    const rawPre = el("pre", { className: "log-view" }, JSON.stringify(raw, null, 2));
    const rawDetails = el("details", null, [el("summary", null, "Raw JSON"), rawPre]);
    detailHost.appendChild(rawDetails);

    if (meta.filesChanged.length > 0) {
      fileHost.textContent = "";
      fileHost.appendChild(el("h4", null, "Files changed"));
      const files = el("ul", { className: "doc-list" });
      for (const rel of meta.filesChanged) {
        const li = el("li", { className: "doc-item" }, el("span", { className: "mono small" }, rel));
        li.addEventListener("click", () => void openFile(rel));
        files.appendChild(li);
      }
      fileHost.appendChild(files);
    }
  } catch {
    detailHost.textContent = "";
    detailHost.appendChild(el("div", { className: "dim" }, "Could not load artifact."));
  }
}

async function openFile(relPath: string): Promise<void> {
  if (!fileHost) return;
  try {
    const file = await api.artifactContent(relPath);
    fileHost.textContent = "";
    fileHost.appendChild(el("h4", null, relPath));
    fileHost.appendChild(el("pre", { className: "log-view" }, file.content));
  } catch {
    if (fileHost) fileHost.appendChild(el("div", { className: "dim" }, "Could not read file."));
  }
}
