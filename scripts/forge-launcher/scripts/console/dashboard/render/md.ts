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

export function renderMarkdown(src: string): string {
  return renderBlocks(escapeHtml(src).replace(/\r\n?/g, "\n"));
}

function renderBlocks(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  let i = 0;
  let listOpen: "ul" | "ol" | null = null;
  let para: string[] = [];

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

    if (/^```/.test(line)) {
      flushPara();
      closeList();
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i]!)) {
        buf.push(lines[i]!);
        i += 1;
      }
      i += 1;
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
      flushPara();
      closeList();
      const level = heading[1]!.length;
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      flushPara();
      closeList();
      out.push("<hr/>");
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
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
      flushPara();
      openList("ul");
      out.push(`<li>${inline(ul[1]!)}</li>`);
      i += 1;
      continue;
    }

    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ol) {
      flushPara();
      openList("ol");
      out.push(`<li>${inline(ol[1]!)}</li>`);
      i += 1;
      continue;
    }

    para.push(line.trim());
    i += 1;
  }

  flushPara();
  closeList();
  return out.join("\n");
}
