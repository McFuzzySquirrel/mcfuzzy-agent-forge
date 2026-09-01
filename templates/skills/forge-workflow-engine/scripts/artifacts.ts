/**
 * Artifact store for the forge-workflow-engine.
 *
 * Implements the Task → Agent → Artifact → Task pattern described in the
 * MyForge research document.  Every meaningful agent step produces a
 * compact, typed JSON artifact that becomes the sole hand-off to the next
 * agent — rather than passing the full conversation or full workflow state.
 *
 * Storage layout (relative to repo root):
 *
 *   docs/artifacts/
 *     <type-prefix>/          e.g. architecture/, implementation/, review/
 *       <artifact-id>.json    e.g. architecture-001.json
 *
 * The store is deliberately file-based so that artifacts can be inspected,
 * diffed, versioned in Git, and replayed without a database.  A future
 * SqliteArtifactStore or BlobArtifactStore can implement the same interface.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import type { Artifact, ArtifactProjection } from "../../forge-execution-adapter/scripts/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Very rough token estimate: ~4 chars per token (GPT-family rule of thumb).
 * Used only for audit telemetry — not for billing.
 */
function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

/**
 * Derive the subdirectory name from an artifact type string.
 * Uses the full type string with dots replaced by hyphens to avoid
 * collisions between types that share the same last segment.
 *
 * "solution.architecture" → "solution-architecture"
 * "implementation.result" → "implementation-result"
 * "test.result"           → "test-result"
 * "review"                → "review"
 */
function subdirFromType(type: string): string {
  return type.replace(/\./g, "-") || "other";
}

// ─── ArtifactStore ────────────────────────────────────────────────────────────

export interface ArtifactStoreOptions {
  /** Absolute path to the artifacts root directory (e.g. <repoRoot>/docs/artifacts/) */
  artifactsPath: string;
}

export class ArtifactStore {
  private readonly root: string;
  /**
   * In-memory monotonic artifact-index counters, keyed by type subdirectory.
   * Seeded from disk on first use so concurrent writes never scan-then-write
   * into the same ID.
   */
  private readonly idCounters = new Map<string, number>();

  constructor(opts: ArtifactStoreOptions) {
    this.root = opts.artifactsPath;
  }

  /**
   * Allocate the next sequential artifact ID of the form "<subdir>-<NNN>".
   * Uses an in-memory counter seeded once from the on-disk maximum, so
   * concurrent writes to the same type cannot collide.
   */
  private reserveArtifactId(type: string): string {
    const subdir = subdirFromType(type);
    let next = this.idCounters.get(subdir);
    if (next === undefined) {
      let maxIndex = 0;
      const dir = join(this.root, subdir);
      if (existsSync(dir)) {
        for (const file of readdirSync(dir)) {
          const match = file.match(new RegExp(`^${subdir}-(\\d+)\\.json$`));
          if (match) {
            const n = parseInt(match[1]!, 10);
            if (n > maxIndex) maxIndex = n;
          }
        }
      }
      next = maxIndex + 1;
    }
    this.idCounters.set(subdir, next + 1);
    return `${subdir}-${String(next).padStart(3, "0")}`;
  }

  // ─── Write ──────────────────────────────────────────────────────────────────

  /**
   * Persist an artifact to disk and return it with a populated artifactId and
   * createdAt timestamp.  The caller may pre-populate artifactId; if absent,
   * a sequential ID is generated.
   */
  write(partial: Omit<Artifact, "artifactId" | "createdAt"> & Partial<Pick<Artifact, "artifactId" | "createdAt">>): Artifact {
    const artifactId = partial.artifactId ?? this.reserveArtifactId(partial.type);
    const artifact: Artifact = {
      ...partial,
      artifactId,
      createdAt: partial.createdAt ?? new Date().toISOString(),
    };

    const subdir = subdirFromType(artifact.type);
    const dir = join(this.root, subdir);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${artifactId}.json`);
    writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

    return artifact;
  }

  // ─── Read ────────────────────────────────────────────────────────────────────

  /** Load an artifact by ID. Returns null if not found. */
  read(artifactId: string): Artifact | null {
    // Search all subdirectories for the file
    if (!existsSync(this.root)) return null;
    for (const subdir of readdirSync(this.root)) {
      const path = join(this.root, subdir, `${artifactId}.json`);
      if (existsSync(path)) {
        return JSON.parse(readFileSync(path, "utf8")) as Artifact;
      }
    }
    return null;
  }

  /** Load all artifacts of a given dot-separated type string. */
  readByType(type: string): Artifact[] {
    const subdir = subdirFromType(type);
    const dir = join(this.root, subdir);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Artifact)
      .filter((a) => a.type === type);
  }

  /** Load all artifacts produced by a given task ID. */
  readByTask(taskId: string): Artifact[] {
    return this.readAll().filter((a) => a.taskId === taskId);
  }

  /** Load all artifacts in the store (use sparingly — prefer specific reads). */
  readAll(): Artifact[] {
    if (!existsSync(this.root)) return [];
    const results: Artifact[] = [];
    for (const subdir of readdirSync(this.root)) {
      const dir = join(this.root, subdir);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".json")) continue;
        try {
          results.push(JSON.parse(readFileSync(join(dir, file), "utf8")) as Artifact);
        } catch {
          // Corrupt file — skip silently
        }
      }
    }
    return results;
  }

  // ─── Context projection ──────────────────────────────────────────────────────

  /**
   * Build a context projection for a task.
   *
   * For each artifact type listed in `inputTypes`, loads the most recent
   * successful artifact of that type and selects only the fields listed in
   * `fields` (defaults to ["summary", "confidence"] when omitted).
   *
   * The returned projection is what gets prepended to the agent's prompt —
   * not the full artifact payload.  This is the primary token-saving mechanism.
   */
  project(opts: {
    taskId: string;
    inputTypes: string[];
    fields?: string[];
  }): ArtifactProjection {
    const defaultFields = ["summary", "confidence", "filesChanged", "agentOutputExcerpt"];
    const fieldSet = opts.fields ?? defaultFields;

    let sourceTokenEstimate = 0;
    const projected: ArtifactProjection["artifacts"] = [];

    for (const type of opts.inputTypes) {
      const all = this.readByType(type).filter((a) => a.status === "complete");
      if (all.length === 0) continue;

      // Use the most recently created artifact
      const artifact = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!;
      sourceTokenEstimate += estimateTokens(artifact);

      const selectedFields: Record<string, unknown> = {};
      for (const field of fieldSet) {
        if (field in artifact) {
          selectedFields[field] = (artifact as unknown as Record<string, unknown>)[field];
        } else if (field in artifact.payload) {
          selectedFields[field] = artifact.payload[field];
        }
      }

      projected.push({
        artifactId: artifact.artifactId,
        type: artifact.type,
        summary: artifact.summary,
        confidence: artifact.confidence,
        selectedFields,
      });
    }

    const projectedTokenEstimate = estimateTokens(projected);

    return {
      taskId: opts.taskId,
      projectedAt: new Date().toISOString(),
      artifacts: projected,
      sourceTokenEstimate,
      projectedTokenEstimate,
    };
  }

  /**
   * Render a context projection as a concise markdown block suitable for
   * prepending to an agent prompt.
   */
  renderProjection(projection: ArtifactProjection): string {
    if (projection.artifacts.length === 0) return "";

    const lines: string[] = [
      "## Context from previous tasks",
      "",
    ];

    for (const a of projection.artifacts) {
      lines.push(`### ${a.type} (${a.artifactId})`);
      lines.push(`**Summary:** ${a.summary}`);
      if (a.confidence !== undefined) {
        lines.push(`**Confidence:** ${(a.confidence * 100).toFixed(0)}%`);
      }
      const extras = Object.entries(a.selectedFields).filter(([k]) => k !== "summary" && k !== "confidence");
      for (const [key, value] of extras) {
        if (key === "filesChanged" && Array.isArray(value) && value.length > 0) {
          lines.push(`**Files changed:**`);
          for (const f of value as string[]) {
            lines.push(`- ${f}`);
          }
        } else if (value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)) {
          lines.push(`**${key}:** ${typeof value === "string" ? value : JSON.stringify(value)}`);
        }
      }
      lines.push("");
    }

    const reduction =
      projection.sourceTokenEstimate > 0
        ? (
            (1 - projection.projectedTokenEstimate / projection.sourceTokenEstimate) *
            100
          ).toFixed(1)
        : "0";
    lines.push(
      `*Context projection: ~${projection.projectedTokenEstimate} tokens ` +
        `(${reduction}% reduction from ~${projection.sourceTokenEstimate} source tokens)*`,
      "",
    );

    return lines.join("\n");
  }

  // ─── Artifact synthesis from TaskResult ──────────────────────────────────────

  /**
   * Synthesise a minimal work artifact from a completed task's outputs.
   * Used when a task declares `produces` but the agent did not explicitly
   * write a structured artifact — the engine creates a best-effort one from
   * the available metadata.
   */
  synthesise(opts: {
    type: string;
    taskId: string;
    taskTitle: string;
    taskDescription: string;
    producedBy: string;
    outputFiles: string[];
    agentOutput: string;
    inputArtifactIds: string[];
  }): Artifact {
    // Prefer the task description as the summary — it is always meaningful
    // and unambiguous.  Fall back to the first substantive stdout line if no
    // description was provided (shouldn't happen in practice).
    const summary =
      opts.taskDescription && opts.taskTitle
        ? `${opts.taskTitle}: ${opts.taskDescription}`.slice(0, 200)
        : opts.taskDescription
        ? opts.taskDescription.slice(0, 200)
        : opts.taskTitle
        ? opts.taskTitle.slice(0, 200)
      : opts.agentOutput.split("\n").find((l) => l.trim().length > 20)?.trim().slice(0, 200) ??
        `Task ${opts.taskId} completed successfully.`;

    return this.write({
      type: opts.type,
      category: "work",
      taskId: opts.taskId,
      producedBy: opts.producedBy,
      status: "complete",
      summary,
      // 0.9 is a sensible default for a completed synthesis artifact.
      // Agents that write structured artifacts can override this.
      confidence: 0.9,
      inputs: opts.inputArtifactIds,
      filesChanged: opts.outputFiles,
      payload: {
        agentOutputExcerpt: opts.agentOutput.slice(0, 500),
        taskDescription: opts.taskDescription,
      },
      nextActions: [],
    });
  }
}

// ─── Artifact path helper ─────────────────────────────────────────────────────

export function artifactsRoot(repoRoot: string): string {
  return join(repoRoot, "docs", "artifacts");
}
