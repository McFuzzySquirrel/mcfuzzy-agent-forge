// ─── Project files: useful documents and deliverables, separate from Task history ─

import { api } from "../api.js";
import { el, toast } from "../render/dom.js";
import { renderMarkdown } from "../render/md.js";
import { buildProjectFiles } from "./project-files-model.js";
import type { ProjectDocument, ProjectDeliverable } from "./project-files-model.js";

let generation = 0;
let docDialog: HTMLDialogElement | null = null;

export function unmountProjectFiles(): void {
  generation += 1;
  docDialog?.close();
  docDialog = null;
}

export function renderProjectFiles(container: HTMLElement): void {
  unmountProjectFiles();
  container.textContent = "";
  container.append(
    el("h2", null, "Project files"),
    el("p", { className: "dim" }, "Read the important Project documents and open delivered files. Task-by-Task artifact history stays separate in Advanced → Artifacts."),
  );

  const documentsSection = el("section", { className: "section" }, [
    el("h3", null, "Project documents"),
    el("div", { className: "project-files-documents" }, el("div", { className: "dim" }, "Loading Project documents…")),
  ]);
  const documentHost = documentsSection.querySelector<HTMLElement>(".project-files-documents")!;
  const deliverablesSection = el("section", { className: "section" }, [
    el("h3", null, "Project deliverables"),
    el("div", { className: "project-files-deliverables" }, el("div", { className: "dim" }, "Loading deliverables…")),
  ]);
  const deliverableHost = deliverablesSection.querySelector<HTMLElement>(".project-files-deliverables")!;
  container.append(documentsSection, deliverablesSection);

  const myGeneration = generation;
  void api.docs()
    .then((docs) => {
      if (myGeneration !== generation) return;
      void api.artifacts()
        .then((artifacts) => {
          if (myGeneration !== generation) return;
          const files = buildProjectFiles(docs, artifacts);
          renderDocuments(documentHost, files.documents);
          renderDeliverables(deliverableHost, files.deliverables);
        })
        .catch(() => {
          if (myGeneration !== generation) return;
          renderDocuments(documentHost, buildProjectFiles(docs, { artifacts: [], types: [] }).documents);
          deliverableHost.replaceChildren(
            el("p", { className: "dim" }, "Project deliverables could not be loaded. Refresh the Console to try again; your repository files have not been changed."),
          );
        });
    })
    .catch(() => {
      if (myGeneration !== generation) return;
      documentHost.replaceChildren(
        el("p", { className: "dim" }, "Project documents could not be loaded. Refresh the Console to try again."),
      );
      deliverableHost.replaceChildren(
        el("p", { className: "dim" }, "Project deliverables could not be loaded. Refresh the Console to try again; your repository files have not been changed."),
      );
    });
}

function renderDocuments(host: HTMLElement, documents: ProjectDocument[]): void {
  host.textContent = "";
  if (documents.length === 0) {
    host.appendChild(el("p", { className: "dim" }, "No Project documents are available yet. Idea, brief, and feature documents will appear here as they are created."));
    return;
  }

  const cards = el("div", { className: "cards" });
  for (const item of documents) {
    const open = item.available
      ? el("button", { className: "btn btn-sm", type: "button" }, `Read ${item.title}`)
      : el("span", { className: "badge" }, "Not created yet");
    const card = el("article", { className: "panel project-file-card" }, [
      el("div", { className: "row between gap wrap" }, [el("h4", null, item.title), open]),
      el("p", { className: "dim" }, item.description),
      el("div", { className: "mono small" }, item.path),
    ]);
    if (item.available) {
      open.addEventListener("click", () => openDocument(item));
    }
    cards.appendChild(card);
  }
  host.appendChild(cards);
}

function renderDeliverables(host: HTMLElement, deliverables: ProjectDeliverable[]): void {
  host.textContent = "";
  if (deliverables.length === 0) {
    host.appendChild(el("p", { className: "dim" }, "No Project deliverables have been recorded yet. Files will appear here after work produces them."));
    return;
  }

  const list = el("ul", { className: "doc-list" });
  for (const item of deliverables) {
    const message = el("span", { className: "dim small", role: "status", "aria-live": "polite" });
    const button = el("button", { className: "btn btn-sm", type: "button" }, `Open ${item.title} externally`);
    button.addEventListener("click", () => {
      void api.openExternal(item.path)
        .then((result) => {
          message.textContent = result.ok
            ? `Opened ${item.title} externally.`
            : result.message === "open not enabled"
              ? "External opening is unavailable in this Console session."
              : result.message ?? "Could not open this file externally.";
        })
        .catch(() => {
          message.textContent = "This file could not be opened externally. It may have been moved or removed.";
        });
    });
    list.appendChild(el("li", { className: "doc-item project-deliverable" }, [
      el("span", { className: "mono small" }, item.path),
      button,
      message,
    ]));
  }
  host.appendChild(list);
}

function openDocument(item: ProjectDocument): void {
  if (!item.available) return;
  docDialog?.close();
  const body = el("div", { className: "md doc-dialog-body" }, el("p", { className: "dim" }, "Loading Project file…"));
  const external = el("button", { className: "btn btn-sm", type: "button" }, `Open ${item.title} externally`);
  external.addEventListener("click", () => {
    void api.openExternal(item.path).then((result) => {
      if (!result.ok) toast(result.message ?? "External opening is unavailable.");
    }).catch(() => toast("This file could not be opened externally."));
  });
  const close = el("button", { className: "btn btn-sm", type: "button" }, "Close");
  const dialog = el("dialog", { className: "doc-dialog" }, [
    el("div", { className: "doc-dialog-header" }, [
      el("div", { className: "doc-dialog-title" }, [
        el("span", { className: "badge badge-doc" }, "Project file"),
        el("h3", { className: "no-margin" }, item.title),
      ]),
      el("div", { className: "row gap" }, [external, close]),
    ]),
    body,
  ]) as HTMLDialogElement;
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (docDialog === dialog) docDialog = null;
  }, { once: true });
  docDialog = dialog;
  document.body.appendChild(dialog);
  dialog.showModal();

  const myGeneration = generation;
  void api.docContent(item.path)
    .then((file) => {
      if (myGeneration !== generation || docDialog !== dialog) return;
      body.replaceChildren(el("div", { html: renderMarkdown(file.content) }));
    })
    .catch(() => {
      if (myGeneration !== generation || docDialog !== dialog) return;
      body.replaceChildren(el("p", { className: "dim" }, "This Project file is unavailable. It may have been moved or removed; refresh Project files to update the list."));
    });
}
