import { z } from "zod";
import { SCHEMA_VERSION, draftGlob, nonEmptyString } from "./common.js";

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
  /** C-2⁶ (PRDR-281): the documents are judged before anything plans from them. */
  "AUDIT",
  /** C-3⁗ (PRDR-282): what AUDIT left open is asked or settled, in the decision log, before anything plans. */
  "DECIDE",
  /** C-2¹³ (PRDR-283): the documents are rewritten into the pack, and planning reads the pack. */
  "WRITE",
  /** C-2¹⁴ (PRDR-284): the pack is checked and reviewed in rounds, and fixed, before anything plans from it. */
  "VALIDATE",
  /**
   * D-10′ (PRDR-290): ANALYZE stood here, and is folded into DECIDE. Nothing
   * binds before a stack exists, and the stack exists after DECIDE, which
   * records it in greenfield; the pack's parse replaces the analysis.
   */
  "DETERMINE_VERIFICATION",
  /** C-2‴ (PRDR-117): the whole pack is cut into ordered increments before any ticket is drafted. */
  "SLICE",
  "PLAN",
  "PREPARE_AGENTS",
  "PRESENT",
] as const;

export type InitPhase = (typeof INIT_PHASES)[number];

/**
 * C-5: the interrupt set is **closed**. Adding one is a spec change — a
 * major-version decision under C-14, not an editorial one.
 *
 * The type is the first enforcement. The second named a file that was never
 * written: `tests/init/interrupts.test.ts` appears once in this tree, in the
 * sentence that was here (PRDR-256). What exists is the prompt-site inventory
 * in `tests/docs/golden-path.test.ts`, and it is a weaker claim than the one
 * this block made — it holds the modules that can block on a human to a
 * declared list, and it does not bound this tuple: of the five sites it
 * declares, one presents AWAIT_APPROVAL and the rest present C-10/X-8's
 * escalation and V-1's re-baseline consent, which are not members.
 */
export const INTERRUPTS = [
  "AWAIT_DOCS",
  "AWAIT_INFO",
  "AWAIT_BINDING_CHOICE",
  "AWAIT_SETUP_CONSENT",
  "AWAIT_APPROVAL",
] as const;

export type Interrupt = (typeof INTERRUPTS)[number];

/**
 * Which phases may raise which interrupt (C-4.1's bracketed positions). The
 * machine refuses an interrupt raised anywhere else, so this is the rule and
 * not a description of it.
 */
export const INTERRUPT_PHASE = {
  AWAIT_DOCS: ["DISCOVER"],
  /**
   * C-3⁗ (PRDR-282): at DECIDE, on a terminal, for the questions a founder
   * defers; at VALIDATE, for a blocker left at its ceiling or a pack checker
   * its writer could not make green (C-2¹⁴, PRDR-284); and at PRESENT, for a
   * spec defect planning found or a check that still fails (C-4⁵, A-1⁷). No
   * question is asked there since C-7‴ (PRDR-296).
   */
  AWAIT_INFO: ["DECIDE", "VALIDATE", "PRESENT"],
  AWAIT_BINDING_CHOICE: ["DETERMINE_VERIFICATION"],
  AWAIT_SETUP_CONSENT: ["DETERMINE_VERIFICATION"],
  AWAIT_APPROVAL: ["PRESENT"],
} as const satisfies Record<Interrupt, readonly InitPhase[]>;

/*
 * ---------------------------------------------------------------------------
 * X-6a's rules for a research brief
 */

/**
 * X-6a's mechanical check, shared by the two briefs Detent reads, a failing
 * ticket's (A-4) and a claim AUDIT checked (C-2¹¹): a brief citing any URL
 * must include a non-empty `local_search` record (tiers 1–2 consulted). One
 * function, so the two brief schemas cannot drift apart.
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

/**
 * PRDR-266: the first tier that is not this project talking about itself.
 *
 * X-6a's tiers 1-2 are this project's documentation and its codebase. Tier 3
 * and up — pinned library docs, upstream issues, technical sources, the open
 * web — are the outside world, and they are what a verdict about the outside
 * world has to have touched.
 */
export const EXTERNAL_TIER = 3;

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
/**
 * The tags a finding about a plan carries, whoever found it: the review's
 * four, and the three A-1″'s repairs and A-1⁷'s checks also give what code
 * proves, `coverage`, `traceability` and `testability`. PRDR-103 added
 * `dependency`, a criterion that needs behaviour another ticket builds where
 * neither `depends_on` nor the surface says so, and C-2‴ (PRDR-117)
 * `coherence`, tickets that contradict each other, duplicate each other or
 * disagree about the interface between them. PRDR-101's `boundaries`, a
 * ticket whose `non_goals` never says where it stops, left the set with the
 * review's other tags that code or the drafter answers (C-4⁸, PRDR-294).
 */
export const PLAN_FINDING_TAGS = ["sizing", "testability", "coverage", "shape", "traceability", "dependency", "coherence"] as const;
export type PlanFindingTag = (typeof PLAN_FINDING_TAGS)[number];

/**
 * C-4⁸ (PRDR-294): what the review judges, four things a model can judge and
 * code cannot (planning decision 2). `sizing`, whether each ticket fits one
 * implement session (C-4′); `shape`, whether the slice runs end to end first;
 * `dependency`, what depends on what where no contract says so; and
 * `coherence`, tickets that contradict each other or the pack. Coverage,
 * traceability and contracts are code's (A-1⁷).
 */
export const REVIEW_TAGS = ["sizing", "shape", "dependency", "coherence"] as const satisfies readonly PlanFindingTag[];

/** C-4⁸ (PRDR-294): a blocker or a major buys one revision of the slice; a minor goes to the sessions that run its ticket. */
export const REVIEW_SEVERITIES = ["blocker", "major", "minor"] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

/** C-4⁸ (PRDR-294): one finding of a review, graded, on the ticket at fault, with the fix it asks for. */
export const reviewFindingSchema = z.strictObject({
  severity: z.enum(REVIEW_SEVERITIES),
  tag: z.enum(REVIEW_TAGS),
  /** The ticket at fault. A finding about two names the one whose change answers it, and the other in its words. */
  ticket: nonEmptyString,
  finding: nonEmptyString,
  fix: nonEmptyString,
});
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;

/**
 * PRDR-084 — the plan's own D-6. Every IMPLEMENTATION faces a fresh reviewer
 * judging it against criteria; the plan that determines all of them faced only
 * a human scrolling the presentation. This is the review's artifact, written
 * by a `plan_review` session for one slice (C-4⁸, PRDR-294): each finding
 * graded, on the ticket at fault, with the fix it asks for. The verdict that
 * counts is the one the severities give (`plan-review.ts`).
 */
export const planReviewSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  verdict: z.enum(["approve", "changes"]),
  findings: z.array(reviewFindingSchema).default([]),
});

export type PlanReview = z.infer<typeof planReviewSchema>;

/**
 * A finding about a plan as PLAN records it in `review_findings`, which PRESENT
 * counts and the sessions that run its ticket read (PRDR-271): the review's
 * minors, with their severity and fix, and the repairs code made to a draft
 * (A-1″), which carry neither.
 */
export interface PlanFinding {
  readonly tag: PlanFindingTag;
  readonly finding: string;
  /** The ticket at fault, where one is. */
  readonly ticket?: string;
  readonly severity?: ReviewSeverity;
  readonly fix?: string;
}

/**
 * C-4⁸ (PRDR-294): a blocker or major a slice's review found, which bought
 * the slice's one revision. No review reads the revision, so whether it
 * answered each is not known, and PRESENT shows each as a risk.
 */
export type PlanRisk = ReviewFinding & { readonly slice: string };

/** C-4⁸ (PRDR-294): a slice no review read, and why. */
export interface UnreviewedSlice {
  readonly slice: string;
  readonly reason: string;
}

/** A-1⁷ (PRDR-293): the five things code checks in a plan. */
export type CheckFamily = "coverage" | "contracts" | "milestones" | "gates" | "graph";

/**
 * A-1⁷ (PRDR-293): what a plan check proved, in a finding's shape so it renders
 * beside one. `slice` is where it lies, the slice a redraft for it is sent to;
 * `key` names it across drafts, so a redraft is sent it once. A name nobody
 * provides carries `unowned`, since the earliest slice that consumes it is the
 * one sent a redraft for it across the plan.
 */
export type CheckFailure = PlanFinding & {
  readonly check: CheckFamily;
  readonly slice: string;
  readonly key: string;
  readonly unowned?: string;
};

/**
 * A-1‴ (PRDR-120) — what a ticket OWNS and what it LEANS ON.
 *
 * Coupling between tickets is at the symbol level, and the plan could only say
 * it two ways: `depends_on`, which the planner guessed, and `surface`, a file
 * glob. Neither expresses "t-002 defines TerminalStates() and t-016 depends on
 * what it means", so every interface disagreement waited for a reviewer to
 * notice — and the same class reappeared in every slice of ksar-cloud's plan.
 *
 * The kinds are closed, like the interrupt and finding sets: a vocabulary the
 * planner cannot hold in mind is one it fills in badly. Six cover every defect
 * that run actually produced.
 *
 * C-4⁵ (PRDR-292): three more, so every kind a pack's catalogue lists has a
 * contract kind that names it: `error_code`, `setting` and `job`, beside
 * `route` and `event`. Where the pack catalogues a kind, its catalogue ids are
 * the names (`catalogueFindings` in `init/contracts.ts`).
 */
export const CONTRACT_KINDS = ["symbol", "config", "file", "route", "table", "event", "error_code", "setting", "job"] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];

/** A name this ticket brings into existence, with the meaning a consumer needs. */
/**
 * Trimmed on the way in. A provider writing `SHARED_PORT` and a consumer
 * writing `SHARED_PORT ` are the same name to every human and were two
 * different names to `contractKey`, which turned an ordinary edge into a false
 * "nothing provides it" finding whose wording blamed the wrong thing.
 */
const contractId = z
  .string()
  .transform((v) => v.trim())
  .refine((v) => v.length > 0, "a contract id cannot be empty or whitespace");

export const contractProvideSchema = z.strictObject({
  kind: z.enum(CONTRACT_KINDS),
  id: contractId,
  /** What the name MEANS. Handed verbatim to every session that consumes it. */
  note: z.string().default(""),
});

/** A name this ticket depends on another ticket having brought into existence. */
export const contractConsumeSchema = z.strictObject({
  kind: z.enum(CONTRACT_KINDS),
  id: contractId,
});

export type ContractProvide = z.infer<typeof contractProvideSchema>;
export type ContractConsume = z.infer<typeof contractConsumeSchema>;

/** The index key both sides agree on. */
export const contractKey = (c: { readonly kind: string; readonly id: string }): string => `${c.kind}:${c.id}`;

/**
 * C-4⁵ (PRDR-292): a contradiction in the pack, or a gap in it, as a drafter
 * found it. Each passage is quoted word for word from the record whose id it
 * gives, and code checks the quote before the draft is kept.
 */
export const specDefectSchema = z
  .strictObject({
    kind: z.enum(["contradiction", "gap"]),
    passages: z.array(z.strictObject({ id: nonEmptyString, quote: nonEmptyString })).min(1),
    /** Why the passages cannot all hold, or what the pack leaves unsettled. */
    defect: nonEmptyString,
  })
  .superRefine((d, ctx) => {
    if (d.kind === "contradiction" && d.passages.length < 2) {
      ctx.addIssue({ code: "custom", path: ["passages"], message: "a contradiction quotes both passages that contradict each other" });
    }
  });
export type SpecDefect = z.infer<typeof specDefectSchema>;

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
        /** SEC-3″ (PRDR-330): each entry a glob picomatch can match safely and as written, as the ticket it becomes must hold. */
        surface: z.array(draftGlob).default([]),
        /** Ticket ids this one depends on; becomes A-1 `blockers`. */
        depends_on: z.array(nonEmptyString).default([]),
        /** A-1‴: the names this ticket owns, and the ones it leans on. */
        provides: z.array(contractProvideSchema).default([]),
        consumes: z.array(contractConsumeSchema).default([]),
        /**
         * A-1⁵ (PRDR-201): what this ticket DELIVERS, as data.
         *
         * C-2⁗ commanded the coverage and the answer lived in prose, so it
         * could not be checked: one plan cited baseline ids bare where another
         * bracketed them, and a non-goal naming an item as excluded read as
         * coverage of it. Defaulted, because a plan drafted before the fields
         * existed is undeclared rather than invalid.
         */
        requirement_ids: z.array(nonEmptyString).default([]),
        baseline_ids: z.array(nonEmptyString).default([]),
        /**
         * C-4⁵ (PRDR-292): the pack's criteria this ticket delivers, each one
         * word for word among its `acceptance_criteria` (`draftIssues` in
         * `init/plan-draft-checks.ts`).
         */
        criterion_ids: z.array(nonEmptyString).default([]),
        risk_label: z.boolean().default(false),
      }),
    )
    .min(1),
  /**
   * C-4⁵ (PRDR-292): what the pack leaves unsettled, quoted from it. The draft
   * has no `questions`: the founder settled the pack's questions at DECIDE, and
   * what it still leaves open is a defect in the pack, which holds approval
   * until the pack is amended (C-3⁗).
   */
  spec_defects: z.array(specDefectSchema).default([]),
});

export type PlanDraft = z.infer<typeof planDraftSchema>;
export type PlanDraftTicket = PlanDraft["tickets"][number];

/*
 * ---------------------------------------------------------------------------
 * SLICE's artifact (C-2‴, PRDR-117)
 */

/**
 * The whole document pack, cut into ordered increments before any ticket is
 * drafted. A slice is what one planning pass can hold and what one human can
 * review: a goal, the requirement ids it delivers, the documents it planned
 * from, and the slices it thickens. The slicer is told to place every
 * requirement id in exactly one slice, and every applicable production-baseline
 * item in one too, so a pack that never mentions backups still gets a backup
 * slice. Code checks the claim in three places:
 * - On a pack, a cut that leaves a live id out, places one twice or names one
 *   the seed does not hold is refused (`cutIssue` in `init/slice-seed.ts`,
 *   C-2¹⁵).
 * - Pack or none, a slicing that places a requirement id or a baseline item in
 *   two slices is refused (`slicesSchema`, below; PRDR-293).
 * - At PLAN, every id and item a slice holds must be named by one of its own
 *   tickets, and no ticket may name one its slice does not hold (A-1⁷,
 *   `init/plan-checks.ts`, PRDR-293).
 * Which ids documents without a parse define, and which baseline items apply
 * to a product, are the slicer's judgement: no code can list either.
 *
 * C-2⁸ (PRDR-291): it carries no ticket estimate. `expected_tickets` was a
 * guess, 308 and 554 for the same documents, and nothing read it but the
 * announcement that added it up. On a pack a slice's `docs` are code's (C-2¹⁵).
 */
const SLICE_ID = /^s\d{2,3}$/;

export const sliceSchema = z.strictObject({
  id: z.string().regex(SLICE_ID, "slice ids are s01, s02, … s999"),
  title: nonEmptyString,
  goal: nonEmptyString,
  requirement_ids: z.array(nonEmptyString).default([]),
  /** PB-### ids from the production baseline this slice delivers. */
  baseline_items: z.array(nonEmptyString).default([]),
  docs: z.array(nonEmptyString).default([]),
  depends_on: z.array(nonEmptyString).default([]),
  rationale: z.string().default(""),
});
export type SliceSpec = z.infer<typeof sliceSchema>;

/**
 * C-2¹⁵ (PRDR-291): what a slice session that may only add writes, when the
 * pack gained requirements a slicing already on record does not place. Each
 * goes to a slice that exists, or to a new one, which follows the slice
 * `after` names, or comes first where it is null. Nothing here can move,
 * rename or remove what the record places: the shape has no field for it.
 */
export const sliceAdditionsSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  placed: z.array(z.strictObject({ requirement_id: nonEmptyString, slice: z.string().regex(SLICE_ID, "slice ids are s01, s02, … s999") })).default([]),
  new_slices: z
    .array(
      z.strictObject({
        id: z.string().regex(SLICE_ID, "slice ids are s01, s02, … s999"),
        after: z.string().regex(SLICE_ID, "slice ids are s01, s02, … s999").nullable(),
        title: nonEmptyString,
        goal: nonEmptyString,
        requirement_ids: z.array(nonEmptyString).min(1, "a new slice places at least one requirement"),
        depends_on: z.array(nonEmptyString).default([]),
        rationale: z.string().default(""),
      }),
    )
    .default([]),
});
export type SliceAdditions = z.infer<typeof sliceAdditionsSchema>;

/** C-3⁗, C-4⁵ (PRDR-292): no planning stage asks, so a slicing carries no `questions`. */
export const slicesSchema = z
  .strictObject({
    schema_version: z.literal(SCHEMA_VERSION),
    slices: z.array(sliceSchema).min(1),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    /* PRDR-293: an id or baseline item lands in one slice, pack or none. */
    const placed = new Map<string, string>();
    value.slices.forEach((slice, i) => {
      if (seen.has(slice.id)) ctx.addIssue({ code: "custom", path: ["slices", i, "id"], message: `duplicate slice id ${slice.id}` });
      for (const dep of slice.depends_on) {
        if (!seen.has(dep)) ctx.addIssue({ code: "custom", path: ["slices", i, "depends_on"], message: `${slice.id} depends on ${dep}, which is not an EARLIER slice` });
      }
      for (const id of new Set([...slice.requirement_ids, ...slice.baseline_items])) {
        const first = placed.get(id);
        if (first !== undefined) ctx.addIssue({ code: "custom", path: ["slices", i], message: `${id} is placed in ${first} and ${slice.id}: each id belongs in exactly one slice` });
        else placed.set(id, slice.id);
      }
      seen.add(slice.id);
    });
  });
export type Slices = z.infer<typeof slicesSchema>;
