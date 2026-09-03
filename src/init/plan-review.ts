import { existsSync, readFileSync, rmSync } from "node:fs";
import { sizingEvidence } from "./sizing-evidence.js";
import { PRODUCTION_BASELINE } from "./baseline.js";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { parseArtifact } from "../schemas/common.js";
import type { Budgets } from "../schemas/budgets.js";
import {
  planReviewSchema,
  type PlanDraftTicket,
  type PlanReview,
  type SliceSpec,
} from "../schemas/init.js";

/**
 * PRDR-084 — the plan's own D-6.
 *
 * A fresh planner-role session judges the DRAFT plan before any ticket is
 * written, over the closed set of properties a plan can be wrong about. The review
 * advises: an absent or unparseable verdict leaves the draft standing, because
 * a planning aid that can block the pipeline is a new way for init to fail.
 */

/** The exact artifact the REVIEW_PLAN stage writes (PRDR-084). */
export function planReviewSkeleton(): Record<string, unknown> {
  return {
    schema_version: 1,
    verdict: "approve",
    findings: [
      { tag: "sizing", finding: "<what is wrong — required>", ticket: "t-100" },
    ],
  };
}

export function planReviewPath(root: string): string {
  return path.join(stateDir(root), "state", "plan-review.json");
}

/**
 * PRDR-084: ONE revision round, deliberately — the D-24 argument applies here
 * too. A second bite adds cost without adding information, and a plan the
 * reviewer still faults after a revision is a judgment the human should see at
 * approval, not one the machine should keep grinding on.
 */
export const PLAN_REVISIONS = 1;

/** The slice of `PlanDeps` a review needs — kept narrow so the seam is obvious. */
export interface ReviewDeps {
  readonly root: string;
  readonly docs: readonly string[];
  readonly budgets: Budgets;
  readonly launch: (
    inputs: Record<string, unknown>,
    artifactOut?: string,
  ) => Promise<void>;
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

const REVIEW_INSTRUCTION =
  "Review this DRAFT PLAN — not code. Judge it on: sizing (does each ticket fit one implement session in `session_budget`; when " +
  "`sizing_evidence` is present it is MEASURED on a previous plan of these documents — turns per implement session, and tickets " +
  "whose sessions reported themselves oversized with a proposed split — and outweighs any estimate from the text), " +
  "testability (is every acceptance criterion checkable by a command or a test, not by opinion), coverage (does every requirement " +
  "in the documents reach some ticket), shape (do the earliest tickets form a walking skeleton through the riskiest integration, " +
  "rather than completing infrastructure layers first), traceability (is every ticket sourced from the documents rather than " +
  "invented), boundaries (does each ticket state what it is NOT for, in `non_goals` — the implementer and the reviewer both " +
  "receive that field, and empty it leaves the reviewer's commonest judgement, is this in scope, with nothing to judge against), " +
  "and dependency (a criterion that requires behaviour in code ANOTHER ticket builds — status output, a command, a module — " +
  "where the ticket neither lists that ticket in `depends_on` nor carries the path in its surface: at run time the criterion " +
  "cannot be met when the ticket runs. Name BOTH tickets in the finding — the one whose criterion reaches, and the one that " +
  "owns what it reaches for — because the remedy is an edge or a surface and either needs the pair). " +
  "An honest `approve` is a real verdict; do not manufacture findings, and a ticket with genuinely no boundary worth stating is " +
  "not a finding. `coherence` (two tickets that contradict, duplicate, or disagree about their interface — judged when the " +
  "whole plan is in view; see `scope_instruction` when present). The verdict is EXACTLY `approve` or `changes` — no other word " +
  "— and every finding's `tag` is one of the eight named here. Write EXACTLY the `expected_output` shape.";

/**
 * C-2‴ (PRDR-117): what the reviewer is judging — one slice against its own
 * requirement set with the earlier slices' tickets in view, or the whole plan
 * across every slice, where `coherence` and cross-slice coverage are judged.
 */
export type ReviewScope =
  | {
      readonly kind: "slice";
      readonly slice: SliceSpec;
      readonly planIndex: readonly {
        readonly id: string;
        readonly slice: string;
        readonly title: string;
        readonly surface: readonly string[];
      }[];
    }
  | { readonly kind: "whole"; readonly slices: readonly SliceSpec[] };

function scopeInputs(scope: ReviewScope | undefined): Record<string, unknown> {
  if (scope === undefined) return {};
  if (scope.kind === "slice") {
    return {
      scope: "slice",
      slice: scope.slice,
      plan_index: scope.planIndex.map((t) => ({ id: t.id, slice: t.slice, title: t.title, surface: t.surface })),
      scope_instruction:
        `This draft is ONE slice, \`${scope.slice.id}\` (${scope.slice.title}). Judge coverage against ITS ` +
        "`requirement_ids` and `baseline_items` only (a PB-### item traces to `baseline:PB-###`, valid provenance); " +
        "`plan_index` lists the earlier slices' tickets, for dependency findings that reach across slices.",
    };
  }
  const carried = new Set(scope.slices.flatMap((s) => s.baseline_items));
  return {
    scope: "whole",
    slices: scope.slices,
    ...(carried.size === 0 ? {} : { production_baseline: PRODUCTION_BASELINE.filter((b) => carried.has(b.id)) }),
    scope_instruction:
      "This is the WHOLE plan across every slice, each ticket tagged with its slice. Add `coherence`: tickets that " +
      "contradict each other, duplicate each other, or disagree about the interface between them — usually in different " +
      "slices. Judge coverage across EVERY slice's `requirement_ids` and `baseline_items` (a PB-### item traces to " +
      "`baseline:PB-###`, which is valid provenance). Name the ticket in every finding; the slice is known from it.",
  };
}

async function reviewOnce(
  deps: ReviewDeps,
  tickets: readonly PlanDraftTicket[],
  previous: { readonly issue: string } | null,
  scope?: ReviewScope,
): Promise<{
  readonly review: PlanReview | null;
  readonly issue: string | null;
  readonly normalisedFrom: string | null;
}> {
  const file = planReviewPath(deps.root);
  rmSync(file, { force: true });
  try {
    await deps.launch(
      {
        stage: "REVIEW_PLAN",
        plan: tickets,
        docs: deps.docs,
        session_budget: sessionBudget(deps.budgets),
        ...(sizingEvidence(deps.root) === null
          ? {}
          : { sizing_evidence: sizingEvidence(deps.root) }),
        expected_output: planReviewSkeleton(),
        instruction: REVIEW_INSTRUCTION,
        ...scopeInputs(scope),
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
    return {
      review: null,
      issue: `review session failed: ${(err as Error).message}`,
      normalisedFrom: null,
    };
  }
  if (!existsSync(file))
    return { review: null, issue: "no artifact written", normalisedFrom: null };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    return {
      review: null,
      issue: `artifact is not JSON: ${(err as Error).message}`,
      normalisedFrom: null,
    };
  }
  const normalised = normaliseVerdict(raw);
  const parsed = parseArtifact(planReviewSchema, normalised.value);
  if (parsed.ok)
    return {
      review: parsed.value,
      issue: null,
      normalisedFrom: normalised.from,
    };
  const issue =
    parsed.reason === "invalid"
      ? parsed.issues.join("; ")
      : `schema_version ${parsed.found} is newer than ${parsed.supported}`;
  return { review: null, issue, normalisedFrom: null };
}

/**
 * PRDR-084's advisory review, with C-4⁗'s two repairs: a synonym for the
 * verdict is read as the word it means, and an artifact that is absent or
 * unusable buys ONE relaunch carrying the validator's own words — the same
 * relaunch a code review gets (A-5′). Only after that does the draft stand
 * unreviewed, and the note says why.
 */
export async function reviewPlan(
  deps: ReviewDeps,
  tickets: readonly PlanDraftTicket[],
  scope?: ReviewScope,
): Promise<PlanReview | null> {
  const first = await reviewOnce(deps, tickets, null, scope);
  if (first.review !== null) {
    if (first.normalisedFrom !== null)
      deps.note?.(
        `plan review: verdict \`${first.normalisedFrom}\` read as \`${first.review.verdict}\` (C-4⁗)`,
      );
    return first.review;
  }
  deps.note?.(
    `plan review artifact unusable (${first.issue}) — relaunching the review once (C-4⁗)`,
  );
  const second = await reviewOnce(
    deps,
    tickets,
    { issue: first.issue ?? "unusable" },
    scope,
  );
  if (second.review !== null) {
    if (second.normalisedFrom !== null)
      deps.note?.(
        `plan review: verdict \`${second.normalisedFrom}\` read as \`${second.review.verdict}\` (C-4⁗)`,
      );
    return second.review;
  }
  deps.note?.(
    `plan review artifact unusable again (${second.issue}) — the draft stands unreviewed (PRDR-084)`,
  );
  return null;
}

export function sessionBudget(budgets: Budgets): Record<string, number> {
  return {
    implement_turns: budgets.turns_per_stage,
    ticket_wall_clock_minutes: Math.round(
      budgets.ticket_wall_clock_ms / 60_000,
    ),
    sessions_per_generation: budgets.sessions,
  };
}
