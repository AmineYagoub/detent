import { discover } from "../adapter/discover/index.js";
import { assertNoDrift, readBindings } from "../adapter/drift.js";
import type { Ticket } from "../schemas/ticket.js";
import type { KernelEvent } from "./events.js";
import { humanRequeue, outageRequeue } from "./events.js";
import { openGeneration } from "./generations.js";
import { lastNote } from "./referee-context.js";
import { allTickets } from "./tickets/readers.js";
import { appendNote, writeTicket } from "./tickets/mutations.js";

/**
 * The pool's sweeps: kernel-initiated re-queues that need no human because
 * the reason is already on the record. Each takes the core's ONE apply site
 * as `commit` — the sweep decides nothing about legality; the machine does.
 */

export type Commit = (ticket: Ticket, event: KernelEvent) => Ticket;

/** V-3: after `verify sync` re-baselines, every drift-blocked ticket returns to the pool. */
export function requeueDriftBlocked(root: string, commit: Commit, at: string): void {
  const bindings = readBindings(root).bindings;
  if (bindings.length === 0) return;
  try {
    assertNoDrift(bindings, discover(root));
  } catch {
    return;
  }
  for (const ticket of allTickets(root)) {
    if (ticket.state !== "BLOCKED" || !lastNote(ticket).startsWith("drift-blocked:")) continue;
    const requeued = commit(ticket, humanRequeue("verify-sync-rebaseline"));
    const generations = openGeneration(requeued, { at, reason: `gate drift re-baselined via verify sync; ${lastNote(ticket)}` });
    writeTicket(root, { ...requeued, generations });
    appendNote(root, ticket.id, { author: "kernel", text: "requeued after drift re-baseline (V-3/X-8)" });
  }
}

/**
 * PRDR-112: a ticket the outage pushed into NEEDS_HUMAN — its generation
 * closed on a $0 crash inside the streak, and the outage note is the last
 * word on it — returns to the pool with the reason recorded. A ticket a
 * person has since touched (any later note) is left to that person.
 */
export function requeueOutageVictims(root: string, commit: Commit, at: string): void {
  for (const ticket of allTickets(root)) {
    if (ticket.state !== "NEEDS_HUMAN") continue;
    const note = lastNote(ticket);
    if (!note.startsWith("outage:")) continue;
    const requeued = commit(ticket, outageRequeue(note));
    const generations = openGeneration(requeued, { at, reason: `requeued after a backend outage; ${note}` });
    writeTicket(root, { ...requeued, generations });
    appendNote(root, ticket.id, { author: "kernel", text: "requeued after outage (PRDR-112): not a finding against the ticket" });
  }
}
