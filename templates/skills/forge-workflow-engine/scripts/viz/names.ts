// ─── Agent → squirrel-name generator ─────────────────────────────────────────
//
// Every task in the manifest has an ownerAgent; the visualization renders one
// named squirrel per agent. Names are derived deterministically so a given
// agent always gets the same squirrel across runs and machines.

/** Curated override for well-known agent roles. */
const ROLE_NAMES: Record<string, string> = {
  "project-orchestrator": "Acornius",
  "project-architect": "Twigby",
  architect: "Twigby",
  "api-engineer": "Tailor",
  "ui-engineer": "Pixie",
  "game-engineer": "Hopper",
  "qa-engineer": "Nutsy",
  "infrastructure-engineer": "Chip",
  "devops-engineer": "Scamp",
  "data-engineer": "Grommet",
  "backend-engineer": "Bramble",
  "frontend-engineer": "Sassafras",
  "full-stack-engineer": "Buster",
  "security-engineer": "Rusty",
  "content-designer": "Fern",
  "village-content-designer": "Fern",
  writer: "Quill",
  researcher: "Zigzag",
  reviewer: "Judge Nut",
};

/** Curated fallback pool for any agent without a role override. */
const FALLBACK_NAMES = [
  "Acornius", "Twigby", "Tailor", "Pixie", "Hopper", "Nutsy", "Chip",
  "Scamp", "Grommet", "Bramble", "Buster", "Rusty", "Fern", "Quill",
  "Zigzag", "Skitter", "Whiskers", "Pebble", "Mossy", "Thistle", "Sable",
  "Hazel", "Rattle", "Dart", "Willow", "Gus", "Mabel", "Ollie", "Pip",
  "Squeak",
];

/** Deterministic FNV-1a hash so an unknown agent always maps to the same name. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Deterministically derive a squirrel name for an agent. Uses the curated role
 * map first, then a stable hash into the fallback pool.
 */
export function squirrelNameForAgent(agentName: string | null | undefined): string {
  const normalized = (agentName ?? "").trim().toLowerCase();
  if (!normalized) return UNASSIGNED_SQUIRREL;
  if (ROLE_NAMES[normalized]) return ROLE_NAMES[normalized]!;
  const index = hashString(normalized) % FALLBACK_NAMES.length;
  return FALLBACK_NAMES[index]!;
}

/** A generic name for tasks with no owner agent (scout squirrels). */
export const UNASSIGNED_SQUIRREL = "Scout";
