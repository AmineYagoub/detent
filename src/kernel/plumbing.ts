import { existsSync, readFileSync, readdirSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import type { Ticket } from "../schemas/ticket.js";
import { humanApproved, humanRequeue, type KernelEvent } from "./events.js";
import { currentCounters, currentGeneration, openGeneration, withCurrentCounters } from "./generations.js";
import { RunJournal } from "./journal.js";
import { apply } from "./machine.js";
import { allTickets, readTicket, isClaimed } from "./tickets/readers.js";
import { claimsDir } from "./tickets/paths.js";
import { claimBreakable, readClaim, release, writeTicket, appendNote } from "./tickets/mutations.js";
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

const PLUMBING_EXIT_OK = 0;
const PLUMBING_EXIT_REFUSED = 2;

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
  /** An unreadable claim file is held-by-someone until proven stale (R-3). */
  if (info === null) return { ok: false, refusal: `ticket ${id} is claimed (claim unreadable — treat as held)` };
  if (!claimBreakable(info, alive, hostname())) {
    if (info.host !== undefined && info.host !== hostname()) {
      return { ok: false, refusal: `ticket ${id} is claimed on another host (${info.host}) — pid liveness cannot be checked from here (PRDR-079)` };
    }
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

/**
 * `detent unclaim <id>` / `--stale` (C-12, PRDR-078): the explicit
 * lock-release verb for claims whose owner died in a state approve/requeue
 * cannot legally touch — an in-flight resume blocked by a crashed run's
 * claim was the live runs' recurring hand surgery. Releasing a lock is not
 * an X-3 move: no transition happens, and the break is recorded as a ticket
 * note. The C-12 guard decides exactly as it does for the other verbs: a
 * live owner refuses naming the pid and claim age; an unreadable claim
 * stays held-by-someone (R-3).
 */
export function unclaimTicket(root: string, id: string, user: string, deps: PlumbingDeps = {}): PlumbingResult {
  if (!isClaimed(root, id)) return { exitCode: PLUMBING_EXIT_OK, message: `${id}: no claim to release` };
  const guard = guardClaim(root, id, deps);
  if (!guard.ok) return { exitCode: PLUMBING_EXIT_REFUSED, message: guard.refusal ?? `ticket ${id} is claimed` };
  if (guard.brokeStale !== undefined) {
    try {
      appendNote(root, id, { author: user, text: `claim released: owner pid ${guard.brokeStale.pid} dead (unclaim, C-12)` });
    } catch {
      /* A claim for a ticket the plan no longer carries: the release stands. */
    }
    return { exitCode: PLUMBING_EXIT_OK, message: `${id}: released stale claim (owner pid ${guard.brokeStale.pid} dead)` };
  }
  return { exitCode: PLUMBING_EXIT_OK, message: `${id}: no claim to release` };
}

/** The post-crash sweep: releases every claim with a verifiably dead owner, reports the rest. */
export function sweepStaleClaims(root: string, user: string, deps: PlumbingDeps = {}): PlumbingResult {
  const dir = claimsDir(root);
  if (!existsSync(dir)) return { exitCode: PLUMBING_EXIT_OK, message: "no claims held" };
  const ids = readdirSync(dir)
    .filter((f) => f.endsWith(".claim"))
    .map((f) => f.slice(0, -".claim".length));
  if (ids.length === 0) return { exitCode: PLUMBING_EXIT_OK, message: "no claims held" };
  const lines = ids.map((id) => unclaimTicket(root, id, user, deps).message);
  return { exitCode: PLUMBING_EXIT_OK, message: lines.join("\n") };
}

/**
 * PRDR-079 (C-9): release every RESUMABLE-state ticket's claim whose holder
 * is verifiably dead — readable claim, this host, pid not alive — recording
 * each break as a kernel note. The pool calls this before listing, so D-30's
 * crash-resume sentence holds without operator surgery; anything less
 * certain stands, preserving the oracle's never-spin rule.
 */
export function healStaleClaims(root: string, resumable: readonly string[], isAlive: (pid: number) => boolean): void {
  for (const ticket of allTickets(root)) {
    if (!resumable.includes(ticket.state) || !isClaimed(root, ticket.id)) continue;
    const info = readClaim(root, ticket.id);
    if (info === null) continue;
    if (!claimBreakable(info, isAlive, hostname())) continue;
    release(root, ticket.id);
    appendNote(root, ticket.id, {
      author: "kernel",
      text: `stale claim released at resume: owner ${info.owner} pid ${info.pid} dead (C-9, PRDR-079)`,
    });
  }
}

/** An in-run approval reopens the closed generation for the re-verify. */
function reopenGeneration(root: string, id: string): void {
  const fresh = readTicket(root, id);
  const generation = currentGeneration(fresh);
  if (generation.ended_at === undefined) return;
  /**
   * exactOptionalTypes: rebuild without ended_at rather than destructuring
   * into an unused binding the lint rejects.
   */
  const reopened = { ...generation, outcome: "in_flight" as const };
  delete (reopened as { ended_at?: string }).ended_at;
  writeTicket(root, {
    ...fresh,
    generations: [...fresh.generations.slice(0, -1), { ...reopened, outcome: "in_flight" }],
  });
}
