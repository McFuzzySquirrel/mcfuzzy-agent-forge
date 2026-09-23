// ─── Tiny dependency-free Markdown → HTML renderer ───────────────────────────
//
// HTML in the source is escaped first, then markdown transforms are applied,
// so raw HTML is shown as text rather than interpreted.

import { escapeHtml } from "./dom.js";

function inline(s: string): string {
  let out = s.replace(/`([^`]+)`/g, (_m, code: string) => `<code>${code}</code>`);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
    return `<a href="${url}" target="_blank" rel="noopener">${text}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_])_([^_]+)_(?!_)/g, "$1<em>$2</em>");
  return out;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell));
}

function renderTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const head = rows[0]!;
  const body = rows.slice(1);
  const headHtml = `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>`;
  const bodyHtml = body.length > 0
    ? `<tbody>${body
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody>`
    : "";
  return `<table>${headHtml}${bodyHtml}</table>`;
}

// ─── Structured forge blocks ─────────────────────────────────────────────────
//
// Requirements and tasks are authored as JSON inside fenced `forge-requirement`
// and `forge-task` blocks. Rendering them as tables is a Console-only concern:
// the source documents are never rewritten. Malformed JSON falls back to the
// ordinary code block so nothing is silently lost.

type ForgeRecord = Record<string, unknown>;

/**
 * Reverses `escapeHtml` for forge JSON blocks. The markdown source is escaped
 * before block parsing, so the JSON has to be decoded before `JSON.parse`.
 * `&amp;` is replaced last so an escaped entity is not double-decoded.
 */
function unescapeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asText).filter((entry) => entry.length > 0) : [];
}

/** Renders a JSON-derived cell/paragraph value with markdown inline formatting. */
function rich(value: unknown): string {
  return inline(escapeHtml(asText(value)));
}

function listHtml(values: string[]): string {
  if (values.length === 0) return "";
  return `<ul>${values.map((value) => `<li>${inline(escapeHtml(value))}</li>`).join("")}</ul>`;
}

function formatCell(value: unknown): string {
  const list = asList(value);
  if (list.length === 0) {
    const text = asText(value);
    return text ? rich(text) : "—";
  }
  return list.map((entry) => rich(entry)).join("<br>");
}

function renderRequirementTable(items: ForgeRecord[]): string {
  const head = `<thead><tr><th>ID</th><th>Kind</th><th>Requirement</th></tr></thead>`;
  const body = items.map((item) => `<tr>`
    + `<td class="mono small">${rich(item.id)}</td>`
    + `<td>${rich(item.kind)}</td>`
    + `<td>${rich(item.text)}</td>`
    + `</tr>`).join("");
  return `<table class="forge-table forge-requirements">${head}<tbody>${body}</tbody></table>`;
}

function renderTaskTable(items: ForgeRecord[]): string {
  const head = `<thead><tr><th>ID</th><th>Task</th><th>Owner</th><th>Depends on</th><th>Outputs</th></tr></thead>`;
  const body = items.map((item) => {
    const contract = (item.contract && typeof item.contract === "object" && !Array.isArray(item.contract))
      ? item.contract as ForgeRecord
      : {};
    const requirements = [...asList(contract.requirements), ...asList(contract.requirementRefs)];
    const constraints = [...asList(contract.constraints), ...asList(contract.constraintRefs)];
    const detail = [
      asText(item.description) ? `<div><div class="k">Description</div><p>${rich(item.description)}</p></div>` : "",
      requirements.length ? `<div><div class="k">Requirements</div>${listHtml(requirements)}</div>` : "",
      asList(contract.acceptanceCriteria).length ? `<div><div class="k">Acceptance criteria</div>${listHtml(asList(contract.acceptanceCriteria))}</div>` : "",
      constraints.length ? `<div><div class="k">Constraints</div>${listHtml(constraints)}</div>` : "",
      asList(item.validationCommands).length ? `<div><div class="k">Validation</div>${listHtml(asList(item.validationCommands))}</div>` : "",
      asList(contract.references).length ? `<div><div class="k">References</div>${listHtml(asList(contract.references))}</div>` : "",
      asText(contract.kind) === "human-review" ? `<div><div class="k">Human review</div><p>${rich(contract.reviewFile ?? "review file configured in the manifest")}</p></div>` : "",
    ].filter(Boolean).join("");
    const owner = asText(item.ownerAgent) || (asText(contract.kind) === "human-review" ? "human review" : "—");
    const main = `<tr>`
      + `<td class="mono small">${rich(item.id)}</td>`
      + `<td>${rich(item.title)}</td>`
      + `<td>${rich(owner)}</td>`
      + `<td class="mono small">${formatCell(item.dependencies)}</td>`
      + `<td class="mono small">${formatCell(item.expectedOutputs)}</td>`
      + `</tr>`;
    const detailRow = detail
      ? `<tr class="forge-detail"><td colspan="5"><details><summary>Details</summary>${detail}</details></td></tr>`
      : "";
    return main + detailRow;
  }).join("");
  return `<table class="forge-table forge-tasks">${head}<tbody>${body}</tbody></table>`;
}

export function renderMarkdown(src: string): string {
  return renderBlocks(escapeHtml(src).replace(/\r\n?/g, "\n"));
}

function renderBlocks(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  let i = 0;
  let listOpen: "ul" | "ol" | null = null;
  let para: string[] = [];
  let pendingForge: { type: "requirement" | "task"; items: ForgeRecord[] } | null = null;

  const flushForge = (): void => {
    if (!pendingForge) return;
    out.push(pendingForge.type === "requirement" ? renderRequirementTable(pendingForge.items) : renderTaskTable(pendingForge.items));
    pendingForge = null;
  };

  const closeList = (): void => {
    if (listOpen) {
      out.push(`</${listOpen}>`);
      listOpen = null;
    }
  };
  const flushPara = (): void => {
    if (para.length > 0) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const openList = (type: "ul" | "ol"): void => {
    if (listOpen && listOpen !== type) closeList();
    if (!listOpen) {
      out.push(`<${type}>`);
      listOpen = type;
    }
  };

  while (i < lines.length) {
    const line = lines[i]!;

    const fence = /^```\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      flushPara();
      closeList();
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
        buf.push(lines[i]!);
        i += 1;
      }
      i += 1;
      const language = fence[1] ?? "";
      if (language === "forge-requirement" || language === "forge-task") {
        const type = language === "forge-requirement" ? "requirement" : "task";
        let parsed: unknown;
        try {
          parsed = JSON.parse(unescapeHtml(buf.join("\n")));
        } catch {
          parsed = undefined;
        }
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          if (pendingForge && pendingForge.type !== type) flushForge();
          if (!pendingForge) pendingForge = { type, items: [] };
          pendingForge.items.push(parsed as ForgeRecord);
          continue;
        }
      }
      flushForge();
      out.push(`<pre><code>${buf.join("\n")}</code></pre>`);
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushPara();
      closeList();
      i += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushForge();
      flushPara();
      closeList();
      const level = heading[1]!.length;
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      flushForge();
      flushPara();
      closeList();
      out.push("<hr/>");
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushForge();
      flushPara();
      closeList();
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i]!)) {
        buf.push(lines[i]!.replace(/^\s*>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${renderBlocks(buf.join("\n"))}</blockquote>`);
      continue;
    }

    if (line.trim().startsWith("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) {
      flushForge();
      flushPara();
      closeList();
      const rows: string[][] = [splitRow(line)];
      i += 2;
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        rows.push(splitRow(lines[i]!));
        i += 1;
      }
      out.push(renderTable(rows));
      continue;
    }

    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (ul) {
      flushForge();
      flushPara();
      openList("ul");
      out.push(`<li>${inline(ul[1]!)}</li>`);
      i += 1;
      continue;
    }

    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ol) {
      flushForge();
      flushPara();
      openList("ol");
      out.push(`<li>${inline(ol[1]!)}</li>`);
      i += 1;
      continue;
    }

    flushForge();
    para.push(line.trim());
    i += 1;
  }

  flushForge();
  flushPara();
  closeList();
  return out.join("\n");
}
