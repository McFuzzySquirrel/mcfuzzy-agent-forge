import type { TaskAttemptRequest } from "../types.ts";

/**
 * Harness CLI invocation and activity logging.
 *
 * Every CLI harness invocation is logged before the process is launched, and
 * the effective invocation is logged again when platform-specific launcher
 * resolution (the Windows `.cmd` shim rewrite in `run.ts`) changes the
 * executable or argv. Opt-in activity logging mirrors harness stdout/stderr
 * into the same stream as it arrives.
 *
 * Lines are written to stdout, which `forge-launcher engine-run` and the
 * detached engine redirect/tee to `docs/engine-run.log`; the Console tails that
 * file over SSE. Nothing here touches the engine's captured stdout/stderr used
 * for structured-result parsing.
 */

export interface HarnessInvocationContext {
  /** Harness adapter name (copilot, claude, opencode). */
  readonly harness: string;
  readonly runId: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly cwd: string;
}

export interface HarnessCompletion {
  status: number | null;
  error?: string;
  failureKind?: string;
  durationMs: number;
}

/** Builds the invocation context from the task attempt the adapter received. */
export function harnessInvocationContext(name: string, request: TaskAttemptRequest): HarnessInvocationContext {
  return {
    harness: name,
    runId: request.attempt.runId,
    taskId: request.task.id,
    attempt: request.attempt.number,
    cwd: request.repoRoot,
  };
}

export const REDACTED = "[REDACTED]";

/**
 * Argument flags whose value is a credential. Matched on a normalised name
 * (leading dashes stripped, lowercased, non-alphanumerics removed) so
 * `--api-key`, `--api_key`, and `--apikey` all redact.
 */
const SECRET_FLAG_NAMES = new Set([
  "token",
  "apitoken",
  "apikey",
  "password",
  "passwd",
  "secret",
  "clientsecret",
  "auth",
  "authorization",
  "accesskey",
  "accesskeyid",
  "secretkey",
  "credential",
  "credentials",
  "privatekey",
  "apisecret",
]);

/** Inline credential shapes that can appear anywhere in an argument or output line. */
const INLINE_SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s"']+/gi,
];

function normaliseFlagName(arg: string): string {
  return arg.replace(/^-+/, "").split("=")[0]!.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSecretFlag(arg: string): boolean {
  if (!arg.startsWith("-")) return false;
  return SECRET_FLAG_NAMES.has(normaliseFlagName(arg));
}

/** Replaces recognized credential shapes inside arbitrary text. */
export function redactText(text: string): string {
  let result = text;
  for (const pattern of INLINE_SECRET_PATTERNS) {
    result = result.replace(pattern, (match) => {
      // Preserve a recognizable scheme prefix so the redaction stays legible.
      const bearer = /^Bearer\s+/i.exec(match);
      return bearer ? `${bearer[0]}${REDACTED}` : REDACTED;
    });
  }
  return result;
}

/**
 * Redacts secret-bearing argv. A recognized secret flag redacts its value
 * (its `--flag=value` value inline), and inline credential shapes are masked
 * wherever they appear. Argument boundaries and order are preserved.
 */
export function redactArgs(args: string[]): string[] {
  const redacted: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    const inlineSecretFlag = /^([-]{1,2}[^=]+)=(.+)$/.exec(arg);
    if (isSecretFlag(arg) && inlineSecretFlag) {
      redacted.push(`${inlineSecretFlag[1]}=${REDACTED}`);
      continue;
    }
    if (isSecretFlag(arg)) {
      redacted.push(arg);
      const next = args[index + 1];
      if (next !== undefined && !next.startsWith("-")) {
        redacted.push(REDACTED);
        index += 1;
      }
      continue;
    }
    redacted.push(redactText(arg));
  }
  return redacted;
}

function timestamp(value?: string): string {
  return value ?? new Date().toISOString();
}

/** One unambiguous, single-line invocation record; argv is JSON-escaped per element. */
export function formatInvocationLine(
  ctx: HarnessInvocationContext,
  bin: string,
  args: string[],
  kind: "requested" | "effective",
  at?: string,
): string {
  return [
    `[engine] harness invocation [${kind}]`,
    `at=${timestamp(at)}`,
    `harness=${ctx.harness}`,
    `run=${ctx.runId}`,
    `task=${ctx.taskId}`,
    `attempt=${ctx.attempt}`,
    `cwd=${JSON.stringify(ctx.cwd)}`,
    `exec=${JSON.stringify(bin)}`,
    `args=${JSON.stringify(redactArgs(args))}`,
  ].join(" ");
}

export function formatActivityLine(
  ctx: HarnessInvocationContext,
  stream: "stdout" | "stderr",
  text: string,
  at?: string,
): string {
  return `[engine] harness activity ${stream} task=${ctx.taskId} attempt=${ctx.attempt} at=${timestamp(at)} ${redactText(text)}`;
}

export function formatCompletionLine(
  ctx: HarnessInvocationContext,
  completion: HarnessCompletion,
  at?: string,
): string {
  const fields = [
    `[engine] harness completed`,
    `at=${timestamp(at)}`,
    `harness=${ctx.harness}`,
    `run=${ctx.runId}`,
    `task=${ctx.taskId}`,
    `attempt=${ctx.attempt}`,
    `status=${completion.status === null ? "none" : completion.status}`,
    `durationMs=${completion.durationMs}`,
  ];
  if (completion.failureKind) fields.push(`kind=${completion.failureKind}`);
  if (completion.error) fields.push(`error=${JSON.stringify(redactText(completion.error))}`);
  return fields.join(" ");
}

/** Default maximum characters retained from a single activity line. */
export const DEFAULT_MAX_LINE_LENGTH = 4000;
/** Default maximum bytes streamed per attempt before activity is truncated. */
export const DEFAULT_MAX_ACTIVITY_BYTES = 2 * 1024 * 1024;

const ANSI_PATTERN = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;
// Retain newline and tab; drop the rest of the C0/C1 control range and DEL.
const CONTROL_PATTERN = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

function sanitise(text: string): string {
  return text
    .replace(ANSI_PATTERN, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(CONTROL_PATTERN, "");
}

/**
 * Buffers streamed activity into complete, sanitised lines and bounds both line
 * length and total volume. Partial chunks from the child process are held until
 * a newline arrives (or `flush` is called at process end).
 */
export class ActivityLineBuffer {
  private pending = "";
  private pendingDropped = 0;
  private emittedBytes = 0;
  private truncated = false;

  constructor(
    private readonly emit: (line: string) => void,
    private readonly maxLineLength = DEFAULT_MAX_LINE_LENGTH,
    private readonly maxTotalBytes = DEFAULT_MAX_ACTIVITY_BYTES,
  ) {}

  write(chunk: Buffer | string): void {
    if (this.truncated) return;
    this.pending += sanitise(chunk.toString());
    let newline = this.pending.indexOf("\n");
    while (newline !== -1) {
      const line = this.pending.slice(0, newline);
      this.pending = this.pending.slice(newline + 1);
      this.emitLine(line);
      if (this.truncated) {
        this.pending = "";
        this.pendingDropped = 0;
        return;
      }
      newline = this.pending.indexOf("\n");
    }
    // Bound a partial line that never receives a newline so memory stays fixed.
    if (this.pending.length > this.maxLineLength) {
      this.pendingDropped += this.pending.length - this.maxLineLength;
      this.pending = this.pending.slice(0, this.maxLineLength);
    }
  }

  flush(): void {
    if (this.truncated) return;
    if (this.pending.length > 0 || this.pendingDropped > 0) {
      const line = this.pending;
      const dropped = this.pendingDropped;
      this.pending = "";
      this.pendingDropped = 0;
      this.emitLine(line, dropped);
    }
  }

  private emitLine(line: string, dropped = 0): void {
    if (line.length === 0 && dropped === 0) return;
    const omitted = dropped + Math.max(0, line.length - this.maxLineLength);
    const truncatedLine = `${line.slice(0, this.maxLineLength)}${omitted > 0 ? `…[truncated ${omitted} chars]` : ""}`;
    const bytes = Buffer.byteLength(truncatedLine, "utf8");
    if (this.emittedBytes + bytes > this.maxTotalBytes) {
      this.truncated = true;
      this.emit(`[truncated after ${this.emittedBytes} bytes; further activity suppressed]`);
      return;
    }
    this.emittedBytes += bytes;
    this.emit(truncatedLine);
  }
}
