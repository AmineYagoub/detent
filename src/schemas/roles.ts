import type { State } from "./states.js";

/**
 * S-1 role identifiers (D-9, S-7).
 *
 * A committed wire format: `agents/assignments.json` references `role@hash`,
 * so adding, removing, or renaming a role is a `schema_version` event under
 * F-3 with a migration — never an editorial change. A test pins these
 * strings for exactly that reason.
 *
 * `audit` (PRDR-281) is the first of S-1‴'s four roles, `spec_write`
 * (PRDR-282) the second, `spec_review` (PRDR-284) the third and
 * `plan_review` (PRDR-294) the fourth. All four join the 3.1.1 line's one
 * event (F-3″): the v1→v2 migration writes their routing into an existing
 * config.
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
  "audit",
  "spec_write",
  "spec_review",
  "plan_review",
] as const;

export type RoleId = (typeof ROLE_IDS)[number];

/**
 * C-4⁵ (PRDR-292): the planner's prompts, one per job, by the stage a session
 * is launched for. One `prompts/planner.md` served SLICE, PLAN and the review,
 * so an edit to one job's words re-cut the product and re-planned every slice.
 * The review's prompt is its role's own since C-4⁸ (PRDR-294).
 */
export const PLANNER_PROMPTS = { SLICE: "slice", PLAN: "plan" } as const;

/**
 * The vendored prompts, each `prompts/<id>.md` and pinned under its id in
 * `prompts/manifest.json` (S-7): every role's own, and the planner's jobs in
 * place of the planner's.
 */
export type PromptId = (typeof PLANNER_PROMPTS)[keyof typeof PLANNER_PROMPTS] | Exclude<RoleId, "planner">;

export const PROMPT_IDS: readonly PromptId[] = [
  ...Object.values(PLANNER_PROMPTS),
  ...ROLE_IDS.filter((r): r is Exclude<RoleId, "planner"> => r !== "planner"),
];

/**
 * The prompt a session reads: its role's own, or for a planner session the
 * one for the job its inputs name. A planner session naming no job is refused
 * rather than handed another job's words.
 */
export function promptOf(role: RoleId, stage: unknown): PromptId {
  if (role !== "planner") return role;
  if (typeof stage === "string" && Object.hasOwn(PLANNER_PROMPTS, stage)) return PLANNER_PROMPTS[stage as keyof typeof PLANNER_PROMPTS];
  throw new Error(`a planner session was launched for stage ${JSON.stringify(stage)}, and only SLICE and PLAN have a prompt (C-4⁵); the review runs on \`plan_review\` (C-4⁸)`);
}

/**
 * PRDR-197: the SDK's closed set, mirrored so a typo is refused at config load
 * rather than accepted and silently ignored.
 *
 * `xhigh` and `max` are not served by every model. The SDK downgrades silently
 * for a model that cannot serve one, which is why every session records both
 * the level it was routed to (`start.effort`, S-4‴) and the level it settled at
 * (`effort_settled`, S-4⁗): a kernel session notes its ticket when they
 * disagree, and an `init` session says so through init's note seam (S-4⁵).
 *
 * This sentence claimed the recording for every session from PRDR-197, which
 * shipped the routing alone; the routed half arrived at PRDR-235 and the
 * settled half at PRDR-237, for kernel sessions only, and `init`'s sessions,
 * the planner and the specification roles S-5⁵ puts at `max`, recorded neither
 * until PRDR-299. It described a mechanism that did not yet exist, and read as
 * finished throughout.
 */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/**
 * S-5⁸ (PRDR-328): why a run session ran at its level. `role` is its role's
 * configured level; `risk` the ticket's risk, which starts it at `max`;
 * `evidence` what the ticket's own attempts, or its neighbours' outcomes in the
 * run, have shown. Each session's `effort_settled` event and ledger row name it.
 */
export const EFFORT_REASONS = ["role", "risk", "evidence"] as const;

export type EffortReason = (typeof EFFORT_REASONS)[number];

/**
 * PRDR-114: the routing `init` writes. Judgement roles — the plan, the
 * verdicts, the hypothesis, the informed attempt — get the stronger model;
 * the volume roles get Sonnet. Typed over ROLE_IDS so a ninth role is a
 * compile error here, not a silent runtime default. A routed model the
 * runtime cannot serve falls back to the runtime default, noted per session.
 *
 * S-5⁶ (PRDR-319): every role on the newest models, the user's decision of
 * 2026-09-30, Opus 5.5 for judgement and Sonnet 5.5 for volume. Opus 5.5 costs
 * less than Opus 5 at every rate, and Sonnet 5.5 what Sonnet 5 does. A config
 * an earlier `init` wrote keeps its own routing (S-5′) and is told which of its
 * roles still name a model `SUPERSEDED_MODELS` lists.
 */
export const DEFAULT_MODEL_ROUTING: Readonly<Record<RoleId, string>> = {
  planner: "claude-opus-5-5",
  review: "claude-opus-5-5",
  diagnose: "claude-opus-5-5",
  informed_fix: "claude-opus-5-5",
  implement: "claude-sonnet-5-5",
  blind_fix: "claude-sonnet-5-5",
  review_fix: "claude-sonnet-5-5",
  research: "claude-sonnet-5-5",
  /** S-5⁵ (PRDR-278): every session of the specification phase runs on Opus 5.5 at `max` (specification decision 14). */
  audit: "claude-opus-5-5",
  spec_write: "claude-opus-5-5",
  spec_review: "claude-opus-5-5",
  /** C-4⁸ (PRDR-294): the planner's seat, so the review is never weaker than the drafts it judges (planning decision 9). */
  plan_review: "claude-opus-5-5",
};

/**
 * S-5⁶ (PRDR-319): the first runtime known to serve each model a default routes
 * to. A session is served by the Claude Code the SDK bundles (S-5‴), and a
 * runtime that does not know a model falls back to its own default (PRDR-114),
 * so `doctor` judges a routing against the bundled runtime, and `init` and
 * `run` say what it cannot serve before their first session.
 *
 * Read from the binaries: 2.1.280's names `claude-opus-5-5` and not
 * `claude-sonnet-5-5`, 2.1.281's does not name it either, and 2.1.284's and
 * 2.1.285's do. 2.1.282 and 2.1.283 were not read, so 2.1.284 is the first
 * FOUND to serve Sonnet 5.5, and a runtime between is judged not to: the side
 * that never passes a model a runtime might not know, and a runtime no pinned
 * Detent bundles. A model outside this table is not judged, since an operator
 * may route to any model.
 */
export const FIRST_RUNTIME_SERVING: Readonly<Record<string, string>> = {
  "claude-opus-5-5": "2.1.280",
  "claude-sonnet-5-5": "2.1.284",
};

/**
 * S-5⁶ (PRDR-319): the defaults S-5⁶ superseded, each with its successor. A
 * config cannot tell a chosen `claude-opus-5` from a defaulted one, so a role
 * routed to one is named with the line that moves it, and never rewritten.
 */
export const SUPERSEDED_MODELS: Readonly<Record<string, string>> = {
  "claude-opus-5": "claude-opus-5-5",
  "claude-sonnet-5": "claude-sonnet-5-5",
};

/** A table's entry for a model an operator named, which may be any string, `constructor` included. */
function entry(table: Readonly<Record<string, string>>, model: string): string | undefined {
  return Object.hasOwn(table, model) ? table[model] : undefined;
}

/** `2.1.285` as three numbers, or null for anything else. */
function versionParts(version: string): readonly [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version.trim());
  return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Whether `have` is `floor` or later, compared as numbers: 2.1.1000 is past 2.1.284. */
function atLeast(have: readonly [number, number, number], floor: readonly [number, number, number]): boolean {
  for (let i = 0; i < 3; i += 1) {
    if (have[i] !== floor[i]) return (have[i] ?? 0) > (floor[i] ?? 0);
  }
  return true;
}

export interface UnservedRoute {
  readonly role: string;
  readonly model: string;
  /** The first runtime `FIRST_RUNTIME_SERVING` names for the model. */
  readonly first: string;
}

/**
 * S-5⁶ (PRDR-319): each role routed to a model the table knows and `runtime`
 * predates, in the routing's order. Null when `runtime` is not a version:
 * nothing can be judged, and calling every model served, or none, would be a
 * guess.
 */
export function unservedRoutes(routing: Readonly<Record<string, string>>, runtime: string): readonly UnservedRoute[] | null {
  const have = versionParts(runtime);
  if (have === null) return null;
  const out: UnservedRoute[] = [];
  for (const [role, model] of Object.entries(routing)) {
    const first = entry(FIRST_RUNTIME_SERVING, model);
    const floor = first === undefined ? null : versionParts(first);
    if (first !== undefined && floor !== null && !atLeast(have, floor)) out.push({ role, model, first });
  }
  return out;
}

export interface SupersededRoute {
  readonly role: string;
  readonly model: string;
  readonly successor: string;
}

/** S-5⁶ (PRDR-319): each role routed to a superseded default, with its successor, in the routing's order. */
export function supersededRoutes(routing: Readonly<Record<string, string>>): readonly SupersededRoute[] {
  return Object.entries(routing).flatMap(([role, model]) => {
    const successor = entry(SUPERSEDED_MODELS, model);
    return successor === undefined ? [] : [{ role, model, successor }];
  });
}

/**
 * PRDR-263: the effort routing `init` writes, and the companion to the table
 * above — a level means nothing without the model that must serve it. The
 * planner drafts a whole product plan in one session and every later role is
 * measured against its output, so it runs at `max`; the rest run one step down.
 *
 * Typed over ROLE_IDS for the same reason as the models: a ninth role is a
 * compile error here, not a role that silently keeps the runtime default.
 *
 * Every pair these two tables produce is servable, so nothing here relies on
 * a downgrade. Up to 0.3.280 the SDK declared it in its types: `xhigh` for
 * Fable 5, Opus 4.7+ and Sonnet 5, `max` for Fable 5, Opus 4.6+ and Sonnet
 * 4.6+. 0.3.285's types no longer name models; the runtime reports each
 * model's levels through `supportedModels()`. Asked on 2026-09-30 (S-5⁶,
 * PRDR-319), 2.1.285 resolves its `opus` and `sonnet` rows to
 * `claude-opus-5-5` and `claude-sonnet-5-5` and lists every level from `low`
 * to `max` for both, and a live session on each at `xhigh` settled at
 * `xhigh`. Where a routed model cannot serve its level the SDK downgrades
 * SILENTLY, which is why PRDR-237 records what the turns settled at rather
 * than assuming.
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
  audit: "max",
  spec_write: "max",
  spec_review: "max",
  plan_review: "max",
};

/**
 * S-5⁷: the tasks of the roles that run more than one. A task's
 * effort can be routed apart from its role's under a `role/task` key of
 * `effort_routing`, so AUDIT's claim checks can move without its survey and
 * its triage. `run`'s roles run one task each, and S-5⁸ routes them.
 */
export const ROLE_TASKS: Readonly<Partial<Record<RoleId, readonly string[]>>> = {
  audit: ["survey", "triage", "verify_claims"],
  spec_write: ["decide", "write", "fix"],
  spec_review: ["review", "verify"],
};

/** S-5⁷: the `effort_routing` key of a role's task. */
export function taskKey(role: string, task: string): string {
  return `${role}/${task}`;
}

/** S-5⁷: every `role/task` key `effort_routing` accepts. */
export const TASK_KEYS: readonly string[] = Object.entries(ROLE_TASKS).flatMap(([role, tasks]) => (tasks ?? []).map((task) => taskKey(role, task)));

/** S-5⁷: the level a session of `role` doing `task` is routed to: its task's own, else its role's, else none. */
export function effortFor(routing: Readonly<Partial<Record<string, string>>>, role: string, task: string | undefined): string | undefined {
  return (task === undefined ? undefined : routing[taskKey(role, task)]) ?? routing[role];
}

/**
 * S-5⁷: the tasks whose level a passing measurement on N-8's sets moved apart
 * from their role's, each named with the measurement that moved it. A new
 * config is written with these beside the roles' levels.
 *
 * Empty: no task has moved. A task moves only to the cheapest arm that passed
 * D-35's bar, and an arm is held to that bar only where today's setup, re-run,
 * meets it too.
 */
export const DEFAULT_TASK_EFFORT_ROUTING: Readonly<Record<string, string>> = {};

/**
 * S-1's read-only set. Since S-1′ (PRDR-067) these roles run DEFAULT mode
 * with the read-only tool surface plus one scoped write rule for their own
 * artifact — plan mode blocks the write the A-contract demands and survives
 * only for artifact-less sessions (doctor's smoke).
 *
 * `spec_write` is not in it: S-1‴ gives it the pack's paths to write, the
 * decision log among them, for WRITE's and VALIDATE's tasks (PRDR-283,
 * PRDR-284). DECIDE's task writes its artifact alone, and code writes the log
 * from it. `spec_review` is in it: VALIDATE's reviewers read and write their
 * artifact alone in the repository. The scratch directory S-1‴ gives them for
 * a simulation lies outside it, and is written only by the scripts they run
 * there, sandboxed (S-1⁗, `SCRATCH_ROLES`). `plan_review` is in it: a plan's
 * review reads, and writes its verdict alone (C-4⁸, PRDR-294).
 */
export const READ_ONLY_ROLES: ReadonlySet<RoleId> = new Set<RoleId>([
  "planner",
  "diagnose",
  "research",
  "review",
  "audit",
  "spec_review",
  "plan_review",
]);

/**
 * S-1‴, S-1⁗ (PRDR-285): the roles whose sessions may be given a scratch
 * directory and the sandboxed tool that runs a script there. VALIDATE's
 * reviewers alone (specification decision 7): AUDIT, DECIDE and WRITE run
 * nothing, and no run-loop role is ever given it.
 */
export const SCRATCH_ROLES: ReadonlySet<RoleId> = new Set<RoleId>(["spec_review"]);

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
 * `planner`, `audit`, `spec_write`, `spec_review` and `plan_review` are
 * absent because they are init roles and never reach this policy;
 * `src/init/session.ts` builds their own surface.
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

/*
 * ---------------------------------------------------------------------------
 * Tool surfaces per role (S-3): the surface, never the containment.
 *
 * S-1⁵ (PRDR-302): here, with the roles, and not in `sessions/guard.ts`, so
 * that both drivers read one list. The kernel may not import the sessions
 * layer (ARCH-1), so it kept a copy it called advisory, of a set it said the
 * SDK backend composed; the backend applied the copy as given, and the copy
 * had lost S-3⁵'s `git rm`. The SDK backend gives each session the built-in
 * tools its allowlist names and no others (`builtinTools`).
 */

const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"] as const;
const WRITE_TOOLS = ["Read", "Grep", "Glob", "Edit", "Write"] as const;

/**
 * X-6/S-3: research adds WebSearch plus a domain-scoped WebFetch rule per
 * configured docs domain. The `WebFetch(domain:…)` specifier form is composed
 * here and VERIFIED against the pinned backend by `doctor` (T-050) — an
 * unrecognized form must fail loudly there, never no-op silently (PRDR-050).
 * The domains parameter has no config home yet — that gap is PRDR-062.
 */
export function researchTools(docsDomains: readonly string[]): string[] {
  return [...READ_ONLY_TOOLS, "WebSearch", ...docsDomains.map((d) => `WebFetch(domain:${d})`)];
}

/**
 * S-1‴ (PRDR-281): `audit` reads the repository, dependency sources at their
 * pinned versions included, and reaches the web under the research role's
 * network rules, so it gets the research role's surface.
 *
 * S-1‴ (PRDR-282, PRDR-283, PRDR-284): `spec_write` is not a read-only role,
 * but what it writes is its task's, so the role's tools are the read tools.
 * DECIDE's task writes its artifact alone, with the one artifact rule every
 * init session carries. WRITE's and VALIDATE's fixes declare the pack's paths
 * as their surface and get Edit and Write for them, which the hook confines
 * (`InitSessionRequest`'s `surface`). `archive/` is in neither: code moves the
 * originals (C-2¹³). `spec_review`, VALIDATE's reviewers, is read-only: the
 * role's tools are the read tools, and a reviewer whose round has a sandbox is
 * given the scratch tool per session, never per role (`InitSessionRequest`'s
 * `scratch`, S-1⁗), since a machine with no sandbox gives it none.
 */
export function toolsForRole(role: string, docsDomains: readonly string[] = []): string[] {
  if (role === "research" || role === "audit") return researchTools(docsDomains);
  if ((READ_ONLY_ROLES as ReadonlySet<string>).has(role) || role === "spec_write") return [...READ_ONLY_TOOLS];
  /* S-3⁵ (PRDR-213): three verbs — the guard judges `git rm` per pathspec (judgeGitRm). */
  return [...WRITE_TOOLS, "Bash(git add:*)", "Bash(git rm:*)", "Bash(git commit:*)"];
}
