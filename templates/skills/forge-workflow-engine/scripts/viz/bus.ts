import type { AuditEvent } from "../types.ts";

// ─── In-process audit broadcast bus ──────────────────────────────────────────
//
// The engine writes audit events to docs/EXECUTION-AUDIT.jsonl and (optionally)
// broadcasts the same events to the live visualization server. A module-level
// bus keeps EngineOptions unchanged: the engine keeps calling writeAuditEvent
// exactly as before, and the viz server registers itself as the single listener.

type AuditListener = (event: AuditEvent) => void;

let listener: AuditListener | undefined;

/** Register the single audit listener (the live viz server). Returns an unregister fn. */
export function setAuditListener(fn: AuditListener | undefined): void {
  listener = fn;
}

/** Broadcast an audit event to the registered listener (no-op when none). */
export function broadcastAudit(event: AuditEvent): void {
  if (listener) {
    try {
      listener(event);
    } catch {
      // A failing consumer must never break the engine loop.
    }
  }
}

export function getAuditListener(): AuditListener | undefined {
  return listener;
}
