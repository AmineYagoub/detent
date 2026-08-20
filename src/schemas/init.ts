import { z } from "zod";
import { SCHEMA_VERSION, nonEmptyString, sha256Hex } from "./common.js";

/**
 * The `init` vocabulary (C-4.1, C-5).
 *
 * Phases and interrupts live in `schemas/` for the same reason execution
 * states do: they are persisted. Every checkpoint under `.detent/state/` is
 * keyed by a phase name, and an interrupt is what a resumed `init` reports.
 */

/** C-4.1's pipeline, in order. Bracketed interrupts fire between phases. */
export const INIT_PHASES = [
  "INIT_FS",
  "DISCOVER",
  "ANALYZE",
  "DETERMINE_VERIFICATION",
  "PLAN",
  "PREPARE_AGENTS",
  "PRESENT",
] as const;

export type InitPhase = (typeof INIT_PHASES)[number];

/**
 * C-5: the interrupt set is **closed**. Adding one is a spec change — a
 * major-version decision under C-14, not an editorial one. The type is the
 * first enforcement; `tests/init/interrupts.test.ts` is the second, scanning
 * for any prompt raised outside this set.
 */
export const INTERRUPTS = [
  "AWAIT_DOCS",
  "AWAIT_INFO",
  "AWAIT_BINDING_CHOICE",
  "AWAIT_SETUP_CONSENT",
  "AWAIT_APPROVAL",
] as const;

export type Interrupt = (typeof INTERRUPTS)[number];

/** Which phase may raise which interrupt (C-4.1's bracketed positions). */
export const INTERRUPT_PHASE = {
  AWAIT_DOCS: "DISCOVER",
  AWAIT_INFO: "ANALYZE",
  AWAIT_BINDING_CHOICE: "DETERMINE_VERIFICATION",
  AWAIT_SETUP_CONSENT: "DETERMINE_VERIFICATION",
  AWAIT_APPROVAL: "PRESENT",
} as const satisfies Record<Interrupt, InitPhase>;

/*
 * ---------------------------------------------------------------------------
 * ANALYZE's artifact (C-3)
 */

/**
 * What ANALYZE produces. In greenfield the chosen `stack` is an ANALYZE
 * output, which is precisely why D-10 puts analysis before verification
 * determination — there is nothing to bind against until the stack exists.
 */
export const analysisSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  summary: nonEmptyString,
  /** `null` in brownfield: the stack is discovered, not chosen. */
  stack: z
    .strictObject({
      language: nonEmptyString,
      runtime: z.string().default(""),
      test_framework: z.string().default(""),
      rationale: z.string().default(""),
    })
    .nullable(),
  /** C-3: un-implementable specs become a BATCH of questions, never a drip. */
  questions: z
    .array(
      z.strictObject({
        id: nonEmptyString,
        question: nonEmptyString,
        /** Blocking questions must be answered before PLAN may proceed. */
        blocking: z.boolean().default(true),
      }),
    )
    .default([]),
  assumptions: z.array(z.strictObject({ claim: nonEmptyString, evidence: z.string().default("") })).default([]),
  /** Repo-relative POSIX paths ANALYZE actually read. */
  docs_read: z.array(nonEmptyString).default([]),
});
export type Analysis = z.infer<typeof analysisSchema>;

/*
 * ---------------------------------------------------------------------------
 * C-3a planning briefs (A-4's second kind)
 */

/**
 * A-4: "Planning briefs share the evidence and hierarchy fields, keyed by
 * question hash." Same X-6a discipline as a failure brief — a brief citing a
 * URL must record the local search that preceded it — but keyed by the
 * question rather than by a failure signature.
 */
export const planningBriefSchema = z
  .strictObject({
    schema_version: z.literal(SCHEMA_VERSION),
    question: nonEmptyString,
    question_hash: sha256Hex,
    answer: z.strictObject({ claim: nonEmptyString, confidence: z.enum(["low", "medium", "high"]) }),
    evidence: z.array(z.strictObject({ source: nonEmptyString, claim: nonEmptyString })).min(1),
    sources_consulted: z
      .array(z.strictObject({ tier: z.number().int().min(1).max(6), ref: nonEmptyString }))
      .default([]),
    local_search: z.strictObject({
      docs_checked: z.array(z.string()).default([]),
      code_checked: z.array(z.string()).default([]),
    }),
    what_would_falsify: z.string().default(""),
  })
  .superRefine(requireLocalSearchBeforeWeb);
export type PlanningBrief = z.infer<typeof planningBriefSchema>;

/**
 * X-6a's mechanical check, shared by both research kinds: a brief citing any
 * URL must include a non-empty `local_search` record (tiers 1–2 consulted).
 * One function, so the two brief schemas cannot drift apart.
 */
export function requireLocalSearchBeforeWeb(
  brief: {
    readonly evidence: readonly { readonly source: string }[];
    readonly local_search: { readonly docs_checked: readonly string[]; readonly code_checked: readonly string[] };
  },
  ctx: z.RefinementCtx,
): void {
  const citesUrl = brief.evidence.some((e) => /^https?:\/\//i.test(e.source));
  const searchedLocally = brief.local_search.docs_checked.length > 0 || brief.local_search.code_checked.length > 0;
  if (citesUrl && !searchedLocally) {
    ctx.addIssue({
      code: "custom",
      path: ["local_search"],
      message: "X-6a: a brief citing a URL must record a non-empty local_search (tiers 1-2 consulted first)",
    });
  }
}

/*
 * ---------------------------------------------------------------------------
 * PLAN's session output (C-4)
 */

/**
 * What the PLAN session emits: ticket drafts, before Detent turns them into
 * A-1 tickets. The bootstrap ticket is NOT drafted here — C-4 makes it
 * Detent's own construction, so a planner cannot forget it, misname it, or
 * write one whose criteria do not actually prove the gates green.
 */
export const planDraftSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  tickets: z
    .array(
      z.strictObject({
        id: nonEmptyString,
        type: z.enum(["feature", "bug"]),
        title: nonEmptyString,
        description: z.string().default(""),
        acceptance_criteria: z.array(nonEmptyString).min(1),
        non_goals: z.array(z.string()).default([]),
        surface: z.array(z.string()).default([]),
        /** Ticket ids this one depends on; becomes A-1 `blockers`. */
        depends_on: z.array(nonEmptyString).default([]),
        risk_label: z.boolean().default(false),
      }),
    )
    .min(1),
});
