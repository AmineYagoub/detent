import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lineOf } from "../../src/init/audit-passages.js";
import { checkReview } from "../../src/init/validate-checks.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import type { ReviewFinding } from "../../src/schemas/validate.js";
import type { Json } from "./decide-fixture.js";
import { CONFORMING_PACK, packRepo } from "./pack-fixture.js";
import { repo } from "./plan-fixture.js";
import { LATE_RULE, LENDING_PRD, appliesAll, finding, initThroughValidate, review, reviewers } from "./validate-fixture.js";
import { RAW } from "./write-fixture.js";

/**
 * PRDR-315 — a quote one line from where it says stands on the line that
 * holds it (C-2²⁵).
 *
 * Tabachir's test run relaunched two of VALIDATE's first four reviews for a
 * quote that was word for word in its document, one line off: `:11` for a
 * requirement on line 10, and `:57` for a decision on line 58. Each relaunch
 * is a whole review again. A quote on exactly one line of its document is not
 * invented, and code can find its line.
 */

describe("PRDR-315 a VALIDATE finding whose quote is on another line stands there (C-2²⁵)", () => {
  it("keeps a finding one line off at the line that holds its quote, relaunches nothing, and says where it moved", async () => {
    const root = repo(RAW);
    const notes: string[] = [];
    const r = reviewers((_, inputs) => review(inputs, inputs["area"] === "Lending" && inputs["round"] === 1 ? [finding({ places: [{ ...LATE_RULE, line: 7 }] })] : []));
    const w = appliesAll();
    await initThroughValidate(root, { reviewers: r, writer: w, notes });

    expect(r.inputs.filter((i) => i["previous_attempt"] !== undefined), "no review relaunched").toEqual([]);
    const given = (w.inputs[0]?.["findings"] as { places: Json[] }[] | undefined)?.[0]?.places;
    expect(given, "the writer is given the line that holds the quote").toEqual([LATE_RULE]);
    expect(notes.join("\n")).toContain(`VALIDATE round 1, Lending: 1 quote was not on the line it named, and stands on the one line that holds it: ${LENDING_PRD}:7 → 6 (C-2²⁵)`);
  });
});

const CATALOG = "docs/prd/01-catalog.md";
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
const artifact = (findings: readonly ReviewFinding[]) => ({ schema_version: SCHEMA_VERSION as typeof SCHEMA_VERSION, documents_read: [CATALOG], findings: [...findings] });
const given = { pack: PACK, documents: [CATALOG], previous: [] as string[] };

describe("PRDR-315 what the check finds of a quote not at its line (C-2²⁵)", () => {
  it("moves a quote on one other line to it, and lists the move", () => {
    const root = packRepo();
    const checked = checkReview(root, artifact([found({ places: [{ ...STORE, line: 7 }] })]), given);
    expect(checked.issues).toEqual([]);
    expect(checked.kept).toEqual([found()]);
    expect(checked.moved).toEqual([`${CATALOG}:7 → 5`]);
  });

  it("refuses a quote that two other lines hold, since it cannot say which it meant", () => {
    const root = packRepo();
    const file = path.join(root, ...CATALOG.split("/"));
    writeFileSync(file, `${CONFORMING_PACK[CATALOG] ?? ""}\n${STORE.quote}.\n`);
    const checked = checkReview(root, artifact([found({ places: [{ ...STORE, line: 2 }] })]), given);
    expect(checked.kept).toEqual([]);
    expect(checked.issues).toEqual([`${CATALOG}:2 does not hold ${JSON.stringify(STORE.quote)}, whitespace aside`]);
    expect(checked.moved).toEqual([]);
  });

  it("lists no move for a finding it drops for another of its places", () => {
    const root = packRepo();
    const readme = { file: "README.md", line: 3, quote: "A small shop." };
    const checked = checkReview(root, artifact([found({ places: [{ ...STORE, line: 7 }, readme] })]), given);
    expect(checked.kept).toEqual([]);
    expect(checked.moved).toEqual([]);
  });
});

describe("PRDR-315 lineOf: the line a quote starts on (C-2²⁵)", () => {
  const TEXT = ["# Notes", "", "Borrowing is free.", "A late return blocks new", "  loans until the tool is back.", "Borrowing is free.", "Fees are kept.", ""].join("\n");
  const at = (line: number, quote: string) => ({ file: "notes.md", line, quote });

  it("answers the line named when it holds the quote, even where another line holds it too", () => {
    const root = repo({ "notes.md": TEXT });
    expect(lineOf(root, at(7, "Fees are kept."))).toBe(7);
    expect(lineOf(root, at(3, "Borrowing is free."))).toBe(3);
  });

  it("answers the one other line that holds it, a quote across a line break included", () => {
    const root = repo({ "notes.md": TEXT });
    expect(lineOf(root, at(6, "Fees are kept."))).toBe(7);
    expect(lineOf(root, at(2, "A late return blocks new loans until the tool is back."))).toBe(4);
  });

  it("answers null for a quote two other lines hold, one no line holds, and a file that is not there", () => {
    const root = repo({ "notes.md": TEXT });
    expect(lineOf(root, at(7, "Borrowing is free."))).toBeNull();
    expect(lineOf(root, at(7, "Fees are refunded."))).toBeNull();
    expect(lineOf(root, { file: "absent.md", line: 1, quote: "Fees are kept." })).toBeNull();
  });
});
