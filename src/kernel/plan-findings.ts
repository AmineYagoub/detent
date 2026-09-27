import { existsSync, readFileSync } from "node:fs";
import { checkpointPath } from "../fs/checkpoints.js";
import type { PlanFinding } from "../schemas/init.js";

/**
 * PRDR-271 — the reader for what PLAN recorded on a ticket, keyed by the ticket.
 *
 * PLAN writes these: `plan.ts` assembles the list and `writeCheckpoint`
 * persists the stage's outputs to `state/PLAN.json`, where
 * `outputs.review_findings` is the full set: the review's minor findings, each
 * with its fix, and the repairs code made to a draft (C-4⁸, PRDR-294). A
 * blocker or major is not among them: it bought its slice a revision, and is
 * the operator's risk at PRESENT.
 *
 * It lives in its own module rather than on `RefereeContext` because the dossier
 * builds without a context and needs the same answer; one definition means the
 * order a session is shown and the order a human is shown cannot drift.
 */

/**
 * C-4⁸ (PRDR-294): a finding's weight is its grade, the review's own; a repair
 * code made carries none and sorts after. A PLAN.json written before the
 * review graded its findings carries none either, and keeps its order.
 */
const RANK: Readonly<Record<string, number>> = { blocker: 0, major: 1, minor: 2 };
const rank = (f: PlanFinding): number => (f.severity === undefined ? 3 : (RANK[f.severity] ?? 3));

/** The findings naming `ticketId`, gravest first, or `null` when PLAN has not run, wrote nothing readable, or named no such ticket. */
export function readPlanFindings(root: string, ticketId: string): readonly PlanFinding[] | null {
  const file = checkpointPath(root, "PLAN");
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { outputs?: { review_findings?: unknown } };
    const all = raw.outputs?.review_findings;
    if (!Array.isArray(all)) return null;
    const mine = (all as readonly PlanFinding[]).filter((f) => f !== null && typeof f === "object" && f.ticket === ticketId);
    if (mine.length === 0) return null;
    return [...mine].sort((a, b) => rank(a) - rank(b));
  } catch {
    return null;
  }
}

/**
 * One finding as a line for a human — the form the dossier carries (X-8's
 * artifacts are read at an escalation, where the question is what PLAN already
 * knew): its grade where the review gave one, and the fix it asked for.
 */
export function findingLine(finding: PlanFinding): string {
  const grade = finding.severity === undefined ? "" : `${finding.severity} `;
  const fix = finding.fix === undefined ? "" : ` — fix: ${finding.fix}`;
  return `${grade}${finding.tag}: ${finding.finding}${fix}`;
}
