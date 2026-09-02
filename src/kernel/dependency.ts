import picomatch from "picomatch";
import type { KernelEvent } from "./events.js";
import { dependencyDiscovered, premiseFalsified } from "./events.js";
import { openGeneration } from "./generations.js";
import type { Ticket } from "../schemas/ticket.js";
import { allTickets, readTicket } from "./tickets/readers.js";
import { appendNote, writeTicket } from "./tickets/mutations.js";

/**
 * X-4′ (PRDR-111) — a falsification that names the code it is missing is a
 * dependency the plan did not declare, not a plan-level flaw for a human.
 *
 * The session knows what it needs: a path. The plan knows who owns every
 * path: every ticket declares a surface. Resolving one against the other is
 * a glob match, and the pool already knows how to wait.
 */

/** What a session wrote to `falsified.json`. `missing` is X-4′'s addition. */
export interface FalsifiedSignal {
  readonly note: string;
  readonly missing: readonly string[];
}

/** Releases per ticket before a falsification is a human's again. */
export const DEPENDENCY_RELEASE_CAP = 3;

const WAIT_PREFIX = "waiting on ";

export interface Resolution {
  readonly owners: readonly string[];
  /** Why there are none — a note for the human the ticket goes to instead. */
  readonly reason: string;
}

/** Every ticket that depends on `id`, transitively, through declared and discovered edges. */
function dependentsOf(tickets: readonly Ticket[], id: string): Set<string> {
  const out = new Set<string>();
  const frontier = [id];
  while (frontier.length > 0) {
    const current = frontier.pop() as string;
    for (const t of tickets) {
      if (out.has(t.id)) continue;
      if (t.blockers.includes(current) || t.waits_on.includes(current)) {
        out.add(t.id);
        frontier.push(t.id);
      }
    }
  }
  return out;
}

/**
 * Owners of the named paths: other tickets, not DONE, whose surface matches,
 * minus anything that (transitively) depends on this ticket — a dependency
 * that would deadlock is not a dependency.
 */
export function resolveMissing(tickets: readonly Ticket[], self: Ticket, missing: readonly string[]): Resolution {
  const releases = self.generations.filter((g) => g.reason?.startsWith(WAIT_PREFIX) === true).length;
  if (releases >= DEPENDENCY_RELEASE_CAP) {
    return { owners: [], reason: `already released ${releases} times on discovered dependencies (X-4′ cap)` };
  }
  const dependents = dependentsOf(tickets, self.id);
  const owners = new Set<string>();
  const unowned: string[] = [];
  const deadlocked: string[] = [];
  for (const p of missing) {
    const matching = tickets.filter((t) => t.id !== self.id && t.state !== "DONE" && picomatch.isMatch(p, [...t.surface], { dot: true }));
    const usable = matching.filter((t) => !dependents.has(t.id));
    if (usable.length === 0) {
      (matching.length === 0 ? unowned : deadlocked).push(p);
      continue;
    }
    for (const t of usable) owners.add(t.id);
  }
  if (unowned.length > 0 || deadlocked.length > 0) {
    const parts = [
      ...(unowned.length > 0 ? [`no ticket's surface owns ${unowned.join(", ")}`] : []),
      ...(deadlocked.length > 0 ? [`the only owner of ${deadlocked.join(", ")} depends on this ticket`] : []),
    ];
    return { owners: [], reason: parts.join("; ") };
  }
  return { owners: [...owners].sort(), reason: "" };
}

/**
 * The referee's move on a falsification: a dependency when the paths resolve,
 * the X-4 human stop when they do not. With a dependency the ticket records
 * its owners, closes this generation as blocked, and opens the next with the
 * reason — the transition the returned event admits takes it back to READY.
 */
export function resolveFalsification(root: string, id: string, signal: FalsifiedSignal, at: string): KernelEvent {
  if (signal.missing.length === 0) return premiseFalsified(signal.note);
  const ticket = readTicket(root, id);
  const resolved = resolveMissing(allTickets(root), ticket, signal.missing);
  if (resolved.owners.length === 0) {
    /* The human who gets this ticket should not have to diff the plan to learn why. */
    appendNote(root, id, { author: "kernel", text: `not a dependency: ${resolved.reason} (X-4′)` });
    return premiseFalsified(`${signal.note} — missing ${signal.missing.join(", ")}: ${resolved.reason}`);
  }
  const reason = `${WAIT_PREFIX}${resolved.owners.join(", ")} for ${signal.missing.join(", ")} (X-4′)`;
  appendNote(root, id, { author: "kernel", text: `${reason} — released when they reach DONE` });
  const fresh = readTicket(root, id);
  writeTicket(root, {
    ...fresh,
    waits_on: [...new Set([...fresh.waits_on, ...resolved.owners])],
    generations: openGeneration(fresh, { at, reason, outcome: "blocked" }),
  });
  return dependencyDiscovered(resolved.owners, signal.missing);
}
