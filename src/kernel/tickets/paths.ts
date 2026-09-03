import path from "node:path";
import { STATE_DIR } from "../../fs/layout.js";
import { isSafeTicketId } from "../../schemas/common.js";

/**
 * F-1 layout. `plan/` is committed; `claims/` is local and gitignored — a claim
 * is run state, not a decision, so it must never travel between machines.
 * The directory name itself is owned by `fs/layout.ts`, which is where F-1's
 * split is declared; duplicating the literal here is how the two drift.
 */

export const ticketsDir = (root: string): string => path.join(root, STATE_DIR, "plan");
export const claimsDir = (root: string): string => path.join(root, STATE_DIR, "claims");
/**
 * The floor under every reader and writer: an id that is not a safe file name
 * never becomes a path. The schema rejects one on the way in, but this is the
 * guard that holds even when a caller builds a path from something the schema
 * never saw — a checkpoint, a cache, a hand-edited plan.
 */
function safeId(id: string): string {
  if (!isSafeTicketId(id)) throw new Error(`unsafe ticket id ${JSON.stringify(id)} — a ticket id is a file name under ${STATE_DIR}/plan (F-1)`);
  return id;
}

export const ticketPath = (root: string, id: string): string => path.join(ticketsDir(root), `${safeId(id)}.json`);
export const claimPath = (root: string, id: string): string => path.join(claimsDir(root), `${safeId(id)}.claim`);
