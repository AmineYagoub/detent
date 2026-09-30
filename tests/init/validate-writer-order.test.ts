import { describe, expect, it } from "vitest";
import { VALIDATE_FIX_BATCH, fixBatches, minorsAlone, writerBatches } from "../../src/init/validate-fix.js";
import type { ToFix } from "../../src/init/validate-round.js";
import type { Json } from "./decide-fixture.js";
import { repo } from "./plan-fixture.js";
import { byRound, initThroughValidate, writer, type Reviewers, type Writer } from "./validate-fixture.js";
import { CODES, prdOf, wide } from "./validate-wide-fixture.js";
import { RAW } from "./write-fixture.js";

/**
 * C-2²⁷ (PRDR-323) — VALIDATE's writer takes the findings that share a first
 * place together, the most severe first. C-2²⁴ cut a round's findings into
 * batches in the areas' order: on tabachir's first round, 22 places fell in
 * two or more of the 19 batches, each batch's writer editing a place without
 * seeing what another would ask of it, and the first batch already held a
 * minor while the seventeenth was the last to hold a blocker.
 */

const QUOTE = "Borrowing a tool MUST cost nothing in the MVP";
const CATEGORIES = ["gap", "contradiction", "untestable", "name-drift"];
const fourAt = (file: string, severity: string): Json[] =>
  CATEGORIES.map((category) => ({ severity, category, places: [{ file, line: 5, quote: QUOTE }], why: `${category} in ${file}`, fix: `fix the ${category} in ${file}`, previous: null }));
const severitiesGiven = (inputs: readonly Json[]): string[][] => inputs.map((i) => ((i["findings"] as { severity: string }[] | undefined) ?? []).map((f) => f.severity));
const firstPlacesGiven = (inputs: readonly Json[]): string[][] =>
  inputs.map((i) => ((i["findings"] as { places: { file: string; line: number }[] }[] | undefined) ?? []).map((f) => `${f.places[0]?.file ?? ""}:${String(f.places[0]?.line ?? 0)}`));
/** Each module area reports four findings in round 1, of the severity `severityOf` gives it, and nothing after. */
const perArea = (severityOf: (i: number) => string, extra: (i: number) => Json[] = () => []): Reviewers =>
  byRound((round, area) => {
    const i = CODES.findIndex((code) => area === `Area ${code}`);
    return round === 1 && i !== -1 ? [...fourAt(prdOf(i), severityOf(i)), ...extra(i)] : [];
  });

describe("C-2²⁷ the writer takes a place's findings together, the most severe first", () => {
  it("gives one batch two findings from different areas that share a first place, however far apart the areas are", async () => {
    const root = repo(RAW);
    /* The fourth area also reports a gap at the Lending PRD's first requirement, where the first area reported its four. */
    const shared = (i: number): Json[] =>
      i === 3 ? [{ severity: "minor", category: "gap", places: [{ file: prdOf(0), line: 5, quote: QUOTE }, { file: prdOf(3), line: 5, quote: QUOTE }], why: "shared", fix: "fix it", previous: null }] : [];
    const w = writer(() => ({}));
    await initThroughValidate(root, { reviewers: perArea(() => "minor", shared), writer: w }, wide());
    const batches = firstPlacesGiven(w.inputs);
    const holding = batches.map((b) => b.filter((p) => p === `${prdOf(0)}:5`).length);
    expect(holding.filter((n) => n > 0), JSON.stringify(batches)).toEqual([5]);
  });

  it("runs the batches that hold a blocker before any batch that holds only minors", async () => {
    const root = repo(RAW);
    /* The last area's four are blockers; the other five areas' are minors. */
    const w = writer(() => ({}));
    await initThroughValidate(root, { reviewers: perArea((i) => (i === 5 ? "blocker" : "minor")), writer: w }, wide());
    const severities = severitiesGiven(w.inputs.filter((i) => i["source"] === "review"));
    expect(severities[0]?.slice(0, 4), "the blockers go first").toEqual(["blocker", "blocker", "blocker", "blocker"]);
    const firstMinorsOnly = severities.findIndex((b) => b.every((s) => s === "minor"));
    const lastBlocker = severities.map((b, n) => (b.includes("blocker") ? n : -1)).reduce((a, b) => Math.max(a, b), -1);
    expect(firstMinorsOnly).toBeGreaterThan(lastBlocker);
  });

  it("says how many batches hold only minors, and what they cost by their ledger rows", async () => {
    const root = repo(RAW);
    const base = writer(() => ({}));
    const costs = [1.25, 2.5];
    const w: Writer = {
      inputs: base.inputs,
      stage: (spec) => {
        const call = base.inputs.length;
        return { ...base.stage(spec), costEstimateUsd: costs[call] ?? 0 };
      },
    };
    const notes: string[] = [];
    await initThroughValidate(root, { reviewers: perArea((i) => (i === 5 ? "blocker" : "minor")), writer: w, notes }, wide());
    const said = notes.join("\n");
    expect(said).toContain("VALIDATE's writer, round 1: 24 findings in 2 batches of at most 20, one after another (C-2²⁴); a place's findings together, the most severe first, and 1 batch holds only minors (C-2²⁷)");
    expect(said).toContain("VALIDATE's writer, round 1: the batch of minors alone cost $2.50, by their ledger rows (C-2²⁷)");
  });
});

describe("C-2²⁷ what the minors alone cost, in a round of one batch", () => {
  it("prices the batch of minors when it is the round's only batch", async () => {
    const root = repo(RAW);
    const base = writer(() => ({}));
    const w: Writer = { inputs: base.inputs, stage: (spec) => ({ ...base.stage(spec), costEstimateUsd: 0.75 }) };
    const notes: string[] = [];
    const threeAreas = byRound((round, area) => {
      const i = CODES.findIndex((code) => area === `Area ${code}`);
      return round === 1 && i >= 0 && i < 3 ? fourAt(prdOf(i), "minor") : [];
    });
    await initThroughValidate(root, { reviewers: threeAreas, writer: w, notes }, wide());
    const said = notes.join("\n");
    expect(said).not.toContain("batches of at most");
    expect(said).toContain("VALIDATE's writer, round 1: the batch of minors alone cost $0.75, by their ledger rows (C-2²⁷)");
  });
});

describe("C-2²⁷ how the batches are cut", () => {
  const f = (id: string, severity: string, file: string, line: number): ToFix => ({ id, severity, category: "gap", places: [{ file, line, quote: "q" }], why: "w", fix: "x" });
  const idsOf = (batches: readonly (readonly ToFix[])[]): string[][] => batches.map((b) => b.map((x) => x.id));

  it("cuts findings that share no place as C-2²⁴ always did: as few batches as the size allows, as even as can be", () => {
    const singles = Array.from({ length: 41 }, (_, n) => f(`R1-${String(n + 1)}`, "major", "a.md", n + 1));
    expect(writerBatches(singles).map((b) => b.length)).toEqual(fixBatches(singles).map((b) => b.length));
    expect(writerBatches(singles).map((b) => b.length)).toEqual([14, 14, 13]);
  });

  it("orders groups by their most severe finding, then by file and line, and a minor at a blocker's place goes with the blocker", () => {
    const batches = writerBatches(
      [f("m1", "minor", "b.md", 1), f("M1", "major", "a.md", 9), f("m2", "minor", "a.md", 2), f("m3", "minor", "c.md", 4), f("B1", "blocker", "c.md", 4), f("M2", "major", "a.md", 3)],
      VALIDATE_FIX_BATCH,
    );
    expect(idsOf(batches), "the minors at no blocker's or major's place come after, in a batch of their own").toEqual([
      ["B1", "m3", "M2", "M1"],
      ["m2", "m1"],
    ]);
  });

  it("puts a finding that names no place after the groups of its severity that name one, each such finding alone", () => {
    const placeless = (id: string): ToFix => ({ id, severity: "major", category: "gap", places: [], why: "w", fix: "x" });
    expect(idsOf(writerBatches([placeless("x1"), f("M1", "major", "a.md", 1), placeless("x2"), f("B1", "blocker", "z.md", 9)]))).toEqual([["B1", "M1", "x1", "x2"]]);
  });

  it("never splits a group across batches unless it holds more than a batch, and cuts on group boundaries", () => {
    const group = (at: string, n: number, severity = "major"): ToFix[] => Array.from({ length: n }, (_, k) => f(`${at}-${String(k + 1)}`, severity, at, 1));
    /* 15 and 10 at two places: one batch of 25 is too many, and a cut at 20 would split the second place. */
    expect(writerBatches([...group("a.md", 15), ...group("b.md", 10)]).map((b) => b.length)).toEqual([15, 10]);
    /* A place with 45 findings is split, evenly, and only because it must be. */
    expect(writerBatches(group("a.md", 45)).map((b) => b.length)).toEqual([15, 15, 15]);
  });

  it("cuts each batch near an even share of what is left, taking a group across its share only when that lands nearer it", () => {
    const groups = Array.from({ length: 7 }, (_, n) => Array.from({ length: 3 }, (_, k) => f(`g${String(n)}-${String(k)}`, "major", "a.md", n + 1))).flat();
    expect(writerBatches(groups).map((b) => b.length), "a share of 11: nine falls two short and twelve one over").toEqual([12, 9]);
  });

  it("takes a group past its share when stopping short would leave more than the batches after it can hold", () => {
    const at = (file: string, n: number): ToFix[] => Array.from({ length: n }, (_, k) => f(`${file}-${String(k)}`, "major", file, 1));
    /* Three batches at the fewest; a share of 13 would stop at the first eight, and the eighteen and the three would then need two more. */
    const batches = writerBatches([...at("a.md", 8), ...at("b.md", 10), ...at("c.md", 18), ...at("d.md", 3)]);
    expect(batches.map((b) => b.length)).toEqual([18, 18, 3]);
  });

  it("puts the minors that share a place with no blocker or major last, in batches of their own, and counts them", () => {
    const minors = Array.from({ length: 12 }, (_, n) => f(`m${String(n + 1)}`, "minor", "a.md", n + 1));
    const serious = Array.from({ length: 12 }, (_, n) => f(`M${String(n + 1)}`, "major", "z.md", n + 1));
    const batches = writerBatches([...minors, ...serious]);
    expect(batches.map((b) => b.map((x) => x.severity))).toEqual([Array(12).fill("major"), Array(12).fill("minor")]);
    expect([...minorsAlone(batches)]).toEqual([1]);
  });

  it("keeps the minors alone out of a batch with room for them, so their batches' ledger rows are what they cost", () => {
    const serious = Array.from({ length: 15 }, (_, n) => f(`M${String(n + 1)}`, "major", "z.md", n + 1));
    const minors = Array.from({ length: 3 }, (_, n) => f(`m${String(n + 1)}`, "minor", "a.md", n + 1));
    const batches = writerBatches([...minors, ...serious]);
    expect(batches.map((b) => b.length), "18 would fit one batch, and the three minors are cut apart").toEqual([15, 3]);
    expect([...minorsAlone(batches)]).toEqual([1]);
  });

  it("does not count as minors alone the minors of a place too big for one batch that a blocker shares", () => {
    const place = [f("B1", "blocker", "a.md", 1), ...Array.from({ length: 24 }, (_, n) => f(`m${String(n + 1)}`, "minor", "a.md", 1))];
    const batches = writerBatches(place);
    expect(batches.map((b) => b.length)).toEqual([13, 12]);
    expect(batches[1]?.every((x) => x.severity === "minor"), "the second half is all minors").toBe(true);
    expect(minorsAlone(batches).size, "but they share the blocker's place").toBe(0);
  });
});
