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

/** Which phase may raise which interrupt (C-4.1's bracketed positions). */
export const INTERRUPT_PHASE = {
  AWAIT_DOCS: "DISCOVER",
  /** C-3′ (PRDR-117): questions are batched from every planning stage and asked once, with the whole plan. */
  AWAIT_INFO: "PRESENT",
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
/**
 * C-3′ (PRDR-117): a question the documents cannot answer no longer stops
 * planning. It carries the ASSUMPTION the plan proceeds on, is batched with
 * every other planning stage's questions, and is asked once — with the whole
 * plan, at PRESENT. `blocking` is reserved for a question no assumption can
 * carry; it turns the final presentation into AWAIT_INFO instead of approval.
 */
export const planQuestionSchema = z.strictObject({
  id: nonEmptyString,
  question: nonEmptyString,
  blocking: z.boolean().default(false),
  assumption: z.string().default(""),
});
export type PlanQuestion = z.infer<typeof planQuestionSchema>;

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
      /**
       * A-1⁶ (PRDR-206): the files the chosen stack's scaffold creates that
       * later tickets lean on — the manifest, the compiler and test
       * configuration. The bootstrap ticket PROVIDES each as a `file`
       * contract, so a ticket consuming `package.json` resolves to it instead
       * of being reported as consuming a file no ticket creates. Additive and
       * defaulted: an analysis written before the field reads with none, and
       * nothing is ever inferred from a file's name.
       */
      scaffold_files: z.array(nonEmptyString).default([]),
      /**
       * PRDR-115: the verification commands the DOCUMENTS name, exactly as
       * written. When present they are the provisional bindings; the stack
       * table is only the fallback for documents that name none.
       */
      verification: z
        .strictObject({
          test: nonEmptyString.optional(),
          lint: nonEmptyString.optional(),
          typecheck: nonEmptyString.optional(),
          build: nonEmptyString.optional(),
          e2e: nonEmptyString.optional(),
        })
        .optional(),
    })
    .nullable(),
  /** C-3: un-implementable specs become a BATCH of questions, never a drip. */
  questions: z.array(planQuestionSchema).default([]),
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
    /**
     * PRDR-264: which arm this brief is.
     *
     * Defaults to `answered`, so a brief written before this ticket parses
     * unchanged and the cache does not need a migration.
     *
     * The `undecidable` arm exists because research can SETTLE a question
     * without answering it, and on the live run both questions were of that
     * kind — a price ladder the founder has not decided, and a retention
     * schedule only counsel can give. A schema with one arm made that outcome
     * unrepresentable, so a correct negative result was indistinguishable from
     * a broken session, and the operator was told to raise a ceiling.
     */
    outcome: z.enum(["answered", "undecidable"]).default("answered"),
    question: nonEmptyString,
    question_hash: sha256Hex,
    answer: z
      .strictObject({ claim: nonEmptyString, confidence: z.enum(["low", "medium", "high"]) })
      .optional(),
    /**
     * PRDR-264: why the question cannot be researched, and who can settle it.
     * `who_decides` is the actionable half — C-3′ carries the question to
     * PRESENT on its assumption either way, and this names the human that
     * assumption is waiting on.
     */
    undecidable: z
      .strictObject({
        reason: z.enum(["decision_not_made", "needs_specialist", "no_public_source"]),
        detail: nonEmptyString,
        who_decides: nonEmptyString,
      })
      .optional(),
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
  .superRefine(requireLocalSearchBeforeWeb)
  .superRefine(requireOutcomeArm)
  .superRefine(requireEscalationBeforeUndecidable);

/**
 * PRDR-264: the two arms are exclusive and each carries its own evidence.
 *
 * `evidence.min(1)` stays common to both — an undecidable verdict is a claim
 * about the world and needs the same support as an answer. What differs is
 * WHICH block must be present, and that a brief may never carry both: "here is
 * the answer, and also nobody has decided it" is not a state research can be in.
 */
export function requireOutcomeArm(
  brief: {
    readonly outcome: "answered" | "undecidable";
    readonly answer?: unknown;
    readonly undecidable?: unknown;
  },
  ctx: z.RefinementCtx,
): void {
  if (brief.outcome === "answered") {
    if (brief.answer === undefined) {
      ctx.addIssue({ code: "custom", path: ["answer"], message: "PRDR-264: an `answered` brief carries an `answer`" });
    }
    if (brief.undecidable !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["undecidable"],
        message: "PRDR-264: an `answered` brief carries no `undecidable` verdict — a question is settled or answered, never both",
      });
    }
    return;
  }
  if (brief.undecidable === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["undecidable"],
      message: "PRDR-264: an `undecidable` brief says why it cannot be answered and who decides it",
    });
  }
  if (brief.answer !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["undecidable"],
      message: "PRDR-264: an `undecidable` brief carries no `answer` — a question is settled or answered, never both",
    });
  }
}
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

/**
 * PRDR-266: the first tier that is not this project talking about itself.
 *
 * X-6a's tiers 1-2 are this project's documentation and its codebase. Tier 3
 * and up — pinned library docs, upstream issues, technical sources, the open
 * web — are the outside world, and they are what a verdict about the outside
 * world has to have touched.
 */
const EXTERNAL_TIER = 3;

/**
 * PRDR-266: X-6a's ascent, the mirror of `requireLocalSearchBeforeWeb`.
 *
 * That rule stops a session skipping the project and going straight to the web.
 * Nothing stopped the opposite: declaring that the outside world holds no answer
 * without consulting it. `needs_specialist` and `no_public_source` are both
 * claims about what exists outside this project, and tiers 1-2 cannot establish
 * either, so a brief asserting one from tiers 1-2 alone asserts something its
 * own evidence cannot reach.
 *
 * `decision_not_made` is exempt, and the exemption is the rule's point rather
 * than a hole in it: that reason is a claim about THIS project's state, which
 * tier 1 settles dispositively. When the decision log lists an item as open, no
 * external tier carries an answer that does not exist anywhere yet.
 *
 * The count that cannot do this job is `evidence.min(1)` — PRDR-264's own guard
 * against this arm becoming a cheap exit. The live brief that forced this ticket
 * cleared it sevenfold and still never left tier 1, because tier-1 citations are
 * free. `sources_consulted` carries the tier and is the field that can tell a
 * session that looked from one that did not.
 */
export function requireEscalationBeforeUndecidable(
  brief: {
    readonly outcome: "answered" | "undecidable";
    readonly undecidable?: { readonly reason: string } | undefined;
    readonly sources_consulted: readonly { readonly tier: number }[];
  },
  ctx: z.RefinementCtx,
): void {
  if (brief.outcome !== "undecidable") return;
  const reason = brief.undecidable?.reason;
  if (reason !== "needs_specialist" && reason !== "no_public_source") return;
  if (brief.sources_consulted.some((s) => s.tier >= EXTERNAL_TIER)) return;
  ctx.addIssue({
    code: "custom",
    path: ["sources_consulted"],
    message:
      `X-6a: \`${reason}\` is a claim about sources outside this project, and tiers 1-2 are this ` +
      `project's own docs and code — escalate and record a tier ${String(EXTERNAL_TIER)}+ consultation, ` +
      `or settle it as \`decision_not_made\` if what is missing is a decision rather than a source`,
  });
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
/**
 * PRDR-084 — the plan's own D-6. Every IMPLEMENTATION faces a fresh reviewer
 * judging it against criteria; the plan that determines all of them faced only
 * a human scrolling the presentation. This is that review's artifact: a closed
 * finding set over the five properties a plan can be wrong about, written by a
 * fresh planner-role session at the REVIEW_PLAN stage.
 */
/**
 * PRDR-101: `boundaries` joins the closed set. A ticket that never says what
 * it is NOT for leaves the reviewer making its commonest judgement — is this
 * in scope — with nothing to judge against. Distinct from `sizing`: sizing is
 * a ticket too large to finish, boundaries a ticket that never says where it
 * stops.
 */
/**
 * PRDR-103 adds `dependency`: a criterion that needs behaviour another ticket
 * builds, where neither `depends_on` nor the surface says so — distinct from
 * `shape` (skeleton ordering) and `sizing` (too much work). A finding names
 * both tickets, because the remedy is an edge or a surface and both need the pair.
 */
/**
 * C-2‴ (PRDR-117) adds `coherence`: two tickets — usually in different slices —
 * that contradict each other, duplicate each other, or disagree about the
 * interface between them. The whole-plan review is where it is judged.
 */
export const PLAN_FINDING_TAGS = ["sizing", "testability", "coverage", "shape", "traceability", "boundaries", "dependency", "coherence"] as const;

export const planReviewSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  verdict: z.enum(["approve", "changes"]),
  findings: z
    .array(
      z.strictObject({
        tag: z.enum(PLAN_FINDING_TAGS),
        finding: nonEmptyString,
        /** The ticket at fault, where one is. Absent for plan-wide findings. */
        ticket: nonEmptyString.optional(),
      }),
    )
    .default([]),
});

export type PlanReview = z.infer<typeof planReviewSchema>;

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
 */
export const CONTRACT_KINDS = ["symbol", "config", "file", "route", "table", "event"] as const;
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
        risk_label: z.boolean().default(false),
      }),
    )
    .min(1),
  /** C-3′: questions a slice's drafting raised; batched to PRESENT with the rest. */
  questions: z.array(planQuestionSchema).default([]),
});

export type PlanDraft = z.infer<typeof planDraftSchema>;
export type PlanDraftTicket = PlanDraft["tickets"][number];

/**
 * D-24′ (PRDR-209): why a finding is still in front of the human. `seen-once`
 * is C-4⁗″'s `seenOnce` — one read of three, never reproduced, the kind the
 * null says is mostly noise. `after-revision` survived a revision that was
 * paid to remove it — the stronger signal. Absent means an older cache or a
 * finding the pipeline itself added (an unreviewed slice); it renders plain.
 */
export type HeldKind = "seen-once" | "after-revision";
export type HeldFinding = PlanReview["findings"][number] & { readonly held?: HeldKind };

/*
 * ---------------------------------------------------------------------------
 * SLICE's artifact (C-2‴, PRDR-117)
 */

/**
 * The whole document pack, cut into ordered increments before any ticket is
 * drafted. A slice is what one planning pass can hold and what one human can
 * review: a goal, the requirement ids it delivers, the documents it planned
 * from, and the slices it thickens. Every requirement id in the pack lands in
 * exactly one slice; every applicable production-baseline item lands in one
 * too, so a pack that never mentions backups still gets a backup slice.
 */
export const sliceSchema = z.strictObject({
  id: z.string().regex(/^s\d{2,3}$/, "slice ids are s01, s02, … s999"),
  title: nonEmptyString,
  goal: nonEmptyString,
  requirement_ids: z.array(nonEmptyString).default([]),
  /** PB-### ids from the production baseline this slice delivers. */
  baseline_items: z.array(nonEmptyString).default([]),
  docs: z.array(nonEmptyString).default([]),
  depends_on: z.array(nonEmptyString).default([]),
  expected_tickets: z.number().int().positive().default(20),
  rationale: z.string().default(""),
});
export type SliceSpec = z.infer<typeof sliceSchema>;

export const slicesSchema = z
  .strictObject({
    schema_version: z.literal(SCHEMA_VERSION),
    slices: z.array(sliceSchema).min(1),
    questions: z.array(planQuestionSchema).default([]),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.slices.forEach((slice, i) => {
      if (seen.has(slice.id)) ctx.addIssue({ code: "custom", path: ["slices", i, "id"], message: `duplicate slice id ${slice.id}` });
      for (const dep of slice.depends_on) {
        if (!seen.has(dep)) ctx.addIssue({ code: "custom", path: ["slices", i, "depends_on"], message: `${slice.id} depends on ${dep}, which is not an EARLIER slice` });
      }
      seen.add(slice.id);
    });
  });
export type Slices = z.infer<typeof slicesSchema>;
