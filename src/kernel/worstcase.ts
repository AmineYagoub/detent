import { z } from "zod";
import { ROLE_IDS } from "../schemas/roles.js";
import { budgetsSchema, type Budgets } from "../schemas/budgets.js";
import { SCHEMA_VERSION, glob, nonEmptyString } from "../schemas/common.js";
import type { State } from "../schemas/states.js";
import type { Counters } from "../schemas/ticket.js";
import { apply, legalEvents, TABLE, TransitionError, type Row } from "./machine.js";

/**
 * T-014 — worst-case session count, computed and never quoted (X-1).
 *
 * The figure is derived from the transition table and the budgets, so a table
 * edit that adds a recovery path raises it automatically. The configured net
 * `sessions` must exceed it, and a configuration that violates that is rejected
 * at load — before any run, per R-9 — rather than discovered mid-ticket.
 */

/** States whose entry launches a session. Entering one costs one launch. */
const SESSION_ENTRY_STATES: ReadonlySet<State> = new Set<State>([
  "DIAGNOSED",
  "IN_PROGRESS",
  "BLIND_FIX",
  "RESEARCH",
  "INFORMED_FIX",
  "REVIEW_FIX",
  "IN_REVIEW",
]);

/**
 * A-5′ (PRDR-109): a review with no usable verdict is relaunched once by the
 * referee, outside the table. Every IN_REVIEW entry can therefore cost two
 * launches, and the worst case charges both so the net `sessions` ceiling
 * still bounds what one generation can spend.
 */
const REVIEW_RELAUNCH_ALLOWANCE = 1;

const zeroCounters: Counters = {
  blind_fix_attempts: 0,
  informed_fix_attempts: 0,
  review_fix_attempts: 0,
  research_sessions: 0,
  hypotheses: 0,
  sessions: 0,
};

/**
 * Canonical node key. Every counter is clamped to one past its ceiling, because
 * any value above the ceiling routes identically — that makes the reachable
 * node set finite for *any* table, so termination is a property of this walk
 * rather than of the table happening to be acyclic.
 */
function stateKey(state: State, c: Counters, budgets: Budgets): string {
  const cap = (v: number, ceiling: number) => Math.min(v, ceiling + 1);
  return [
    state,
    cap(c.blind_fix_attempts, budgets.blind_fix_attempts),
    cap(c.informed_fix_attempts, budgets.informed_fix_attempts),
    cap(c.review_fix_attempts, budgets.review_fix_attempts),
    cap(c.research_sessions, budgets.research_sessions),
    cap(c.hypotheses, budgets.hypotheses),
  ].join(":");
}

/**
 * A table whose reachable subgraph contains a cycle through a session-entry
 * state has no finite worst case: the ticket could launch sessions forever.
 * That is a table defect, and X-1's whole point is that it surfaces here rather
 * than as a runaway run — so it is reported, never silently truncated.
 */
export class UnboundedWorstCaseError extends Error {
  constructor(readonly cycle: readonly string[]) {
    super(
      `transition table admits an unbounded session count: the cycle ${cycle.join(" -> ")} ` +
        `re-enters a session-launching state without consuming a budget.`,
    );
    this.name = "UnboundedWorstCaseError";
  }
}

/**
 * Longest launch-count path through the machine, over all reachable
 * (state, counters) configurations. The counter tuple is bounded by the
 * budgets, so the graph is finite and the walk terminates; `seen` guards the
 * cycles the table legitimately contains (e.g. DIAGNOSED recycling).
 */
export function maxPossibleSessions(
  budgets: Budgets,
  opts: { readonly ticketType?: "feature" | "bug"; readonly table?: ReadonlyMap<string, Row> } = {},
): number {
  const ticketType = opts.ticketType ?? "bug";
  const table = opts.table ?? TABLE;
  const memo = new Map<string, number>();

  function walk(state: State, counters: Counters, onPath: ReadonlyMap<string, number>, depth: number): number {
    if (state === "DONE") return 0;
    const k = stateKey(state, counters, budgets);
    const seenAt = onPath.get(k);
    if (seenAt !== undefined) {
      /**
       * Revisiting a node with no launch in between is a benign no-op loop;
       * revisiting it *after* launching is an unbounded cycle.
       */
      if (depth > seenAt) throw new UnboundedWorstCaseError([...onPath.keys()].slice(seenAt).concat(k));
      return 0;
    }
    const cached = memo.get(k);
    if (cached !== undefined) return cached;

    const nextOnPath = new Map(onPath).set(k, depth);
    let best = 0;
    for (const event of legalEvents(state, table)) {
      /**
       * A human re-entry opens a new generation with zeroed counters (X-8);
       * the per-generation worst case does not traverse it.
       */
      if (event === "HUMAN_REQUEUE" || event === "HUMAN_APPROVED") continue;
      /** X-4′: a discovered dependency re-queues into a new generation the same way. */
      if (event === "DEPENDENCY_DISCOVERED") continue;
      /** PRDR-112: so does an outage re-queue. */
      if (event === "OUTAGE_REQUEUE") continue;
      /** BUDGET_BREACH and GATE_DRIFT are halts, never the worst path. */
      if (event === "BUDGET_BREACH" || event === "GATE_DRIFT") continue;
      let result;
      try {
        result = apply(state, event, counters, { ticket: { type: ticketType }, budgets }, table);
      } catch (err) {
        if (err instanceof TransitionError) continue;
        /* slot already consumed: this edge is unreachable here */
        continue;
      }
      const cost = SESSION_ENTRY_STATES.has(result.to) ? 1 + (result.to === "IN_REVIEW" ? REVIEW_RELAUNCH_ALLOWANCE : 0) : 0;
      best = Math.max(best, cost + walk(result.to, result.counters, nextOnPath, depth + cost));
    }
    memo.set(k, best);
    return best;
  }

  /* A run begins by claiming a READY ticket; the claim itself launches nothing. */
  return walk("READY", zeroCounters, new Map<string, number>(), 0);
}

const configSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  budgets: budgetsSchema,
  protected: z.array(glob).default([]),
  /**
   * C-2″ (PRDR-086): the documents THIS increment plans from. Empty means the
   * whole C-2 discovery, which is right for a product one plan can hold; a
   * large product plans slice by slice, and without this the next `--replan`
   * rediscovers everything and re-plans the entire thing.
   */
  plan_docs: z.array(glob).default([]),
  /** C-2‴ (PRDR-117): the production baseline SLICE plans against; "none" opts out, in writing. */
  plan_baseline: z.enum(["production", "none"]).default("production"),
  /**
   * C-2⁵′ (PRDR-125): how many tickets one slice should hold.
   *
   * A slice is drafted by ONE session into ONE artifact, so its size is the
   * size of the largest thing this pipeline ever has to produce without
   * failing. Measured on the first self-build gate: a 36-ticket slice emitted
   * 176,391 output tokens — about 4,900 per ticket, because a ticket now
   * carries its contracts and their notes — and that draft is where a session
   * limit killed the run. The old band's top was set before contracts existed.
   *
   * Smaller slices do not save money: the drafting is the same work, and the
   * review, revision and re-review around each slice are paid per slice. They
   * buy a failure you can afford — half the tokens, half the loss when a
   * session dies, which on a run that has died four times is worth more than
   * the overhead costs.
   */
  slice_size: z
    .strictObject({ min: z.number().int().positive(), max: z.number().int().positive() })
    .refine((v) => v.max >= v.min, "slice_size.max must be at least slice_size.min")
    .default({ min: 12, max: 18 }),
  risk: z.array(glob).default([]),
  /**
   * PRDR-142: the KEYS are roles. This accepted any string, and `roles.ts`
   * claims the typing makes a bad role "a compile error here, not a silent
   * runtime default" — true of `DEFAULT_MODEL_ROUTING`, false of the config a
   * human edits, which `cli/init.ts` explicitly invites them to edit. A typo
   * routed that role to the runtime default forever, at whatever the runtime
   * charges, with nothing printed and no `doctor` check.
   */
  model_routing: z
    .record(z.string(), nonEmptyString)
    .default({})
    .superRefine((routing, ctx) => {
      for (const key of Object.keys(routing)) {
        if (ROLE_IDS.includes(key as (typeof ROLE_IDS)[number])) continue;
        ctx.addIssue({
          code: "custom",
          message: `model_routing has no role \`${key}\` — expected one of ${ROLE_IDS.join(", ")}`,
        });
      }
    }),
  pinned: z.strictObject({
    agent_sdk: nonEmptyString,
    claude_code: nonEmptyString,
  }),
  /**
   * S-3′ (PRDR-121): optional symbol intelligence. Absent or disabled, every
   * stage runs unchanged. Detent never installs it — `enabled` with a command
   * it cannot run is a setup message, not an install (D-4/F-2).
   */
  symbols: z
    .strictObject({
      /**
       * S-3″ (PRDR-121): TRI-STATE on purpose — absent is NOT `false`.
       *
       * This defaulted to `false`, and the default made the reminder dead code
       * in every real project. `init` writes a config before it reads one, so
       * `symbols` always parsed to the default object, and the reminder — whose
       * whole contract is "a user who declined once is never asked again" —
       * read that default as an explicit decline. It could only ever fire when
       * the config was `undefined`, which the production path never produces,
       * and its test passed because that is the only case the test passed in.
       *
       * Undefined means nobody has said anything yet; `false` means a person
       * said no. Only the second one silences.
       */
      enabled: z.boolean().optional(),
      /**
       * S-3‴ (PRDR-123): a bare executable NAME, resolved on PATH — never a
       * path. `.detent/config.json` is repository content, and an unrestricted
       * string let a repo point the orchestrator at an executable it shipped
       * and have it run at the operator's privilege, before anything was
       * presented or approved. Constrained here, at load, rather than at the
       * call site, so no execution path can be reached with a value that never
       * should have parsed.
       */
      command: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "symbols.command is an executable name resolved on PATH, not a path — no `/`, `\\` or `..`")
        .default("serena"),
      pinned: nonEmptyString.default("0.1.4"),
    })
    .default({ command: "serena", pinned: "0.1.4" }),
  /**
   * S-1: sessions are constructed with no external setting sources. Recorded in
   * config so `doctor` can report it and a backend upgrade cannot silently
   * re-enable project-scope policy from the repository under work (PRDR-051).
   */
  setting_sources: z.array(z.never()).default([]),
});
type Config = z.infer<typeof configSchema>;

export class ConfigRejectedError extends Error {
  constructor(
    readonly net: number,
    readonly computed: number,
  ) {
    super(
      `config rejected: budgets.sessions is ${net}, but the worst path through the transition table needs ${computed}. ` +
        `The net session budget must exceed the computed worst case (X-1); raise sessions above ${computed}.`,
    );
    this.name = "ConfigRejectedError";
  }
}

export interface LoadedConfig {
  readonly config: Config;
  readonly computedWorstCase: number;
}

/**
 * R-9: parse, compute, assert, return. The CLI never sees an invalid config
 * object, so no caller can start a run against budgets that cannot complete.
 */
export function loadConfig(raw: unknown): LoadedConfig {
  const config = configSchema.parse(raw);
  const computed = maxPossibleSessions(config.budgets);
  if (config.budgets.sessions <= computed) {
    throw new ConfigRejectedError(config.budgets.sessions, computed);
  }
  return { config, computedWorstCase: computed };
}
