// ─── Artifacts: browse generated artifacts with type filter + detail ────────

import { api } from "../api.js";
import { el, fmtTime, statusBadge } from "../render/dom.js";
import type { ArtifactIndex, ArtifactMeta } from "../types.js";

let unsub: Array<() => void> = [];
let detailHost: HTMLElement | null = null;
let fileHost: HTMLElement | null = null;
let artifactItems: ArtifactMeta[] = [];
let selectedIndex = -1;
let requestGeneration = 0;

export function unmountArtifacts(): void {
  for (const u of unsub) u();
  unsub = [];
  detailHost = null;
  fileHost = null;
  artifactItems = [];
  selectedIndex = -1;
  requestGeneration += 1;
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

  const myGeneration = requestGeneration;
  void api.artifacts()
    .then((index) => {
      if (myGeneration !== requestGeneration) return;
      renderArtifactList(list, index);
    })
    .catch(() => list.appendChild(el("div", { className: "dim" }, "Failed to load artifacts.")));
}

function renderArtifactList(list: HTMLElement, index: ArtifactIndex): void {
  list.textContent = "";
  artifactItems = index.artifacts;

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
      item.setAttribute("tabindex", "0");
      item.setAttribute("role", "button");
      const open = (): void => {
        selectedIndex = artifactItems.indexOf(a);
        void openArtifact(a);
      };
      item.addEventListener("click", open);
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
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
  const myGeneration = requestGeneration;
  try {
    const raw = await api.artifact(meta.artifactId) as Record<string, unknown>;
    if (myGeneration !== requestGeneration || !detailHost || !fileHost) return;

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
    const navigation = el("div", { className: "row gap artifact-nav" }, [
      el("button", { className: "btn btn-sm", disabled: selectedIndex <= 0 ? true : null }, "Previous"),
      el("span", { className: "dim small" }, `${selectedIndex + 1} of ${artifactItems.length}`),
      el("button", { className: "btn btn-sm", disabled: selectedIndex < 0 || selectedIndex >= artifactItems.length - 1 ? true : null }, "Next"),
    ]);
    const [previous, , next] = [...navigation.children] as HTMLElement[];
    previous?.addEventListener("click", () => {
      if (selectedIndex > 0) {
        selectedIndex -= 1;
        void openArtifact(artifactItems[selectedIndex]!);
      }
    });
    next?.addEventListener("click", () => {
      if (selectedIndex < artifactItems.length - 1) {
        selectedIndex += 1;
        void openArtifact(artifactItems[selectedIndex]!);
      }
    });
    detailHost.appendChild(navigation);
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
