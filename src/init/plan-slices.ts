import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type HeldFinding, type PlanReview, type SliceSpec, specDefectSchema, type SpecDefect } from "../schemas/init.js";
import { SCHEMA_VERSION } from "../schemas/common.js";
import { sliceCacheDir } from "./machine.js";
import { sliceKey } from "./slice-key.js";
import { draftAndRead, type PlanDeps } from "./plan.js";
import { PLAN_REVISIONS } from "./plan-review.js";
import { sampleReviewPlan, type SampledReview } from "./plan-sample.js";
import { churnLine, nullNote, recurringLine, remainLine, revisionLine, sampleLine } from "./plan-notes.js";
import { heldFindings, revisionOutcome, sampleChurn, type RevisionOutcome } from "./plan-signal.js";
import type { DraftedTicket } from "./plan-write.js";
import { noteUnitComplete } from "../kernel/ledger.js";
import { stillQuoted } from "./plan-draft-checks.js";
import { cachedTicketSchema } from "./plan-cache.js";
import type { PlanContext } from "./plan-checks.js";
import { crossSlicePass, writeRedrafts, type Redraft } from "./plan-cross.js";
import { normaliseDraft, tagSlice } from "./plan-normalise.js";
import { checkedDraft, type Checked } from "./plan-redraft.js";

/**
 * C-2‴ (PRDR-117) — PLAN, one slice at a time, to the end of the product.
 *
 * Each slice is drafted with the earlier slices' ticket index in view, reviewed
 * as its own plan (PRDR-084), revised once, and cached under
 * `.detent/state/plan/<slice>.json` keyed by what it read (`slice-key.ts`) —
 * so an edit to one slice's requirements, or without a pack to its documents,
 * re-plans that slice and reuses the rest (C-8, C-2⁸).
 * Nothing here stops for a human, and nothing asks (C-3⁗): what a draft finds
 * the pack leaves open accumulates for PRESENT as a spec defect (C-4⁵).
 *
 * A-1⁷ (PRDR-293): code checks the draft, and the revision where there is one,
 * and a failing one is redrafted once with its failures (`plan-redraft.ts`).
 * After every slice, reused or planned, the same checks run across the plan
 * so far (`plan-cross.ts`).
 */

/** C-4⁵ (PRDR-292): a spec defect, with the slice whose draft reported it. */
export type PlannedSpecDefect = SpecDefect & { readonly slice: string };

export interface SlicePlan {
  readonly tickets: DraftedTicket[];
  readonly spec_defects: PlannedSpecDefect[];
  /** Findings a slice's second review still held; shown at PRESENT. */
  readonly remaining: { readonly slice: string; readonly findings: readonly HeldFinding[] }[];
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
  /** F-3′ (PRDR-137): the fields this file casts to `DraftedTicket`, validated (`plan-cache.ts`). */
  tickets: z.array(cachedTicketSchema),
  /** C-4⁵ (PRDR-292): what the slice's drafts found the pack leaves open. The v1→v2 migration writes it where `questions` was (F-3″). */
  spec_defects: z.array(specDefectSchema),
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
  /**
   * A-1⁷ (PRDR-293): the keys of the failures the slice's redrafts were sent,
   * so a resumed run's checks across the plan do not send them again. Empty
   * where the slice passed its checks.
   */
  sent: z.array(z.string()).default([]),
});
type SliceCache = {
  readonly key: string;
  readonly tickets: DraftedTicket[];
  readonly spec_defects: SpecDefect[];
  readonly remaining: PlanReview["findings"];
  readonly external_deps: string[];
  readonly reviewed: boolean;
  readonly sent: string[];
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

export async function planSlices(deps: PlanDeps, slices: readonly SliceSpec[], context: PlanContext): Promise<SlicePlan> {
  const index: DraftedTicket[] = [];
  const defects: PlannedSpecDefect[] = [];
  const pack = deps.pack ?? null;
  const remaining: SlicePlan["remaining"] = [];
  /* PRDR-196: one per slice that needed a revision round; summed for PRESENT. */
  const revisions: RevisionOutcome[] = [];
  const churns: RevisionOutcome[] = [];
  /* A-1⁷: what each slice has been sent a redraft for, and every redraft the checks across the plan used. */
  const sent = new Map<string, Set<string>>();
  const used: Redraft[] = [];
  mkdirSync(sliceCacheDir(deps.root), { recursive: true });
  const across = async (): Promise<void> => {
    const pass = await crossSlicePass(deps, context, slices, index, sent, used);
    index.splice(0, index.length, ...pass.tickets);
    defects.push(...pass.spec_defects);
    remaining.push(...pass.findings);
  };

  for (const slice of slices) {
    const key = sliceKey(deps, slice);
    const cached = readCache(deps.root, slice.id);
    const planned = new Set(index.map((t) => t.id));
    /** A cached slice that reaches into an earlier one is only valid while those tickets still exist. */
    const reachable = cached === null || cached.external_deps.every((d) => planned.has(d));
    /**
     * C-4⁵ (PRDR-292): a spec defect quotes the pack, and may quote a record
     * outside the slice's own, which its key does not read. Once a passage it
     * quotes is amended, the slice is planned again, so an amendment can close
     * the defect it answers.
     */
    const amended = cached !== null && pack !== null && cached.spec_defects.some((d) => !stillQuoted(deps.root, pack, d));
    if (cached !== null && cached.key === key && reachable && !amended) {
      deps.progress?.(`reusing ${slice.id}`);
      deps.note?.(`${slice.id} ${slice.title}: reused — nothing it read has changed (C-8)`);
      index.push(...cached.tickets);
      defects.push(...cached.spec_defects.map((d) => ({ ...d, slice: slice.id })));
      sent.set(slice.id, new Set(cached.sent));
      const held = cached.reviewed
        ? cached.remaining
        : [...cached.remaining, { tag: "coverage" as const, finding: `${slice.id} was planned but never reviewed — no verdict was produced when it was planned` }];
      if (held.length > 0) remaining.push({ slice: slice.id, findings: held });
      await across();
      continue;
    }
    if (cached !== null && cached.key === key && !reachable) {
      deps.note?.(`${slice.id} ${slice.title}: re-planning — a ticket it depends on is no longer in the plan (C-8‴)`);
    } else if (cached !== null && cached.key === key && amended) {
      deps.note?.(`${slice.id} ${slice.title}: re-planning — the pack no longer says what a spec defect it reported quotes (C-4⁵)`);
    }

    deps.progress?.(`planning ${slice.id} ${slice.title}`);
    deps.note?.(`planning ${slice.id} ${slice.title} (${index.length} ticket(s) planned before it)`);
    let drafted = await draftAndRead(deps, { slice, planIndex: index });
    let normalised = normaliseDraft(slice, tagSlice(drafted.tickets, slice.id), index, deps.note);
    /** A defect in the pack is not answered by redrafting a slice: each draft's are kept, once each. */
    const found: SpecDefect[] = [...drafted.spec_defects];
    const keep = (more: readonly SpecDefect[]): void => {
      for (const d of more) if (!found.some((f) => JSON.stringify(f.passages) === JSON.stringify(d.passages))) found.push(d);
    };
    /* A-1⁷: the draft that stands, the repairs A-1″ made to it, and what the checks sent back. */
    const mine = new Set<string>();
    const settle = (checked: Checked, repairs: PlanReview["findings"]): { tickets: DraftedTicket[]; repairs: PlanReview["findings"] } => {
      keep(checked.spec_defects);
      for (const k of checked.sent) mine.add(k);
      return { tickets: checked.tickets, repairs: checked.sent.length === 0 ? repairs : checked.findings };
    };
    let standing = settle(await checkedDraft(deps, context, slice, normalised.tickets, index, "draft"), normalised.findings);

    let leftover: PlanReview["findings"] = [];
    let reviewed = false;
    let revision: RevisionOutcome | null = null;
    let churn: RevisionOutcome | null = null;
    let after: SampledReview | null = null;
    const review = await sampleReviewPlan(deps, standing.tickets, { kind: "slice", slice, planIndex: index });
    reviewed = review !== null;
    if (review !== null) {
      churn = sampleChurn(review.reads);
      deps.note?.(sampleLine(slice.id, review.reads.length, review.threshold, review.findings.length, review.seenOnce.length));
      deps.note?.(churnLine(slice.id, churn, review.reads.length * (review.reads.length - 1)));
    }
    if (review !== null && review.verdict === "changes" && review.findings.length > 0) {
      deps.note?.(recurringLine(slice.id, review.findings));
      /**
       * PRDR-268: a round is drafted against what the LAST round left.
       *
       * The review used to sit after the loop, so every iteration was handed
       * `review.findings` — the one review taken before it — and `drafted = …`
       * threw the previous round away. `draftPlan` deletes the prior artifact
       * too ("a stale draft is an echo chamber"), so there was no implicit
       * channel either: round two re-rolled the same inputs. That is why
       * PRDR-084's "a second bite adds cost without adding information" held,
       * and it held by construction rather than by measurement.
       *
       * Moving the review in also buys an exit a loop with no review cannot
       * have: a plan the reviewer has just passed does not need another
       * index-carrying session spent redrafting it.
       */
      let outstanding: PlanReview["findings"] = review.findings;
      for (let round = 0; round < (deps.revisionRounds ?? PLAN_REVISIONS); round += 1) {
        drafted = await draftAndRead(deps, { slice, planIndex: index, findings: outstanding });
        normalised = normaliseDraft(slice, tagSlice(drafted.tickets, slice.id), index, deps.note);
        keep(drafted.spec_defects);
        standing = { tickets: normalised.tickets, repairs: normalised.findings };
        after = await sampleReviewPlan(deps, standing.tickets, { kind: "slice", slice, planIndex: index, revised: true });
        reviewed = after !== null;
        leftover = after !== null && after.verdict === "changes" ? after.findings : [];
        if (leftover.length === 0) break;
        outstanding = leftover;
      }
      /* A-1⁷: the revision is checked as the draft was, and redrafted once where it fails. */
      standing = settle(await checkedDraft(deps, context, slice, standing.tickets, index, "revision"), standing.repairs);
      /**
       * PRDR-196: say what the round DID, not how many findings came back.
       *
       * A count answers neither of the two questions worth asking — did the
       * revision fix what it was handed, and did it create work that was not
       * there. Recorded on the slice as well as said, so the question can be
       * asked across runs rather than re-derived from a log each time.
       */
      revision = revisionOutcome(review.findings, leftover);
      deps.note?.(revisionLine(slice.id, revision));
      deps.note?.(
        leftover.length === 0
          ? `${slice.id} review: revision accepted`
          : remainLine(
              `${slice.id} review after revision`,
              leftover.length,
              revision,
              nullNote(churn, review.reads.length * (review.reads.length - 1)),
              leftover.map((f) => f.tag).join(", "),
            ),
      );
    } else if (review !== null) {
      deps.note?.(
        review.verdict === "approve"
          ? `${slice.id} review: approve — no finding recurred across the samples`
          : `${slice.id} review: changes, but the verdict named no finding — nothing to revise, treated as it stands`,
      );
    }

    /*
     * C-4⁗″: what the filter held back is judgement, not noise to discard —
     * D-24 sends it to the human. D-24′ (PRDR-209): marked with WHY it is
     * held, because the populations are not worth the same and PRESENT says
     * which is which. PRDR-269 (D-25): `labelHeld` reads the marking off
     * `revisionOutcome`'s own arithmetic, so "survived a paid revision" names
     * the findings that did; BOTH reviews are sampled, so both contribute the
     * reads that fell below the threshold. Only the last round's are carried:
     * an earlier round's unreproduced findings are about a draft the round
     * after it replaced.
     */
    /** PRDR-271: `heldFindings` carries each sample's read count. PRDR-272 (D-32): from the panel the label came from, both panels named, and a key this panel held is not also reported as sub-threshold. */
    const held: HeldFinding[] = [...standing.repairs, ...heldFindings(review?.findings ?? [], leftover, review, after)];
    if (!reviewed) {
      held.push({ tag: "coverage", finding: `${slice.id} produced no review verdict — it is planned but unreviewed (PRDR-084)` });
      deps.note?.(`${slice.id}: no review verdict after the relaunch — the slice is planned but UNREVIEWED (PRDR-084)`);
    }
    const own = new Set(standing.tickets.map((t) => t.id));
    writeFileSync(
      cachePath(deps.root, slice.id),
      `${JSON.stringify(
        {
          schema_version: SCHEMA_VERSION,
          key,
          tickets: standing.tickets,
          spec_defects: found,
          remaining: held,
          /* PRDR-196: null when the slice needed no revision. */
          revision,
          /* C-4⁗″ (PRDR-200): what the same arithmetic returns over reads of an UNCHANGED draft. */
          churn,
          external_deps: [...new Set(standing.tickets.flatMap((t) => t.depends_on).filter((d) => !own.has(d)))],
          reviewed,
          sent: [...mine],
        },
        null,
        2,
      )}\n`,
    );
    /**
     * X-1⁵ (PRDR-191): the slice is on disk, so the run has completed a unit of
     * work and buys its next budget. Putting it after the checkpoint write
     * rather than before means a slice that failed to persist does not count.
     *
     * It is not the only mark that resets the no-progress breaker, as this
     * block said: a ticket reaching DONE is one, and so are each completed
     * specification phase, each claim brief AUDIT writes (C-2¹¹) and each
     * completed VALIDATE round (C-2⁶, PRDR-284).
     */
    noteUnitComplete(deps.root);
    if (revision !== null) revisions.push(revision);
    if (churn !== null) churns.push(churn);
    index.push(...standing.tickets);
    defects.push(...found.map((d) => ({ ...d, slice: slice.id })));
    sent.set(slice.id, mine);
    if (held.length > 0) remaining.push({ slice: slice.id, findings: held });
    await across();
  }
  /* C-8⁗: what this run did not use belongs to a plan that no longer exists. */
  writeRedrafts(deps.root, used);
  return { tickets: index, spec_defects: defects, remaining, revisions, churns };
}
