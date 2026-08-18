import { existsSync, readFileSync, readdirSync } from "node:fs";
import { parseArtifact, type SchemaCheck } from "../../schemas/common.js";
import { ticketSchema, type Ticket } from "../../schemas/ticket.js";
import { claimPath, ticketPath, ticketsDir } from "./paths.js";

/**
 * T-017 read side. Separated from `mutations.ts` so ARCH-1's "sessions import
 * no kernel state mutators" is expressible to the dependency lint (R-5) — a
 * session may read ticket state, never write it.
 */

export class TicketNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`no such ticket: ${id}`);
    this.name = "TicketNotFoundError";
  }
}

export class TicketInvalidError extends Error {
  constructor(
    readonly id: string,
    readonly detail: string,
  ) {
    super(`ticket ${id} is invalid: ${detail}`);
    this.name = "TicketInvalidError";
  }
}

export function readTicket(root: string, id: string): Ticket {
  const p = ticketPath(root, id);
  if (!existsSync(p)) throw new TicketNotFoundError(id);
  return unwrap(id, parseArtifact(ticketSchema, JSON.parse(readFileSync(p, "utf8"))));
}

function unwrap(id: string, result: SchemaCheck<Ticket>): Ticket {
  if (result.ok) return result.value;
  if (result.reason === "newer-schema") {
    throw new TicketInvalidError(id, `declares schema_version ${result.found}, this build supports ${result.supported}`);
  }
  throw new TicketInvalidError(id, result.issues.join("; "));
}

/**
 * Files in `plan/` that are not tickets. F-1 enumerates the directory as
 * "tickets `*.json`, `approval.json`" and A-2's plan artifact has no named
 * home, so this list has now grown twice by accident — once for the approval
 * record, once for the plan. PRDR-064 asks F-1 to say what a ticket file is
 * rather than leaving readers to maintain an exclusion list.
 */
const NON_TICKET_FILES: ReadonlySet<string> = new Set(["approval.json", "plan.json"]);

export function allTickets(root: string): Ticket[] {
  const dir = ticketsDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !NON_TICKET_FILES.has(f))
    .map((f) => readTicket(root, f.slice(0, -".json".length)))
    .sort((a, b) => (b.priority - a.priority) || a.id.localeCompare(b.id));
}

export function isClaimed(root: string, id: string): boolean {
  return existsSync(claimPath(root, id));
}

/**
 * C-9's claimable pool: READY, unclaimed, and every blocker DONE.
 *
 * C-4's greenfield bootstrap falls out of this rather than needing a special
 * case — ticket #1 is simply listed as a blocker on every other ticket, so
 * nothing is claimable until it reaches DONE.
 */
export function ready(root: string): Ticket[] {
  const tickets = allTickets(root);
  const byId = new Map(tickets.map((t) => [t.id, t]));
  return tickets.filter(
    (t) =>
      t.state === "READY" &&
      !isClaimed(root, t.id) &&
      t.blockers.every((b) => byId.get(b)?.state === "DONE"),
  );
}

/** Non-terminal in-flight states resume by re-running `run` (C-9). */
export function resumable(root: string): Ticket[] {
  return allTickets(root).filter((t) => t.state !== "DONE" && t.state !== "READY");
}

export function countsByState(root: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of allTickets(root)) counts[t.state] = (counts[t.state] ?? 0) + 1;
  return counts;
}
