import { parseArtifact } from "../../schemas/common.js";
import { reviewSchema, type Hypothesis } from "../../schemas/records.js";
import type { Ticket } from "../../schemas/ticket.js";
import { reviewApprove, reviewChanges, type KernelEvent } from "../events.js";

/**
 * T-044 — review consumption and REVIEW_FIX routing (X-3 review rows, D-6, A-5).
 *
 * The reviewer's input set is closed (SEC-3): diff + acceptance criteria +
 * rules + hypothesis, nothing else — `buildReviewerInputs` is the only way the
 * loop assembles them, so widening the set is a visible diff here, not a quiet
 * key in a call site. Verdicts route through the machine's own rows: changes
 * with the review-fix slot free → REVIEW_FIX, else NEEDS_HUMAN (D-6's own unit
 * budget; review findings never touch the ladder). An invalid review artifact
 * is a BREAKER — a malformed reviewer must never be partially accepted (A-*).
 */

/**
 * The closed input set, asserted by T-044's input-set test. The two
 * `expected_output*` keys are T-140's addition — the OUTPUT contract, not
 * evidence: the live bootstrap reviewer wrote a correct verdict minus
 * `schema_version` and the strict validator refused it (SEC-3's evidence
 * closure is unchanged: diff + criteria + rules + hypothesis).
 */
export const REVIEWER_INPUT_KEYS = ["ticket", "diff", "hypothesis", "expected_output", "expected_output_note"] as const;
export const REVIEWER_TICKET_KEYS = ["id", "title", "acceptance_criteria", "non_goals"] as const;

/** A-5's exact shape; skeletons.test parses it through `reviewSchema`. */
export function reviewSkeleton(): Record<string, unknown> {
  return { schema_version: 1, verdict: "approve", changes: [] };
}

export function buildReviewerInputs(
  ticket: Ticket,
  diff: string,
  hypothesis: Hypothesis | null,
): Record<(typeof REVIEWER_INPUT_KEYS)[number], unknown> {
  return {
    ticket: {
      id: ticket.id,
      title: ticket.title,
      acceptance_criteria: ticket.acceptance_criteria,
      non_goals: ticket.non_goals,
    },
    expected_output: reviewSkeleton(),
    expected_output_note:
      'verdict "changes" requires at least one {tag: correctness|requirement|scope|rules, finding, file?} entry; the validator is strict — no extra keys, and schema_version is required.',
    diff,
    hypothesis,
  };
}

export interface ReviewDeps {
  readonly launch: (inputs: Record<string, unknown>) => Promise<void>;
  readonly readArtifact: () => unknown;
  readonly note: (text: string) => void;
}

export type ReviewOutcome = { readonly kind: "event"; readonly event: KernelEvent } | { readonly kind: "breaker"; readonly reason: string };

export async function reviewStage(ticket: Ticket, diff: string, hypothesis: Hypothesis | null, deps: ReviewDeps): Promise<ReviewOutcome> {
  await deps.launch(buildReviewerInputs(ticket, diff, hypothesis));

  const raw = deps.readArtifact();
  const parsed = raw === null ? null : parseArtifact(reviewSchema, raw);
  if (parsed === null || !parsed.ok) {
    return { kind: "breaker", reason: parsed === null ? "review produced no artifact" : "review artifact invalid (A-5)" };
  }
  if (parsed.value.verdict === "approve") {
    return { kind: "event", event: reviewApprove(parsed.value) };
  }
  deps.note(`review changes: ${parsed.value.changes.map((c) => c.tag).join(",")}`);
  return { kind: "event", event: reviewChanges(parsed.value) };
}
