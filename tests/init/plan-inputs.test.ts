import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import type { InitResult } from "../../src/init/machine.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { CONFORMING_PACK } from "./pack-fixture.js";
import { APPROVE_PLAN } from "./plan-fixture.js";
import { clear, CUT, draft, edit, planned, seeded, sliced, slicing, type Json, type Seeded } from "./seed-fixture.js";
import { ticket } from "./slicing-fixture.js";

/**
 * PRDR-292 — PLAN drafts from the pack's records (C-4⁵).
 *
 * The planning audit found a drafter re-deriving from prose what a pack states
 * as data, guessing the names earlier tickets own (56 of 60 drafting sessions
 * read Detent's own state files for them), and told to ask questions the
 * founder had already answered. On a pack, a draft is handed the checker's
 * parse of its slice's records and an index of what the slices it builds on
 * provide; it carries the pack's criteria verbatim, names a catalogued thing
 * by its catalogue id, and reports what the pack leaves unsettled as a spec
 * defect quoted from it, which holds approval until the pack is amended.
 */

const plans = (s: Seeded, slice: string): Json[] =>
  s.inputs.filter((i) => i["stage"] === "PLAN" && (i["slice"] as { id?: unknown } | undefined)?.id === slice);

const issueOf = (input: Json | undefined): string => String((input?.["previous_attempt"] as { issue?: unknown } | undefined)?.issue);

const noteOf = (input: Json | undefined): string => String((input?.["previous_attempt"] as { note?: unknown } | undefined)?.note);

const ticketFile = (root: string, id: string): Json => JSON.parse(readFileSync(path.join(stateDir(root), "plan", `${id}.json`), "utf8")) as Json;

const sliceOfInputs = (inputs: Json): string => (inputs["slice"] as { id: string }).id;

const CAT_AC_01 = "CAT-AC-01: Given a product titled `Mug` priced 1500, when it is stored and read back, then the title is `Mug` and the price is 1500.";

/** s01's draft, one ticket carrying `ids` with `acceptance` as its only criterion; every other slice's as the fixture drafts it. */
const carrying =
  (acceptance: string, ids: readonly string[] = ["CAT-AC-01"]) =>
  (_take: number, inputs: Json): Json =>
    sliceOfInputs(inputs) !== "s01"
      ? draft(inputs)
      : { schema_version: SCHEMA_VERSION, tickets: [{ ...ticket("t-s01-001"), requirement_ids: ["CAT-F-001"], acceptance_criteria: [acceptance], criterion_ids: [...ids] }] };

/** CHK-F-001's words, the passage a gap in the pack is quoted from. */
const GAP = {
  kind: "gap",
  passages: [{ id: "CHK-F-001", quote: "MUST emit `order.placed` once the order is stored" }],
  defect: "The pack does not say whether an order is stored before its payment settles or after.",
};

/** `slice`'s draft reports `defects` on the launches `takes` names, its first by default, and nothing on the others. */
const reporting =
  (slice: string, defects: readonly Json[], takes: readonly number[] = [1]) =>
  (take: number, inputs: Json): Json => ({ ...draft(inputs), ...(sliceOfInputs(inputs) === slice && takes.includes(take) ? { spec_defects: [...defects] } : {}) });

/** A review that asks for `ticket` to be split. */
const splitting = (ticket: string): Json => ({ schema_version: SCHEMA_VERSION, verdict: "changes", findings: [{ tag: "sizing", finding: `${ticket} is two sessions' work`, ticket }] });

describe("PRDR-292: a PLAN session drafts from the checker's parse of its slice's records (C-4⁵)", () => {
  it("is handed each requirement, its criteria and what they cite, and no document or document path", async () => {
    const s = seeded();
    await s.init();
    const [s01] = plans(s, "s01");
    const [s03] = plans(s, "s03");
    const records = s03?.["records"] as { requirements: Json[]; criteria: Json[]; decisions: Json[]; defaults: Json[]; facts: Json[]; catalogue_entries: Json[] };
    expect(records.requirements).toEqual([
      { id: "CHK-F-001", milestone: 1, level: "MUST", tags: [], text: "Checkout MUST refuse an empty cart with `409` `cart_empty`, and MUST emit `order.placed` once the order is stored (CAT-F-001)." },
      { id: "CHK-F-002", milestone: 1, level: "MUST", tags: ["E2E"], text: "Checkout MUST accept DZD only (D-1)." },
    ]);
    expect(records.criteria.map((c) => [c["id"], c["requirements"], c["given"], c["when"], c["then"]])).toEqual([
      ["CHK-AC-01", ["CHK-F-001"], "an empty cart", "`POST /store/checkout` is called", "it answers `409` `cart_empty`"],
      ["CHK-AC-02", ["CHK-F-001", "CHK-F-002"], "a cart holding one product at 1500 DZD", "it is checked out", "one `order.placed` event carries the order id, and a EUR cart answers `409`"],
    ]);
    expect(records.decisions).toEqual([{ id: "D-1", question: "Which currencies does checkout accept?", answer: "DZD only in V1", reason: "The launch market is Algeria." }]);
    expect(records.defaults).toEqual([]);
    expect(records.facts).toEqual([]);
    expect(records.catalogue_entries.map((e) => `${String(e["kind"])}:${String(e["id"])}`).sort()).toEqual(["error_codes:cart_empty", "events:order.placed", "routes:POST /store/checkout"]);
    expect(records.catalogue_entries.find((e) => e["id"] === "cart_empty")?.["row"]).toBe("| `cart_empty` | 409 | The cart has no lines. |");
    expect((s01?.["records"] as { defaults: Json[] }).defaults).toEqual([{ id: "X-1", value: "Prices are stored in minor units.", reason: "Integer arithmetic has no rounding drift." }]);
    for (const input of [s01, s03]) {
      expect(input).not.toHaveProperty("docs");
      expect(input).not.toHaveProperty("analysis");
      const text = JSON.stringify(input);
      for (const doc of Object.keys(CONFORMING_PACK)) expect(text, `a PLAN session's inputs name ${doc}`).not.toContain(doc);
    }
  });

  it("is handed the stack, the bindings, the session budget and the slice's baseline items beside them", async () => {
    const s = seeded(CONFORMING_PACK, { slices: (take) => slicing([{ ...CUT[0]!, baseline_items: ["PB-001"] }, CUT[1]!, CUT[2]!], take) });
    await s.init();
    const [s01] = plans(s, "s01");
    expect(s01?.["stack"]).toMatchObject({ language: "TypeScript" });
    expect(s01?.["bound_slots"]).toEqual(expect.any(Array));
    expect(s01?.["session_budget"]).toMatchObject({ implement_turns: expect.any(Number) });
    expect((s01?.["production_baseline"] as Json[]).map((b) => b["id"])).toEqual(["PB-001"]);
    expect((s01?.["slice"] as Json)["docs"], "a slice's document paths are not among a draft's inputs").toBeUndefined();
  });

  it("is handed the tickets of the slices it depends on, each with what it provides as kind:id, and no other slice's", async () => {
    const providing = (_take: number, inputs: Json): Json => {
      const id = sliceOfInputs(inputs);
      const base = draft(inputs) as { tickets: Json[] };
      return { ...base, tickets: base.tickets.map((t) => ({ ...t, provides: [{ kind: "symbol", id: `shop/${id}.Thing`, note: `what ${id} builds` }] })) };
    };
    const s = seeded(CONFORMING_PACK, { draft: providing });
    await s.init();
    expect(plans(s, "s03")[0]?.["plan_index"]).toEqual([{ id: "t-s01-001", title: "t t-s01-001", surface: ["src/**"], provides: ["symbol:shop/s01.Thing"] }]);
    expect(plans(s, "s01")[0], "the first slice depends on nothing").not.toHaveProperty("plan_index");
  });

  it("drafts from the documents, as without a pack, where those planning reads hold no requirement of it (C-2‴)", async () => {
    const s = seeded(CONFORMING_PACK, { slices: (take) => slicing([{ id: "s01", requirement_ids: [] }], take) });
    await s.init({}, { planDocs: ["docs/design/architecture.md"] });
    const [s01] = plans(s, "s01");
    expect(s01, "a slice cut from prose has no records").not.toHaveProperty("records");
    expect(s01?.["docs"]).toContain("docs/design/architecture.md");
  });

  it("reaches the slices those depend on as well", async () => {
    const chain = [CUT[0]!, CUT[1]!, { ...CUT[2]!, depends_on: ["s02"] }];
    const s = seeded(CONFORMING_PACK, { slices: (take) => slicing(chain, take) });
    await s.init();
    expect((plans(s, "s03")[0]?.["plan_index"] as Json[]).map((t) => t["id"])).toEqual(["t-s01-001", "t-s02-001"]);
  });

  it("is handed a criterion that tests one of its requirements, though it tests another slice's as well", async () => {
    const split = [CUT[0]!, CUT[1]!, { id: "s03", requirement_ids: ["CHK-F-001"], depends_on: ["s01"] }, { id: "s04", requirement_ids: ["CHK-F-002"], depends_on: ["s01"] }];
    const s = seeded(CONFORMING_PACK, { slices: (take) => slicing(split, take) });
    await s.init();
    const criteria = (slice: string): unknown[] => (plans(s, slice)[0]?.["records"] as { criteria: Json[] }).criteria.map((c) => c["id"]);
    expect(criteria("s03")).toEqual(["CHK-AC-01", "CHK-AC-02"]);
    expect(criteria("s04"), "CHK-AC-02 tests CHK-F-001 and CHK-F-002").toEqual(["CHK-AC-02"]);
  });
});

describe("PRDR-292: a ticket carries the pack's criteria it delivers, by id and verbatim (A-1, C-4⁵)", () => {
  it("each criterion's exact words are among the draft's inputs", async () => {
    const s = seeded();
    await s.init();
    expect((plans(s, "s01")[0]?.["records"] as { criteria: Json[] }).criteria.map((c) => c["text"])).toEqual([CAT_AC_01]);
  });

  it("a criterion copied verbatim reaches the A-1 ticket with its id", async () => {
    const s = seeded(CONFORMING_PACK, { draft: carrying(CAT_AC_01) });
    await s.init();
    expect(plans(s, "s01")).toHaveLength(1);
    const written = ticketFile(s.root, "t-s01-001");
    expect(written["criterion_ids"]).toEqual(["CAT-AC-01"]);
    expect(written["acceptance_criteria"]).toEqual([CAT_AC_01]);
  });

  it("a ticket that paraphrases a criterion it carries is refused, and the relaunch is told the words to copy", async () => {
    const s = seeded(CONFORMING_PACK, {
      draft: (take, inputs) => carrying(take === 1 ? "Given a mug priced 1500, when it is saved, then it reads back the same" : CAT_AC_01)(take, inputs),
    });
    await s.init();
    const [first, second] = plans(s, "s01");
    expect(first).not.toHaveProperty("previous_attempt");
    for (const named of ["t-s01-001", "CAT-AC-01", CAT_AC_01]) expect(issueOf(second)).toContain(named);
    expect(noteOf(second), "a refusal is not a shape error, whose content is kept").toContain("Fix what it names");
    expect(noteOf(second)).not.toContain("sound to keep");
    expect(ticketFile(s.root, "t-s01-001")["acceptance_criteria"]).toEqual([CAT_AC_01]);
  });

  it("a criterion copied with its lines rewrapped, or its code ticks or bold markers dropped, is copied word for word", async () => {
    const s = seeded(CONFORMING_PACK, { draft: carrying("CAT-AC-01: Given a product titled **Mug** priced 1500, when it is stored\n  and read back, then the title is Mug and the price is 1500.") });
    await s.init();
    expect(plans(s, "s01"), "the draft is kept as drafted").toHaveLength(1);
  });

  it("a paraphrase on the relaunch as well ends PLAN, and so does a criterion the pack does not define", async () => {
    await expect(seeded(CONFORMING_PACK, { draft: carrying("the mug reads back as stored") }).init()).rejects.toThrow(/PLAN could not draft slice s01[\s\S]*CAT-AC-01/u);
    await expect(seeded(CONFORMING_PACK, { draft: carrying("CAT-AC-09: Given nothing, when nothing, then nothing.", ["CAT-AC-09"]) }).init()).rejects.toThrow(/CAT-AC-09/u);
  });
});

describe("PRDR-292: catalogue ids are the names of what a catalogue covers (A-1‴, C-4⁵)", () => {
  const naming =
    (contracts: { readonly provides?: readonly Json[]; readonly consumes?: readonly Json[] }) =>
    (_take: number, inputs: Json): Json => {
      const base = draft(inputs) as { tickets: Json[] };
      if (sliceOfInputs(inputs) !== "s03") return base;
      return { ...base, tickets: base.tickets.map((t) => ({ ...t, provides: [...(contracts.provides ?? [])], consumes: [...(contracts.consumes ?? [])] })) };
    };
  /** PRDR-293: what the checks still find holds approval, and PRESENT names each; a plan that passes them is offered for approval. */
  const contractFindings = (result: InitResult): string[] => (result.interrupt?.interrupt === "AWAIT_INFO" ? [...result.interrupt.items] : []);
  const sentTo = (s: Seeded, slice: string): string =>
    plans(s, slice)
      .flatMap((i) => (i["check_failures"] as { finding: string }[] | undefined) ?? [])
      .map((f) => f.finding)
      .join("\n");

  it("a name of a catalogued kind that its catalogue does not hold fails a check, and a catalogue id does not", async () => {
    const s = seeded(CONFORMING_PACK, {
      draft: naming({
        provides: [
          { kind: "route", id: "POST /checkout", note: "places the order" },
          { kind: "event", id: "order.placed", note: "the order is stored" },
          { kind: "error_code", id: "cart_empty", note: "the cart has no lines" },
          { kind: "error_code", id: "cart_missing", note: "no such cart" },
        ],
        consumes: [{ kind: "event", id: "order.paid" }],
      }),
    });
    const found = contractFindings(await s.init());
    /* PRDR-293: the slice's redraft is sent them first, and this draft keeps them. */
    expect(sentTo(s, "s03")).toContain("`route:POST /checkout`, and the pack's catalogue holds no route");
    expect(found.filter((f) => f.includes("POST /checkout") && f.includes("catalogue"))).toHaveLength(1);
    expect(found.filter((f) => f.includes("cart_missing") && f.includes("catalogue"))).toHaveLength(1);
    expect(found.filter((f) => f.includes("order.paid") && f.includes("catalogue"))).toHaveLength(1);
    expect(found.filter((f) => f.includes("order.placed") || f.includes("`cart_empty`") || f.includes("error_code:cart_empty"))).toEqual([]);
  });

  it("a kind the pack catalogues nothing of is named freely", async () => {
    const s = seeded(CONFORMING_PACK, {
      draft: naming({ provides: [{ kind: "job", id: "nightly-reindex", note: "rebuilds the search index" }, { kind: "setting", id: "max_cart_lines", note: "a cart's line limit" }] }),
    });
    expect(contractFindings(await s.init()).filter((f) => f.includes("nightly-reindex") || f.includes("max_cart_lines"))).toEqual([]);
  });

  it("a draft is handed the catalogue's ids under the kind that names them", async () => {
    const s = seeded();
    await s.init();
    expect(plans(s, "s01")[0]?.["catalogue_ids"]).toEqual({ error_code: ["cart_empty"], event: ["order.placed"], route: ["POST /store/checkout"] });
  });
});

describe("PRDR-292: planning asks nothing, and reports what the pack leaves unsettled as a spec defect (C-4⁵, C-3⁗)", () => {
  it("a draft's expected shape has spec_defects and criterion_ids and no questions, and nothing already asked is handed to it", async () => {
    const s = seeded();
    await s.init();
    const [s01] = plans(s, "s01");
    const skeleton = s01?.["expected_output"] as { tickets: Json[] };
    expect(skeleton).not.toHaveProperty("questions");
    expect(skeleton).toHaveProperty("spec_defects");
    expect(skeleton.tickets[0]).toHaveProperty("criterion_ids");
    expect(s01).not.toHaveProperty("open_questions");
  });

  it("a draft that asks a question is refused", async () => {
    const s = seeded(CONFORMING_PACK, {
      draft: (take, inputs) => ({ ...draft(inputs), ...(take === 1 ? { questions: [{ id: "q1", question: "Which region hosts the data?", blocking: false, assumption: "eu-west-1" }] } : {}) }),
    });
    await s.init();
    for (const slice of ["s01", "s02", "s03"]) expect(plans(s, slice), `${slice} is drafted again, without the question`).toHaveLength(2);
    expect(issueOf(plans(s, "s01")[1])).toContain("questions");
  });

  it("SLICE asks nothing either: a slicing that carries questions is refused", async () => {
    const s = seeded(CONFORMING_PACK, {
      slices: (take) => ({ ...slicing(CUT, take), ...(take === 1 ? { questions: [{ id: "q1", question: "Which region?", blocking: false, assumption: "eu-west-1" }] } : {}) }),
    });
    await s.init();
    expect(sliced(s)).toEqual(["SLICE", "SLICE"]);
  });

  it("a spec defect quoted from the pack reaches PRESENT, which raises AWAIT_INFO naming it and never offers approval", async () => {
    let asked = 0;
    const s = seeded(CONFORMING_PACK, { draft: reporting("s03", [GAP]) });
    const result = await s.init({}, {
      askApproval: async () => {
        asked += 1;
        return { kind: "approved", by: "the operator" };
      },
    });
    expect(result.exitCode).toBe(2);
    expect(result.interrupt?.interrupt).toBe("AWAIT_INFO");
    for (const shown of ["CHK-F-001", GAP.passages[0]!.quote, GAP.defect]) expect(result.interrupt?.message).toContain(shown);
    expect(result.interrupt?.message, "each passage says where the pack is amended").toContain("CHK-F-001 (docs/prd/02-checkout.md:3)");
    expect(result.interrupt?.message.split("\n")[0]).toBe("Plan drafted, and not approvable while the spec defects below are open.");
    expect(result.interrupt?.items.join("\n")).toContain(GAP.defect);
    expect(asked, "approval is not offered while a spec defect is open").toBe(0);
    expect(existsSync(path.join(stateDir(s.root), "plan", "approval.json"))).toBe(false);
    const shown = JSON.parse(readFileSync(path.join(stateDir(s.root), "plan", "presentation.json"), "utf8")) as Json;
    expect(shown["spec_defects"]).toBe(1);
  });

  it("a spec defect whose quote is not in the record it names is refused, and so is one under an id the pack does not define", async () => {
    const misquoted = { ...GAP, passages: [{ id: "CHK-F-001", quote: "MUST emit `order.shipped`" }] };
    const unknown = { ...GAP, passages: [{ id: "D-9", quote: "DZD only in V1" }] };
    const s = seeded(CONFORMING_PACK, { draft: reporting("s03", [misquoted, unknown]) });
    const result = await s.init();
    expect(plans(s, "s03")).toHaveLength(2);
    expect(issueOf(plans(s, "s03")[1])).toContain("order.shipped");
    expect(issueOf(plans(s, "s03")[1])).toContain("D-9");
    expect(result.interrupt?.interrupt, "nothing is open once the relaunch reports nothing").toBe("AWAIT_APPROVAL");
  });

  /**
   * A criterion quoted as it is handed, the document's words across a
   * continuation line, a fact by its section mark, and words without their
   * code ticks.
   */
  it("a quote is found as the parse holds its record, or as its document writes it", async () => {
    const quoted = {
      kind: "gap",
      passages: [
        { id: "CHK-AC-01", quote: "CHK-AC-01: Given an empty cart, when `POST /store/checkout` is called" },
        { id: "CHK-AC-01", quote: "then it answers `409` `cart_empty` (CHK-F-001)" },
        { id: "§1.1", quote: "Chargily settles card payments in DZD." },
        { id: "CHK-F-001", quote: "MUST emit order.placed once the order is stored" },
      ],
      defect: "The pack does not say which card networks checkout accepts.",
    };
    const s = seeded(CONFORMING_PACK, { draft: reporting("s03", [quoted]) });
    const result = await s.init();
    expect(plans(s, "s03").map(issueOf), "no quote is refused").toEqual(["undefined"]);
    expect(result.interrupt?.interrupt).toBe("AWAIT_INFO");
  });

  it("a contradiction quoting one passage is refused: it quotes both sides", async () => {
    const lone = { kind: "contradiction", passages: GAP.passages, defect: "Checkout emits the event before it stores the order." };
    const s = seeded(CONFORMING_PACK, { draft: reporting("s03", [lone]) });
    await s.init();
    expect(plans(s, "s03")).toHaveLength(2);
    expect(issueOf(plans(s, "s03")[1])).toContain("contradict");
  });

  it("without a pack, a draft reports no spec defect and carries no criterion id, since neither can be checked", async () => {
    const prose = (take: number): Json => slicing([{ id: "s01", requirement_ids: [] }], take);
    const reports = seeded(CONFORMING_PACK, { slices: prose, draft: reporting("s01", [GAP]) });
    await reports.init({}, { planDocs: ["docs/design/architecture.md"] });
    expect(plans(reports, "s01")).toHaveLength(2);
    expect(issueOf(plans(reports, "s01")[1])).toContain("there is none");
    const carries = seeded(CONFORMING_PACK, { slices: prose, draft: (take, inputs) => (take === 1 ? carrying(CAT_AC_01)(take, inputs) : draft(inputs)) });
    await carries.init({}, { planDocs: ["docs/design/architecture.md"] });
    expect(plans(carries, "s01")).toHaveLength(2);
    expect(issueOf(plans(carries, "s01")[1])).toContain("there is no pack");
  });

  it("a spec defect a slice's revision reports reaches PRESENT", async () => {
    const s = seeded(CONFORMING_PACK, {
      review: (take, inputs) => (inputs["scope"] === "slice" && sliceOfInputs(inputs) === "s03" && take <= 3 ? splitting("t-s03-001") : APPROVE_PLAN),
      draft: reporting("s03", [GAP], [2]),
    });
    const result = await s.init();
    expect(plans(s, "s03"), "s03 is drafted, and revised once").toHaveLength(2);
    expect(result.interrupt?.items).toEqual([`[s03] gap: ${GAP.defect}`]);
  });

  /** PRDR-293: the redraft the whole-plan review sent is gone; one the checks send reports a defect the same way. */
  it("a spec defect a redraft the checks sent reports reaches PRESENT, and one two drafts of a slice report is listed once", async () => {
    const faulted = (takes: readonly number[]): Seeded =>
      seeded(CONFORMING_PACK, {
        draft: (take, inputs) => {
          const reported = reporting("s03", [GAP], takes)(take, inputs) as { tickets: Json[] };
          return sliceOfInputs(inputs) === "s03" && take === 1 ? { ...reported, tickets: reported.tickets.map((t) => ({ ...t, consumes: [{ kind: "config", id: "NOPE" }] })) } : reported;
        },
      });
    const redrafted = faulted([2]);
    const result = await redrafted.init();
    expect(plans(redrafted, "s03"), "s03 is drafted, and redrafted once for the checks").toHaveLength(2);
    expect(result.interrupt?.items).toEqual([`[s03] gap: ${GAP.defect}`]);
    const twice = faulted([1, 2]);
    expect((await twice.init()).interrupt?.items).toEqual([`[s03] gap: ${GAP.defect}`]);
  });

  it("a slice reused from its cache keeps the spec defect it reported", async () => {
    const s = seeded(CONFORMING_PACK, { draft: reporting("s03", [GAP]) });
    expect((await s.init()).interrupt?.interrupt).toBe("AWAIT_INFO");
    clear(s);
    edit(s.root, "docs/prd/01-catalog.md", ["SHOULD show its price in DZD (D-1)", "SHOULD show its price in DZD, to the dinar (D-1)"]);
    const result = await s.init();
    expect(planned(s), "s02 holds the amended requirement, and s03 is reused").toEqual(["PLAN:s02"]);
    expect(result.interrupt?.items).toEqual([`[s03] gap: ${GAP.defect}`]);
  });

  it("a slice whose spec defect quotes a passage the pack has since amended is planned again, and the rest are reused", async () => {
    const s = seeded(CONFORMING_PACK, { draft: reporting("s01", [GAP]) });
    expect((await s.init()).interrupt?.interrupt).toBe("AWAIT_INFO");
    clear(s);
    edit(s.root, "docs/prd/02-checkout.md", ["once the order is stored", "after the order is stored"]);
    const result = await s.init();
    expect([...planned(s)].sort(), "s03 holds the amended requirement, and s01 quoted it").toEqual(["PLAN:s01", "PLAN:s03"]);
    expect(result.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
  });
});
