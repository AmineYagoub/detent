import type { PlanReview, SliceSpec, SpecDefect } from "../schemas/init.js";
import { draftAndRead, type PlanDeps } from "./plan.js";
import { failureLine, sliceFailures, type PlanContext } from "./plan-checks.js";
import { normaliseDraft, tagSlice } from "./plan-normalise.js";
import type { DraftedTicket } from "./plan-write.js";

/**
 * A-1⁷ (PRDR-293) — a slice's draft, checked, and redrafted once where it fails.
 *
 * What the checks prove needs no reviewer to confirm it, so it goes straight
 * back to the slice's drafter: the failures, and the draft they were found in,
 * so a redraft can fix what they name and keep the rest. The checks run again
 * on the redraft, and what still fails is the operator's at PRESENT. A second
 * redraft for the same draft is not bought: one targeted attempt, then the
 * operator.
 */

export interface Checked {
  readonly tickets: DraftedTicket[];
  /** What the redraft found the pack leaves open, where there was one. */
  readonly spec_defects: SpecDefect[];
  /** The keys of the failures a redraft was sent, so the checks across the plan do not send them again. */
  readonly sent: string[];
  /** A-1″'s repairs of the redraft, reported as a draft's are. */
  readonly findings: PlanReview["findings"];
}

export async function checkedDraft(
  deps: PlanDeps,
  context: PlanContext,
  slice: SliceSpec,
  tickets: DraftedTicket[],
  /** The tickets of the slices planned before this one. */
  index: readonly DraftedTicket[],
  /** Which of the slice's drafts this is, for the log. */
  what: "draft" | "revision",
): Promise<Checked> {
  const failures = sliceFailures(context, [...index, ...tickets], slice.id);
  if (failures.length === 0) return { tickets, spec_defects: [], sent: [], findings: [] };
  deps.progress?.(`redrafting ${slice.id} ${slice.title} for the checks`);
  deps.note?.(`${slice.id}: its ${what} fails ${String(failures.length)} check(s) — ${failures.map(failureLine).join("; ")}; redrafting it once with them (A-1⁷)`);
  const drafted = await draftAndRead(deps, { slice, planIndex: index, failures, draft: tickets });
  const normalised = normaliseDraft(slice, tagSlice(drafted.tickets, slice.id), index, deps.note);
  const after = sliceFailures(context, [...index, ...normalised.tickets], slice.id);
  deps.note?.(
    after.length === 0
      ? `${slice.id}: the redraft passes the checks`
      : `${slice.id}: ${String(after.length)} check failure(s) remain after its redraft, for the operator at PRESENT — ${after.map(failureLine).join("; ")}`,
  );
  return { tickets: normalised.tickets, spec_defects: [...drafted.spec_defects], sent: failures.map((f) => f.key), findings: normalised.findings };
}
