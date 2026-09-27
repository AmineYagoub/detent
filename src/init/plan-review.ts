import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { SCHEMA_VERSION, parseArtifact } from "../schemas/common.js";
import type { Budgets } from "../schemas/budgets.js";
import { planReviewSchema, type PlanDraftTicket, type PlanReview, type ReviewFinding, type SliceSpec } from "../schemas/init.js";
import type { Pack } from "../schemas/pack.js";
import { sliceRecords } from "./plan-records.js";
import { sizingEvidence } from "./sizing-evidence.js";

/**
 * PRDR-084 — the plan's own D-6, read once (C-4⁸, PRDR-294).
 *
 * A `plan_review` session reads one slice's draft, after A-1⁷'s checks pass
 * on it and before any ticket is written, and judges what code cannot: whether
 * each ticket fits one implement session, whether the slice runs end to end
 * first, what depends on what where no contract says so, and whether its
 * tickets agree with each other and with the pack. Each finding is graded, and
 * a blocker or major buys the slice one revision that no review reads again.
 *
 * The review advises (D-24): an absent or unusable verdict leaves the draft
 * standing, since a planning aid that can block the pipeline is a new way for
 * init to fail, and what blocks approval is code's.
 */

/** The exact artifact a review writes (PRDR-084). */
export function planReviewSkeleton(): Record<string, unknown> {
  return {
    schema_version: SCHEMA_VERSION,
    verdict: "approve",
    findings: [
      {
        severity: "minor",
        tag: "coherence",
        ticket: "t-100",
        finding: "<what is wrong, and why it matters to the session that runs the ticket — required>",
        fix: "<what should change, in the ticket's own terms — required>",
      },
    ],
  };
}

/**
 * Where a slice's review is written. PRDR-260: the slice keys the directory,
 * so each slice's verdict is kept beside the others and none is read back as
 * another slice's.
 */
export function planReviewPath(root: string, sliceId?: string): string {
  return path.join(stateDir(root), "state", ...(sliceId === undefined ? [] : ["slices", sliceId]), "plan-review.json");
}

/** What a review needs of PLAN's dependencies — kept narrow so the seam is obvious. */
export interface ReviewDeps {
  readonly root: string;
  readonly docs: readonly string[];
  readonly budgets: Budgets;
  /** C-2⁸: the parse whose records a slice is drafted from, which the review reads too; absent or null without a pack. */
  readonly pack?: Pack | null;
  /** C-4⁸ (PRDR-294): one session on the `plan_review` role, writing its verdict to `artifactOut`. */
  readonly launchReview: (inputs: Record<string, unknown>, artifactOut: string) => Promise<void>;
  readonly note?: (text: string) => void;
}

/**
 * C-4⁗ (PRDR-116): the verdict vocabulary is closed, but a reviewer that
 * writes `revise` for `changes` has still reviewed. Six real findings were
 * thrown away on ksar-cloud over that one word, and the draft was written
 * unreviewed. Obvious synonyms are read as the word they mean, noted.
 */
const VERDICT_SYNONYMS: Readonly<Record<string, "approve" | "changes">> = {
  approve: "approve",
  approved: "approve",
  accept: "approve",
  accepted: "approve",
  ok: "approve",
  pass: "approve",
  lgtm: "approve",
  changes: "changes",
  revise: "changes",
  revision: "changes",
  request_changes: "changes",
  "request changes": "changes",
  changes_requested: "changes",
  needs_changes: "changes",
  reject: "changes",
  rejected: "changes",
};

export function normaliseVerdict(raw: unknown): {
  readonly value: unknown;
  readonly from: string | null;
} {
  if (raw === null || typeof raw !== "object" || !("verdict" in raw))
    return { value: raw, from: null };
  const verdict = (raw as { verdict: unknown }).verdict;
  if (typeof verdict !== "string") return { value: raw, from: null };
  const canonical = VERDICT_SYNONYMS[verdict.trim().toLowerCase()];
  if (canonical === undefined || canonical === verdict)
    return { value: raw, from: null };
  return { value: { ...(raw as object), verdict: canonical }, from: verdict };
}

/** `prompts/plan_review.md` says the same, in its own words; the two must agree (PRDR-292). */
const REVIEW_INSTRUCTION =
  "Review this DRAFT of one slice, tickets and not code, on four things alone. `sizing`: does each ticket fit one implement " +
  "session within `session_budget` (`sizing_evidence`, when present, is measured on a previous plan of this product and " +
  "outweighs any estimate from the text). `shape`: do the slice's first tickets form a walking skeleton through its riskiest " +
  "integration, rather than completing infrastructure first. `dependency`: a criterion that needs behaviour another ticket " +
  "builds, where neither `depends_on`, `consumes` nor the surface says so; name both tickets. `coherence`: tickets that " +
  "contradict or duplicate each other, here or against `plan_index`, or contradict the `records` or `docs` the slice was " +
  "drafted from. Code checks coverage, traceability and contracts, and they are not yours. Grade each finding: `blocker` or " +
  "`major` where the slice should be redrafted before it runs, `minor` where the session that runs the ticket should know it. " +
  "Every finding names its ticket and its `fix`. The verdict is `approve` when nothing is blocker or major, and `changes` " +
  "otherwise. Write EXACTLY the `expected_output` shape.";

/**
 * C-2‴ (PRDR-117): what the reviewer is judging, one slice with the earlier
 * slices' tickets in view. A-1⁷ (PRDR-293): the whole-plan review, the other
 * kind of scope, is gone.
 */
export interface ReviewScope {
  readonly slice: SliceSpec;
  readonly planIndex: readonly {
    readonly id: string;
    readonly slice: string;
    readonly title: string;
    readonly surface: readonly string[];
  }[];
}

/**
 * C-4⁸ (PRDR-294): the slice as its drafter was handed it, so `coherence`
 * can be judged against what the draft was planned from: on a pack, the
 * slice's records from the parse, and without one, its documents.
 */
export function scopeInputs(deps: Pick<ReviewDeps, "root" | "docs" | "pack">, scope: ReviewScope): Record<string, unknown> {
  const { slice } = scope;
  const pack = deps.pack ?? null;
  return {
    slice: { id: slice.id, title: slice.title, goal: slice.goal, requirement_ids: slice.requirement_ids, baseline_items: slice.baseline_items },
    ...(pack !== null ? { records: sliceRecords(deps.root, pack, slice.requirement_ids) } : { docs: slice.docs.length > 0 ? slice.docs : deps.docs }),
    plan_index: scope.planIndex.map((t) => ({ id: t.id, slice: t.slice, title: t.title, surface: t.surface })),
    scope_instruction:
      `This draft is ONE slice, \`${slice.id}\` (${slice.title}). \`plan_index\` lists the earlier slices' tickets, for ` +
      "dependency and coherence findings that reach across slices.",
  };
}

async function reviewOnce(
  deps: ReviewDeps,
  tickets: readonly PlanDraftTicket[],
  previous: { readonly issue: string } | null,
  scope: ReviewScope,
): Promise<{
  readonly review: PlanReview | null;
  readonly issue: string | null;
  readonly normalisedFrom: string | null;
}> {
  const file = planReviewPath(deps.root, scope.slice.id);
  rmSync(file, { force: true });
  const evidence = sizingEvidence(deps.root);
  try {
    await deps.launchReview(
      {
        stage: "REVIEW_PLAN",
        plan: tickets,
        session_budget: sessionBudget(deps.budgets),
        ...(evidence === null ? {} : { sizing_evidence: evidence }),
        expected_output: planReviewSkeleton(),
        instruction: REVIEW_INSTRUCTION,
        ...scopeInputs(deps, scope),
        ...(previous === null
          ? {}
          : {
              previous_attempt: {
                issue: previous.issue,
                note: "Your previous review artifact was refused for the issue above. Rewrite it in EXACTLY the `expected_output` shape; the findings themselves were sound to keep.",
              },
            }),
      },
      file,
    );
  } catch (err) {
    /* PRDR-084: the review advises and never fails init — a session that died is an unusable attempt, not an exit. */
    return { review: null, issue: `review session failed: ${(err as Error).message}`, normalisedFrom: null };
  }
  if (!existsSync(file)) return { review: null, issue: "no artifact written", normalisedFrom: null };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    return { review: null, issue: `artifact is not JSON: ${(err as Error).message}`, normalisedFrom: null };
  }
  const normalised = normaliseVerdict(raw);
  const parsed = parseArtifact(planReviewSchema, normalised.value);
  if (parsed.ok) return { review: parsed.value, issue: null, normalisedFrom: normalised.from };
  const issue = parsed.reason === "invalid" ? parsed.issues.join("; ") : `schema_version ${parsed.found} is newer than ${parsed.supported}`;
  return { review: null, issue, normalisedFrom: null };
}

/**
 * PRDR-084's advisory review, with C-4⁗'s two repairs: a synonym for the
 * verdict is read as the word it means, and an artifact that is absent or
 * unusable buys ONE relaunch carrying the validator's own words — the same
 * relaunch a code review gets (A-5′). Only after that does the draft stand
 * unreviewed, and the note says why.
 */
export async function reviewPlan(deps: ReviewDeps, tickets: readonly PlanDraftTicket[], scope: ReviewScope): Promise<PlanReview | null> {
  const first = await reviewOnce(deps, tickets, null, scope);
  if (first.review !== null) {
    if (first.normalisedFrom !== null) deps.note?.(`plan review: verdict \`${first.normalisedFrom}\` read as \`${first.review.verdict}\` (C-4⁗)`);
    return first.review;
  }
  deps.note?.(`plan review artifact unusable (${first.issue}) — relaunching the review once (C-4⁗)`);
  const second = await reviewOnce(deps, tickets, { issue: first.issue ?? "unusable" }, scope);
  if (second.review !== null) {
    if (second.normalisedFrom !== null) deps.note?.(`plan review: verdict \`${second.normalisedFrom}\` read as \`${second.review.verdict}\` (C-4⁗)`);
    return second.review;
  }
  deps.note?.(`plan review artifact unusable again (${second.issue}) — the draft stands unreviewed (PRDR-084)`);
  return null;
}

/** C-4⁸ (PRDR-294): what buys the slice its one revision. */
export const isBlocking = (f: ReviewFinding): boolean => f.severity === "blocker" || f.severity === "major";

/**
 * C-4⁸ (PRDR-294): the verdict is what the severities say. A review that
 * wrote `changes` over minors alone has approved, and one that wrote `approve`
 * over a blocker or major has not, since the finding is the more exact of the
 * two statements. Where the word and the grades disagree, the note says so.
 */
export function gradedVerdict(review: PlanReview, sliceId: string, note?: (text: string) => void): "approve" | "changes" {
  const graded = review.findings.some(isBlocking) ? "changes" : "approve";
  if (graded !== review.verdict) {
    note?.(
      `${sliceId} review: \`${review.verdict}\` read as ${graded === "approve" ? "approve — it found nothing blocker or major" : "changes — it found a blocker or major"} (C-4⁸)`,
    );
  }
  return graded;
}

export function sessionBudget(budgets: Budgets): Record<string, number> {
  return {
    implement_turns: budgets.turns_per_stage,
    ticket_wall_clock_minutes: Math.round(budgets.ticket_wall_clock_ms / 60_000),
    sessions_per_generation: budgets.sessions,
  };
}
