import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { stateDir } from "../fs/layout.js";
import { noteUnitComplete } from "../kernel/ledger.js";
import { SCHEMA_VERSION, sha256Hex } from "../schemas/common.js";
import { reviewFindingSchema, type ReviewFinding } from "../schemas/validate.js";
import type { ScratchGrant } from "../sessions/sandbox.js";
import { inBatches } from "./batches.js";
import { contentsDigest } from "./machine.js";
import { reviewArea, type ReviewTask, type RoundDeps } from "./validate-round.js";
import type { Area } from "./validate-scope.js";

/**
 * C-2²³ (PRDR-313) — a VALIDATE round's reviews: as many at once as
 * `budgets.init_sessions_at_once` says, four by default (X-1⁸, PRDR-324),
 * each kept as it lands.
 *
 * C-2¹⁴ ran one reviewer per area, one after another, and held what they
 * found in memory until the round's writer ran. Tabachir's pack has 26 areas,
 * and its first reviewer ran for more than half an hour: a round would have
 * taken most of a day, and a stop anywhere in it lost every review it had paid
 * for. Nothing in a round needs the order: each reviewer reads the foundations
 * and its own documents, and the findings are merged once all have reported.
 * So the reviewers run as AUDIT's checks do (C-2¹⁶), each writing its own
 * artifact, and what they report is merged in the areas' order, as a
 * sequential round merged it.
 *
 * Each review is kept as it lands, under a digest of what its reviewer read:
 * the round, its area, the foundations and its documents with their contents,
 * the heuristic reports, the findings it verifies, the diff with its contents,
 * and the reviewer's prompt. A re-run of the round takes each kept review
 * whose digest holds and reviews the rest, as AUDIT's kept survey is taken
 * (C-2¹⁷). Once the round is recorded, its record is what the next round
 * starts from, and the kept reviews go. No session can write them: the
 * structural floor keeps every session out of `.detent/state/` (SEC-3′).
 */
const keptSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  reviews: z.array(z.strictObject({ key: sha256Hex, round: z.number().int().positive(), area: z.string(), findings: z.array(reviewFindingSchema) })),
});
type Kept = z.infer<typeof keptSchema>["reviews"][number];

export function keptReviewsPath(root: string): string {
  return path.join(stateDir(root), "state", "validate", "reviews-kept.json");
}

/** The kept reviews, or none where there is no file or this build cannot read it: a review not trusted is done again. */
function readKept(root: string): Kept[] {
  const file = keptReviewsPath(root);
  if (!existsSync(file)) return [];
  try {
    const parsed = keptSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? parsed.data.reviews : [];
  } catch {
    return [];
  }
}

function keep(root: string, review: Kept): void {
  const reviews = [...readKept(root).filter((r) => r.key !== review.key), review];
  mkdirSync(path.dirname(keptReviewsPath(root)), { recursive: true });
  writeFileSync(keptReviewsPath(root), `${JSON.stringify({ schema_version: SCHEMA_VERSION, reviews })}\n`);
}

/** Once the round is recorded, its record is what the next round starts from. */
export function dropKeptReviews(root: string): void {
  rmSync(keptReviewsPath(root), { force: true });
}

/**
 * What a reviewer reads, digested: what it is given, and the contents of every
 * file it is given to read. N-8 (PRDR-326): the evaluation set's builder reads
 * a kept review as its reviewer's only where this key holds, which proves the
 * files it keeps are the ones that reviewer read.
 *
 * S-6‴: a reviewer handed the foundations is keyed apart from one that read
 * them, so a review kept under one setting is not taken under the other. A
 * reviewer that reads them is keyed as before, so the keys of every review
 * kept, and of N-8's set, still hold.
 */
export function reviewKey(root: string, round: number, task: ReviewTask, prompt: string, foundations: "read" | "given" = "read"): string {
  const files = [...task.foundations, ...task.documents, ...(task.diff === null ? [] : [task.diff])];
  const given = [round, task.area.name, task.foundations, task.documents, task.heuristic, task.previous, task.diff, prompt, contentsDigest(root, files)];
  return createHash("sha256")
    .update(JSON.stringify(foundations === "given" ? [...given, "foundations given"] : given))
    .digest("hex");
}

export interface KeptRoundDeps extends RoundDeps {
  /** The `spec_review` prompt's hash: a kept review answers only for the prompt it was made with. */
  readonly reviewPrompt: string;
  /** X-1⁸ (PRDR-324): how many reviewers run at once. */
  readonly atOnce: number;
}

/**
 * The round's reviews, each with its area's index in `areas`: every kept one
 * whose key holds, and the rest reviewed `atOnce` at a time, each kept as it
 * lands. A reviewer that fails lets those in flight end, kept, and then fails
 * the round (C-2¹⁶).
 */
export async function reviewRound(
  deps: KeptRoundDeps,
  round: number,
  tasks: readonly ReviewTask[],
  areas: readonly Area[],
  pack: readonly string[],
  scratch: ScratchGrant | null,
): Promise<{ area: number; findings: ReviewFinding[] }[]> {
  const kept = new Map(readKept(deps.root).map((r) => [r.key, r.findings]));
  const slots = tasks.map((task) => {
    const key = reviewKey(deps.root, round, task, deps.reviewPrompt, deps.foundations ?? "read");
    return { task, key, area: areas.indexOf(task.area), findings: kept.get(key) };
  });
  const reused = slots.filter((s) => s.findings !== undefined).length;
  if (reused > 0) {
    deps.note?.(
      `VALIDATE round ${String(round)}: ${String(reused)} of ${String(tasks.length)} reviews are the ones a stopped run kept, since nothing their reviewers read has moved (C-2²³)`,
    );
  }
  const toReview = slots.filter((s) => s.findings === undefined);
  const step = deps.estimate?.begin({
    phase: "VALIDATE",
    step: `VALIDATE round ${String(round)}'s reviews`,
    said: `VALIDATE round ${String(round)}: ${String(toReview.length)} area${toReview.length === 1 ? "" : "s"} to review, a session each, ${String(deps.atOnce)} at once`,
    units: toReview.map((s) => ({ role: "spec_review", task: s.task.previous === null ? "review" : "verify" })),
    atOnce: deps.atOnce,
  });
  await inBatches(toReview, deps.atOnce, async (slot) => {
    const unit = step?.start();
    const findings = await reviewArea(deps, round, slot.task, pack, scratch, slot.area);
    keep(deps.root, { key: slot.key, round, area: slot.task.area.name, findings });
    /* X-1⁵: a kept review is a unit of work, as a kept brief is. */
    noteUnitComplete(deps.root);
    slot.findings = findings;
    unit?.done();
  });
  step?.end();
  return slots.map((s) => ({ area: s.area, findings: [...(s.findings ?? [])] }));
}
