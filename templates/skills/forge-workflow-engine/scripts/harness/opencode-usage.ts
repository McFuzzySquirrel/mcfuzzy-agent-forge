import type { TaskUsage } from "../types.ts";

/**
 * Reads session usage out of an OpenCode `session export` document.
 *
 * Only the top-level `info` block is parsed, never the transcript. `info` holds
 * `cost` and `tokens` and sits at the head of the document; `messages` holds the
 * whole multi-megabyte conversation. JSON-parsing the entire export made usage
 * depend on transcript integrity — and OpenCode truncates a piped export after a
 * random number of bytes (it exits before the pipe drains), which surfaced as
 * "Expected ',' or '}' after property value" in task records. Scanning for one
 * small object keeps usage readable from whatever prefix arrived.
 *
 * Returns `null` when the export has no session `info` or reports no tokens, so
 * the caller can report "unavailable" rather than inventing zeros.
 */
export function parseOpenCodeUsageExport(text: string): TaskUsage | null {
  const info = readTopLevelObject(text, "info");
  if (info === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(info);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const info_ = parsed as { cost?: unknown; tokens?: unknown };
  const tokens = info_.tokens as
    | { input?: unknown; output?: unknown; reasoning?: unknown; cache?: { read?: unknown; write?: unknown } }
    | undefined;
  if (!tokens || typeof tokens !== "object") return null;
  if (typeof tokens.input !== "number" && typeof tokens.output !== "number") return null;
  return {
    inputTokens: typeof tokens.input === "number" ? tokens.input : undefined,
    outputTokens: typeof tokens.output === "number" ? tokens.output : undefined,
    reasoningTokens: typeof tokens.reasoning === "number" ? tokens.reasoning : undefined,
    cacheReadTokens: typeof tokens.cache?.read === "number" ? tokens.cache.read : undefined,
    cacheWriteTokens: typeof tokens.cache?.write === "number" ? tokens.cache.write : undefined,
    costUsd: typeof info_.cost === "number" ? info_.cost : undefined,
    source: "harness",
  };
}

/**
 * Finds a property of the root object and returns its object value verbatim.
 *
 * A full JSON parse would fail on a truncated document; this walks only as far
 * as the matching brace, with string/escape awareness so braces inside message
 * text cannot end the value early. A string that merely equals `key` (a *value*,
 * not a property name) is skipped because no `:` follows it.
 */
function readTopLevelObject(text: string, key: string): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char !== '"') continue;
      inString = false;
      if (depth === 1 && stringStart !== -1 && text.slice(stringStart + 1, index) === key) {
        const value = readObjectValue(text, index + 1);
        if (value !== null) return value;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      stringStart = index;
      continue;
    }
    if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") depth -= 1;
  }
  return null;
}

/** Reads `: { … }` starting at `from`, returning the balanced object literal. */
function readObjectValue(text: string, from: number): string | null {
  let index = from;
  while (index < text.length && /\s/.test(text[index]!)) index += 1;
  if (text[index] !== ":") return null;
  index += 1;
  while (index < text.length && /\s/.test(text[index]!)) index += 1;
  if (text[index] !== "{") return null;
  const start = index;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char !== "}") continue;
    depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }
  return null;
}
