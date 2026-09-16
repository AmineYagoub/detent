import { Breach } from "./referee-context.js";
import { readClaim } from "./tickets/mutations.js";

/**
 * X-1 (PRDR-246) — the ticket wall clock, in ONE place, for every arm that
 * starts work on a claimed ticket.
 *
 * X-1⁗ (PRDR-140) moved this ceiling off the headless loop and onto the launch
 * seam so both drivers would inherit it: `skills/run/SKILL.md`, the program the
 * model-driven driver executes, has no time check of its own. That covered
 * launches and nothing else. `RefereeGate.evaluate` — the `gate` tool — runs the
 * bound commands and mints a ref, and consulted no clock, so a ticket could be
 * evaluated past its ceiling, close-check included. The headless driver hid it
 * by keeping its own loop-level check, which is exactly the one-driver
 * asymmetry X-1⁗ was written to remove.
 *
 * Its own module because both callers already sit at their line ceiling and this
 * is one self-contained fact about a claimed ticket — the same reason the effort,
 * stage and sweep arms live beside `referee-session.ts` rather than inside it.
 */

export interface WallClockContext {
  readonly root: string;
  readonly budgets: { readonly ticket_wall_clock_ms: number };
  readonly iso: () => string;
}

/**
 * The basis is the CLAIM's timestamp, never the generation's `started_at`: that
 * would date from a requeue which may be days old, and a ticket planned last
 * week must not breach the moment it is first claimed (X-1⁗).
 *
 * An unclaimed ticket is not this check's business — the claim is what starts
 * the clock — and an unparseable timestamp yields a non-finite elapsed, which
 * is allowed through rather than read as infinitely old. Both are the harmless
 * direction: this refuses work, so guessing would refuse real work.
 */
export function assertTicketWallClock(ctx: WallClockContext, id: string): void {
  const claimedAt = readClaim(ctx.root, id)?.at;
  if (claimedAt === undefined) return;
  const elapsed = Date.parse(ctx.iso()) - Date.parse(claimedAt);
  if (!Number.isFinite(elapsed) || elapsed <= ctx.budgets.ticket_wall_clock_ms) return;
  throw new Breach(
    `ticket wall clock ceiling (X-1): ${Math.round(elapsed / 1000)}s since the claim exceeds ` +
      `${Math.round(ctx.budgets.ticket_wall_clock_ms / 1000)}s`,
  );
}
