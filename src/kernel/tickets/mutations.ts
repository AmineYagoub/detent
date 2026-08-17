import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { ticketSchema, type Generation, type Ticket } from "../../schemas/ticket.js";
import { SCHEMA_VERSION } from "../../schemas/common.js";
import { ZERO_COUNTERS } from "../generations.js";
import { claimPath, claimsDir, ticketPath, ticketsDir } from "./paths.js";
import { readTicket } from "./readers.js";

/**
 * T-017 write side. `src/sessions/**` may not import this module (ARCH-1): a
 * session produces artifacts, and only the kernel writes ticket state.
 */

export interface ClaimInfo {
  readonly owner: string;
  readonly pid: number;
  readonly at: string;
}

/**
 * R-3: `openSync(path, "wx")` is POSIX `O_CREAT|O_EXCL` — the same primitive
 * the Python reference used. Exactly one caller wins the create; every other
 * gets EEXIST. The write that follows is not part of the atomic step, so a
 * reader must treat an empty claim file as held-by-someone, not as free.
 */
export function claim(root: string, id: string, owner: string): boolean {
  mkdirSync(claimsDir(root), { recursive: true });
  let fd: number;
  try {
    fd = openSync(claimPath(root, id), "wx");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
  try {
    const info: ClaimInfo = { owner, pid: process.pid, at: new Date().toISOString() };
    writeFileSync(fd, JSON.stringify(info));
  } finally {
    closeSync(fd);
  }
  return true;
}

export function readClaim(root: string, id: string): ClaimInfo | null {
  try {
    const raw = readFileSync(claimPath(root, id), "utf8");
    return raw === "" ? null : (JSON.parse(raw) as ClaimInfo);
  } catch {
    return null;
  }
}

export function release(root: string, id: string): void {
  rmSync(claimPath(root, id), { force: true });
}

/** Validate before write: an invalid ticket never reaches disk. */
export function writeTicket(root: string, ticket: Ticket): Ticket {
  const validated = ticketSchema.parse(ticket);
  mkdirSync(ticketsDir(root), { recursive: true });
  writeFileSync(ticketPath(root, validated.id), `${JSON.stringify(validated, null, 2)}\n`);
  return validated;
}

export interface NewTicket {
  readonly id: string;
  readonly type: "feature" | "bug";
  readonly title: string;
  readonly acceptance_criteria: readonly string[];
  readonly description?: string;
  readonly surface?: readonly string[];
  readonly blockers?: readonly string[];
  readonly priority?: number;
  readonly risk_label?: boolean;
}

export function createTicket(root: string, input: NewTicket, at = new Date().toISOString()): Ticket {
  const generation: Generation = {
    index: 0,
    counters: { ...ZERO_COUNTERS },
    outcome: "in_flight",
    started_at: at,
  };
  return writeTicket(root, {
    schema_version: SCHEMA_VERSION,
    id: input.id,
    type: input.type,
    title: input.title,
    description: input.description ?? "",
    acceptance_criteria: [...input.acceptance_criteria],
    non_goals: [],
    surface: [...(input.surface ?? [])],
    blockers: [...(input.blockers ?? [])],
    links: [],
    priority: input.priority ?? 0,
    risk_label: input.risk_label ?? false,
    state: "READY",
    generations: [generation],
    notes: [],
  } satisfies Ticket);
}

/** Notes are append-only: existing entries are carried forward untouched. */
export function appendNote(
  root: string,
  id: string,
  note: { readonly author: string; readonly text: string; readonly at?: string },
): Ticket {
  const ticket = readTicket(root, id);
  return writeTicket(root, {
    ...ticket,
    notes: [...ticket.notes, { at: note.at ?? new Date().toISOString(), author: note.author, text: note.text }],
  });
}

/**
 * X-5 / X-6: a quarantine or upstream-bug ticket is linked back to the ticket
 * whose run surfaced it, so the discovery is traceable from either end.
 */
export function linkDiscovered(root: string, parentId: string, child: NewTicket): Ticket {
  const created = createTicket(root, child);
  const parent = readTicket(root, parentId);
  writeTicket(root, {
    ...parent,
    links: [...parent.links, { rel: "discovered_from", ref: created.id }],
  });
  return writeTicket(root, {
    ...created,
    links: [...created.links, { rel: "discovered_from", ref: parentId }],
  });
}
