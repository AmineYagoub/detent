import { createHash } from "node:crypto";
import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { planQuestionSchema, type PlanQuestion, type PlanReview, type SliceSpec } from "../schemas/init.js";
import { SCHEMA_VERSION } from "../schemas/common.js";
import { contentsDigest, sliceCacheDir } from "./machine.js";
import { sessionBudget } from "./plan-review.js";
import { draftAndRead, type PlanDeps } from "./plan.js";
import { PLAN_REVISIONS, reviewPlan, sampleReviewPlan } from "./plan-review.js";
import { revisionOutcome, sampleChurn, type RevisionOutcome } from "./plan-signal.js";
import { BOOTSTRAP_TICKET_ID, type DraftedTicket } from "./plan-write.js";
import { isSafeTicketId } from "../schemas/common.js";
import { noteUnitComplete } from "../kernel/ledger.js";

/**
 * C-2‴ (PRDR-117) — PLAN, one slice at a time, to the end of the product.
 *
 * Each slice is drafted with the earlier slices' ticket index in view, reviewed
 * as its own plan (PRDR-084), revised once, and cached under
 * `.detent/state/plan/<slice>.json` keyed by everything it read — so an edit
 * to one slice's documents re-plans that slice and reuses the rest (C-8).
 * Nothing here stops for a human: questions accumulate for PRESENT.
 */

export interface SlicePlan {
  readonly tickets: DraftedTicket[];
  readonly questions: PlanQuestion[];
  /** Findings a slice's second review still held; shown at PRESENT. */
  readonly remaining: { readonly slice: string; readonly findings: PlanReview["findings"] }[];
  /** PRDR-196: what each revision round did, for the slices that needed one. */
  readonly revisions: readonly RevisionOutcome[];
  /** C-4⁗″ (PRDR-200): the same arithmetic over reads of an unchanged draft — the null for the line above. */
  readonly churns: readonly RevisionOutcome[];
}

/**
 * C-8‴ (PRDR-118): the cache is a trust boundary — it is read back and pushed
 * straight into the plan index — so it is validated like every other artifact
 * instead of cast. A shape this does not recognise is a miss, not a crash.
 */
const sliceCacheSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  key: z.string(),
  /**
   * F-3′ (PRDR-137): the fields this file CASTS to `DraftedTicket`, validated.
   * It checked 3 of 11 while its own header promised "a shape this does not
   * recognise is a miss, not a crash" — so a cache from an older build, a merge
   * or a hand edit was a HIT that crashed `init` mid-PLAN with
   * `TypeError: t.provides is not iterable`. `sliceKey` hashes what the slice
   * READ and not the code that read it, which is what lets an older cache still
   * match its key.
   */
  tickets: z.array(
    z.looseObject({
      id: z.string(),
      type: z.string(),
      title: z.string(),
      slice: z.string(),
      depends_on: z.array(z.string()).default([]),
      acceptance_criteria: z.array(z.string()).default([]),
      non_goals: z.array(z.string()).default([]),
      surface: z.array(z.string()).default([]),
      provides: z.array(z.unknown()).default([]),
      consumes: z.array(z.unknown()).default([]),
    }),
  ),
  questions: z.array(planQuestionSchema),
  remaining: z.array(z.looseObject({ tag: z.string(), finding: z.string() })),
  /**
   * PRDR-196: what the revision round did, or `null` where none was needed.
   *
   * Additive with a default, so every cache written before this reads back as
   * "unmeasured" rather than failing — the `cache_*` and `models` precedent.
   * Adding it WITHOUT the default re-planned every cached slice, which two
   * existing cases caught immediately: a strict schema is a trust boundary in
   * both directions, and a field the writer knows and the reader does not is a
   * miss, exactly as F-3′ says.
   */
  revision: z
    .looseObject({ resolved: z.number(), survived: z.number(), introduced: z.number() })
    .nullable()
    .default(null),
  /**
   * C-4⁗″ (PRDR-200): the same arithmetic over reads of an UNCHANGED draft.
   *
   * Additive with a default for the reason the field above records in full: a
   * strict schema is a trust boundary in both directions, and a key the writer
   * knows and the reader does not is a MISS — which here would have re-planned
   * every cached slice at full price to add a measurement.
   */
  churn: z
    .looseObject({ resolved: z.number(), survived: z.number(), introduced: z.number() })
    .nullable()
    .default(null),
  /**
   * Ids in EARLIER slices these tickets depend on; if one is gone, the cache is
   * stale. REQUIRED, not defaulted: `sliceKey` hashes what the slice READ, not
   * the code that read it, so a cache written before this field existed still
   * matches its key. Defaulting it to `[]` told the staleness check that such a
   * slice reached into nothing, which is the one answer that always passes.
   */
  external_deps: z.array(z.string()),
  /**
   * Whether a review actually produced a verdict. REQUIRED for the same reason,
   * and it defaulted to `true` — so an older cache was assumed reviewed, which
   * is exactly the claim this field exists to stop anyone from assuming. An
   * absent field now misses the cache and re-plans one slice: cheap, and honest.
   */
  reviewed: z.boolean(),
});
type SliceCache = {
  readonly key: string;
  readonly tickets: DraftedTicket[];
  readonly questions: PlanQuestion[];
  readonly remaining: PlanReview["findings"];
  readonly external_deps: string[];
  readonly reviewed: boolean;
};

function cachePath(root: string, sliceId: string): string {
  return path.join(sliceCacheDir(root), `${sliceId}.json`);
}

function readCache(root: string, sliceId: string): SliceCache | null {
  const file = cachePath(root, sliceId);
  if (!existsSync(file)) return null;
  try {
    const parsed = sliceCacheSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? (parsed.data as unknown as SliceCache) : null;
  } catch {
    return null;
  }
}

/**
 * Everything a slice's draft read that can meaningfully change it.
 *
 * C-8‴ (PRDR-118): this used to hash the whole ANALYZE artifact and the ids of
 * every ticket planned before it, which made the module's own promise false.
 * ANALYZE re-runs on any document edit and is a model act, so its prose drifts
 * every time — and with it every slice's key, so a typo in slice twelve's
 * document re-planned all twenty. The ids did the same thing transitively:
 * re-planning slice two changed slice three's key, and so on to the end.
 *
 * What actually determines a slice's plan is its own documents, its own spec,
 * the STACK the analysis settled on, the bindings, the budgets and the prompt.
 * The earlier index matters only where this slice reached into it, and that is
 * checked separately as `external_deps` — precisely, and without cascading.
 */
export function sliceKey(deps: PlanDeps, slice: SliceSpec, index: readonly DraftedTicket[]): string {
  const docs = slice.docs.length > 0 ? slice.docs : deps.docs;
  void index;
  return createHash("sha256")
    .update(
      JSON.stringify([
        slice,
        contentsDigest(deps.root, docs),
        deps.analysis?.stack ?? null,
        deps.greenfield,
        deps.baseline ?? "production",
        deps.boundSlots,
        /**
         * PRDR-186: what the planner READ, not the whole budgets object.
         *
         * `sessionBudget` derives the only three values a plan can depend on —
         * `turns_per_stage`, `ticket_wall_clock_ms`, `sessions` — and they are
         * what reaches the prompt as `session_budget`. Keying on the whole
         * object put `run_spend_usd` in the key, so raising a spend cap
         * mid-run discarded every slice already planned and re-paid for it.
         * Observed: a live run five slices in, ~$70 of planning thrown away by
         * an operational decision that cannot change what a plan should say.
         * This module's own header calls the key "everything a slice's draft
         * READ"; the cap is not something it read.
         */
        sessionBudget(deps.budgets),
        deps.promptHash ?? "",
      ]),
    )
    .digest("hex");
}

export const tagSlice = (tickets: readonly Omit<DraftedTicket, "slice">[], slice: string): DraftedTicket[] =>
  tickets.map((t) => ({ ...t, slice }));

/**
 * The draft as the planner wrote it is not trusted for its ids or its edges.
 * An id that collides with another slice's (or repeats inside this one) is
 * renamed and the slice's own references follow; a `depends_on` that names
 * nothing planned is dropped and kept as a `dependency` finding for PRESENT.
 * Neither stops the run: a plan with one doubtful edge is a finding for the
 * human, not a failure of the machine (C-2‴, D-24).
 */
export function normaliseDraft(
  slice: SliceSpec,
  tickets: readonly DraftedTicket[],
  earlier: readonly DraftedTicket[],
  note: ((text: string) => void) | undefined,
  reserved: readonly DraftedTicket[] = earlier,
): { readonly tickets: DraftedTicket[]; readonly findings: PlanReview["findings"] } {
  /**
   * The bootstrap id is Detent's own construction (C-4) and is created after
   * planning, so it collides with nothing here — a planner that drafts it
   * would be cached and would then fail every later run identically. Reserving
   * it renames the offender instead of poisoning the cache.
   */
  const taken = new Set([...reserved.map((t) => t.id), BOOTSTRAP_TICKET_ID]);
  const own = new Set<string>();
  const renamed = new Map<string, string>();
  let next = 1;
  const fresh = (): string => {
    let id = "";
    do {
      id = `t-${slice.id}-${String(next).padStart(3, "0")}`;
      next += 1;
    } while (taken.has(id) || own.has(id) || tickets.some((t) => t.id === id));
    return id;
  };
  const findings: PlanReview["findings"] = [];
  const retagged = tickets.map((t) => {
    let id = t.id;
    /**
     * A duplicate INSIDE this slice is a different thing from a collision with
     * an earlier one, and it is the ambiguous case: two tickets claimed one
     * name, so every edge naming it has two possible meanings.
     */
    const duplicate = own.has(id);
    if (taken.has(id) || duplicate || !isSafeTicketId(id)) {
      id = fresh();
      renamed.set(t.id, id);
      note?.(`${slice.id}: ticket id ${JSON.stringify(t.id)} is unusable or already planned — renamed ${id}`);
      if (duplicate) {
        findings.push({
          tag: "coherence",
          ticket: id,
          finding: `was drafted as \`${t.id}\`, an id another ticket in this slice already holds — renamed ${id}. Edges naming \`${t.id}\` were read as the ticket that KEPT the id, so check none of them meant this one`,
        });
      }
      /**
       * C-4 reserves the bootstrap ticket for Detent, so a draft carrying its
       * id has probably drafted the scaffolding it was told not to. The
       * content is kept — it may be a real ticket that merely picked the wrong
       * name — but the human is told, because the alternative reading is that
       * the plan now contains the bootstrap's work twice.
       */
      if (t.id === BOOTSTRAP_TICKET_ID) {
        findings.push({
          tag: "traceability",
          ticket: id,
          finding: `drafted with ${BOOTSTRAP_TICKET_ID}, the id C-4 reserves for the bootstrap ticket Detent writes itself — renamed ${id}; check it does not duplicate the scaffolding work`,
        });
      }
    }
    own.add(id);
    return { ...t, id };
  });
  const earlierIds = new Set(earlier.map((t) => t.id));
  const known = new Set([...earlierIds, ...own]);
  const result = retagged.map((t) => {
    /**
     * A reference is rewritten ONLY when the name it uses no longer belongs to
     * anything. Two cases must survive untouched, and each was a real defect:
     *
     * - an id that ALSO names a real earlier ticket means that earlier ticket.
     *   Rewriting it to this slice's renamed local destroyed the only
     *   cross-slice edge the draft declared, and silently.
     * - an id another ticket in THIS slice kept means that ticket. When the
     *   planner drafted one id twice, the rename map pointed at the SECOND,
     *   renamed copy, so every edge naming it was redirected away from the
     *   ticket still holding the name — a silently rewired plan.
     *
     * `renamed` is therefore the last resort, for names nothing answers to.
     */
    const survives = (d: string): boolean => earlierIds.has(d) || own.has(d);
    const deps = [...new Set(t.depends_on.map((d) => (survives(d) ? d : renamed.get(d) ?? d)))].filter((d) => d !== t.id);
    const unknown = deps.filter((d) => !known.has(d));
    if (unknown.length === 0) return { ...t, depends_on: deps };
    findings.push({
      tag: "dependency",
      ticket: t.id,
      finding: `depends on ${unknown.join(", ")}, which no slice planned — the edge was dropped; the need it named may be real`,
    });
    note?.(`${slice.id}: ${t.id} depends on unknown ${unknown.join(", ")} — edge dropped (C-2‴)`);
    return { ...t, depends_on: deps.filter((d) => known.has(d)) };
  });
  return { tickets: breakCycles(slice, result, findings, note), findings };
}

/**
 * A dependency cycle is a permanent, silent deadlock: `ready()` simply never
 * offers those tickets and nothing anywhere reports why. Nothing downstream
 * looks for one — not the draft validator, not `planSchema` — and two tickets
 * naming each other is an ordinary thing for a model to write. Cross-slice
 * edges only point backwards, so any cycle is inside this slice; each one is
 * broken at the edge that closes it, and the human is told which.
 */
function breakCycles(
  slice: SliceSpec,
  tickets: readonly DraftedTicket[],
  findings: PlanReview["findings"],
  note: ((text: string) => void) | undefined,
): DraftedTicket[] {
  const own = new Set(tickets.map((t) => t.id));
  const edges = new Map(tickets.map((t) => [t.id, t.depends_on.filter((d) => own.has(d))]));
  const state = new Map<string, "open" | "closed">();
  const dropped = new Map<string, Set<string>>();

  const walk = (id: string, stack: string[]): void => {
    state.set(id, "open");
    for (const dep of edges.get(id) ?? []) {
      if (dropped.get(id)?.has(dep) === true) continue;
      if (state.get(dep) === "open") {
        dropped.set(id, new Set([...(dropped.get(id) ?? []), dep]));
        const loop = [...stack.slice(stack.indexOf(dep)), id].join(" → ");
        findings.push({ tag: "dependency", ticket: id, finding: `is part of a dependency cycle (${loop} → ${dep}); the edge to ${dep} was dropped so the plan can run` });
        note?.(`${slice.id}: dependency cycle ${loop} → ${dep} — edge ${id} → ${dep} dropped (C-2‴)`);
        continue;
      }
      if (state.get(dep) !== "closed") walk(dep, [...stack, dep]);
    }
    state.set(id, "closed");
  };
  for (const t of tickets) if (state.get(t.id) === undefined) walk(t.id, [t.id]);

  if (dropped.size === 0) return [...tickets];
  return tickets.map((t) => {
    const drop = dropped.get(t.id);
    return drop === undefined ? t : { ...t, depends_on: t.depends_on.filter((d) => !drop.has(d)) };
  });
}

export async function planSlices(deps: PlanDeps, slices: readonly SliceSpec[]): Promise<SlicePlan> {
  const index: DraftedTicket[] = [];
  const questions: PlanQuestion[] = [];
  const remaining: SlicePlan["remaining"] = [];
  /* PRDR-196: one per slice that needed a revision round; summed for PRESENT. */
  const revisions: RevisionOutcome[] = [];
  const churns: RevisionOutcome[] = [];
  mkdirSync(sliceCacheDir(deps.root), { recursive: true });

  for (const slice of slices) {
    const key = sliceKey(deps, slice, index);
    const cached = readCache(deps.root, slice.id);
    const planned = new Set(index.map((t) => t.id));
    /** A cached slice that reaches into an earlier one is only valid while those tickets still exist. */
    const reachable = cached === null || cached.external_deps.every((d) => planned.has(d));
    if (cached !== null && cached.key === key && reachable) {
      deps.progress?.(`reusing ${slice.id}`);
      deps.note?.(`${slice.id} ${slice.title}: reused — nothing it read has changed (C-8)`);
      index.push(...cached.tickets);
      questions.push(...cached.questions);
      const held = cached.reviewed
        ? cached.remaining
        : [...cached.remaining, { tag: "coverage" as const, finding: `${slice.id} was planned but never reviewed — no verdict was produced when it was planned` }];
      if (held.length > 0) remaining.push({ slice: slice.id, findings: held });
      continue;
    }
    if (cached !== null && cached.key === key && !reachable) {
      deps.note?.(`${slice.id} ${slice.title}: re-planning — a ticket it depends on is no longer in the plan (C-8‴)`);
    }

    deps.progress?.(`planning ${slice.id} ${slice.title}`);
    deps.note?.(`planning ${slice.id} ${slice.title} (${index.length} ticket(s) planned before it)`);
    let drafted = await draftAndRead(deps, { slice, planIndex: index });
    let normalised = normaliseDraft(slice, tagSlice(drafted.tickets, slice.id), index, deps.note);
    /** A question the first draft raised is not answered by redrafting it — both drafts' questions are the human's. */
    const asked: PlanQuestion[] = [...drafted.questions];

    let leftover: PlanReview["findings"] = [];
    let reviewed = false;
    let revision: RevisionOutcome | null = null;
    let churn: RevisionOutcome | null = null;
    const review = await sampleReviewPlan(deps, normalised.tickets, { kind: "slice", slice, planIndex: index });
    reviewed = review !== null;
    if (review !== null) {
      churn = sampleChurn(review.reads);
      deps.note?.(
        `${slice.id} review: sampled ${String(review.reads.length)}, keeping what ${String(review.threshold)} of ` +
          `${String(review.reads.length)} saw — ${String(review.findings.length)} recurring, ` +
          `${String(review.seenOnce.length)} seen once (C-4⁗″)`,
      );
      deps.note?.(
        `${slice.id} sample churn, nothing revised between the reads: ${String(churn.resolved)} resolved, ` +
          `${String(churn.survived)} survived, ${String(churn.introduced)} introduced — the null the number ` +
          `below is read against (PRDR-200)`,
      );
    }
    if (review !== null && review.verdict === "changes" && review.findings.length > 0) {
      deps.note?.(`${slice.id} review: ${review.findings.length} recurring finding(s) — ${review.findings.map((f) => f.tag).join(", ")}`);
      for (let round = 0; round < PLAN_REVISIONS; round += 1) {
        drafted = await draftAndRead(deps, { slice, planIndex: index, findings: review.findings });
        normalised = normaliseDraft(slice, tagSlice(drafted.tickets, slice.id), index, deps.note);
        for (const q of drafted.questions) if (!asked.some((a) => a.question.trim().toLowerCase() === q.question.trim().toLowerCase())) asked.push(q);
      }
      const second = await reviewPlan(deps, normalised.tickets, { kind: "slice", slice, planIndex: index });
      reviewed = second !== null;
      leftover = second !== null && second.verdict === "changes" ? second.findings : [];
      /**
       * PRDR-196: say what the round DID, not how many findings came back.
       *
       * A count answers neither of the two questions worth asking — did the
       * revision fix what it was handed, and did it create work that was not
       * there. Recorded on the slice as well as said, so the question can be
       * asked across runs rather than re-derived from a log each time.
       */
      revision = revisionOutcome(review.findings, leftover);
      deps.note?.(
        `${slice.id} revision: ${String(revision.resolved)} resolved, ${String(revision.survived)} survived, ` +
          `${String(revision.introduced)} introduced (PRDR-196)`,
      );
      deps.note?.(
        leftover.length === 0
          ? `${slice.id} review: revision accepted`
          : `${slice.id} review after revision: ${leftover.length} finding(s) remain — ${leftover.map((f) => f.tag).join(", ")}`,
      );
    } else if (review !== null) {
      deps.note?.(
        review.verdict === "approve"
          ? `${slice.id} review: approve — no finding recurred across the samples`
          : `${slice.id} review: changes, but the verdict named no finding — nothing to revise, treated as it stands`,
      );
    }

    /* C-4⁗″: what the filter held back is judgement, not noise to discard — D-24 sends it to the human. */
    const held = [...normalised.findings, ...leftover, ...(review?.seenOnce ?? [])];
    if (!reviewed) {
      held.push({ tag: "coverage", finding: `${slice.id} produced no review verdict — it is planned but unreviewed (PRDR-084)` });
      deps.note?.(`${slice.id}: no review verdict after the relaunch — the slice is planned but UNREVIEWED (PRDR-084)`);
    }
    /**
     * PRDR-119: a slice's questions come from two drafts — the first and the
     * revision — and each numbered its own from one, so a slice presented two
     * `q1`s with different content. Ids are assigned here, over the merged
     * set, because only this side knows both drafts.
     */
    const numbered = asked.map((q, i) => ({ ...q, id: `${slice.id}-q${i + 1}` }));
    const own = new Set(normalised.tickets.map((t) => t.id));
    writeFileSync(
      cachePath(deps.root, slice.id),
      `${JSON.stringify(
        {
          schema_version: SCHEMA_VERSION,
          key,
          tickets: normalised.tickets,
          questions: numbered,
          remaining: held,
          /* PRDR-196: null when the slice needed no revision. */
          revision,
          /* C-4⁗″ (PRDR-200): what the same arithmetic returns over reads of an UNCHANGED draft. */
          churn,
          external_deps: [...new Set(normalised.tickets.flatMap((t) => t.depends_on).filter((d) => !own.has(d)))],
          reviewed,
        },
        null,
        2,
      )}\n`,
    );
    /**
     * X-1⁵ (PRDR-191): the slice is on disk, so the run has completed a unit of
     * work and buys its next budget. This is the ONLY thing that resets the
     * no-progress breaker, and putting it after the checkpoint write rather
     * than before means a slice that failed to persist does not count.
     */
    noteUnitComplete(deps.root);
    if (revision !== null) revisions.push(revision);
    if (churn !== null) churns.push(churn);
    index.push(...normalised.tickets);
    questions.push(...numbered);
    if (held.length > 0) remaining.push({ slice: slice.id, findings: held });
  }
  return { tickets: index, questions, remaining, revisions, churns };
}
