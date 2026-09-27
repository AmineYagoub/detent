import type { CheckFailure, PlanFinding, ReviewFinding, SliceSpec, SpecDefect } from "../schemas/init.js";
import { draftAndRead, type PlanDeps } from "./plan.js";
import type { PlanContext } from "./plan-checks.js";
import { normaliseDraft, tagSlice } from "./plan-normalise.js";
import { checkedDraft } from "./plan-redraft.js";
import { gradedVerdict, isBlocking, reviewPlan } from "./plan-review.js";
import type { DraftedTicket } from "./plan-write.js";

/**
 * C-4⁸ (PRDR-294) — a slice's one review read, and the one revision a
 * blocker or major buys.
 *
 * The read waits for A-1⁷'s checks: a draft they still fail after its redraft
 * is not read, since what code proved wrong holds approval whatever a reader
 * says of it, and the draft that answers it is not this one. A read that finds
 * a blocker or major sends the slice back to its drafter once, with the draft
 * it read and those findings, each with its fix. The checks run on the
 * revision as on the draft. No review reads the revision, so every blocker and
 * major is the operator's risk at PRESENT, and every minor goes to the sessions
 * that run its ticket (PRDR-271).
 */

/** A slice's draft as the checks left it. */
export interface Standing {
  readonly tickets: DraftedTicket[];
  /** A-1″'s repairs of those tickets. */
  readonly repairs: PlanFinding[];
  /** What the checks still find in them after the redraft they sent. */
  readonly remaining: readonly CheckFailure[];
}

export interface SliceRead extends Omit<Standing, "remaining"> {
  /** What the revision and the redraft the checks sent it found the pack leaves open. */
  readonly spec_defects: SpecDefect[];
  /** The keys of the failures the revision's redraft was sent (A-1⁷). */
  readonly sent: string[];
  /** Every finding the review wrote, or null where no review was read. */
  readonly findings: ReviewFinding[] | null;
  /** Why no review was read, or null where one was. */
  readonly unreviewed: string | null;
}

export async function readSlice(deps: PlanDeps, context: PlanContext, slice: SliceSpec, index: readonly DraftedTicket[], draft: Standing): Promise<SliceRead> {
  const unread = (reason: string): SliceRead => {
    deps.note?.(`${slice.id}: not reviewed — ${reason} (C-4⁸)`);
    return { tickets: draft.tickets, repairs: draft.repairs, spec_defects: [], sent: [], findings: null, unreviewed: reason };
  };
  if (draft.remaining.length > 0) {
    return unread(`its draft fails ${String(draft.remaining.length)} check(s) after its redraft, and the review reads a draft the checks pass`);
  }
  const review = await reviewPlan(deps, draft.tickets, { slice, planIndex: index });
  if (review === null) return unread("no usable review artifact, after one relaunch");
  const findings = [...review.findings];
  const blocking = findings.filter(isBlocking);
  if (gradedVerdict(review, slice.id, deps.note) === "approve") {
    deps.note?.(`${slice.id} review: approve${findings.length === 0 ? "" : `, with ${String(findings.length)} minor finding(s) for the sessions that run their tickets`}`);
    return { tickets: draft.tickets, repairs: draft.repairs, spec_defects: [], sent: [], findings, unreviewed: null };
  }
  deps.progress?.(`revising ${slice.id} ${slice.title}`);
  deps.note?.(`${slice.id} review: ${String(blocking.length)} blocker or major finding(s) — ${blocking.map((f) => `${f.ticket} ${f.severity} ${f.tag}`).join("; ")}; revising the slice once, and no review reads the revision (C-4⁸)`);
  const drafted = await draftAndRead(deps, { slice, planIndex: index, findings: blocking, draft: draft.tickets });
  const normalised = normaliseDraft(slice, tagSlice(drafted.tickets, slice.id), index, deps.note);
  /* A-1⁷: the revision is checked as the draft was, and redrafted once where it fails. */
  const checked = await checkedDraft(deps, context, slice, normalised.tickets, index, "revision");
  const spec_defects = [...drafted.spec_defects, ...checked.spec_defects];
  /**
   * The draft the review read passed the checks, so a revision that still
   * fails them after its redraft has made the slice worse by what code proves,
   * and is discarded: the draft stands, and its blocker or major is a risk as
   * every one is. What the revision found the pack leaves open is kept; the
   * failures its redraft was sent are not the draft's, and are not recorded
   * as sent, so the checks across the plan may still send the draft one.
   */
  if (checked.remaining.length > 0) {
    deps.note?.(`${slice.id}: its revision still fails ${String(checked.remaining.length)} check(s) after its redraft — the revision is discarded, and the draft the review read stands (C-4⁸)`);
    return { tickets: draft.tickets, repairs: draft.repairs, spec_defects, sent: [], findings, unreviewed: null };
  }
  return {
    tickets: checked.tickets,
    repairs: checked.sent.length === 0 ? normalised.findings : checked.findings,
    spec_defects,
    sent: checked.sent,
    findings,
    unreviewed: null,
  };
}
