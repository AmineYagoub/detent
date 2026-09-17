import type { State } from "./states.js";

/**
 * S-1 role identifiers (D-9, S-7).
 *
 * A committed wire format: `agents/assignments.json` references `role@hash`,
 * so adding, removing, or renaming a role is a `schema_version` event under
 * F-3 with a migration — never an editorial change. A test pins these eight
 * strings for exactly that reason.
 *
 * `blind_fix` is the draft.5 rename of the oracle's `fix` (PRDR-044): the
 * role's defining property is that it acts on the failure output alone, and
 * the name should say so.
 */
export const ROLE_IDS = [
  "planner",
  "diagnose",
  "implement",
  "blind_fix",
  "informed_fix",
  "review_fix",
  "research",
  "review",
] as const;

export type RoleId = (typeof ROLE_IDS)[number];

/**
 * PRDR-197: the SDK's closed set, mirrored so a typo is refused at config load
 * rather than accepted and silently ignored.
 *
 * `xhigh` and `max` are not served by every model. The SDK downgrades silently
 * for a model that cannot serve one, which is why a KERNEL-launched session
 * records both the level it was routed to (`start.effort`, S-4‴) and the level
 * it settled at (`effort_settled`, S-4⁗). Init sessions are routed a level and
 * record neither — ARCH-2 parity is owed there and is not paid.
 *
 * This sentence claimed the recording for every session from PRDR-197, which
 * shipped the routing alone; the routed half arrived at PRDR-235 and the
 * settled half at PRDR-237. It described a mechanism that did not yet exist,
 * and read as finished throughout.
 */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/**
 * PRDR-114: the routing `init` writes. Judgement roles — the plan, the
 * verdicts, the hypothesis, the informed attempt — get the stronger models;
 * the volume roles get Sonnet. Typed over ROLE_IDS so a ninth role is a
 * compile error here, not a silent runtime default. A routed model the
 * runtime cannot serve falls back to the runtime default, noted per session.
 */
export const DEFAULT_MODEL_ROUTING: Readonly<Record<RoleId, string>> = {
  planner: "claude-opus-5",
  review: "claude-opus-5",
  diagnose: "claude-opus-5",
  informed_fix: "claude-opus-5",
  implement: "claude-sonnet-5",
  blind_fix: "claude-sonnet-5",
  review_fix: "claude-sonnet-5",
  research: "claude-sonnet-5",
};

/**
 * PRDR-263: the effort routing `init` writes, and the companion to the table
 * above — a level means nothing without the model that must serve it. The
 * planner drafts a whole product plan in one session and every later role is
 * measured against its output, so it runs at `max`; the rest run one step down.
 *
 * Typed over ROLE_IDS for the same reason as the models: a ninth role is a
 * compile error here, not a role that silently keeps the runtime default.
 *
 * Every pair these two tables produce is servable, per the SDK's own
 * declaration — `xhigh` is Fable 5 / Opus 4.7+ / Sonnet 5, `max` is Fable 5 /
 * Opus 4.6+ / Sonnet 4.6+ — so nothing here relies on a downgrade. Where a
 * routed model cannot serve its level the SDK downgrades SILENTLY, which is
 * why PRDR-237 records what the turns settled at rather than assuming.
 */
export const DEFAULT_EFFORT_ROUTING: Readonly<Record<RoleId, string>> = {
  planner: "max",
  review: "xhigh",
  diagnose: "xhigh",
  informed_fix: "xhigh",
  implement: "xhigh",
  blind_fix: "xhigh",
  review_fix: "xhigh",
  research: "xhigh",
};

/**
 * S-1's read-only set. Since S-1′ (PRDR-067) these roles run DEFAULT mode
 * with the read-only tool surface plus one scoped write rule for their own
 * artifact — plan mode blocks the write the A-contract demands and survives
 * only for artifact-less sessions (doctor's smoke).
 */
export const READ_ONLY_ROLES: ReadonlySet<RoleId> = new Set<RoleId>([
  "planner",
  "diagnose",
  "research",
  "review",
]);

/**
 * S-1′ (PRDR-178) — the read-only roles whose write surface is their ARTIFACT
 * ALONE, which is not all of them.
 *
 * `prompts/diagnose.md` grants, in its first sentence: "you may write ONLY your
 * artifact **and a reproduction test inside the ticket surface**". PRDR-170
 * narrowed every read-only role to `.detent/runs/**` and so denied the write
 * that vendored, hash-pinned prompt promises — its own ticket claiming it "does
 * not change what a read-only role WRITES", which was false for `diagnose`.
 * `review` and `research` grant only their artifact, and are narrowed.
 *
 * `planner` is absent because it is an init role and never reaches this policy;
 * `src/init/session.ts` builds its own artifact-only surface.
 */
export const ARTIFACT_ONLY_ROLES: ReadonlySet<RoleId> = new Set<RoleId>(["research", "review"]);

/**
 * S-1's role ↔ state mapping. Role identifiers are not derived from state
 * names; this table is the mapping, and `planner` deliberately has no row —
 * it belongs to the init pipeline, which has no execution state.
 */
export const ROLE_FOR_STATE = {
  DIAGNOSED: "diagnose",
  IN_PROGRESS: "implement",
  BLIND_FIX: "blind_fix",
  INFORMED_FIX: "informed_fix",
  REVIEW_FIX: "review_fix",
  RESEARCH: "research",
  IN_REVIEW: "review",
} as const satisfies Partial<Record<State, RoleId>>;

export type SessionState = keyof typeof ROLE_FOR_STATE;

export function roleForState(state: SessionState): RoleId {
  return ROLE_FOR_STATE[state];
}
