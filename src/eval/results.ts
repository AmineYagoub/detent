import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CLAIM_VERDICTS, claimBriefSchema } from "../schemas/audit.js";
import { SCHEMA_VERSION, sha256Hex } from "../schemas/common.js";
import { reviewFindingSchema } from "../schemas/validate.js";
import { EvalRefused } from "./sets.js";

/**
 * N-8 (PRDR-326) — what one evaluation of a set found, and what it cost: the
 * file the runner writes beside the set, outside this repository, and the
 * scorer reads. A unit that did not finish says why, the budget or a session
 * that failed, and is never read as a verdict.
 */

const ranSchema = {
  schema_version: z.literal(SCHEMA_VERSION),
  /** The set's directory, and when it was built, which the scorer checks it is scoring against. */
  set: z.strictObject({ dir: z.string(), built_at: z.string() }),
  route: z.strictObject({ model: z.string(), effort: z.string() }),
  build: z.string(),
  runtime: z.string(),
  copy: z.string(),
  started: z.string(),
  ended: z.string(),
  wall_ms: z.number().nonnegative(),
  spend_usd: z.number().nonnegative(),
  sessions: z.number().int().nonnegative(),
  budget_usd: z.number().positive(),
};

export const claimResultSchema = z.strictObject({
  claim_hash: sha256Hex,
  /** What the check settled; absent where it did not finish. */
  verdict: z.enum(CLAIM_VERDICTS).optional(),
  /** False where no session left a brief the validator took, as AUDIT records it (C-2¹¹). */
  checked: z.boolean(),
  source: z.string().optional(),
  correction: z.string().optional(),
  /** The brief the check committed, kept here since the next evaluation on the copy writes over it. */
  brief: claimBriefSchema.optional(),
  unfinished: z.string().optional(),
});
export type ClaimResult = z.infer<typeof claimResultSchema>;

export const areaResultSchema = z.strictObject({
  name: z.string(),
  /** The findings that stood, as VALIDATE keeps them; absent where the reviewer left no usable review or did not finish. */
  findings: z.array(reviewFindingSchema).optional(),
  unfinished: z.string().optional(),
});
export type AreaResult = z.infer<typeof areaResultSchema>;

export const claimsResultsSchema = z.strictObject({
  ...ranSchema,
  kind: z.literal("claims"),
  /** Present where only the claims arm A found wrong were checked, as today's setup is re-run (N-8). */
  only: z.literal("wrong").optional(),
  claims: z.array(claimResultSchema),
});
export type ClaimsResults = z.infer<typeof claimsResultsSchema>;
export const reviewsResultsSchema = z.strictObject({
  ...ranSchema,
  kind: z.literal("reviews"),
  /** S-6‴: present where every reviewer was handed the foundations as its system prompt. */
  foundations: z.literal("given").optional(),
  areas: z.array(areaResultSchema),
});
export type ReviewsResults = z.infer<typeof reviewsResultsSchema>;
export const evalResultsSchema = z.discriminatedUnion("kind", [claimsResultsSchema, reviewsResultsSchema]);
export type EvalResults = z.infer<typeof evalResultsSchema>;

/** A person's word on a confirmed claim an evaluation called wrong: whose check was mistaken (N-8). */
export const settlementsSchema = z.record(sha256Hex, z.enum(["arm_a_mistaken", "arm_mistaken"]));
export type Settlements = z.infer<typeof settlementsSchema>;

const stamp = (iso: string): string => iso.replace(/[:.]/gu, "-");

/** Writes `results` under `dir` with a name that says what ran, and returns the file. */
export function writeResults(dir: string, results: EvalResults): string {
  mkdirSync(dir, { recursive: true });
  const given = results.kind === "reviews" && results.foundations === "given" ? "-foundations-given" : "";
  const file = path.join(dir, `${results.kind}-${results.route.model}-${results.route.effort}${given}-${stamp(results.started)}.json`);
  writeFileSync(file, `${JSON.stringify(results, null, 2)}\n`);
  return file;
}

export function readResults(file: string): EvalResults {
  if (!existsSync(file)) throw new EvalRefused(`${file} does not exist`);
  return evalResultsSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

export function readSettlements(file: string | undefined): Settlements {
  if (file === undefined) return {};
  if (!existsSync(file)) throw new EvalRefused(`${file} does not exist`);
  return settlementsSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}
