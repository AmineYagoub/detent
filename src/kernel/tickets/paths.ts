import path from "node:path";
import { STATE_DIR } from "../../fs/layout.js";

/**
 * F-1 layout. `plan/` is committed; `claims/` is local and gitignored — a claim
 * is run state, not a decision, so it must never travel between machines.
 * The directory name itself is owned by `fs/layout.ts`, which is where F-1's
 * split is declared; duplicating the literal here is how the two drift.
 */
export { STATE_DIR };

export const ticketsDir = (root: string): string => path.join(root, STATE_DIR, "plan");
export const claimsDir = (root: string): string => path.join(root, STATE_DIR, "claims");
export const ticketPath = (root: string, id: string): string => path.join(ticketsDir(root), `${id}.json`);
export const claimPath = (root: string, id: string): string => path.join(claimsDir(root), `${id}.claim`);
