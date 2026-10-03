import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { definitionText } from "../docs/prd-marks.js";
import { repo } from "./plan-fixture.js";
import type { Json } from "./decide-fixture.js";
import { RAW } from "./write-fixture.js";
import { appliesAll, finding, initThroughValidate, record, review, reviewers } from "./validate-fixture.js";

/**
 * PRDR-333 — a first round's finding with no `previous` reads as null
 * (C-2²⁸).
 *
 * `previous` names the finding of the round before that a finding is what
 * remains of. A first round's reviewer is given none, so null is the only
 * value the field can hold there. On N-8's review set at Opus 5.5 `high`, 5
 * of the 10 reviewers left it out of every finding, and each was relaunched
 * for a second whole review; at `max`, none did.
 */

const REPO = path.resolve(import.meta.dirname, "..", "..");

/** A finding with no `previous` at all, as those reviewers wrote theirs. */
const bare = (over: Json = {}): Json => Object.fromEntries(Object.entries(finding(over)).filter(([key]) => key !== "previous"));

const launchesOf = (inputs: readonly Json[], area: string, round: number): Json[] => inputs.filter((i) => i["area"] === area && i["round"] === round);

/** Reviewers who answer Lending's attempts in `round` from `attempts`, in order, and report nothing elsewhere; round 1 reports one finding unless `round` is 1. */
function lendingAttempts(round: number, attempts: readonly (readonly Json[])[]) {
  let made = 0;
  return reviewers((_, inputs) => {
    if (inputs["area"] !== "Lending") return review(inputs);
    if (inputs["round"] === round) return review(inputs, attempts[Math.min(made++, attempts.length - 1)] ?? []);
    return review(inputs, inputs["round"] === 1 ? [finding()] : []);
  });
}

describe("PRDR-333 a first round's finding with no previous reads as null (C-2²⁸)", () => {
  it("takes a first round's review whose findings leave out previous at its first attempt, with nothing said", async () => {
    const root = repo(RAW);
    const notes: string[] = [];
    const r = lendingAttempts(1, [[bare()]]);
    await initThroughValidate(root, { reviewers: r, writer: appliesAll(), notes });
    expect(launchesOf(r.inputs, "Lending", 1), "one session for the review").toHaveLength(1);
    expect(notes.join("\n")).not.toMatch(/unusable|relaunching/u);
    expect(record(root).rounds[0]?.counts.major, "its finding stands").toBe(1);
  }, 120_000);

  it("keeps a verification's previous required: one left out is refused at the first attempt", async () => {
    const root = repo(RAW);
    const r = lendingAttempts(2, [[bare()], [finding()]]);
    await initThroughValidate(root, { reviewers: r, writer: appliesAll() });
    const verifying = launchesOf(r.inputs, "Lending", 2);
    expect(verifying.map((i) => i["task"])).toEqual(["verify", "verify"]);
    expect(String((verifying[1]?.["previous_attempt"] as Json | undefined)?.["issue"])).toMatch(/findings\.0\.previous/u);
  }, 120_000);

  it("still refuses a first round's finding that names a finding it was not given", async () => {
    const root = repo(RAW);
    const r = lendingAttempts(1, [[finding({ previous: "R0-9" })], [finding()]]);
    await initThroughValidate(root, { reviewers: r, writer: appliesAll() });
    const reviewing = launchesOf(r.inputs, "Lending", 1);
    expect(reviewing).toHaveLength(2);
    expect((reviewing[1]?.["previous_attempt"] as Json)["issue"]).toBe("`previous` names R0-9, which is not a finding you were given");
  }, 120_000);

  it("C-2²⁸ states the rule, and C-2¹⁴ carries the amendment", () => {
    const prd = readFileSync(path.join(REPO, "detent-prd-v3.md"), "utf8");
    const rule = (definitionText(prd, "C-2²⁸")[0] ?? "").replace(/\s+/gu, " ");
    for (const said of ["`previous`", "reads as null", "A verification's keeps the field required", "5 of the 10"]) expect(rule, said).toContain(said);
    expect((definitionText(prd, "C-2¹⁴")[0] ?? "").replace(/\s+/gu, " ")).toContain("*Amended by C-2²⁸ (PRDR-333)");
  });
});
