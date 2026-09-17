import { existsSync, readFileSync } from "node:fs";
import { checkpointPath } from "../fs/checkpoints.js";
import type { HeldFinding } from "../schemas/init.js";

/**
 * PRDR-271 — the reader for PLAN's held findings, keyed by the ticket they name.
 *
 * PLAN already writes these: `plan.ts` assembles the held list and
 * `writeCheckpoint` persists the stage's outputs to `state/PLAN.json`, where
 * `outputs.review_findings` is the full set. Until this module nothing under
 * `src/kernel/` read it — `advice.md` was the only consumed form, it is Markdown
 * for a human, and it is written only when the list exceeds `ADVICE_INLINE_MAX`.
 *
 * It lives in its own module rather than on `RefereeContext` because the dossier
 * builds without a context and needs the same answer; one definition means the
 * order a session is shown and the order a human is shown cannot drift.
 */

/**
 * The findings naming `ticketId`, strongest first, or `null` when PLAN has not
 * run, wrote nothing readable, or named no such ticket.
 *
 * Ordering is by `seen` descending — how many of the k reads reproduced the
 * finding. Over six reads of one slice (D-30) about half of what survives the
 * ⌈k/2⌉ filter reproduced five or six times and half three or four, so a reader
 * that cannot chase all of them should chase the reproduced ones first. An
 * uncounted finding sorts last rather than above a measured one: absent a count
 * there is no evidence of strength, and `?? 0` is that reading.
 */
export function readPlanFindings(root: string, ticketId: string): readonly HeldFinding[] | null {
  const file = checkpointPath(root, "PLAN");
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { outputs?: { review_findings?: unknown } };
    const all = raw.outputs?.review_findings;
    if (!Array.isArray(all)) return null;
    const mine = (all as readonly HeldFinding[]).filter((f) => f !== null && typeof f === "object" && f.ticket === ticketId);
    if (mine.length === 0) return null;
    return [...mine].sort((a, b) => (b.seen ?? 0) - (a.seen ?? 0));
  } catch {
    return null;
  }
}

/**
 * One finding as a line for a human — the form the dossier carries (X-8's
 * artifacts are read at an escalation, where the question is what PLAN already
 * knew). The count is included when there is one, because "three of three reads
 * said this" and "two of three" are different evidence and the dossier is where
 * that difference decides whether a human believes it.
 */
export function findingLine(finding: HeldFinding): string {
  const seen = finding.seen === undefined ? "" : ` (seen in ${finding.seen} of the plan's reads)`;
  return `${finding.tag}: ${finding.finding}${seen}`;
}
