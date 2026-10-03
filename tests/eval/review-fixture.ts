import { writeFileSync } from "node:fs";
import { expect } from "vitest";
import { okResult, resultFromSdk, type StageFn } from "../../src/sessions/mock.js";
import { inputsOf } from "../init/slicing-fixture.js";
import { repo } from "../init/plan-fixture.js";
import { appliesAll, initThroughValidate, review, type Reviewers } from "../init/validate-fixture.js";
import { CODES, prdOf, wide } from "../init/validate-wide-fixture.js";
import { RAW } from "../init/write-fixture.js";

/**
 * PRDR-326 — a copy whose `init` stopped in VALIDATE's first round with some
 * reviews kept, as tabachir's did, for N-8's tests of the reviews set.
 */

export type Json = Record<string, unknown>;

export const QUOTE = "Borrowing a tool MUST cost nothing in the MVP";
export const at = (severity: string, file: string): Json => ({ severity, category: "contradiction", places: [{ file, line: 5, quote: QUOTE }], why: `${severity} in ${file}`, fix: "fix it", previous: null });
const CRASH = resultFromSdk({ subtype: "success", is_error: true, result: "the session crashed", total_cost_usd: 0.5, modelUsage: {}, num_turns: 3 });

/** Reviewers who report a blocker in Lending, and a major and a minor too where `lendingMajor` says, and a major in Borrowing; the reviewer of Returns crashes, so round 1 stops with the others kept. */
export function stoppedReviewers(lendingMajor = false): Reviewers {
  const inputs: Json[] = [];
  const stage: StageFn = async (spec) => {
    const given = inputsOf(spec) as Json;
    inputs.push(given);
    if (given["area"] === "Area RTN") return CRASH;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const lending = lendingMajor ? [at("blocker", prdOf(0)), at("major", prdOf(0)), at("minor", prdOf(0))] : [at("blocker", prdOf(0))];
    const findings = given["area"] === `Area ${CODES[0] ?? ""}` ? lending : given["area"] === `Area ${CODES[1] ?? ""}` ? [at("major", prdOf(1))] : [];
    writeFileSync(spec.artifactOut, `${JSON.stringify(review(given, findings))}\n`);
    return okResult({ turns: 4 });
  };
  return { stage, inputs };
}

/** A copy whose `init` stopped in round 1 with the reviews of the foundations, Lending and Borrowing kept, as tabachir's did. */
export async function stoppedCopy(opts: { readonly lendingMajor?: boolean } = {}): Promise<string> {
  const root = repo(RAW);
  await expect(initThroughValidate(root, { reviewers: stoppedReviewers(opts.lendingMajor), writer: appliesAll() }, wide())).rejects.toThrow(/the session crashed/u);
  return root;
}
