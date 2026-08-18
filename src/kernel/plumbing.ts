import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import type { Ticket } from "../schemas/ticket.js";
import { humanApproved, humanRequeue, type KernelEvent } from "./events.js";
import { currentCounters, currentGeneration, openGeneration, withCurrentCounters } from "./generations.js";
import { RunJournal } from "./journal.js";
import { apply } from "./machine.js";
import { readTicket, isClaimed } from "./tickets/readers.js";
import { readClaim, release, writeTicket, appendNote } from "./tickets/mutations.js";
import { loadConfig, type LoadedConfig } from "./worstcase.js";

/**
 * T-055 — `approve <id>` and `requeue <id>` (C-12, X-3, X-8).
 *
 * Plumbing mutates ticket state and therefore respects the C-9 claim: a live
 * claim refuses with exit 2 naming the pid and the claim's age; a STALE claim
 * (owner not alive) may be broken, and the break is recorded in
 * `transitions.jsonl` inside the transition's evidence — an operator action
 * with the broken pid, without inventing an X-3 event to carry it.
 *
 * Legality is X-3's: `approve` only from NEEDS_HUMAN, `requeue` only from
 * NEEDS_HUMAN or BLOCKED. Approve re-enters APPROVED — the kernel re-verifies
 * on the next run; a direct DONE does not exist. Requeue opens generation N+1
 * with zeroed counters while N stays frozen (D-17, the recorded divergence
 * from the oracle's in-place reset).
 */

export const PLUMBING_EXIT_OK = 0;
export const PLUMBING_EXIT_REFUSED = 2;

export interface PlumbingResult {
  readonly exitCode: 0 | 2;
  readonly message: string;
  readonly ticket?: Ticket;
}

interface ClaimGuard {
  readonly ok: boolean;
  readonly brokeStale?: { readonly pid: number };
  readonly refusal?: string;
}

export interface PlumbingDeps {
  /** Injectable liveness probe; default `process.kill(pid, 0)`. */
  readonly isAlive?: (pid: number) => boolean;
  readonly now?: () => number;
}

function defaultAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** C-12's claim discipline, shared by both verbs. */
function guardClaim(root: string, id: string, deps: PlumbingDeps): ClaimGuard {
  if (!isClaimed(root, id)) return { ok: true };
  const info = readClaim(root, id);
  const alive = deps.isAlive ?? defaultAlive;
  // An unreadable claim file is held-by-someone until proven stale (R-3).
  if (info === null) return { ok: false, refusal: `ticket ${id} is claimed (claim unreadable — treat as held)` };
  if (alive(info.pid)) {
    const ageMs = Math.max(0, (deps.now ?? Date.now)() - Date.parse(info.at));
    return {
      ok: false,
      refusal:
        `ticket ${id} is claimed by a live run (pid ${info.pid}, claim age ${Math.round(ageMs / 1000)}s) — ` +
        `resolve the escalation inside \`run\` (C-10) or stop the run first`,
    };
  }
  release(root, id);
  return { ok: true, brokeStale: { pid: info.pid } };
}

function loadedConfig(root: string): LoadedConfig {
  const file = path.join(stateDir(root), "config.json");
  if (!existsSync(file)) throw new Error(`no config at ${file}`);
  return loadConfig(JSON.parse(readFileSync(file, "utf8")));
}

/** One transition, journaled — the same shape as the run loop's commit path. */
function commitTransition(root: string, ticket: Ticket, kernelEvent: KernelEvent, loaded: LoadedConfig): Ticket {
  const journal = RunJournal.open(root);
  try {
    const counters = currentCounters(ticket);
    const result = apply(ticket.state, kernelEvent.event, counters, {
      ticket: { type: ticket.type },
      budgets: loaded.config.budgets,
    });
    const generation = currentGeneration(ticket);
    journal.appendTransition({
      at: new Date().toISOString(),
      ticket: ticket.id,
      generation: generation.index,
      from: result.from,
      event: kernelEvent.event,
      to: result.to,
      evidence: kernelEvent.evidence,
      counters: result.counters,
    });
    return writeTicket(root, {
      ...ticket,
      state: result.to,
      generations: withCurrentCounters(ticket.generations, generation.index, result.counters),
    });
  } finally {
    journal.close();
  }
}

/**
 * `detent approve <id>`: NEEDS_HUMAN → APPROVED. The kernel re-verifies on
 * the next `run` — the resumable pool includes APPROVED, and the close-check
 * runs the full gates before finalize (never a direct DONE).
 */
export function approveTicket(root: string, id: string, user: string, deps: PlumbingDeps = {}): PlumbingResult {
  const guard = guardClaim(root, id, deps);
  if (!guard.ok) return { exitCode: PLUMBING_EXIT_REFUSED, message: guard.refusal ?? "claimed" };

  const ticket = readTicket(root, id);
  if (ticket.state !== "NEEDS_HUMAN") {
    return {
      exitCode: PLUMBING_EXIT_REFUSED,
      message: `approve is admissible only from NEEDS_HUMAN; ${id} is ${ticket.state} (X-3 offers no such row)`,
    };
  }

  const brokeNote = guard.brokeStale === undefined ? "" : `; operator broke stale claim (dead pid ${guard.brokeStale.pid})`;
  appendNote(root, id, { author: user, text: `human-approved: by ${user} via plumbing (C-12)${brokeNote}` });
  const updated = commitTransition(
    root,
    readTicket(root, id),
    humanApproved(`approved by ${user} via plumbing (C-12)${brokeNote}`),
    loadedConfig(root),
  );
  reopenGeneration(root, id);
  return { exitCode: PLUMBING_EXIT_OK, message: `${id}: NEEDS_HUMAN → APPROVED; the kernel re-verifies on the next run`, ticket: updated };
}

/**
 * `detent requeue <id> [--guidance]`: NEEDS_HUMAN|BLOCKED → READY, opening
 * generation N+1 with zeroed counters; generation N stays frozen with its
 * record (X-8/D-17). The guidance is recorded on the generation it opens.
 */
export function requeueTicket(
  root: string,
  id: string,
  user: string,
  guidance: string,
  deps: PlumbingDeps = {},
): PlumbingResult {
  const guard = guardClaim(root, id, deps);
  if (!guard.ok) return { exitCode: PLUMBING_EXIT_REFUSED, message: guard.refusal ?? "claimed" };

  const ticket = readTicket(root, id);
  if (ticket.state !== "NEEDS_HUMAN" && ticket.state !== "BLOCKED") {
    return {
      exitCode: PLUMBING_EXIT_REFUSED,
      message: `requeue is admissible only from NEEDS_HUMAN or BLOCKED; ${id} is ${ticket.state} (X-3 offers no such row)`,
    };
  }

  const brokeNote = guard.brokeStale === undefined ? "" : `; operator broke stale claim (dead pid ${guard.brokeStale.pid})`;
  appendNote(root, id, { author: user, text: `requeued with guidance (C-12): ${guidance}${brokeNote}` });
  const requeued = commitTransition(
    root,
    readTicket(root, id),
    humanRequeue(`requeue by ${user} via plumbing: ${guidance}${brokeNote}`),
    loadedConfig(root),
  );
  const generations = openGeneration(requeued, { at: new Date().toISOString(), reason: guidance });
  const updated = writeTicket(root, { ...requeued, generations });
  return {
    exitCode: PLUMBING_EXIT_OK,
    message: `${id}: → READY; generation ${generations.length - 1} opened with the guidance recorded (X-8)`,
    ticket: updated,
  };
}

/** An in-run approval reopens the closed generation for the re-verify. */
function reopenGeneration(root: string, id: string): void {
  const fresh = readTicket(root, id);
  const generation = currentGeneration(fresh);
  if (generation.ended_at === undefined) return;
  // exactOptionalTypes: rebuild without ended_at rather than destructuring
  // into an unused binding the lint rejects.
  const reopened = { ...generation, outcome: "in_flight" as const };
  delete (reopened as { ended_at?: string }).ended_at;
  writeTicket(root, {
    ...fresh,
    generations: [...fresh.generations.slice(0, -1), { ...reopened, outcome: "in_flight" }],
  });
}
