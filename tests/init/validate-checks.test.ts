import { describe, expect, it } from "vitest";
import { checkReview, countsOf, fixIssues, mergeFindings, outcomes } from "../../src/init/validate-checks.js";
import { fixSkeleton, reviewSkeleton } from "../../src/init/validate-round.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { fixArtifactSchema, reviewArtifactSchema, type ReviewFinding } from "../../src/schemas/validate.js";
import { CONFORMING_PACK, packRepo } from "./pack-fixture.js";

/**
 * PRDR-284 — what code checks of VALIDATE's sessions (C-2¹⁴): each finding
 * stands on passages that are where it says, a round's findings are numbered
 * once each, and the writer accounts for every finding it was given.
 */

const CATALOG = "docs/prd/01-catalog.md";
const CHECKOUT = "docs/prd/02-checkout.md";
const PACK = Object.keys(CONFORMING_PACK).filter((rel) => rel !== "README.md");
/** Line 5 of the catalog PRD, as the fixture writes it. */
const STORE = { file: CATALOG, line: 5, quote: "The catalog MUST store every product with a title and a price in minor units" };

const found = (over: Partial<ReviewFinding> = {}): ReviewFinding => ({
  severity: "major",
  category: "contradiction",
  places: [STORE],
  why: "minor units and DZD disagree",
  fix: "say which minor unit",
  previous: null,
  ...over,
});

const review = (findings: readonly ReviewFinding[], read: readonly string[] = [CATALOG]) => ({ schema_version: SCHEMA_VERSION as typeof SCHEMA_VERSION, documents_read: [...read], findings: [...findings] });

describe("PRDR-284: a finding stands on what the pack says (C-2¹⁴)", () => {
  const given = { pack: PACK, documents: [CATALOG], previous: [] as string[] };

  it("keeps a finding whose every passage is at its line, whitespace aside, across a line break", () => {
    const root = packRepo();
    const wrapped = { file: CHECKOUT, line: 3, quote: "and MUST emit `order.placed` once the order is stored" };
    const checked = checkReview(root, review([found(), found({ places: [STORE, wrapped] })]), given);
    expect(checked.issues).toEqual([]);
    expect(checked.kept).toHaveLength(2);
    expect(checked.dropped).toEqual([]);
  });

  it("refuses a quote that is not at its line, and a place outside the pack's documents, and drops the finding", () => {
    const root = packRepo();
    const moved = found({ places: [{ ...STORE, line: 6 }] });
    const readme = found({ places: [{ file: "README.md", line: 3, quote: "A small shop." }] });
    const checked = checkReview(root, review([moved, readme, found()]), given);
    expect(checked.kept).toEqual([found()]);
    expect(checked.issues).toEqual([
      `${CATALOG}:6 does not hold "The catalog MUST store every product with a title and a price in minor units", whitespace aside`,
      "README.md:3 is not in one of the pack's documents",
    ]);
    expect(checked.dropped).toEqual([
      `${CATALOG}:6: ${CATALOG}:6 does not hold "The catalog MUST store every product with a title and a price in minor units", whitespace aside`,
      "README.md:3: README.md:3 is not in one of the pack's documents",
    ]);
  });

  it("refuses `previous` naming a finding the reviewer was not given, and takes one it was", () => {
    const root = packRepo();
    const checked = checkReview(root, review([found({ previous: "R1-9" }), found({ previous: "R1-2" })]), { ...given, previous: ["R1-2"] });
    expect(checked.issues).toEqual(["`previous` names R1-9, which is not a finding you were given"]);
    expect(checked.kept).toEqual([found({ previous: "R1-2" })]);
  });

  it("says which documents it was given and did not read, and drops no finding for it", () => {
    const root = packRepo();
    const checked = checkReview(root, review([found()], []), { ...given, documents: [CATALOG, CHECKOUT] });
    expect(checked.issues).toEqual([`the review did not read every document it was given: ${CATALOG}, ${CHECKOUT}`]);
    expect(checked.unread).toEqual([CATALOG, CHECKOUT]);
    expect(checked.kept).toHaveLength(1);
  });
});

describe("PRDR-284: a round's findings, numbered once each", () => {
  it("numbers them R<round>-<n> in the order the reviewers reported them, each with its reviewer's area", () => {
    const other = found({ places: [{ file: CHECKOUT, line: 3, quote: "x" }] });
    const merged = mergeFindings(3, [
      { area: 1, findings: [found()] },
      { area: 2, findings: [other] },
    ]);
    expect(merged.map((f) => [f.id, f.area])).toEqual([
      ["R3-1", 1],
      ["R3-2", 2],
    ]);
  });

  it("makes one of two that name the same places for the same kind of defect, the more severe standing where the first stood", () => {
    const second = found({ places: [{ file: CHECKOUT, line: 3, quote: "x" }] });
    const again = found({ severity: "blocker", why: "worded otherwise", places: [second.places[0]!, STORE] });
    const merged = mergeFindings(1, [{ area: 0, findings: [found({ places: [STORE, second.places[0]!] }), found({ places: [{ ...STORE, line: 9 }] })] }, { area: 2, findings: [again] }]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ id: "R1-1", severity: "blocker", why: "worded otherwise", area: 2 });
    expect(merged[1]?.id).toBe("R1-2");
  });

  it("keeps the first of two alike in severity, and keeps apart two at one place that differ in kind", () => {
    const merged = mergeFindings(1, [{ area: 0, findings: [found({ why: "first" }), found({ why: "second" }), found({ category: "gap" })] }]);
    expect(merged.map((f) => [f.why, f.category])).toEqual([
      ["first", "contradiction"],
      ["minor units and DZD disagree", "gap"],
    ]);
  });

  it("counts a round by severity", () => {
    expect(countsOf([found(), found({ severity: "blocker" }), found({ severity: "minor" }), found({ severity: "minor" })])).toEqual({ blocker: 1, major: 1, minor: 2 });
  });
});

describe("PRDR-284: the writer accounts for every finding it was given", () => {
  const account = (applied: string[], declined: { id: string; reason: string }[] = []) => ({ schema_version: SCHEMA_VERSION as typeof SCHEMA_VERSION, applied, declined });

  it("takes each id once, in applied or declined", () => {
    expect(fixIssues(account(["R1-1"], [{ id: "R1-2", reason: "no defect" }]), ["R1-1", "R1-2"])).toEqual([]);
  });

  it("refuses an id it was not given, one listed twice, and one listed nowhere", () => {
    expect(fixIssues(account(["R1-1", "R1-1", "R9-9"]), ["R1-1", "R1-2"])).toEqual([
      "R1-1 is listed twice",
      "R9-9 is not one of the findings you were given",
      "R1-2 is listed in neither applied nor declined",
    ]);
    expect(fixIssues(account(["R1-1"], [{ id: "R1-1", reason: "r" }]), ["R1-1"])).toEqual(["R1-1 is listed twice"]);
  });

  it("counts a finding applied only where the writer changed a document, and one it did not account for declined", () => {
    const said = account(["R1-1"], [{ id: "R1-2", reason: "the passages agree" }]);
    expect([...outcomes(said, ["R1-1", "R1-2", "R1-3"], true)]).toEqual([
      ["R1-1", { left: "applied", reason: "" }],
      ["R1-2", { left: "declined", reason: "the passages agree" }],
      ["R1-3", { left: "declined", reason: "its writer did not say whether it applied it" }],
    ]);
    expect(outcomes(said, ["R1-1"], false).get("R1-1")).toEqual({ left: "declined", reason: "its writer listed it as applied and changed no document" });
  });

  it("gives each session a skeleton its schema takes, so the two cannot drift", () => {
    expect(reviewArtifactSchema.safeParse(reviewSkeleton()).success).toBe(true);
    expect(fixArtifactSchema.safeParse(fixSkeleton()).success).toBe(true);
  });
});
