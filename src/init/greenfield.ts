/**
 * D-10′ (PRDR-290) — whether this is a new project, decided by code.
 *
 * Greenfield is the absence of stack markers, not a flag: a directory holding
 * only planning documents has nothing to bind against yet (C-1, D-10). ANALYZE
 * reported it beside the stack its session chose, and the phases after it read
 * both from its checkpoint. The stack is a decision now, which DECIDE records
 * in the decision log, and this is code's: each phase that needs it computes it
 * from the stack markers it reads, and no model session stands in between.
 */
export function isGreenfield(stackMarkers: readonly string[]): boolean {
  return stackMarkers.length === 0;
}
