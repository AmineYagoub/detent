import { describe, expect, it } from "vitest";
import { DECISION_LOG_PATH, PACK_PATHS, PACK_PRECEDENCE } from "../../src/schemas/pack.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import type { MockBackend } from "../../src/sessions/mock.js";
import { repo } from "./plan-fixture.js";
import type { Json } from "./decide-fixture.js";
import { LENDING, PACK, RAW, WROTE, read, write } from "./write-fixture.js";
import { LATE_RULE, LENDING_PRD, appliesAll, byRound, clean, finding, initThroughValidate, record, review, reviewers, writer } from "./validate-fixture.js";

/**
 * PRDR-284 — VALIDATE's writer and what code checks of every VALIDATE
 * session (C-2⁶, C-2¹⁴): the checker first, fixes the checker still refuses
 * undone, the writer's account, the decision log, and each reviewer's quotes.
 */

/** LND-F-002 with no criterion: the pack checker blocks on it. */
const UNCOVERED = LENDING.split("\n").filter((l) => !l.includes("LND-AC-02")).join("\n");
/** WRITE's pack with the checker red on it, both attempts. */
const writesRed = () => write(() => ({ files: { ...PACK, [LENDING_PRD]: UNCOVERED }, artifact: WROTE() }));
const lendingOnce = (f: Json = finding()) => byRound((round, area) => (round === 1 && area === "Lending" ? [f] : []));
const account = (applied: string[], declined: { id: string; reason: string }[] = []) => ({ schema_version: SCHEMA_VERSION, applied, declined });
const restoreCriterion = (text: string): string => text.replace("- **LND-AC-03**", `${LENDING.split("\n").find((l) => l.includes("LND-AC-02")) ?? ""}\n- **LND-AC-03**`);

describe("PRDR-284: the checker first (C-2⁶)", () => {
  it("has its writer fix a red checker before any round, told the checker's findings, and reviews the whole pack after", async () => {
    const root = repo(RAW);
    const seen = { backend: null as MockBackend | null };
    const w = writer(() => ({ edit: { [LENDING_PRD]: restoreCriterion } }));
    const r = clean();
    const result = await initThroughValidate(root, { reviewers: r, writer: w, seen }, writesRed());
    expect(result.reachedPhase).toBe("READY");
    expect(w.inputs[0]).toMatchObject({ task: "fix", source: "checker" });
    expect(w.inputs[0]?.["findings"]).toEqual([expect.objectContaining({ id: "CHECK-1", rule: "coverage", at: `${LENDING_PRD}:6` })]);
    const roles = seen.backend?.rolesLaunched() ?? [];
    expect(roles.slice(roles.lastIndexOf("spec_write") - 0, roles.lastIndexOf("spec_write") + 3), "the writer, then the round").toEqual(["spec_write", "spec_review", "spec_review"]);
    expect(r.inputs.map((i) => i["documents"])).toEqual([[DECISION_LOG_PATH, "docs/prd/index.md", "docs/research/verified-facts.md"], [LENDING_PRD]]);
    expect(record(root)).toMatchObject({ validated: true, checker: { green: true } });
  });

  it("stops init at VALIDATE when two attempts leave the checker red, with the pack as it was, and no round", async () => {
    const root = repo(RAW);
    const w = writer(() => ({ edit: { "docs/research/verified-facts.md": (t) => `${t}\nA note the fix left behind.\n` } }));
    const r = clean();
    const before = { lending: "", facts: "" };
    const result = await initThroughValidate(
      root,
      {
        reviewers: r,
        writer: {
          ...w,
          stage: (spec) => {
            if (w.inputs.length === 0) Object.assign(before, { lending: read(root, LENDING_PRD), facts: read(root, "docs/research/verified-facts.md") });
            return w.stage(spec);
          },
        },
      },
      writesRed(),
    );
    expect(result.reachedPhase).toBe("VALIDATE");
    expect(result.interrupt?.interrupt).toBe("AWAIT_INFO");
    expect(result.interrupt?.message).toContain("the pack checker is red, and its writer could not make it green in two attempts, so nothing plans from the pack (C-2⁷)");
    expect(result.interrupt?.items).toEqual([expect.stringMatching(/^docs\/prd\/01-lending\.md:6 \[coverage\] `LND-F-002`/u)]);
    expect(w.inputs).toHaveLength(2);
    expect((w.inputs[1]?.["previous_attempt"] as Json)["issue"]).toContain("the pack checker: docs/prd/01-lending.md:6 [coverage]");
    expect(r.inputs, "no round runs on a red checker").toEqual([]);
    expect(read(root, LENDING_PRD)).toBe(before.lending);
    expect(read(root, "docs/research/verified-facts.md"), "what the failed fix wrote is undone").toBe(before.facts);
    expect(record(root)).toMatchObject({ validated: false, rounds: [], checker: { green: false } });
  });
});

describe("PRDR-284: what the writer leaves open (C-2¹⁴)", () => {
  it("undoes every fix of a round that leaves the checker red, leaves its findings open as undone, and goes on", async () => {
    const root = repo(RAW);
    const w = writer(() => ({ edit: { [LENDING_PRD]: (t) => t.split("\n").filter((l) => !l.includes("LND-AC-02")).join("\n") } }));
    const r = lendingOnce();
    let before = "";
    await initThroughValidate(root, {
      reviewers: { ...r, stage: (spec) => ((before ||= read(root, LENDING_PRD)), r.stage(spec)) },
      writer: w,
    });
    expect(w.inputs, "relaunched once with the checker's words").toHaveLength(2);
    expect(read(root, LENDING_PRD)).toBe(before);
    const [first] = record(root).rounds;
    expect(first).toMatchObject({ round: 1, changed: [], open: [{ id: "R1-1", left: "undone" }] });
    expect(first?.open[0]?.reason).toMatch(/^its fixes left the pack checker red: the pack checker: docs\/prd\/01-lending\.md:6 \[coverage\]/u);
    const verified = r.inputs.find((i) => i["round"] === 2 && i["area"] === "Lending");
    expect(verified?.["previous"]).toEqual([expect.objectContaining({ id: "R1-1", left: "undone" })]);
    expect(verified?.["diff"], "nothing stood, so there is no diff").toBeNull();
    expect(record(root).validated).toBe(true);
  });

  it("undoes every fix of a round that leaves the pack holding no requirement, though the checker is green on it", async () => {
    const root = repo(RAW);
    const w = writer(() => ({ edit: { [LENDING_PRD]: (t) => t.split("\n").filter((l) => !l.startsWith("- **LND-")).join("\n") } }));
    const r = lendingOnce();
    let before = "";
    await initThroughValidate(root, { reviewers: { ...r, stage: (spec) => ((before ||= read(root, LENDING_PRD)), r.stage(spec)) }, writer: w });
    expect(w.inputs, "relaunched once with why").toHaveLength(2);
    expect((w.inputs[1]?.["previous_attempt"] as Json)["issue"]).toBe("the pack holds no requirement");
    expect(read(root, LENDING_PRD)).toBe(before);
    expect(record(root).rounds[0]).toMatchObject({ changed: [], open: [{ id: "R1-1", left: "undone", reason: "its fixes left the pack holding no requirement" }] });
  });

  it("leaves a declined finding open with its reason, which the next round's verifier is shown", async () => {
    const root = repo(RAW);
    const w = writer(() => ({ artifact: account([], [{ id: "R1-1", reason: "LND-AC-02 already states the grace period" }]) }));
    const r = lendingOnce();
    await initThroughValidate(root, { reviewers: r, writer: w });
    expect(record(root).rounds[0]).toMatchObject({ open: [{ id: "R1-1", severity: "major", file: LENDING_PRD, line: 6, left: "declined", reason: "LND-AC-02 already states the grace period" }], changed: [] });
    expect(r.inputs.find((i) => i["round"] === 2 && i["area"] === "Lending")?.["previous"]).toEqual([
      expect.objectContaining({ id: "R1-1", left: "declined", reason: "LND-AC-02 already states the grace period" }),
    ]);
    expect(
      r.inputs.filter((i) => i["round"] === 2).map((i) => [i["area"], i["documents"]]),
      "the document it stands on is reviewed again, and what cites it, though no fix changed either",
    ).toEqual([
      ["foundations", ["docs/prd/index.md"]],
      ["Lending", [LENDING_PRD]],
    ]);
  });

  it("counts a finding the writer says it applied, and changed no document for, as declined", async () => {
    const root = repo(RAW);
    await initThroughValidate(root, { reviewers: lendingOnce(), writer: writer(() => ({})) });
    expect(record(root).rounds[0]?.open).toEqual([expect.objectContaining({ id: "R1-1", left: "declined", reason: "its writer listed it as applied and changed no document" })]);
  });

  it("relaunches an account that leaves a finding out, and counts it declined if the second does too", async () => {
    const root = repo(RAW);
    const w = writer(() => ({ edit: { [LENDING_PRD]: (t) => `${t}\n` }, artifact: account([]) }));
    await initThroughValidate(root, { reviewers: lendingOnce(), writer: w });
    expect((w.inputs[1]?.["previous_attempt"] as Json)["issue"]).toBe("R1-1 is listed in neither applied nor declined");
    expect(record(root).rounds[0]?.open).toEqual([expect.objectContaining({ id: "R1-1", left: "declined", reason: "its writer did not say whether it applied it" })]);
  });

  it("puts the decision log back when a fix changes a row it held, and relaunches with why", async () => {
    const root = repo(RAW);
    const notes: string[] = [];
    let original = "";
    const w = writer((call) => ({
      edit: call === 0 ? { [DECISION_LOG_PATH]: (t) => ((original = t), t.replace(/\| X-1 \|[^|\n]*\|/u, "| X-1 | Late returns are forgiven. |")) } : { [LENDING_PRD]: (t) => `${t}\n` },
    }));
    await initThroughValidate(root, { reviewers: lendingOnce(), writer: w, notes });
    expect(read(root, DECISION_LOG_PATH)).toBe(original);
    expect((w.inputs[1]?.["previous_attempt"] as Json)["issue"]).toContain("the decision log's X-1 is changed");
    expect(notes.join("\n")).toContain("VALIDATE's writer, round 1: the decision log is restored as it was, since the fixes changed what it held");
    expect(record(root).rounds[0]).toMatchObject({ open: [], changed: [LENDING_PRD] });
  });

  it("asks for a cite of a default the writer added, and says it is owed when the second attempt still omits it", async () => {
    const root = repo(RAW);
    const notes: string[] = [];
    const w = writer(() => ({ edit: { [DECISION_LOG_PATH]: (t) => (t.includes("| X-5 |") ? t : t.replace(/(\| X-4 \|[^\n]*\n)/u, "$1| X-5 | A loan lasts a week. | The documents imply it. |\n")) } }));
    const r = lendingOnce();
    await initThroughValidate(root, { reviewers: r, writer: w, notes });
    expect(w.inputs[1]?.["next_default"], "the next free id, counted over the log as it was before the round").toBe("X-5");
    expect(w.inputs[0]?.["decision_log_entries"], "the writer is given the log's entries, to cite and not to repeat").toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "X-1", value: expect.any(String) }), expect.objectContaining({ id: "X-4", value: expect.any(String) })]),
    );
    expect((w.inputs[1]?.["previous_attempt"] as Json)["issue"]).toBe("the pack does not cite X-5, a default you added to the log");
    expect(notes).toContain("VALIDATE's writer, round 1: the pack does not cite X-5, a default you added to the log");
    expect(record(root).rounds[0]?.changed).toEqual([DECISION_LOG_PATH]);
    expect(r.inputs.find((i) => i["round"] === 2 && i["area"] === "foundations")?.["documents"], "the next round reviews what the fix changed, which no finding named").toContain(DECISION_LOG_PATH);
  });

  it("fails the phase, with the pack as it was, when the writer's account is unusable twice", async () => {
    const root = repo(RAW);
    let before = "";
    const w = writer(() => ({ edit: { [LENDING_PRD]: (t) => ((before ||= t), `${t}\nhalf a fix\n`) }, artifact: null }));
    await expect(initThroughValidate(root, { reviewers: lendingOnce(), writer: w })).rejects.toThrow(/VALIDATE's writer, round 1: no usable account of the fixes: the session wrote no artifact/u);
    expect(read(root, LENDING_PRD)).toBe(before);
    expect(record(root)).toMatchObject({ validated: false, rounds: [] });
  });
});

describe("PRDR-284: a reviewer's finding stands where it says (C-2¹⁴)", () => {
  it("relaunches a review whose quote is not at its line, and keeps the finding the second attempt places", async () => {
    const root = repo(RAW);
    const r = reviewers((call, inputs) =>
      review(inputs, inputs["area"] !== "Lending" || inputs["round"] !== 1 ? [] : [finding(call === 1 ? { places: [{ ...LATE_RULE, line: 7 }] } : {})]),
    );
    await initThroughValidate(root, { reviewers: r, writer: appliesAll() });
    expect((r.inputs[2]?.["previous_attempt"] as Json)["issue"]).toBe(`${LENDING_PRD}:7 does not hold "${LATE_RULE.quote}", whitespace aside`);
    expect(record(root).rounds[0]?.counts.major).toBe(1);
  });

  it("drops a finding the second attempt still places wrong, says so, and counts it nowhere", async () => {
    const root = repo(RAW);
    const notes: string[] = [];
    const r = reviewers((call, inputs) => review(inputs, inputs["area"] === "Lending" && inputs["round"] === 1 ? [finding({ places: [{ ...LATE_RULE, quote: "a sentence the pack does not hold" }] })] : []));
    await initThroughValidate(root, { reviewers: r, notes });
    expect(notes.join("\n")).toContain(`VALIDATE round 1, Lending: a finding at ${LENDING_PRD}:6: ${LENDING_PRD}:6 does not hold "a sentence the pack does not hold", whitespace aside stands on nothing, so it is dropped (C-2¹⁴)`);
    expect(record(root).rounds).toEqual([expect.objectContaining({ round: 1, counts: { blocker: 0, major: 0, minor: 0 } })]);
  });

  it("relaunches a review that did not read a document it was given, and names the document when the second does not either", async () => {
    const root = repo(RAW);
    const notes: string[] = [];
    const r = reviewers((_, inputs) => (inputs["area"] === "Lending" ? { ...review(inputs, [finding()]), documents_read: inputs["foundations"] } : review(inputs)));
    await initThroughValidate(root, { reviewers: r, writer: appliesAll(), notes });
    expect((r.inputs[2]?.["previous_attempt"] as Json)["issue"]).toBe(`the review did not read every document it was given: ${LENDING_PRD}`);
    expect(notes).toContain(`VALIDATE round 1, Lending: the reviewer did not read ${LENDING_PRD}, so this round did not review it (C-2¹⁴)`);
    expect(record(root).rounds[0]?.counts.major, "its findings stand").toBe(1);
  });

  it("fails the phase when a reviewer writes no usable review twice, and records no round", async () => {
    const root = repo(RAW);
    const r = reviewers((call, inputs) => (inputs["area"] === "Lending" ? null : review(inputs)));
    await expect(initThroughValidate(root, { reviewers: r })).rejects.toThrow(/VALIDATE round 1, Lending: the reviewer produced no usable review: the session wrote no artifact/u);
    expect(record(root)).toMatchObject({ validated: false, rounds: [] });
  });

  it("gives each reviewer the checker's heuristic reports on its documents, marked as a heuristic's, and never stops the loop on them (C-2¹⁰)", async () => {
    const root = repo(RAW);
    const told = LENDING.replace("Borrowing a tool MUST cost nothing in the MVP (X-4).", "Borrowing a tool MUST cost nothing in the MVP (X-4). The desk checks each tool out.");
    const r = clean();
    await initThroughValidate(root, { reviewers: r }, write(() => ({ files: { ...PACK, [LENDING_PRD]: told }, artifact: WROTE() })));
    const lending = r.inputs.find((i) => i["area"] === "Lending");
    expect(lending?.["heuristic"]).toEqual([
      expect.objectContaining({ file: LENDING_PRD, line: 5, report: expect.stringMatching(/"The desk checks each tool out\." states behaviour without MUST, SHOULD or MAY/u) }),
    ]);
    expect(r.inputs.find((i) => i["area"] === "foundations")?.["heuristic"]).toEqual([]);
    expect(record(root)).toMatchObject({ validated: true, rounds: [{ round: 1, counts: { blocker: 0, major: 0, minor: 0 } }] });
  });
});

describe("PRDR-284: VALIDATE's sessions and what they may write (S-1‴, S-5⁵)", () => {
  it("runs its reviewers as spec_review, reading and writing their artifact alone, and its writer as spec_write over the pack's paths", async () => {
    const root = repo(RAW);
    const seen = { backend: null as MockBackend | null };
    const w = appliesAll();
    await initThroughValidate(root, { reviewers: lendingOnce(), writer: w, seen });
    expect(w.inputs[0], "the writer is told where it may write, and which document wins").toMatchObject({ pack_paths: [...PACK_PATHS], precedence: [...PACK_PRECEDENCE] });
    const reviewer = seen.backend?.calls.find((c) => c.role === "spec_review")?.spec;
    expect(reviewer?.allowedTools.filter((tool) => !tool.startsWith("Write(")).sort(), "no Edit, no Write but its artifact's, no Bash").toEqual(["Glob", "Grep", "Read"]);
    expect(reviewer?.policy?.surface, "the first reviewer is the foundations', area 0 (C-2²³)").toEqual([".detent/state/review-artifact-0.json"]);
    const fixer = seen.backend?.calls.filter((c) => c.role === "spec_write").at(-1)?.spec;
    expect(fixer?.allowedTools).toEqual(expect.arrayContaining(["Edit", "Write"]));
    expect(fixer?.policy?.surface).toEqual([".detent/state/fix-artifact.json", ...PACK_PATHS]);
  });
});
