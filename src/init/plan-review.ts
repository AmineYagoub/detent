import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { parseArtifact } from "../schemas/common.js";
import type { Budgets } from "../schemas/budgets.js";
import { planReviewSchema, type PlanDraftTicket, type PlanReview } from "../schemas/init.js";

/**
 * PRDR-084 — the plan's own D-6.
 *
 * A fresh planner-role session judges the DRAFT plan before any ticket is
 * written, over the five properties a plan can be wrong about. The review
 * advises: an absent or unparseable verdict leaves the draft standing, because
 * a planning aid that can block the pipeline is a new way for init to fail.
 */

/** The exact artifact the REVIEW_PLAN stage writes (PRDR-084). */
export function planReviewSkeleton(): Record<string, unknown> {
  return {
    schema_version: 1,
    verdict: "approve",
    findings: [{ tag: "sizing", finding: "<what is wrong — required>", ticket: "t-100" }],
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
  readonly launch: (inputs: Record<string, unknown>, artifactOut?: string) => Promise<void>;
}

export async function reviewPlan(deps: ReviewDeps, tickets: readonly PlanDraftTicket[]): Promise<PlanReview | null> {
  rmSync(planReviewPath(deps.root), { force: true });
  await deps.launch({
    stage: "REVIEW_PLAN",
    plan: tickets,
    docs: deps.docs,
    session_budget: sessionBudget(deps.budgets),
    expected_output: planReviewSkeleton(),
    instruction:
      "Review this DRAFT PLAN — not code. Judge it on: sizing (does each ticket fit one implement session in `session_budget`), " +
      "testability (is every acceptance criterion checkable by a command or a test, not by opinion), coverage (does every requirement " +
      "in the documents reach some ticket), shape (do the earliest tickets form a walking skeleton through the riskiest integration, " +
      "rather than completing infrastructure layers first), traceability (is every ticket sourced from the documents rather than " +
      "invented), and boundaries (does each ticket state what it is NOT for, in `non_goals` — the implementer and the reviewer both " +
      "receive that field, and empty it leaves the reviewer's commonest judgement, is this in scope, with nothing to judge against). " +
      "An honest `approve` is a real verdict; do not manufacture findings, and a ticket with genuinely no boundary worth stating is " +
      "not a finding. Write EXACTLY the `expected_output` shape.",
  }, planReviewPath(deps.root));
  const file = planReviewPath(deps.root);
  const raw = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  const parsed = raw === null ? null : parseArtifact(planReviewSchema, raw);
  return parsed !== null && parsed.ok ? parsed.value : null;
}

export function sessionBudget(budgets: Budgets): Record<string, number> {
  return {
    implement_turns: budgets.turns_per_stage,
    ticket_wall_clock_minutes: Math.round(budgets.ticket_wall_clock_ms / 60_000),
    sessions_per_generation: budgets.sessions,
  };
}
