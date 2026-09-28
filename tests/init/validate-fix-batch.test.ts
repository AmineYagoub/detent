import { describe, expect, it } from "vitest";
import { readProgressMark } from "../../src/kernel/ledger.js";
import { readLedgerRows } from "../../src/kernel/ledger-rows.js";
import type { Json } from "./decide-fixture.js";
import { repo } from "./plan-fixture.js";
import { byRound, clean, initThroughValidate, record, writer, type Reviewers } from "./validate-fixture.js";
import { CODES, prdOf, wide, wideSpoiled } from "./validate-wide-fixture.js";
import { RAW, read } from "./write-fixture.js";

/**
 * PRDR-314 — VALIDATE's writer takes a round's findings in batches of at most
 * twenty, one session after another, each checked and undone on its own
 * (C-2²⁴).
 *
 * C-2¹⁴ gave one writer session every finding of the round. Tabachir's first
 * two reviews reported 23 findings each, so round 1 would hand one session
 * some 600, and one fix that left the checker red would undo them all. Here
 * the six module areas of the seven-area pack report four findings each: 24,
 * two batches of 12.
 */

const CATEGORIES = ["gap", "contradiction", "untestable", "name-drift"];
/** Four findings at a module PRD's first requirement, one of each category, so none merges with another. */
const fourAt = (file: string, severity: string): Json[] =>
  CATEGORIES.map((category) => ({
    severity,
    category,
    places: [{ file, line: 5, quote: "Borrowing a tool MUST cost nothing in the MVP" }],
    why: `${category} in ${file}`,
    fix: `fix the ${category} in ${file}`,
    previous: null,
  }));
/** Each module area's reviewer reports four findings in round 1, and nothing after. */
const fourEach = (severity: string): Reviewers =>
  byRound((round, area) => {
    const i = CODES.findIndex((code) => area === `Area ${code}`);
    return round === 1 && i !== -1 ? fourAt(prdOf(i), severity) : [];
  });

const ids = (from: number, to: number): string[] => Array.from({ length: to - from + 1 }, (_, n) => `R1-${String(from + n)}`);
const idsGiven = (inputs: readonly Json[]): string[][] => inputs.map((i) => ((i["findings"] as { id: string }[] | undefined) ?? []).map((f) => f.id));
const fixedIn = (call: number) => (text: string): string => text.replace("## 7. Acceptance criteria", `Fixed in call ${String(call)}.\n\n## 7. Acceptance criteria`);
/** The first batch's session edits Lending, every later one the sixth module. */
const target = (call: number): string => prdOf(call === 0 ? 0 : 5);

describe("PRDR-314 VALIDATE's writer takes a round in batches of at most twenty, one after another (C-2²⁴)", () => {
  it("gives the writer the round's 24 findings as two batches of 12, in the round's order, the second on the pack the first left", async () => {
    const root = repo(RAW);
    const seen: boolean[] = [];
    const w = writer((call, _, cwd) => {
      if (call === 1) seen.push(read(cwd, prdOf(0)).includes("Fixed in call 0."));
      return { edit: { [target(call)]: fixedIn(call) } };
    });
    const notes: string[] = [];
    await initThroughValidate(root, { reviewers: fourEach("minor"), writer: w, notes }, wide());

    expect(idsGiven(w.inputs)).toEqual([ids(1, 12), ids(13, 24)]);
    expect(seen, "the second batch's session ran on the first batch's fixes").toEqual([true]);
    expect(notes.join("\n")).toContain("VALIDATE's writer, round 1: 24 findings in 2 batches of at most 20, one after another (C-2²⁴)");
    expect(record(root).rounds[0]).toMatchObject({ round: 1, open: [], changed: [prdOf(0), prdOf(5)] });
  });

  it("undoes only a batch whose fixes leave the checker red, leaves its own findings undone, and keeps the batches that stood", async () => {
    const root = repo(RAW);
    const dropCriterion = (text: string): string => text.split("\n").filter((l) => !l.includes("INV-AC-02")).join("\n");
    const w = writer((call) => (call === 0 ? { edit: { [prdOf(0)]: fixedIn(0) } } : { edit: { [prdOf(5)]: dropCriterion } }));
    await initThroughValidate(root, { reviewers: fourEach("minor"), writer: w }, wide());

    expect(idsGiven(w.inputs), "the second batch relaunched once with the checker's words").toEqual([ids(1, 12), ids(13, 24), ids(13, 24)]);
    expect(read(root, prdOf(0))).toContain("Fixed in call 0.");
    expect(read(root, prdOf(5)), "the red batch's fix is undone").toContain("INV-AC-02");
    const [first] = record(root).rounds;
    expect(first?.changed).toEqual([prdOf(0)]);
    expect(first?.open.map((o) => [o.id, o.left])).toEqual(ids(13, 24).map((id) => [id, "undone"]));
  });

  it("hands the next round one diff of every batch that stood, taken from where the round's writer began", async () => {
    const root = repo(RAW);
    const reviewers = fourEach("major");
    await initThroughValidate(root, { reviewers, writer: writer((call) => ({ edit: { [target(call)]: fixedIn(call) } })) }, wide());

    const verify = reviewers.inputs.find((i) => i["round"] === 2);
    const diff = read(root, String(verify?.["diff"]));
    expect(diff).toContain("Fixed in call 0.");
    expect(diff).toContain("Fixed in call 1.");
  });
});

describe("PRDR-314 a batch that fails puts back every batch of the round, and the kept reviews answer the re-run (C-2²⁴, C-2²³)", () => {
  it("fails the phase for an account unusable twice, with the pack as it was when the round's writer began, each batch that stood a unit of work", async () => {
    const root = repo(RAW);
    const reviewers = fourEach("minor");
    let before = "";
    const first = { ...reviewers, stage: (spec: Parameters<Reviewers["stage"]>[0]) => ((before ||= read(root, prdOf(0))), reviewers.stage(spec)) };
    const w = writer((call) => (call === 0 ? { edit: { [prdOf(0)]: fixedIn(0) } } : { artifact: null }));
    await expect(initThroughValidate(root, { reviewers: first, writer: w }, wide())).rejects.toThrow(/no usable account of the fixes/u);

    expect(idsGiven(w.inputs)).toEqual([ids(1, 12), ids(13, 24), ids(13, 24)]);
    expect(read(root, prdOf(0)), "the first batch's fixes are put back").toBe(before);
    const rows = readLedgerRows(root);
    const beforeWriter = rows.filter((r) => !(r.phase === "VALIDATE" && r.role === "spec_write")).reduce((total, r) => total + r.cost_estimate_usd, 0);
    expect(readProgressMark(root).spent, "the batch that stood is a unit of work (X-1⁵)").toBeGreaterThan(beforeWriter);

    const again = fourEach("minor");
    const w2 = writer((call) => ({ edit: { [target(call)]: fixedIn(call) } }));
    await initThroughValidate(root, { reviewers: again, writer: w2 }, wide());
    expect(again.inputs, "every review is kept, so no reviewer runs again").toEqual([]);
    expect(idsGiven(w2.inputs)).toEqual([ids(1, 12), ids(13, 24)]);
  });
});

describe("PRDR-314 the checker's writer before any round is one session, however many findings it has (C-2²⁴)", () => {
  it("gives the checker's writer every blocking finding at once, since a batch would read the checker red on the others'", async () => {
    const root = repo(RAW);
    const { stub, green } = wideSpoiled((text, code) =>
      `${text.split("\n").filter((l) => !l.includes(`${code}-AC-0`)).join("\n")}\n- **${code}-F-004** [M1] A loan MUST end when the tool is back (X-98).\n`,
    );
    const w = writer(() => ({ edit: Object.fromEntries([...green].map(([rel, text]) => [rel, () => text])) }));
    await initThroughValidate(root, { reviewers: clean(), writer: w }, stub);

    const checker = w.inputs.filter((i) => i["source"] === "checker");
    expect(checker).toHaveLength(1);
    expect(idsGiven(checker)[0]?.length).toBeGreaterThan(20);
    expect(record(root).validated).toBe(true);
  });
});
