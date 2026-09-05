import { confirm, isCancel, multiline, select, text } from "@clack/prompts";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { AsyncLocalStorage } from "node:async_hooks";
import { expandPath } from "./paths.ts";

const promptSessions = new AsyncLocalStorage<{ nonInteractive: boolean }>();
let defaultNonInteractive = false;
export const prompts = {
  get nonInteractive(): boolean { return promptSessions.getStore()?.nonInteractive ?? defaultNonInteractive; },
  set nonInteractive(value: boolean) {
    const session = promptSessions.getStore();
    if (session) session.nonInteractive = value;
    else defaultNonInteractive = value;
  },
};

export function withPromptSession<T>(nonInteractive: boolean, operation: () => T): T {
  return promptSessions.run({ nonInteractive }, operation);
}

/** Thrown when the user cancels an interactive prompt (Ctrl+C). */
export class PromptCancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

function isTty(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}

function checkCancel<T>(value: T | symbol): T {
  if (isCancel(value)) throw new PromptCancelled();
  return value as T;
}

// ---------------------------------------------------------------------------
// readline fallbacks / helpers (piped or non-TTY stdin)
// ---------------------------------------------------------------------------

async function readlinePrompt(message: string, def = ""): Promise<string> {
  const display = def ? `${message} [${def}]: ` : `${message}: `;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(display, resolve));
  rl.close();
  return answer.trim() || def;
}

/** readline line input with Tab completion for file/dir paths (both \ and /). */
async function readlinePathPrompt(message: string, def = ""): Promise<string> {
  const display = def ? `${message} [${def}]: ` : `${message}: `;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    completer: (line: string) => {
      const { dir, base } = splitPathInput(line);
      let entries: string[] = [];
      try {
        const readDir = dir ? path.resolve(expandPath(dir) || dir) : ".";
        entries = fs.readdirSync(readDir);
      } catch {
        return [[line], line];
      }
      const hits = entries
        .filter((e) => e.toLowerCase().startsWith(base.toLowerCase()))
        .map((e) => dir + e);
      return [hits.length ? hits : [line], line];
    },
  });
  const answer = await new Promise<string>((resolve) => rl.question(display, resolve));
  rl.close();
  return answer.trim() || def;
}

async function readlineYesNo(message: string, def: "y" | "n"): Promise<"y" | "n"> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(`${message} [y/N]: `, resolve));
  rl.close();
  const a = (answer.trim() || def).toLowerCase();
  return a === "y" ? "y" : "n";
}

async function readlineSelect(
  message: string,
  options: Array<{ value: string; label: string }>,
  def: string,
): Promise<string> {
  process.stdout.write(message + "\n");
  options.forEach((o, i) => process.stdout.write(`    ${i + 1}) ${o.label}\n`));
  const defIdx = options.findIndex((o) => o.value === def);
  const display = `Select [1-${options.length}] [${defIdx + 1}]: `;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(display, resolve));
  rl.close();
  const choice = answer.trim();
  const idx = Number(choice);
  if (Number.isInteger(idx) && idx >= 1 && idx <= options.length) return options[idx - 1].value;
  return def;
}

/** Multi-line capture via readline; ends on a blank line. */
async function readlineMultiline(message: string): Promise<string> {
  process.stdout.write(message + "\n");
  process.stdout.write("  Press Enter twice on a blank line when finished:\n");
  process.stdout.write("  ──────────────────────────────────────────────────────────────\n");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const lines: string[] = [];
  let blanks = 0;
  const collected = await new Promise<string[]>((resolve) => {
    rl.setPrompt("  ");
    rl.prompt();
    rl.on("line", (line) => {
      if (line === "") {
        blanks += 1;
        if (blanks >= 2) {
          rl.close();
          resolve(lines);
          return;
        }
      } else {
        blanks = 0;
      }
      lines.push(line);
      rl.prompt();
    });
  });
  while (collected.length > 0 && collected[collected.length - 1] === "") collected.pop();
  return collected.join("\n");
}

// ---------------------------------------------------------------------------
// Path picking helpers (cross-platform: \ and / separators, case-insensitive)
// ---------------------------------------------------------------------------

/** Splits a typed path into its directory prefix and the trailing name part. */
export function splitPathInput(line: string): { dir: string; base: string } {
  const idx = Math.max(line.lastIndexOf("/"), line.lastIndexOf("\\"));
  if (idx === -1) return { dir: "", base: line };
  return { dir: line.slice(0, idx + 1), base: line.slice(idx + 1) };
}

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

/** Lists directory entries, folders first, then case-insensitive by name. */
export function listDirEntries(dir: string, opts: { directory?: boolean } = {}): DirEntry[] {
  const abs = path.resolve(dir || ".");
  let raw: fs.Dirent[];
  try {
    raw = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  return raw
    .filter((e) => e.name !== "." && e.name !== "..")
    .filter((e) => (opts.directory ? e.isDirectory() : true))
    .map((e) => ({ name: e.name, path: path.join(abs, e.name), isDirectory: e.isDirectory() }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
}

const USE_FOLDER = "\u0000use";
const TYPE_PATH = "\u0000type";
const GO_UP = "\u0000up";

function validateTypedPath(input: string | undefined, opts: { directory?: boolean }): string | undefined {
  const raw = expandPath((input ?? "").trim());
  if (!raw) return "Path cannot be empty";
  const p = path.resolve(raw);
  if (!fs.existsSync(p)) return opts.directory ? undefined : `File not found: ${p}`;
  const st = fs.statSync(p);
  if (opts.directory && !st.isDirectory()) return `Not a directory: ${p}`;
  if (!opts.directory && !st.isFile()) return `Not a file: ${p}`;
  return undefined;
}

/**
 * Interactive cross-platform file/directory picker. Uses a clack `select` list
 * (reliable on Windows, unlike @clack/prompts' `path` autocomplete, which
 * hardcodes "/" and does case-sensitive full-path prefix matching). Navigate
 * with folders, "..", and a "Type a path…" free-text entry for search.
 */
export async function pickPath(
  message: string,
  initial = "",
  opts: { directory?: boolean } = {},
): Promise<string> {
  let current = initial ? path.resolve(expandPath(initial) || initial) : path.resolve(".");
  if (opts.directory && fs.existsSync(current) && !fs.statSync(current).isDirectory()) {
    current = path.dirname(current);
  }
  for (;;) {
    const entries = listDirEntries(current, opts);
    const atRoot = path.dirname(current) === current;
    const options: Array<{ value: string; label: string; hint?: string }> = [];
    if (opts.directory) options.push({ value: USE_FOLDER, label: "Use this folder", hint: current });
    options.push({ value: TYPE_PATH, label: "Type a path\u2026", hint: "" });
    if (!atRoot) options.push({ value: GO_UP, label: "..  (go up)", hint: path.dirname(current) });
    for (const e of entries) {
      options.push({
        value: e.path,
        label: e.isDirectory ? `${e.name}/` : e.name,
        hint: e.isDirectory ? "directory" : "file",
      });
    }
    if (options.length === 0) return current;

    const choice = checkCancel<string>(
      await select({
        message: `${message}\n  ${current}`,
        options,
        initialValue: opts.directory ? USE_FOLDER : undefined,
      }),
    );
    if (choice === USE_FOLDER) return current;
    if (choice === TYPE_PATH) {
      const typed = checkCancel<string>(
        await text({
          message: "Enter a path",
          initialValue: current,
          validate: (v) => validateTypedPath(v, opts),
        }),
      );
      return path.resolve(expandPath(typed.trim() || current) || current);
    }
    if (choice === GO_UP) {
      current = path.dirname(current);
      continue;
    }
    const entry = entries.find((e) => e.path === choice);
    if (!entry) continue;
    if (entry.isDirectory) current = entry.path;
    else return entry.path;
  }
}

// ---------------------------------------------------------------------------
// Public prompt helpers (clack when interactive TTY, readline otherwise)
// ---------------------------------------------------------------------------

/** Reads a single line of text. */
export async function prompt(message: string, def = ""): Promise<string> {
  if (prompts.nonInteractive) return def;
  if (!isTty()) return readlinePrompt(message, def);
  const result = await text({ message, initialValue: def || undefined });
  return checkCancel(result).trim() || def;
}

/**
 * Reads a file/directory path. Interactive TTY sessions get a cross-platform
 * directory picker (folders, "..", type-to-search); piped input falls back to
 * a readline prompt.
 */
export async function promptPath(
  message: string,
  def = "",
  opts: { directory?: boolean } = {},
): Promise<string> {
  if (prompts.nonInteractive) return def;
  if (!isTty()) return readlinePrompt(message, def);
  return pickPath(message, def, opts);
}

/** Reads multiple paths until a blank line (readline; keeps Tab completion). */
export async function promptPathLoop(message: string): Promise<string[]> {
  if (prompts.nonInteractive) return [];
  const paths: string[] = [];
  const read = isTty() ? readlinePathPrompt : readlinePrompt;
  for (;;) {
    const p = (await read(message)).trim();
    if (!p) break;
    paths.push(p);
  }
  return paths;
}

/** Reads a yes/no answer; returns "y" or "n". */
export async function promptYesNo(message: string, def: "y" | "n" = "n"): Promise<"y" | "n"> {
  if (prompts.nonInteractive) {
    const env = process.env.FORGE_YN_DEFAULT;
    if (env) return env.toLowerCase() === "y" ? "y" : "n";
    return def;
  }
  if (!isTty()) return readlineYesNo(message, def);
  const result = await confirm({ message, initialValue: def === "y" });
  return checkCancel(result) ? "y" : "n";
}

/**
 * Numbered-select menu. Returns one of the option `value`s. In non-interactive
 * mode returns `nonInteractiveValue` (falling back to the default).
 */
export async function promptSelect(
  message: string,
  options: Array<{ value: string; label: string; hint?: string }>,
  opts: { initial?: string; nonInteractiveValue?: string } = {},
): Promise<string> {
  if (prompts.nonInteractive) return opts.nonInteractiveValue ?? opts.initial ?? options[0].value;
  if (!isTty()) return readlineSelect(message, options, opts.initial ?? options[0].value);
  const result = await select({
    message,
    options: options.map((o) => ({ value: o.value, label: o.label, hint: o.hint })),
    initialValue: opts.initial ?? options[0].value,
  });
  return checkCancel(result);
}

/** Multi-line text capture; Enter twice submits (clack) or a blank line ends (readline). */
export async function promptMultiline(message: string): Promise<string> {
  if (prompts.nonInteractive) return "";
  if (!isTty()) return readlineMultiline(message);
  const result = await multiline({ message });
  return checkCancel(result);
}
