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

/** S-1: the read-only set runs `permissionMode: 'plan'`. */
export const READ_ONLY_ROLES: ReadonlySet<RoleId> = new Set<RoleId>([
  "planner",
  "diagnose",
  "research",
  "review",
]);

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
