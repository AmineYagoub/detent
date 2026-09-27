import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type PlanFinding,
  type PlanRisk,
  type ReviewFinding,
  reviewFindingSchema,
  type SliceSpec,
  specDefectSchema,
  type SpecDefect,
  type UnreviewedSlice,
} from "../schemas/init.js";
import { SCHEMA_VERSION } from "../schemas/common.js";
import { sliceCacheDir } from "./machine.js";
import { sliceKey } from "./slice-key.js";
import { draftAndRead, type PlanDeps } from "./plan.js";
import type { DraftedTicket } from "./plan-write.js";
import { noteUnitComplete } from "../kernel/ledger.js";
import { stillQuoted } from "./plan-draft-checks.js";
import { cachedTicketSchema } from "./plan-cache.js";
import type { PlanContext } from "./plan-checks.js";
import { crossSlicePass, writeRedrafts, type Redraft } from "./plan-cross.js";
import { normaliseDraft, tagSlice } from "./plan-normalise.js";
import { checkedDraft } from "./plan-redraft.js";
import { isBlocking } from "./plan-review.js";
import { readSlice } from "./plan-revision.js";

/**
 * C-2‴ (PRDR-117) — PLAN, one slice at a time, to the end of the product.
 *
 * Each slice is drafted with the earlier slices' ticket index in view, read
 * once by the review and revised once where it asks (C-4⁸, PRDR-294), and
 * cached under `.detent/state/plan/<slice>.json` keyed by what it read
 * (`slice-key.ts`) — so an edit to one slice's requirements, or without a pack
 * to its documents, re-plans that slice and reuses the rest (C-8, C-2⁸).
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
  /** C-4⁸ (PRDR-294): the review's minors and A-1″'s repairs, by slice, for the sessions that run their tickets. */
  readonly findings: { readonly slice: string; readonly findings: readonly PlanFinding[] }[];
  /** C-4⁸: the blockers and majors each slice's revision was sent, for the operator. */
  readonly risks: PlanRisk[];
  /** C-4⁸: the slices no review read, and why. */
  readonly unreviewed: UnreviewedSlice[];
}

/**
 * C-8‴ (PRDR-118): the cache is a trust boundary — it is read back and pushed
 * straight into the plan index — so it is validated like every other artifact
 * instead of cast. A shape this does not recognise is a miss, not a crash.
 *
 * C-4⁸ (PRDR-294): a cache written before the review was read once holds the
 * sampled reads' measurements, and misses: its key folds in the review's
 * prompt, which changed, and its shape is not this one.
 */
const sliceCacheSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  key: z.string(),
  /** F-3′ (PRDR-137): the fields this file casts to `DraftedTicket`, validated (`plan-cache.ts`). */
  tickets: z.array(cachedTicketSchema),
  /** C-4⁵ (PRDR-292): what the slice's drafts found the pack leaves open. The v1→v2 migration writes it where `questions` was (F-3″). */
  spec_defects: z.array(specDefectSchema),
  /** A-1″: the repairs code made to the tickets above. */
  repairs: z.array(z.looseObject({ tag: z.string(), finding: z.string() })),
  /**
   * C-4⁸ (PRDR-294): every finding the slice's one review wrote, or null where
   * none was read, with why beside it. REQUIRED, not defaulted: a default of
   * "reviewed, nothing found" is the one answer a cache that says nothing must
   * not give, and an older cache assumed reviewed was the defect the field it
   * replaces existed to stop. An absent field misses and re-plans one slice.
   */
  review: z.array(reviewFindingSchema).nullable(),
  unreviewed: z.string().nullable(),
  /**
   * Ids in EARLIER slices these tickets depend on; if one is gone, the cache is
   * stale. REQUIRED, not defaulted: `sliceKey` hashes what the slice READ, not
   * the code that read it, so a cache written before this field existed still
   * matches its key. Defaulting it to `[]` told the staleness check that such a
   * slice reached into nothing, which is the one answer that always passes.
   */
  external_deps: z.array(z.string()),
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
  readonly repairs: PlanFinding[];
  readonly review: ReviewFinding[] | null;
  readonly unreviewed: string | null;
  readonly external_deps: string[];
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
  const findings: SlicePlan["findings"] = [];
  const risks: PlanRisk[] = [];
  const unreviewed: UnreviewedSlice[] = [];
  /* A-1⁷: what each slice has been sent a redraft for, and every redraft the checks across the plan used. */
  const sent = new Map<string, Set<string>>();
  const used: Redraft[] = [];
  mkdirSync(sliceCacheDir(deps.root), { recursive: true });
  const across = async (): Promise<void> => {
    const pass = await crossSlicePass(deps, context, slices, index, sent, used);
    index.splice(0, index.length, ...pass.tickets);
    defects.push(...pass.spec_defects);
    findings.push(...pass.findings);
  };
  /**
   * C-4⁸ (PRDR-294): what a slice's review leaves, by severity. A minor, with
   * A-1″'s repairs, goes to the sessions that run its ticket (PRDR-271); a
   * blocker or major went to the slice's one revision, which nothing reads
   * again, so it is the operator's risk; a slice no review read is named.
   */
  const record = (sliceId: string, repairs: readonly PlanFinding[], review: readonly ReviewFinding[] | null, why: string | null): void => {
    const minors = (review ?? []).filter((f) => !isBlocking(f));
    if (repairs.length + minors.length > 0) findings.push({ slice: sliceId, findings: [...repairs, ...minors] });
    risks.push(...(review ?? []).filter(isBlocking).map((f) => ({ ...f, slice: sliceId })));
    if (why !== null) unreviewed.push({ slice: sliceId, reason: why });
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
      record(slice.id, cached.repairs, cached.review, cached.unreviewed);
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
    const drafted = await draftAndRead(deps, { slice, planIndex: index });
    const normalised = normaliseDraft(slice, tagSlice(drafted.tickets, slice.id), index, deps.note);
    /** A defect in the pack is not answered by redrafting a slice: each draft's are kept, once each. */
    const found: SpecDefect[] = [...drafted.spec_defects];
    const keep = (more: readonly SpecDefect[]): void => {
      for (const d of more) if (!found.some((f) => JSON.stringify(f.passages) === JSON.stringify(d.passages))) found.push(d);
    };
    /* A-1⁷: the draft, checked, and redrafted once where it fails; then the one read, and the one revision it may buy (C-4⁸). */
    const checked = await checkedDraft(deps, context, slice, normalised.tickets, index, "draft");
    keep(checked.spec_defects);
    const read = await readSlice(deps, context, slice, index, {
      tickets: checked.tickets,
      repairs: checked.sent.length === 0 ? normalised.findings : checked.findings,
      remaining: checked.remaining,
    });
    keep(read.spec_defects);
    const mine = new Set([...checked.sent, ...read.sent]);
    const own = new Set(read.tickets.map((t) => t.id));
    writeFileSync(
      cachePath(deps.root, slice.id),
      `${JSON.stringify(
        {
          schema_version: SCHEMA_VERSION,
          key,
          tickets: read.tickets,
          spec_defects: found,
          repairs: read.repairs,
          review: read.findings,
          unreviewed: read.unreviewed,
          external_deps: [...new Set(read.tickets.flatMap((t) => t.depends_on).filter((d) => !own.has(d)))],
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
    index.push(...read.tickets);
    defects.push(...found.map((d) => ({ ...d, slice: slice.id })));
    sent.set(slice.id, mine);
    record(slice.id, read.repairs, read.findings, read.unreviewed);
    await across();
  }
  /* C-8⁗: what this run did not use belongs to a plan that no longer exists. */
  writeRedrafts(deps.root, used);
  return { tickets: index, spec_defects: defects, findings, risks, unreviewed };
}
