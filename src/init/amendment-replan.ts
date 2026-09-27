import { readAmendments, writeAmendment } from "../kernel/amendment-store.js";
import { requeueTicket } from "../kernel/plumbing.js";
import { allTickets } from "../kernel/tickets/readers.js";

/**
 * X-4⁸, C-8⁵ (PRDR-286) — what a re-plan does with the amendments it answered.
 *
 * Called once PLAN has written the plan, outside its journal, since a requeue
 * journals its own transition. Each applied amendment is marked re-planned
 * with the slices this run planned again, which frees the tickets it held.
 * Its filing ticket, if the re-plan did not supersede it, still waits in
 * NEEDS_HUMAN, and returns to the queue through HUMAN_REQUEUE with the
 * amendment as its guidance, as PRDR-277 returns the tickets an install frees.
 * A re-planned slice wrote its tickets afresh or removed them, so a filing
 * ticket there is READY or gone. A requeue refused (a live claim, say) is
 * said, and the ticket stays with the operator; the re-plan stands.
 */
export function settleAmendments(root: string, replanned: readonly string[], note?: (text: string) => void): void {
  const applied = readAmendments(root).filter((a) => a.status === "applied");
  if (applied.length === 0) return;
  const tickets = new Map(allTickets(root).map((t) => [t.id, t]));
  for (const a of applied) {
    if (tickets.get(a.ticket)?.state === "NEEDS_HUMAN") {
      const guidance = `the pack was amended (${a.id}) and the slices it changed were planned again: build this ticket against the pack as it now reads (X-4⁸)`;
      let said: string;
      try {
        const requeued = requeueTicket(root, a.ticket, "detent", guidance);
        said = requeued.exitCode === 0 ? requeued.message : `${a.ticket} stays with you: ${requeued.message}; \`detent requeue ${a.ticket}\` returns it`;
      } catch (err) {
        said = `${a.ticket} stays with you: ${(err as Error).message}; \`detent requeue ${a.ticket}\` returns it`;
      }
      note?.(said);
    }
    writeAmendment(root, { ...a, status: "replanned", replanned: [...replanned] });
    note?.(`${a.id}: re-planned ${replanned.length === 0 ? "no slice" : replanned.join(", ")}; the tickets it held return to the pool (C-8⁵)`);
  }
}
