import picomatch from "picomatch";
import { EFFORT_LEVELS, type EffortReason, type RoleId } from "../schemas/roles.js";
import type { LedgerRow, TransitionLine } from "../schemas/records.js";
import type { Ticket } from "../schemas/ticket.js";
import { ticketOutcomes } from "./outcomes.js";
import { readTransitions } from "./plan-quality.js";
import { allTickets } from "./tickets/readers.js";

/**
 * S-5⁸ (PRDR-328) — how hard a run session works.
 *
 * S-5⁵ gives each role one level, whatever the ticket. Here the ticket's risk
 * sets where its sessions start, and evidence from the run moves them, only up:
 *
 * - A high-risk ticket, one the plan labelled or whose surface meets a glob of
 *   the config's `risk` list, runs its implement, fix and review sessions at
 *   `max`.
 * - A ticket whose surface meets one where an earlier ticket of this run
 *   escalated to a human or was falsified runs those sessions one level above
 *   its roles'.
 * - Each failed attempt, a red gate, a falsified premise or a review asking for
 *   changes, raises the ticket's later implement and fix sessions one level, up
 *   to `max`. The code-writing roles start from one level, so each attempt runs
 *   one level above the last, as far as `max`.
 *
 * Nothing here routes a session below its role's configured level. A lower
 * start for a low-risk ticket waits for D-33's outcomes from measured runs, and
 * is not built. A role routed to no level is raised by risk, to `max`, and not
 * by a step: one level above the SDK's own default is not a level Detent can
 * name.
 */

const CODE_ROLES: ReadonlySet<string> = new Set(["implement", "blind_fix", "informed_fix", "review_fix"]);

/** The sessions a ticket's risk and its neighbours' outcomes raise: those that write its code, and its review. */
const TICKET_ROLES: ReadonlySet<string> = new Set([...CODE_ROLES, "review"]);

/** What an attempt that did not hold leaves in `transitions.jsonl`, said as the ticket's note says it. */
const FAILED: Readonly<Record<string, string>> = {
  GATE_RED: "a red gate",
  PREMISE_FALSIFIED: "a falsified premise",
  REVIEW_CHANGES: "a review asking for changes",
};

export interface EffortRoute {
  /** A level, or `default` for a role routed to none and not raised. */
  readonly level: string;
  readonly reason: EffortReason;
  /** What raised the level, for the ticket's note; absent at the role's own level. */
  readonly because?: string;
}

export interface EffortEvidence {
  readonly role: string;
  /** The role's configured level; undefined where the config routes it to none. */
  readonly base: string | undefined;
  readonly risky: boolean;
  /** The ticket's failed attempts, oldest first, each said as `FAILED` says it. */
  readonly failures: readonly string[];
  /** This run's tickets whose surface meets this one's and that escalated or were falsified, each named with what happened. */
  readonly troubled: readonly string[];
}

const rank = (level: string): number => (EFFORT_LEVELS as readonly string[]).indexOf(level);

/** `level` raised `n` steps, as far as `max`; a level outside the closed set is not raised. */
function stepped(level: string, n: number): string {
  const i = rank(level);
  return i < 0 ? level : (EFFORT_LEVELS[Math.min(EFFORT_LEVELS.length - 1, i + n)] ?? level);
}

const times = (n: number): string => (n === 1 ? "once" : n === 2 ? "twice" : `${String(n)} times`);

export function routeEffort(e: EffortEvidence): EffortRoute {
  let route: EffortRoute = { level: e.base ?? "default", reason: "role" };
  const raise = (level: string, reason: EffortReason, because: string): void => {
    if (rank(level) > rank(route.level)) route = { level, reason, because };
  };
  if (TICKET_ROLES.has(e.role) && e.risky) raise("max", "risk", "the ticket is high-risk");
  if (TICKET_ROLES.has(e.role) && e.troubled.length > 0) raise(stepped(route.level, 1), "evidence", `its surface meets that of ${e.troubled.join(", and of ")}`);
  if (CODE_ROLES.has(e.role) && e.failures.length > 0) {
    raise(stepped(route.level, e.failures.length), "evidence", `its attempts have failed ${times(e.failures.length)}: ${e.failures.join(", ")}`);
  }
  return route;
}

/**
 * Whether two surfaces meet: an entry of one, read as a path, matches a glob of
 * the other, either way round. A surface is a list of globs (B-1), so `src/**`
 * meets `src/auth/login.ts`, and `src/auth/**` meets `src/**`.
 */
export function surfacesMeet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  return a.some((p) => picomatch.isMatch(p, [...b], { dot: true })) || b.some((p) => picomatch.isMatch(p, [...a], { dot: true }));
}

export interface EffortFacts {
  readonly role: string;
  readonly base: string | undefined;
  readonly ticket: Ticket;
  readonly riskGlobs: readonly string[];
  /** Every line of `transitions.jsonl`. */
  readonly lines: readonly TransitionLine[];
  /** When this run began: an earlier ticket's outcome counts from here. */
  readonly runSince: number;
  readonly tickets: readonly Ticket[];
}

/** The evidence for one session, from the ticket, the config's risk globs and what `run` recorded. */
export function effortEvidence(f: EffortFacts): EffortEvidence {
  const failures = f.lines.flatMap((l) => (l.ticket === f.ticket.id && Object.hasOwn(FAILED, l.event) ? [FAILED[l.event] ?? l.event] : []));
  const inRun = f.lines.filter((l) => Date.parse(l.at) >= f.runSince);
  const near = f.tickets.filter((t) => t.id !== f.ticket.id && surfacesMeet(t.surface, f.ticket.surface));
  const troubled = ticketOutcomes(near.map((t) => t.id), inRun, []).flatMap((o) => {
    if (o.escalations > 0) return [`${o.ticket}, which escalated to a human`];
    return o.falsified.premise > 0 ? [`${o.ticket}, which was falsified`] : [];
  });
  return {
    role: f.role,
    base: f.base,
    risky: f.ticket.risk_label || surfacesMeet(f.ticket.surface, f.riskGlobs),
    failures,
    troubled,
  };
}

/** What `effortRouteFor` reads of the referee: the config's routing and risk globs, the root, and when the run began. */
export interface EffortContext {
  readonly root: string;
  readonly loaded: { readonly config: { readonly effort_routing: Readonly<Partial<Record<string, string>>>; readonly risk: readonly string[] } };
  readonly startedAt: number;
}

/** The level a session of `role` on `ticket` runs at, and why, from what is on disk now. */
export function effortRouteFor(ctx: EffortContext, ticket: Ticket, role: RoleId): EffortRoute {
  return routeEffort(
    effortEvidence({
      role,
      base: ctx.loaded.config.effort_routing[role],
      ticket,
      riskGlobs: ctx.loaded.config.risk,
      lines: readTransitions(ctx.root).lines,
      runSince: ctx.startedAt,
      tickets: allTickets(ctx.root),
    }),
  );
}

/** The ticket's note for a session evidence raised (S-5⁸): its role, its level, its role's level, and why. */
export function effortStepNote(role: string, base: string | undefined, route: EffortRoute): string | null {
  if (route.reason !== "evidence" || route.because === undefined) return null;
  return `effort raised (S-5⁸): ${role} runs at ${route.level}, above its role's ${base ?? "default"}, because ${route.because}`;
}

export interface EffortTally {
  readonly sessions: number;
  readonly cost_usd: number;
}

/**
 * A run's sessions and their cost, by why each ran at its level. A row that
 * names no reason, an `init` session's or one written before S-5⁸, is not
 * counted.
 */
export function effortTally(rows: readonly LedgerRow[]): ReadonlyMap<EffortReason, EffortTally> {
  const out = new Map<EffortReason, EffortTally>();
  for (const row of rows) {
    if (row.effort_reason === undefined) continue;
    const was = out.get(row.effort_reason) ?? { sessions: 0, cost_usd: 0 };
    out.set(row.effort_reason, { sessions: was.sessions + 1, cost_usd: was.cost_usd + row.cost_estimate_usd });
  }
  return out;
}
