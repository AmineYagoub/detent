import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { packDocuments } from "../../src/init/pack.js";
import { parsePack } from "../../src/init/pack-parse.js";
import { PLAN_REVIEW_SAMPLES } from "../../src/init/plan-review.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { CONFORMING_PACK, packRepo } from "./pack-fixture.js";
import { PROMPTS } from "./plan-fixture.js";
import { CUT, clear, edit, planned, seeded, sliceInputs, sliced, slicing, type Cut, type Json } from "./seed-fixture.js";

/**
 * PRDR-291 — SLICE seeded by the pack, and a slice keyed by its requirement ids (C-2⁸).
 *
 * SLICE asked a model to re-derive the pack's structure from prose, and keyed
 * each slice by that model's own words: identical documents drew estimates of
 * 308 and 554 tickets, 1 of 24 slice titles survived between two runs, and an
 * edit to one document re-planned every slice. On a pack the structure is
 * data. Code builds the seed, the slice session makes the one judgement code
 * cannot, and a slice's identity is its requirement ids.
 *
 * Every case runs the real pipeline on the pack fixture, conforming, whose
 * live requirements are CAT-F-001 [M0], CAT-F-002 and CAT-N-001 [M1] in the
 * catalog, and CHK-F-001 and CHK-F-002 [M1] in checkout; CAT-F-003 is
 * withdrawn. The slicer writes new words on every take.
 */

const CHECKOUT = "docs/prd/02-checkout.md";
const CHK_F_002 = "- **CHK-F-002** [M1] [E2E] Checkout MUST accept DZD only (D-1).";
const LAST_CRITERION = "`order.placed` event carries the order id, and a EUR cart answers `409` (CHK-F-001–CHK-F-002).";
/** A checkout criterion that tests a catalog requirement: the checker lets a criterion test any module's. */
const CROSS_CRITERION = "- **CHK-AC-03** [M1] Given a listed product, when it is added to the cart, then the cart shows its `DZD` price (CAT-F-002).";
const CROSS: Readonly<Record<string, string>> = {
  ...CONFORMING_PACK,
  [CHECKOUT]: (CONFORMING_PACK[CHECKOUT] ?? "").replace(LAST_CRITERION, `${LAST_CRITERION}\n${CROSS_CRITERION}`),
};
/** A new checkout requirement, and the criterion that tests it. */
const ADDED: readonly (readonly [string, string])[] = [
  [CHK_F_002, `${CHK_F_002}\n- **CHK-F-003** [M1] Checkout MUST record how the order was paid.`],
  [LAST_CRITERION, `${LAST_CRITERION}\n- **CHK-AC-03** [M1] Given a paid order, when it is read back, then it names \`card\` as how it was paid (CHK-F-003).`],
];

const outputsOf = (root: string, phase: string): Json =>
  (JSON.parse(readFileSync(path.join(stateDir(root), "state", `${phase}.json`), "utf8")) as { outputs: Json }).outputs;
type Sliced = { readonly id: string; readonly requirement_ids: string[]; readonly depends_on: string[] };
const slicesOut = (root: string): Sliced[] => outputsOf(root, "SLICE")["slices"] as Sliced[];
const issueOf = (inputs: Json | undefined): string => ((inputs?.["previous_attempt"] as { issue?: string } | undefined)?.issue ?? "");
/** What the relaunch is told besides the issue: that its content was refused, never that it was sound. */
const noteOf = (inputs: Json | undefined): string => ((inputs?.["previous_attempt"] as { note?: string } | undefined)?.note ?? "");
const draftDocs = (s: { readonly inputs: Json[] }, slice: string): string[] =>
  (s.inputs.find((i) => i["stage"] === "PLAN" && (i["slice"] as { id?: string } | undefined)?.id === slice)?.["docs"] as string[] | undefined) ?? [];
const additions = (placed: readonly (readonly [string, string])[], fresh: readonly Json[] = []) =>
  (): Json => ({ schema_version: SCHEMA_VERSION, placed: placed.map(([requirement_id, slice]) => ({ requirement_id, slice })), new_slices: fresh });
/** A new slice for CHK-F-003, after checkout. */
const OPENED = { id: "s04", after: "s03", title: "payment records", goal: "an order says how it was paid", requirement_ids: ["CHK-F-003"], depends_on: ["s03"], rationale: "" };

describe("PRDR-291 — the seed is code's, and one session orders and groups it (C-2⁸)", () => {
  it("hands the slice session the live requirement ids by milestone, then by module code, each group with its criteria count", async () => {
    const s = seeded();
    await s.init();
    const [inputs] = sliceInputs(s);
    expect(inputs?.["seed"]).toEqual([
      { milestone: "M0", title: "Foundations", groups: [{ code: "CAT", area: "Catalog", requirement_ids: ["CAT-F-001"], criteria: 1 }] },
      {
        milestone: "M1",
        title: "Selling",
        groups: [
          { code: "CAT", area: "Catalog", requirement_ids: ["CAT-F-002", "CAT-N-001"], criteria: 1 },
          { code: "CHK", area: "Checkout", requirement_ids: ["CHK-F-001", "CHK-F-002"], criteria: 2 },
        ],
      },
    ]);
    expect(JSON.stringify(inputs?.["expected_output"]), "no guessed sizes").not.toContain("expected_tickets");
    expect(inputs, "the stack keys every slice PLAN drafts, and is not the slicer's").not.toHaveProperty("stack");
  });

  it("plans each slice from the module PRDs its requirements live in and the pack's shared documents, never another module's", async () => {
    const s = seeded();
    await s.init();
    expect(draftDocs(s, "s01")).toContain("docs/prd/01-catalog.md");
    expect(draftDocs(s, "s01")).not.toContain(CHECKOUT);
    expect(draftDocs(s, "s03")).toEqual(expect.arrayContaining([CHECKOUT, "docs/founder-decisions.md", "docs/prd/index.md", "docs/design/catalogues.md"]));
    expect(draftDocs(s, "s03")).not.toContain("docs/prd/01-catalog.md");
  });

  it("plans a slice from the PRD of a criterion that tests its requirements, though another module's PRD holds it", async () => {
    const s = seeded(CROSS);
    await s.init();
    expect(draftDocs(s, "s02")).toContain(CHECKOUT);
    expect(draftDocs(s, "s01")).not.toContain(CHECKOUT);
  });

  const refused: readonly (readonly [string, readonly Cut[], RegExp])[] = [
    ["leaves an id in no slice", [CUT[0] as Cut, CUT[1] as Cut, { id: "s03", requirement_ids: ["CHK-F-001"] }], /CHK-F-002.* no slice/u],
    ["places an id in two slices", [CUT[0] as Cut, CUT[1] as Cut, { id: "s03", requirement_ids: ["CHK-F-001", "CHK-F-002", "CAT-F-002"] }], /CAT-F-002.* s02 and s03/u],
    ["names an id the seed does not hold", [CUT[0] as Cut, CUT[1] as Cut, { id: "s03", requirement_ids: ["CHK-F-001", "CHK-F-002", "CHK-F-009"] }], /CHK-F-009/u],
    ["places a withdrawn requirement", [{ id: "s01", requirement_ids: ["CAT-F-001", "CAT-F-003"] }, CUT[1] as Cut, CUT[2] as Cut], /CAT-F-003/u],
    ["breaks milestone order", [{ id: "s01", requirement_ids: ["CAT-F-002", "CAT-N-001"] }, { id: "s02", requirement_ids: ["CAT-F-001"] }, CUT[2] as Cut], /s02 .*M0.* s01 .*M1/u],
  ];

  it.each(refused)("refuses a slicing that %s, and relaunches the session once with the reason", async (_, bad, reason) => {
    const s = seeded(CONFORMING_PACK, { slices: (take) => slicing(take === 1 ? bad : CUT, take) });
    await s.init();
    expect(sliced(s)).toEqual(["SLICE", "SLICE"]);
    expect(issueOf(sliceInputs(s)[1])).toMatch(reason);
    expect(noteOf(sliceInputs(s)[1])).toContain("Fix what it names");
    expect(planned(s)).toEqual(["PLAN:s01", "PLAN:s02", "PLAN:s03"]);
  });

  it("lets a slice span a milestone boundary, and never go back across one, however many milestones the pack has", async () => {
    const { cutIssue } = await import("../../src/init/slice-seed.js");
    const root = packRepo();
    const { pack } = parsePack(root, packDocuments(root), { greenfield: true });
    const ids = new Map([["CAT-F-001", 0], ["CAT-F-002", 1], ["CAT-N-001", 1], ["CHK-F-001", 2], ["CHK-F-002", 2]]);
    const cut = (...slices: readonly string[][]): Cut[] => slices.map((requirement_ids, i) => ({ id: `s0${String(i + 1)}`, requirement_ids }));
    expect(cutIssue(pack, ids, cut(["CAT-F-001", "CAT-F-002"], ["CAT-N-001", "CHK-F-001"], ["CHK-F-002"]))).toBeNull();
    expect(cutIssue(pack, ids, cut(["CAT-F-001"], ["CAT-F-002", "CHK-F-001"], ["CHK-F-002", "CAT-N-001"]))).toMatch(
      /^s03 holds CAT-N-001 \[M1\] after s02 holds CHK-F-001 \[M2\]/u,
    );
  });

  it("fails SLICE when the relaunch is refused too, rather than planning an incomplete product", async () => {
    const [, bad] = refused[0] ?? ["", CUT, /./u];
    const s = seeded(CONFORMING_PACK, { slices: (take) => slicing(bad, take) });
    await expect(s.init()).rejects.toThrow(/SLICE produced no usable slices artifact: .*CHK-F-002/u);
    expect(planned(s)).toEqual([]);
  });

  it("seeds only the requirements of the documents plan_docs narrows planning to (C-2″)", async () => {
    const s = seeded(CONFORMING_PACK, { slices: (take) => slicing([{ id: "s01", requirement_ids: ["CHK-F-001", "CHK-F-002"] }], take) });
    await s.init({}, { planDocs: [CHECKOUT] });
    expect(sliceInputs(s)[0]?.["seed"]).toEqual([
      { milestone: "M1", title: "Selling", groups: [{ code: "CHK", area: "Checkout", requirement_ids: ["CHK-F-001", "CHK-F-002"], criteria: 2 }] },
    ]);
    expect(sliced(s), "a cut of the checkout alone is whole").toEqual(["SLICE"]);
    const k = String(1 + PLAN_REVIEW_SAMPLES);
    expect(s.notes.join("\n"), "one slice has no whole-plan review").toContain(`1 slice takes at least ${k} planner sessions, ${k} + ${k}R:`);
  });

  it("cuts the documents as they are where those planning reads hold no live requirement of the pack (C-2‴)", async () => {
    const s = seeded(CONFORMING_PACK, { slices: (take) => slicing([{ id: "s01", requirement_ids: [] }], take) });
    await s.init({}, { planDocs: ["docs/design/architecture.md"] });
    const [inputs] = sliceInputs(s);
    expect(inputs).not.toHaveProperty("seed");
    expect(inputs, "the documents' SLICE is handed the stack, as C-2‴'s was").toHaveProperty("stack");
    expect(s.notes.join("\n")).toContain("hold no live requirement of the pack");
  });

  it("shows each session a skeleton its own schema accepts, and none asks for a ticket estimate", async () => {
    const { additionsSkeleton, seededSkeleton } = await import("../../src/init/slice-seed.js");
    const { slicesSkeleton } = await import("../../src/init/slice.js");
    const { sliceAdditionsSchema, slicesSchema } = await import("../../src/schemas/init.js");
    expect(slicesSchema.safeParse(seededSkeleton()).success).toBe(true);
    expect(sliceAdditionsSchema.safeParse(additionsSkeleton()).success).toBe(true);
    expect(JSON.stringify([seededSkeleton(), additionsSkeleton(), slicesSkeleton()])).not.toContain("expected_tickets");
  });

  it("announces the session formula for the slice count, and estimates no ticket count", async () => {
    const s = seeded();
    await s.init();
    const k = 1 + PLAN_REVIEW_SAMPLES;
    const said = s.notes.join("\n");
    expect(said).toContain(
      `3 slices take at least ${String(3 * k + 1)} planner sessions, ${String(k)}N + 1: a draft and ${String(PLAN_REVIEW_SAMPLES)} review reads per slice, and one whole-plan review.`,
    );
    expect(said).toContain(
      `Each of the R revision rounds a slice review asks for adds ${String(k)}, and where the whole-plan review faults C slices, their redrafts and one more whole-plan review add C + 1.`,
    );
    expect(said).not.toMatch(/~\d+ ticket/u);
  });

  it("tells the slicer to place each seed id once in milestone order, and a session shown `slices` to add alone", () => {
    const prompt = readFileSync("prompts/planner.md", "utf8");
    const atSlice = prompt.slice(prompt.indexOf("At SLICE:"), prompt.indexOf("At PLAN:"));
    expect(atSlice).toContain("When `seed` is in your inputs");
    expect(atSlice).toContain("place every id of it in exactly one slice's `requirement_ids`");
    expect(atSlice).toContain("keep milestone order");
    expect(atSlice).toContain("When `slices` is in your inputs as well");
    expect(atSlice).toContain("move, remove or rename nothing already placed");
    expect(atSlice).toContain("do not estimate how many a slice holds");
    expect(prompt, "no stage of the planner's estimates a slice's tickets").not.toContain("expected_tickets");
  });
});

describe("PRDR-291 — a slice is its requirement ids: what re-plans, and what is reused (C-2⁸, C-8⁵)", () => {
  it("re-plans only the slice whose requirement an edit changes, and no session re-slices", async () => {
    const s = seeded();
    await s.init();
    expect(planned(s)).toEqual(["PLAN:s01", "PLAN:s02", "PLAN:s03"]);
    clear(s);

    edit(s.root, CHECKOUT, [CHK_F_002, "- **CHK-F-002** [M1] [E2E] Checkout MUST accept DZD only, and say so at the cart (D-1)."]);
    await s.init();
    expect(sliced(s), "the pack's ids and milestones are unchanged").toEqual([]);
    expect(planned(s)).toEqual(["PLAN:s03"]);
    expect(s.notes.join("\n")).toContain("s01 s01, take 1: reused — nothing it read has changed (C-8)");
  });

  it("keys no slice by its title or goal: a re-slice in new words that cuts the same ids re-plans nothing", async () => {
    const s = seeded();
    await s.init();
    clear(s);
    await s.init({}, { sliceSize: { min: 8, max: 12 } });
    expect(sliced(s), "a new band re-cuts the product").toEqual(["SLICE"]);
    expect(planned(s), "the same ids in new words").toEqual([]);
  });

  it("re-plans only the slices whose requirements cite the entry a veto edits", async () => {
    const s = seeded();
    await s.init();
    clear(s);
    edit(s.root, "docs/founder-decisions.md", ["| DZD only in V1 |", "| DZD and EUR in V1 |"]);
    await s.init();
    expect(sliced(s)).toEqual([]);
    expect(planned(s), "CAT-F-002 and CHK-F-002 cite D-1; CAT-F-001 cites X-1 alone").toEqual(["PLAN:s02", "PLAN:s03"]);
  });

  it("re-plans every slice when a veto edits the stack's entry, which every slice plans on (C-3⁗)", async () => {
    const s = seeded();
    await s.init();
    clear(s);
    edit(s.root, "docs/founder-decisions.md", ["| toolchain | Node.js 22 with pnpm 9 |", "| toolchain | Node.js 24 with pnpm 10 |"]);
    await s.init();
    expect(sliced(s), "the entry is not the slicer's").toEqual([]);
    expect(planned(s)).toEqual(["PLAN:s01", "PLAN:s02", "PLAN:s03"]);
  });

  /** What a requirement's record holds besides its text: each part edited alone re-plans the slices that cite it, and only those. */
  const cited: readonly (readonly [string, Readonly<Record<string, string>>, string, readonly [string, string], readonly string[]])[] = [
    ["a criterion", CONFORMING_PACK, CHECKOUT, ["then it answers `409`\n  `cart_empty` (CHK-F-001).", "then it answers `409`\n  `cart_empty` at once (CHK-F-001)."], ["PLAN:s03"]],
    ["a default", CONFORMING_PACK, "docs/founder-decisions.md", ["| Integer arithmetic has no rounding drift. |", "| Integer arithmetic never drifts. |"], ["PLAN:s01"]],
    [
      "a fact",
      { ...CONFORMING_PACK, [CHECKOUT]: (CONFORMING_PACK[CHECKOUT] ?? "").replace("DZD only (D-1).", "DZD only (D-1; facts §1.1).") },
      "docs/research/verified-facts.md",
      ["Chargily settles card payments in DZD.", "Chargily settles card and wallet payments in DZD."],
      ["PLAN:s03"],
    ],
    [
      "a fact by its section",
      { ...CONFORMING_PACK, [CHECKOUT]: (CONFORMING_PACK[CHECKOUT] ?? "").replace("DZD only (D-1).", "DZD only (D-1; facts §1).") },
      "docs/research/verified-facts.md",
      ["Chargily settles card payments in DZD.", "Chargily settles card and wallet payments in DZD."],
      ["PLAN:s03"],
    ],
    ["a catalogue entry", CONFORMING_PACK, "docs/design/catalogues.md", ["| The cart has no lines. |", "| The cart holds no line. |"], ["PLAN:s03"]],
    ["a criterion another module's PRD holds", CROSS, CHECKOUT, ["then the cart shows its `DZD` price", "then the cart shows its `DZD` price at once"], ["PLAN:s02"]],
    [
      "a route a criterion names by its path alone",
      { ...CONFORMING_PACK, [CHECKOUT]: (CONFORMING_PACK[CHECKOUT] ?? "").replace("when `POST /store/checkout` is called", "when `/store/checkout` is called") },
      "docs/design/catalogues.md",
      ["| Places the order. |", "| Places the order, once. |"],
      ["PLAN:s03"],
    ],
    ["a route only a criterion uses", CONFORMING_PACK, "docs/design/catalogues.md", ["| Places the order. |", "| Places the order, once. |"], ["PLAN:s03"]],
  ];

  it.each(cited)("re-plans only the slices whose requirements cite %s an edit changes", async (_, files, file, change, replanned) => {
    const s = seeded(files);
    await s.init();
    clear(s);
    edit(s.root, file, change);
    await s.init();
    expect(sliced(s)).toEqual([]);
    expect(planned(s)).toEqual(replanned);
  });

  it("keys a slice by the baseline items it carries: a re-cut that moves one re-plans the two slices it moved between", async () => {
    const carrying = (at: string): Cut[] => CUT.map((c) => ({ ...c, baseline_items: c.id === at ? ["PB-001"] : [] }));
    const s = seeded(CONFORMING_PACK, { slices: (take) => slicing(carrying(take === 1 ? "s01" : "s02"), take) });
    await s.init();
    clear(s);
    await s.init({}, { sliceSize: { min: 8, max: 12 } });
    expect(sliced(s)).toEqual(["SLICE"]);
    expect(planned(s)).toEqual(["PLAN:s01", "PLAN:s02"]);
  });

  it("keys a slice by what each baseline item it carries is verified by", async () => {
    const { PRODUCTION_BASELINE } = await import("../../src/init/baseline.js");
    const item = PRODUCTION_BASELINE.find((b) => b.id === "PB-001") as { verifiable_by: string };
    const was = item.verifiable_by;
    const s = seeded(CONFORMING_PACK, { slices: (take) => slicing(CUT.map((c) => ({ ...c, baseline_items: c.id === "s02" ? ["PB-001"] : [] })), take) });
    await s.init();
    clear(s);
    try {
      item.verifiable_by = `${was}, and a scan in CI`;
      await s.init();
    } finally {
      item.verifiable_by = was;
    }
    expect(sliced(s), "the baseline moved, so the product is cut again").toEqual(["SLICE"]);
    expect(planned(s)).toEqual(["PLAN:s02"]);
  });

  it("places an added requirement by a session that may only add, and re-plans only the slice it joins", async () => {
    const s = seeded(CONFORMING_PACK, { additions: additions([["CHK-F-003", "s03"]]) });
    await s.init();
    clear(s);
    edit(s.root, CHECKOUT, ...ADDED);
    await s.init();
    expect(sliced(s)).toEqual(["SLICE:add"]);
    const [adding] = sliceInputs(s);
    expect(adding?.["seed"], "the session is shown what to place, and nothing else").toEqual([
      { milestone: "M1", title: "Selling", groups: [{ code: "CHK", area: "Checkout", requirement_ids: ["CHK-F-003"], criteria: 1 }] },
    ]);
    expect((adding?.["slices"] as { id: string; milestones: string[] }[] | undefined)?.map((x) => [x.id, x.milestones])).toEqual([
      ["s01", ["M0"]],
      ["s02", ["M1"]],
      ["s03", ["M1"]],
    ]);
    expect(planned(s)).toEqual(["PLAN:s03"]);
    expect(slicesOut(s.root).map((x) => [x.id, x.requirement_ids])).toEqual([
      ["s01", ["CAT-F-001"]],
      ["s02", ["CAT-F-002", "CAT-N-001"]],
      ["s03", ["CHK-F-001", "CHK-F-002", "CHK-F-003"]],
    ]);
  });

  it("gives an added requirement a new slice where the session opens one, and plans that slice alone", async () => {
    const s = seeded(CONFORMING_PACK, { additions: additions([], [OPENED]) });
    await s.init();
    clear(s);
    edit(s.root, CHECKOUT, ...ADDED);
    await s.init();
    expect(planned(s)).toEqual(["PLAN:s04"]);
    expect(slicesOut(s.root).map((x) => x.id)).toEqual(["s01", "s02", "s03", "s04"]);
  });

  /** C-2¹⁵: what code refuses of a session that may only add, each named to the relaunch. */
  const refusedAdditions: readonly (readonly [string, () => Json, RegExp])[] = [
    ["moves what is already placed", additions([["CHK-F-003", "s03"], ["CAT-F-001", "s02"]]), /CAT-F-001 is already placed in s01/u],
    ["places an id it was not shown", additions([["CHK-F-003", "s03"], ["CHK-F-009", "s03"]]), /CHK-F-009 is not among the requirements to place/u],
    ["leaves out an id it was shown", additions([]), /CHK-F-003 is placed in no slice/u],
    ["places an id in a slice that does not exist", additions([["CHK-F-003", "s07"]]), /s07, which is no slice/u],
    ["opens a slice under an id a slice has", additions([], [{ ...OPENED, id: "s02" }]), /new slice s02 takes an id a slice already has/u],
    ["opens a slice after one that does not exist", additions([], [{ ...OPENED, after: "s07" }]), /follows s07, which is no slice before it/u],
    ["opens a slice that depends on a later one", additions([], [{ ...OPENED, after: "s01", depends_on: ["s03"] }]), /s04 depends on s03, which is not an EARLIER slice/u],
    ["breaks milestone order", additions([], [{ ...OPENED, after: null, depends_on: [] }]), /s01 holds CAT-F-001 \[M0\] after s04 holds CHK-F-003 \[M1\]/u],
    ["opens a slice with no requirement", additions([["CHK-F-003", "s03"]], [{ ...OPENED, requirement_ids: [] }]), /requirement_ids/u],
    ["writes a field its shape does not have", () => ({ ...additions([["CHK-F-003", "s03"]])(), removed: ["CAT-F-001"] }), /removed/u],
  ];

  it.each(refusedAdditions)("refuses a session that may only add when it %s, and relaunches it once with the reason", async (_, bad, reason) => {
    const s = seeded(CONFORMING_PACK, { additions: (take) => (take === 1 ? bad : additions([["CHK-F-003", "s03"]]))() });
    await s.init();
    clear(s);
    edit(s.root, CHECKOUT, ...ADDED);
    await s.init();
    expect(sliced(s)).toEqual(["SLICE:add", "SLICE:add"]);
    expect(issueOf(sliceInputs(s)[1])).toMatch(reason);
    expect(noteOf(sliceInputs(s)[1])).toContain("Fix what it names");
    expect(planned(s)).toEqual(["PLAN:s03"]);
  });

  it("fails SLICE when the relaunch of a session that may only add is refused too", async () => {
    const s = seeded(CONFORMING_PACK, { additions: additions([]) });
    await s.init();
    clear(s);
    edit(s.root, CHECKOUT, ...ADDED);
    await expect(s.init()).rejects.toThrow(/SLICE could not place CHK-F-003: CHK-F-003 is placed in no slice/u);
    expect(planned(s)).toEqual([]);
  });

  it("re-plans the slice a withdrawn requirement leaves, and runs no session", async () => {
    const s = seeded();
    await s.init();
    clear(s);
    edit(s.root, CHECKOUT, [CHK_F_002, "- **CHK-F-002** [withdrawn] Checkout accepted DZD only."]);
    await s.init();
    expect(sliced(s)).toEqual([]);
    expect(planned(s)).toEqual(["PLAN:s03"]);
    expect(slicesOut(s.root).find((x) => x.id === "s03")?.requirement_ids).toEqual(["CHK-F-001"]);
  });

  it("drops a slice the pack leaves with nothing to plan, and the edges to it", async () => {
    const lone: Cut[] = [
      { id: "s01", requirement_ids: ["CAT-F-001"] },
      { id: "s02", requirement_ids: ["CHK-F-002"], depends_on: ["s01"] },
      { id: "s03", requirement_ids: ["CAT-F-002", "CAT-N-001", "CHK-F-001"], depends_on: ["s01", "s02"] },
    ];
    const s = seeded(CONFORMING_PACK, { slices: (take) => slicing(lone, take) });
    await s.init();
    clear(s);
    edit(s.root, CHECKOUT, [CHK_F_002, "- **CHK-F-002** [withdrawn] Checkout accepted DZD only."]);
    await s.init();
    expect(sliced(s)).toEqual([]);
    expect(slicesOut(s.root).map((x) => [x.id, x.depends_on])).toEqual([
      ["s01", []],
      ["s03", ["s01"]],
    ]);
    expect(planned(s)).toEqual([]);
  });

  it("re-places a requirement whose milestone moves through the session that may only add", async () => {
    const s = seeded(CONFORMING_PACK, { additions: additions([["CAT-N-001", "s01"]]) });
    await s.init();
    clear(s);
    edit(s.root, "docs/prd/01-catalog.md", ["**CAT-N-001** [M1]", "**CAT-N-001** [M0]"]);
    await s.init();
    expect(sliced(s)).toEqual(["SLICE:add"]);
    expect(planned(s)).toEqual(["PLAN:s01", "PLAN:s02"]);
    expect(slicesOut(s.root).map((x) => [x.id, x.requirement_ids])).toEqual([
      ["s01", ["CAT-F-001", "CAT-N-001"]],
      ["s02", ["CAT-F-002"]],
      ["s03", ["CHK-F-001", "CHK-F-002"]],
    ]);
  });

  it("cuts the product again where no slice on record keeps a requirement the pack still holds", async () => {
    const s = seeded(CONFORMING_PACK, {
      slices: (take) => slicing(take === 1 ? [{ id: "s01", requirement_ids: ["CHK-F-001", "CHK-F-002"] }] : CUT.slice(0, 2), take),
    });
    await s.init({}, { planDocs: [CHECKOUT] });
    clear(s);
    await s.init({}, { planDocs: ["docs/prd/01-catalog.md"] });
    expect(sliced(s), "a whole cut, not a session that may only add").toEqual(["SLICE"]);
    expect(s.notes.join("\n")).toContain("no slice on record keeps a requirement the pack still holds");
    expect(slicesOut(s.root).map((x) => x.id)).toEqual(["s01", "s02"]);
  });

  it("cuts the product again, and plans every slice again, when the planner prompt moves (C-4⁵ is not built)", async () => {
    const s = seeded();
    await s.init();
    clear(s);
    await s.init({}, { prompts: { ...PROMPTS, hashes: { ...PROMPTS.hashes, planner: "an edited planner prompt" } } });
    expect(sliced(s)).toEqual(["SLICE"]);
    expect(s.notes.join("\n")).toContain("the baseline, the band or the prompt moved since the product was last cut");
    expect(planned(s)).toEqual(["PLAN:s01", "PLAN:s02", "PLAN:s03"]);
  });

  it("--replan still re-derives every slice: a fresh slicing, and every slice planned again (C-8′)", async () => {
    const s = seeded();
    await s.init();
    clear(s);
    await s.init({ replan: true });
    expect(sliced(s)).toEqual(["SLICE"]);
    expect(planned(s)).toEqual(["PLAN:s01", "PLAN:s02", "PLAN:s03"]);
  });
});
