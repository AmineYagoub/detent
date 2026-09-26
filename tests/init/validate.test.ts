import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readProgressMark, readRecordedSpend } from "../../src/kernel/ledger.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { DECISION_LOG_PATH } from "../../src/schemas/pack.js";
import type { MockBackend } from "../../src/sessions/mock.js";
import { BUDGETS, repo } from "./plan-fixture.js";
import type { Json } from "./decide-fixture.js";
import { inputsOf } from "./slicing-fixture.js";
import { PACK, RAW, WROTE, read, write } from "./write-fixture.js";
import {
  FEE_RULE,
  LATE_RULE,
  LENDING_PRD,
  appliesAll,
  byRound,
  clean,
  finding,
  initThroughValidate,
  record,
  review,
  reviewers,
  validateOutputs,
  writer,
} from "./validate-fixture.js";

/**
 * PRDR-284 — VALIDATE's rounds (C-2⁶, C-2¹⁴): one reviewer per area of the
 * pack WRITE wrote, one writer for what they found, a verification of those
 * fixes in the round after, the stop rule, and the ceiling.
 *
 * The pack has two areas: the foundations (the decision log, the index and the
 * facts) and Lending, which holds `docs/prd/01-lending.md`. The index links to
 * the Lending PRD, so a change to it reaches the index too.
 */

const INDEX = "docs/prd/index.md";
const FACTS = "docs/research/verified-facts.md";
const FOUNDATIONS = [DECISION_LOG_PATH, INDEX, FACTS];
const ceiling = (n: number) => ({ more: { budgets: { ...BUDGETS, spec_validation_rounds: n } } });
const lendingOnly = (per: (round: number) => readonly Json[]) => byRound((round, area) => (area === "Lending" ? per(round) : []));
const asked = (inputs: readonly Json[]) => inputs.map((i) => [i["round"], i["task"], i["area"], i["documents"]]);
/** Every VALIDATE session, in order: the roles launched from its first reviewer or writer on. */
const validating = (backend: MockBackend | null): string[] => {
  const roles = backend?.rolesLaunched() ?? [];
  const fix = backend?.calls.findIndex((c) => c.role === "spec_write" && inputsOf(c.spec)["task"] === "fix") ?? -1;
  const first = [roles.indexOf("spec_review"), fix].filter((i) => i >= 0);
  return first.length === 0 ? [] : roles.slice(Math.min(...first));
};

describe("PRDR-284: one reviewer per area, the foundations first (C-2⁶)", () => {
  it("reviews the whole pack WRITE wrote, each area's reviewer reading the foundations before its own documents", async () => {
    const root = repo(RAW);
    const seen = { backend: null as MockBackend | null };
    const r = clean();
    const result = await initThroughValidate(root, { reviewers: r, seen });
    expect(result.reachedPhase).toBe("READY");
    expect(asked(r.inputs)).toEqual([
      [1, "review", "foundations", FOUNDATIONS],
      [1, "review", "Lending", [LENDING_PRD]],
    ]);
    for (const inputs of r.inputs) expect(inputs["foundations"]).toEqual(FOUNDATIONS);
    expect(r.inputs[0]?.["previous"], "a review, not a verification").toBeUndefined();
    expect(validating(seen.backend), "a round with nothing to fix launches no writer").toEqual(["spec_review", "spec_review"]);
    expect(record(root)).toMatchObject({ validated: true, rounds: [{ round: 1, counts: { blocker: 0, major: 0, minor: 0 }, open: [], changed: [] }] });
  });
});

describe("PRDR-284: the stop rule (specification decision 3)", () => {
  it("verifies a round's fixes in the next, and ends on the first round with no blocker and no major, its minor fixed and nothing launched after", async () => {
    const root = repo(RAW);
    const seen = { backend: null as MockBackend | null };
    const minor = finding({ severity: "minor", category: "name-drift", places: [FEE_RULE], fix: "call it the processing fee" });
    const r = lendingOnly((round) => (round === 1 ? [finding()] : [minor]));
    const w = appliesAll();
    await initThroughValidate(root, { reviewers: r, writer: w, seen });
    expect(asked(r.inputs)).toEqual([
      [1, "review", "foundations", FOUNDATIONS],
      [1, "review", "Lending", [LENDING_PRD]],
      [2, "verify", "foundations", [INDEX]],
      [2, "verify", "Lending", [LENDING_PRD]],
    ]);
    expect(r.inputs[3]?.["previous"]).toEqual([{ id: "R1-1", severity: "major", places: [LATE_RULE], why: finding()["why"], fix: finding()["fix"], left: "applied", reason: "" }]);
    expect(r.inputs[2]?.["previous"], "the foundations had no finding to verify").toEqual([]);
    const diff = r.inputs[3]?.["diff"] as string;
    expect(diff).toBe(".detent/state/validate/round-1.diff");
    expect(read(root, diff)).toContain("+Fixed in call 0.");
    expect(read(root, diff), "the fix against the bytes it changed, not the whole file as new").toContain(`--- a/before/${LENDING_PRD}`);
    expect(read(root, diff)).not.toContain("+# 01 — Lending");
    expect(w.inputs.map((i) => (i["findings"] as Json[]).map((f) => f["id"]))).toEqual([["R1-1"], ["R2-1"]]);
    expect(validating(seen.backend), "the loop ends on round 2: its writer is the last session").toEqual(["spec_review", "spec_review", "spec_write", "spec_review", "spec_review", "spec_write"]);
    expect(record(root)).toMatchObject({
      validated: true,
      rounds: [
        { round: 1, counts: { blocker: 0, major: 1, minor: 0 }, open: [], changed: [LENDING_PRD] },
        { round: 2, counts: { blocker: 0, major: 0, minor: 1 }, open: [], changed: [LENDING_PRD] },
      ],
    });
    expect(read(root, LENDING_PRD)).toContain("Fixed in call 1.");
  });

  it("marks progress after each round and once the loop ends, so the breaker hears of a healthy validation (X-1⁵)", async () => {
    const root = repo(RAW);
    const marks: [number | null, number][] = [];
    const r = reviewers((call, inputs, at) => {
      if (inputs["area"] === "foundations") marks.push([readProgressMark(at).spent, readRecordedSpend(at)]);
      return review(inputs, inputs["round"] === 1 && inputs["area"] === "Lending" ? [finding()] : []);
    });
    await initThroughValidate(root, { reviewers: r, writer: appliesAll() });
    const [first, second] = marks;
    expect(second?.[0], "round 2 begins with round 1's spend marked").toBe(second?.[1]);
    expect(first?.[0], "and round 1 with the phase before VALIDATE's").toBe(first?.[1]);
    expect(second?.[1]).toBeGreaterThan(first?.[1] ?? Infinity);
    expect(readProgressMark(root).spent).toBe(readRecordedSpend(root));
    expect(readProgressMark(root).unitCost, "the completed phase is a unit of its own, marked after its last round's, and cost nothing past it").toBe(0);
  });

  it("says once that no reviewer runs a simulation, since its scratch directory is not built", async () => {
    const root = repo(RAW);
    const notes: string[] = [];
    await initThroughValidate(root, { reviewers: lendingOnly((round) => (round === 1 ? [finding()] : [])), writer: appliesAll(), notes });
    expect(notes.filter((n) => n.includes("no reviewer runs a simulation"))).toHaveLength(1);
    expect(notes).toContain("VALIDATE validated the pack in 2 rounds (C-2¹⁴)");
  });
});

describe("PRDR-284: the ceiling (specification decision 13)", () => {
  it("stops at spec_validation_rounds, a ceiling and never a retry, and hands the last round's majors on as risks", async () => {
    const root = repo(RAW);
    const notes: string[] = [];
    const minor = finding({ severity: "minor", category: "name-drift", places: [FEE_RULE], fix: "call it the processing fee" });
    const r = lendingOnly((round) => [finding({ why: `found in round ${String(round)}` }), ...(round === 2 ? [minor] : [])]);
    await initThroughValidate(root, { reviewers: r, writer: appliesAll(), notes, ...ceiling(2) });
    expect(r.inputs.map((i) => i["round"])).toEqual([1, 1, 2, 2]);
    const unverified = "fixed in the round the loop stopped at, which no round verified";
    expect(record(root)).toMatchObject({
      validated: true,
      rounds: [
        { round: 1, open: [] },
        { round: 2, open: [{ id: "R2-1", severity: "major", file: LENDING_PRD, line: 6, quote: LATE_RULE.quote, fix: finding()["fix"], left: "unverified", reason: unverified }] },
      ],
    });
    expect(record(root).rounds[1]?.open.map((o) => o.id), "the minor its writer fixed is not open: decision 3 fixes minors unverified").toEqual(["R2-1"]);
    expect(validateOutputs(root)["risks"]).toEqual([{ id: "R2-1", where: `${LENDING_PRD}:6`, fix: finding()["fix"], left: "unverified", reason: unverified }]);
    expect(notes).toContain("VALIDATE validated the pack in 2 rounds; the majors it left open go to PRESENT as 1 risk (C-2¹⁴)");
  });

  it("stops init at VALIDATE with AWAIT_INFO for a blocker left at the ceiling, and asks again, running nothing, while nothing moves", async () => {
    const root = repo(RAW);
    const r = lendingOnly((round) => (round === 1 ? [finding({ severity: "blocker", category: "invariant" })] : []));
    const w = appliesAll();
    const first = await initThroughValidate(root, { reviewers: r, writer: w, ...ceiling(1) });
    expect(first.reachedPhase).toBe("VALIDATE");
    expect(first.interrupt?.interrupt).toBe("AWAIT_INFO");
    expect(first.interrupt?.message).toContain("VALIDATE stopped at round 1, its ceiling (spec_validation_rounds is 1), with 1 blocker left open");
    expect(first.interrupt?.message).toContain("VALIDATE carries on from round 2 (C-2¹⁴)");
    expect(first.interrupt?.items).toEqual([
      `R1-1 ${LENDING_PRD}:6 (unverified): ${String(finding()["fix"])} [fixed in the round the loop stopped at, which no round verified]`,
    ]);
    expect(record(root)).toMatchObject({ validated: false, rounds: [{ round: 1, counts: { blocker: 1, major: 0, minor: 0 }, changed: [LENDING_PRD] }] });

    const notes: string[] = [];
    const again = await initThroughValidate(root, { reviewers: r, writer: w, notes, ...ceiling(1) });
    expect(again.interrupt?.interrupt).toBe("AWAIT_INFO");
    expect(again.interrupt?.items).toEqual(first.interrupt?.items);
    expect(r.inputs, "no reviewer ran").toHaveLength(2);
    expect(w.inputs, "and no writer").toHaveLength(1);
    expect(notes.join("\n")).toContain("VALIDATE: nothing in the pack moved since round 1, the last its record holds, so no round runs");
  });

  it("carries on from the round it stopped at once the operator settles the blocker in the pack, one round more", async () => {
    const root = repo(RAW);
    const r = lendingOnly((round) => (round === 1 ? [finding({ severity: "blocker", category: "invariant" })] : []));
    await initThroughValidate(root, { reviewers: r, writer: appliesAll(), ...ceiling(1) });
    writeFileSync(path.join(root, ...LENDING_PRD.split("/")), read(root, LENDING_PRD).replace("until the tool is back", "until the tool is back, with a day's grace"));
    const settled = await initThroughValidate(root, { reviewers: r, writer: appliesAll(), ...ceiling(1) });
    expect(settled.reachedPhase).toBe("READY");
    expect(asked(r.inputs.slice(2))).toEqual([
      [2, "verify", "foundations", [INDEX]],
      [2, "verify", "Lending", [LENDING_PRD]],
    ]);
    expect(r.inputs[3]?.["previous"]).toEqual([
      expect.objectContaining({ id: "R1-1", severity: "blocker", left: "unverified", places: [LATE_RULE], why: "" }),
    ]);
    expect(r.inputs[3]?.["diff"], "the stopped round's diff, kept for the round that carries on").toBe(".detent/state/validate/round-1.diff");
    expect(record(root)).toMatchObject({ validated: true, rounds: [{ round: 1 }, { round: 2, counts: { blocker: 0, major: 0, minor: 0 } }] });
  });

  it("carries on when the operator settles a blocker by removing its document, and the area that held it verifies", async () => {
    const root = repo(RAW);
    const NOTES = "docs/design/notes.md";
    const stub = write(() => ({ files: { ...PACK, [NOTES]: "# Notes\n\nA loan ends the day its tool is back.\n" }, artifact: WROTE() }));
    const place = { file: NOTES, line: 3, quote: "A loan ends the day its tool is back." };
    const r = byRound((round, area) => (round === 1 && area === "foundations" ? [finding({ severity: "blocker", category: "invariant", places: [place] })] : []));
    const declines = writer(() => ({ artifact: { schema_version: SCHEMA_VERSION, applied: [], declined: [{ id: "R1-1", reason: "the notes are the founder's" }] } }));
    const first = await initThroughValidate(root, { reviewers: r, writer: declines, ...ceiling(1) }, stub);
    expect(first.interrupt?.interrupt).toBe("AWAIT_INFO");
    rmSync(path.join(root, ...NOTES.split("/")));
    const settled = await initThroughValidate(root, { reviewers: r, writer: declines, ...ceiling(1) }, stub);
    expect(settled.reachedPhase).toBe("READY");
    expect(asked(r.inputs.slice(2)), "a removal is a move: one round past the ceiling, its finding's area verifying with nothing else in scope").toEqual([[2, "verify", "foundations", []]]);
    expect(r.inputs[2]?.["previous"]).toEqual([expect.objectContaining({ id: "R1-1", left: "declined", places: [place] })]);
    expect(record(root)).toMatchObject({ validated: true, rounds: [{ round: 1 }, { round: 2, counts: { blocker: 0, major: 0, minor: 0 } }] });
  });

  it("carries on up to a ceiling the operator raised, without an edit", async () => {
    const root = repo(RAW);
    const r = lendingOnly((round) => (round < 3 ? [finding({ severity: "blocker", category: "invariant", why: `round ${String(round)}` })] : []));
    await initThroughValidate(root, { reviewers: r, writer: appliesAll(), ...ceiling(1) });
    const raised = await initThroughValidate(root, { reviewers: r, writer: appliesAll(), ...ceiling(3) });
    expect(raised.reachedPhase).toBe("READY");
    expect(r.inputs.map((i) => i["round"])).toEqual([1, 1, 2, 2, 3, 3]);
    expect(record(root).rounds.map((x) => x.counts.blocker)).toEqual([1, 1, 0]);
  });
});

describe("PRDR-284: a validation cut short carries on from its record (C-2¹⁴)", () => {
  it("resumes at the round after the last one recorded, verifying what it fixed, when a session dies mid-round", async () => {
    const root = repo(RAW);
    let alive = false;
    const r = reviewers((call, inputs) => {
      if (inputs["round"] === 2 && !alive) throw new Error("killed mid-round");
      return review(inputs, inputs["round"] === 1 && inputs["area"] === "Lending" ? [finding()] : []);
    });
    await expect(initThroughValidate(root, { reviewers: r, writer: appliesAll() })).rejects.toThrow(/killed mid-round/u);
    expect(record(root)).toMatchObject({ validated: false, rounds: [{ round: 1, counts: { major: 1 }, changed: [LENDING_PRD] }] });
    alive = true;
    const resumed = await initThroughValidate(root, { reviewers: r, writer: appliesAll() });
    expect(resumed.reachedPhase).toBe("READY");
    const carried = r.inputs.filter((i) => i["round"] === 2).slice(-2);
    expect(asked(carried)).toEqual([
      [2, "verify", "foundations", [INDEX]],
      [2, "verify", "Lending", [LENDING_PRD]],
    ]);
    expect(carried[1]?.["diff"]).toBe(".detent/state/validate/round-1.diff");
    expect(record(root)).toMatchObject({ validated: true, rounds: [{ round: 1 }, { round: 2 }] });
    expect(existsSync(path.join(root, ".detent", "state", "validate", "round-1"))).toBe(false);
  });

  it("reviews on resume the document holding what the last round left open, though no fix changed it", async () => {
    const root = repo(RAW);
    let alive = false;
    const r = reviewers((call, inputs) => {
      if (inputs["round"] === 2 && !alive) throw new Error("killed mid-round");
      return review(inputs, inputs["round"] === 1 && inputs["area"] === "Lending" ? [finding()] : []);
    });
    const declines = writer(() => ({ artifact: { schema_version: SCHEMA_VERSION, applied: [], declined: [{ id: "R1-1", reason: "LND-AC-02 states the grace period" }] } }));
    await expect(initThroughValidate(root, { reviewers: r, writer: declines })).rejects.toThrow(/killed mid-round/u);
    expect(record(root).rounds).toEqual([expect.objectContaining({ round: 1, changed: [] })]);
    alive = true;
    await initThroughValidate(root, { reviewers: r, writer: declines });
    expect(asked(r.inputs.filter((i) => i["round"] === 2).slice(-2))).toEqual([
      [2, "verify", "foundations", [INDEX]],
      [2, "verify", "Lending", [LENDING_PRD]],
    ]);
  });

  it("finishes without a round when the record's last round already met the stop rule", async () => {
    const root = repo(RAW);
    const r = clean();
    await initThroughValidate(root, { reviewers: r });
    const file = path.join(root, "docs", "conformance.json");
    const written = JSON.parse(readFileSync(file, "utf8")) as Json;
    writeFileSync(file, `${JSON.stringify({ ...written, validated: false }, null, 2)}\n`);
    const notes: string[] = [];
    const again = await initThroughValidate(root, { reviewers: r, notes });
    expect(again.reachedPhase).toBe("READY");
    expect(r.inputs).toHaveLength(2);
    expect(record(root).validated).toBe(true);
    expect(notes.join("\n")).toContain("nothing in the pack moved since round 1");
  });
});
