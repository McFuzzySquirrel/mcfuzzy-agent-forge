import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { createHash } from "node:crypto";

export interface RequirementDefinition {
  id: string;
  kind: "requirement" | "constraint" | "story";
  text: string;
}

export function referenceParts(reference: string): { path: string; selector?: string } {
  const [path, selector, extra] = reference.split("#");
  if (!path || path.includes("\\") || path.includes(":") || isAbsolute(path) || path.split("/").some((part) => !part || part === "." || part === "..") || extra !== undefined || (selector !== undefined && !selector.trim())) {
    throw new Error(`Reference must be a normalized repository-relative file path with an optional exact heading or ID: '${reference}'.`);
  }
  return { path, ...(selector !== undefined ? { selector } : {}) };
}

export function requirementDefinitions(text: string): RequirementDefinition[] {
  const definitions: RequirementDefinition[] = [];
  const ids = new Set<string>();
  const remainder = text.replace(/```forge-requirement\s*\r?\n([\s\S]*?)```/g, (_block, json: string) => {
    const value = JSON.parse(json) as RequirementDefinition;
    if (!value || Object.keys(value).some((key) => !["id", "kind", "text"].includes(key)) || typeof value.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.id) || !["requirement", "constraint", "story"].includes(value.kind) || typeof value.text !== "string" || !value.text.trim()) throw new Error("Invalid forge-requirement definition.");
    if (ids.has(value.id)) throw new Error(`Duplicate canonical definition '${value.id}'.`);
    ids.add(value.id);
    definitions.push(value);
    return "";
  });
  if (remainder.includes("```forge-requirement")) throw new Error("Malformed forge-requirement block.");
  return definitions;
}

export function readReference(repoRoot: string, reference: string): string {
  const { path, selector } = referenceParts(reference);
  const root = realpathSync(repoRoot);
  const full = realpathSync(resolve(root, path));
  const rel = relative(root, full);
  if (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel)) throw new Error(`Reference escapes repository: '${reference}'.`);
  const stat = statSync(full);
  if (!stat.isFile() || stat.size > 128 * 1024) throw new Error(`Reference '${path}' must be a file no larger than 128 KiB; provide a scoped source document.`);
  const text = readFileSync(full, "utf8");
  if (!selector) return text;
  const definition = requirementDefinitions(text).find((entry) => entry.id === selector);
  if (definition) return `${definition.id}: ${definition.text}`;
  const lines = text.split(/\r?\n/);
  const matches: { index: number; level: number }[] = [];
  let fence = false;
  for (const [index, line] of lines.entries()) {
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    const heading = !fence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading && heading[2] === selector) matches.push({ index, level: heading[1]!.length });
  }
  if (matches.length !== 1) throw new Error(`Reference '${reference}' must resolve to exactly one definition or heading.`);
  const start = matches[0]!;
  let end = lines.length;
  fence = false;
  for (let index = start.index + 1; index < lines.length; index++) {
    const line = lines[index]!;
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    const heading = !fence && line.match(/^(#{1,6})\s/);
    if (heading && heading[1]!.length <= start.level) { end = index; break; }
  }
  return lines.slice(start.index, end).join("\n").trimEnd();
}

export function resolveRequirement(repoRoot: string, reference: string, kind: "requirement" | "constraint"): string {
  const { path, selector } = referenceParts(reference);
  if (!selector) throw new Error(`Requirement reference '${reference}' needs a canonical ID.`);
  const definition = requirementDefinitions(readReference(repoRoot, path)).find((entry) => entry.id === selector);
  if (!definition || definition.kind !== kind) throw new Error(`Unresolved ${kind} reference '${reference}'.`);
  return `${definition.id}: ${definition.text}`;
}

export function resolvedReferenceBlocks(repoRoot: string, references: string[]): string[] {
  const seen = new Set<string>();
  const blocks: string[] = [];
  let bytes = 0;
  for (const reference of new Set(references)) {
    const content = readReference(repoRoot, reference);
    const digest = createHash("sha256").update(content).digest("hex");
    if (seen.has(digest)) continue;
    seen.add(digest);
    const block = `### Reference: ${reference}\n${content}`;
    bytes += Buffer.byteLength(block);
    if (bytes > 256 * 1024) throw new Error("References exceed 256 KiB; use scoped references.");
    blocks.push(block);
  }
  return blocks;
}