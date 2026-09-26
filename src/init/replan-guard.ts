import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { readCheckpoint } from "../fs/checkpoints.js";
import { isClaimed, readTicket } from "../kernel/tickets/readers.js";
import { ticketsDir } from "../kernel/tickets/paths.js";
import { INIT_PHASES, type InitPhase } from "../schemas/init.js";
import type { InitResult, PhaseHandler } from "./machine.js";

/**
 * C-8″ (PRDR-085, PRDR-118) — `init` does not re-plan while a ticket is in
 * flight. Re-deriving under a ticket that is mid-ladder or claimed pulls the
 * ground out from a running session: `writePlan` resets every drafted ticket
 * to READY with fresh counters and deletes the ones the new plan does not name.
 *
 * The driver asks twice. Before any phase runs, a scan of the digests predicts
 * whether PLAN would re-execute, so the refusal comes before any model spend.
 * Then, as each phase on the chain up to PLAN is about to run, it asks again
 * (PRDR-282): a standalone phase runs before the planning phases and can
 * change what they read, as DECIDE does when it writes the decision log, and
 * the scan could not see that coming.
 */

/**
 * PRDR-085: tickets a replan must not pull the ground out from under. Read
 * defensively — an unparseable ticket file is a problem, but it is not
 * evidence of a live session, and this guard must not be the thing that
 * crashes on it.
 */
export function inFlightTickets(root: string): string[] {
  const dir = ticketsDir(root);
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json") || file === "plan.json" || file === "approval.json") continue;
    const id = file.slice(0, -".json".length);
    if (isClaimed(root, id)) {
      found.push(`${id} (claimed)`);
      continue;
    }
    try {
      const state = readTicket(root, id).state;
      if (state !== "DONE" && state !== "READY") found.push(`${id} (${state})`);
    } catch {
      /* unparseable: surfaced by the phases that actually consume it */
    }
  }
  return found;
}

/** Whether a phase on the chain re-plans by running: PLAN, and every phase whose re-run replays into it. */
export function replansAt(phase: InitPhase): boolean {
  return INIT_PHASES.indexOf(phase) <= INIT_PHASES.indexOf("PLAN");
}

/**
 * Whether PLAN would re-execute on this invocation — i.e. whether some phase
 * at or before it has drifted. Digests are pure reads, so this costs nothing
 * and spends nothing; it is the same walk the driver does below, stopped at
 * the first miss.
 */
export function wouldReplan(root: string, handlers: readonly PhaseHandler[], now: () => number): boolean {
  let carried = "";
  const outputs: Record<string, Record<string, unknown>> = {};
  for (const phase of INIT_PHASES) {
    const handler = handlers.find((h) => h.phase === phase);
    if (handler === undefined) continue;
    /* C-2¹¹: a standalone phase re-runs no other, PLAN included, whatever its own checkpoint says. */
    if (handler.standalone === true) continue;
    let hash: string;
    try {
      hash = createHash("sha256").update(`${carried}\0${phase}\0${handler.digest({ root, outputs, now })}`).digest("hex");
    } catch {
      /* A digest that cannot be computed is drift by definition. */
      return true;
    }
    carried = hash;
    const read = readCheckpoint(root, phase, hash);
    if (read.status !== "fresh") return true;
    if (handler.outputIntact?.({ root, outputs, now }) === false) return true;
    outputs[phase] = { ...read.checkpoint.outputs };
    if (phase === "PLAN") return false;
  }
  return false;
}

/** What the run did before the refusal: nothing, at the first ask; at the second, what ran and what was reused. */
export type Progress = Pick<InitResult, "reachedPhase" | "replayedFrom" | "executed" | "reused" | "outputs">;

const NOTHING: Progress = { reachedPhase: "PLAN", replayedFrom: null, executed: [], reused: [], outputs: {} };

/** The refusal, at either ask, with what ran before it; nothing after it runs. */
export function replanRefusal(inFlight: readonly string[], replan: boolean, so: Progress = NOTHING): InitResult {
  return {
    exitCode: 2,
    ...so,
    messages: [
      `${replan ? "--replan" : "re-planning"} refused: ${inFlight.join(", ")} still in flight. ` +
        "Let the run finish or resolve them (detent status), then plan again.",
    ],
  };
}
