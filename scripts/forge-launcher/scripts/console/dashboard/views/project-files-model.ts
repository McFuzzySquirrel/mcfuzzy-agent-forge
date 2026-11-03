import type { ArtifactIndex, DocsIndex } from "../types.js";

export interface ProjectDocument {
  title: string;
  description: string;
  path: string;
  available: boolean;
}

export interface ProjectDeliverable {
  title: string;
  path: string;
}

export interface ProjectFiles {
  documents: ProjectDocument[];
  deliverables: ProjectDeliverable[];
}

const DOCUMENT_PURPOSES: Record<string, { title: string; description: string }> = {
  idea: { title: "Project idea", description: "The original intent and problem this Project addresses." },
  vision: { title: "Project brief", description: "The agreed outcome, scope, success criteria, assumptions, and open questions." },
  progress: { title: "Build progress", description: "A summary of completed work and what remains." },
  research: { title: "Supporting research", description: "Background material used to shape the Project." },
};

/** Project-facing projection of shared documents and changed output paths. */
export function buildProjectFiles(docs: DocsIndex, artifacts: ArtifactIndex): ProjectFiles {
  const documents: ProjectDocument[] = [];
  for (const entry of docs.entries) {
    const purpose = DOCUMENT_PURPOSES[entry.kind];
    if (purpose) {
      documents.push({
        title: purpose.title,
        description: purpose.description,
        path: entry.relPath,
        available: entry.exists,
      });
    } else if (entry.kind === "feature") {
      documents.push({
        title: `Feature addition: ${entry.title}`,
        description: "An agreed addition to this Project's capabilities.",
        path: entry.relPath,
        available: entry.exists,
      });
    }
  }

  const documentPaths = new Set(documents.map((item) => item.path));
  const deliverables = [...new Set(
    artifacts.artifacts.flatMap((artifact) => artifact.filesChanged)
      .map((filePath) => filePath.trim())
      .filter(Boolean),
  )]
    .filter((filePath) => !documentPaths.has(filePath))
    .sort((a, b) => a.localeCompare(b))
    .map((filePath) => ({
      title: filePath.split(/[\\/]/).pop() || filePath,
      path: filePath,
    }));

  return { documents, deliverables };
}
