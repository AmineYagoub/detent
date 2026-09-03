import type { PlanQuestion, PlanReview, SliceSpec } from "../schemas/init.js";
import { draftAndRead, type PlanDeps } from "./plan.js";
import { reviewPlan } from "./plan-review.js";
import { normaliseDraft, tagSlice } from "./plan-slices.js";
import type { DraftedTicket } from "./plan-write.js";

/**
 * C-2‴ (PRDR-117) — the whole-plan review.
 *
 * Each slice was reviewed as its own plan; nothing yet has read the plan as
 * one thing. A fresh planner-role session receives every ticket of every
 * slice and judges the plan for coherence (tickets that contradict, duplicate
 * or disagree about the interface between them — usually across slices),
 * coverage (every requirement id and every baseline item reaches a ticket),
 * and traceability. One targeted revision: only the slices the findings name
 * are redrafted, with the rest of the plan in view; a second whole review
 * says what remains, and that rides to PRESENT for the human.
 */

export interface WholeReview {
  readonly tickets: DraftedTicket[];
  readonly questions: PlanQuestion[];
  readonly remaining: PlanReview["findings"];
}

export async function wholePlanReview(
  deps: PlanDeps,
  slices: readonly SliceSpec[],
  tickets: readonly DraftedTicket[],
): Promise<WholeReview> {
  /* One slice is one plan, and its own review already read all of it. */
  if (slices.length <= 1) return { tickets: [...tickets], questions: [], remaining: [] };

  const first = await reviewPlan(deps, tickets, { kind: "whole", slices });
  if (first === null) {
    /**
     * The coherence review is the whole reason this stage exists, and it is the
     * largest session of the run — the one most likely to be refused for size.
     * Its absence used to be one line on stdout and a successful init; the
     * human approving the plan could not know it never ran.
     */
    deps.note?.("whole-plan review: NO VERDICT after the relaunch — the plan was never reviewed as one thing");
    return {
      tickets: [...tickets],
      questions: [],
      remaining: [
        {
          tag: "coherence",
          finding: `the whole-plan review produced no usable verdict, so nothing checked the ${slices.length} slices against each other — each was reviewed only on its own`,
        },
      ],
    };
  }
  if (first.verdict !== "changes" || first.findings.length === 0) {
    deps.note?.(first.verdict === "approve" ? "whole-plan review: approve" : "whole-plan review: changes, but the verdict named no finding — nothing to revise");
    return { tickets: [...tickets], questions: [], remaining: [] };
  }
  deps.note?.(`whole-plan review: ${first.findings.length} finding(s) — ${first.findings.map((f) => f.tag).join(", ")}`);

  const bySlice = new Map<string, PlanReview["findings"]>();
  const planWide: PlanReview["findings"] = [];
  for (const finding of first.findings) {
    const owner = tickets.find((t) => t.id === finding.ticket)?.slice;
    if (owner === undefined) planWide.push(finding);
    else bySlice.set(owner, [...(bySlice.get(owner) ?? []), finding]);
  }
  if (bySlice.size === 0) {
    deps.note?.("whole-plan review: findings name no ticket — presented for the human, nothing redrafted");
    return { tickets: [...tickets], questions: [], remaining: first.findings };
  }

  let updated: DraftedTicket[] = [...tickets];
  const questions: PlanQuestion[] = [];
  /**
   * A finding that names no ticket belongs to the plan, not to a slice. Giving
   * it to every redrafted slice told five independent sessions to each satisfy
   * it — which is how a coherence review manufactures the duplication it was
   * convened to find. It goes to the first slice redrafted; the rest are told
   * only what is theirs.
   */
  let planWideUnclaimed = [...planWide];
  for (const slice of slices) {
    const findings = bySlice.get(slice.id);
    if (findings === undefined) continue;
    deps.note?.(`redrafting ${slice.id} ${slice.title} for ${findings.length} whole-plan finding(s)`);
    const at = sliceOrder(slices, slice.id);
    const earlier = updated.filter((t) => sliceOrder(slices, t.slice) < at);
    const later = updated.filter((t) => sliceOrder(slices, t.slice) > at);
    const currentIds = new Set(updated.filter((t) => t.slice === slice.id).map((t) => t.id));
    /** Ids later slices reach for: the redraft keeps them, or it is discarded. */
    const keepIds = [...new Set(later.flatMap((t) => t.depends_on).filter((d) => currentIds.has(d)))];
    const drafted = await draftAndRead(deps, { slice, planIndex: [...earlier, ...later], findings: [...findings, ...planWideUnclaimed], keepIds });
    planWideUnclaimed = [];
    const fresh = normaliseDraft(slice, tagSlice(drafted.tickets, slice.id), earlier, deps.note, [...earlier, ...later]).tickets;
    const missing = keepIds.filter((id) => !fresh.some((t) => t.id === id));
    if (missing.length > 0) {
      deps.note?.(`${slice.id} redraft dropped ${missing.join(", ")}, which later slices depend on — redraft discarded, the slice stands as reviewed`);
      continue;
    }
    updated = [...earlier, ...fresh, ...later];
    questions.push(...drafted.questions);
  }

  const second = await reviewPlan(deps, updated, { kind: "whole", slices });
  const remaining = second !== null && second.verdict === "changes" ? second.findings : [];
  deps.note?.(
    remaining.length === 0
      ? "whole-plan review after revision: approve"
      : `whole-plan review after revision: ${remaining.length} finding(s) remain — ${remaining.map((f) => `${f.tag}${f.ticket === undefined ? "" : ` (${f.ticket})`}`).join("; ")}`,
  );
  return { tickets: updated, questions, remaining };
}

function sliceOrder(slices: readonly SliceSpec[], id: string): number {
  const i = slices.findIndex((s) => s.id === id);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
}
