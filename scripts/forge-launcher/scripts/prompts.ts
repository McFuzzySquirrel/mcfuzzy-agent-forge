import { confirm, isCancel, multiline, path as clackPath, select, text } from "@clack/prompts";
import fs from "node:fs";
import readline from "node:readline";
import { expandPath } from "./paths.ts";

/** Module-level interactive flag; set by the CLI entry point. */
export const prompts = { nonInteractive: false };

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

/** readline line input with Tab completion for file/dir paths. */
async function readlinePathPrompt(message: string, def = ""): Promise<string> {
  const display = def ? `${message} [${def}]: ` : `${message}: `;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    completer: (line: string) => {
      const dir = line.includes("/") ? line.slice(0, line.lastIndexOf("/") + 1) : "";
      const base = line.includes("/") ? line.slice(line.lastIndexOf("/") + 1) : line;
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(expandPath(dir) || dir || ".");
      } catch {
        return [[line], line];
      }
      const hits = entries.filter((e) => e.startsWith(base)).map((e) => dir + e);
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
 * Reads a file/directory path. When interactive, uses a clack autocomplete path
 * picker (Tab-completes existing entries); falls back to readline for non-TTY.
 */
export async function promptPath(
  message: string,
  def = "",
  opts: { directory?: boolean } = {},
): Promise<string> {
  if (prompts.nonInteractive) return def;
  if (!isTty()) return readlinePrompt(message, def);
  if (opts.directory) {
    const result = await clackPath({ message, directory: true, initialValue: def || undefined });
    return checkCancel(result).trim() || def;
  }
  const result = await clackPath({ message, initialValue: def || undefined });
  return checkCancel(result).trim() || def;
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
