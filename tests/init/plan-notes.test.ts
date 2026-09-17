import { describe, expect, it } from "vitest";
import { nullNote, remainLine } from "../../src/init/plan-notes.js";
import { revisionOutcome } from "../../src/init/plan-signal.js";
import type { PlanReview } from "../../src/schemas/init.js";

/**
 * PRDR-270: the line that reports a revision must carry the two numbers that
 * decide whether `introduced` was forced.
 *
 * `revisionOutcome` defines `introduced = |after| - survived` and `survived <=
 * |before|`, so `introduced >= |after| - |before|`, which is `introduced -
 * resolved`. PRDR-269's s07 recorded `3 resolved, 1 survived, 9 introduced`
 * with `|before| = 4` and `|after| = 10`: a floor of 6 that no revision could
 * have gone below. The line printed the 9 and neither of the two sizes.
 */
const finding = (ticket: string, tag: PlanReview["findings"][number]["tag"]): PlanReview["findings"][number] => ({
  ticket,
  tag,
  finding: `${ticket} ${tag}`,
});

describe("PRDR-270 — a revision line carries its own floor", () => {
  it("names |before|, |after| and the forced minimum for PRDR-269's recorded s07 figure", () => {
    const handed = [finding("t-s07-001", "dependency"), finding("t-s07-002", "sizing"), finding("t-s07-003", "coherence"), finding("t-s07-004", "coverage")];
    const leftover = [
      handed[3] as PlanReview["findings"][number],
      ...["005", "006", "007", "008", "009", "010", "011", "012", "013"].map((n) => finding(`t-s07-${n}`, "dependency")),
    ];
    const revision = revisionOutcome(handed, leftover);
    expect(revision).toStrictEqual({ resolved: 3, survived: 1, introduced: 9 });

    const line = remainLine("s07 review after revision", leftover.length, revision, nullNote(null, 0), "dependency");

    expect(line).toContain("4 handed");
    expect(line).toContain("10 left");
    expect(line).toContain("6 of the 9 forced");
  });
});
