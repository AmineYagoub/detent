import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { packDocuments } from "../../src/init/pack.js";
import { parsePack } from "../../src/init/pack-parse.js";
import { checkPlan, type PlanContext } from "../../src/init/plan-checks.js";
import type { DraftedTicket } from "../../src/init/plan-write.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { slicesSchema, type CheckFailure, type SliceSpec } from "../../src/schemas/init.js";
import { packRepo } from "./pack-fixture.js";

/**
 * PRDR-293 — A-1⁷'s five checks, as a pure function of a plan.
 *
 * ksar-cloud's approved plan kept 34 defects code had proved, because proved
 * findings were only reported and the whole-plan review was told to treat
 * them as handled; coverage was claimed and never checked. Each case here is
 * one family's failure, with the slice a redraft for it is sent to and a key
 * that names it across drafts.
 */

const t = (id: string, slice: string, over: Partial<DraftedTicket> = {}): DraftedTicket => ({
  id,
  type: "feature",
  title: `t ${id}`,
  description: "",
  acceptance_criteria: ["it works"],
  non_goals: [],
  surface: ["src/**"],
  depends_on: [],
  provides: [],
  consumes: [],
  requirement_ids: [],
  baseline_ids: [],
  criterion_ids: [],
  risk_label: false,
  slice,
  ...over,
});

const slice = (id: string, over: Partial<SliceSpec> = {}): SliceSpec => ({
  id,
  title: id,
  goal: "g",
  requirement_ids: [],
  baseline_items: [],
  docs: [],
  depends_on: [],
  rationale: "",
  ...over,
});

const context = (over: Partial<PlanContext> = {}): PlanContext => ({ slices: [slice("s01"), slice("s02")], pack: null, done: [], ...over });
const failures = (ctx: PlanContext, tickets: readonly DraftedTicket[]): CheckFailure[] => checkPlan(ctx, tickets).failures;
const of = (fs: readonly CheckFailure[], check: CheckFailure["check"]): CheckFailure[] => fs.filter((f) => f.check === check);

function pack(): PlanContext["pack"] {
  const root = packRepo();
  return parsePack(root, packDocuments(root), { greenfield: true }).pack;
}

describe("PRDR-293 coverage", () => {
  it("a requirement id or baseline item a slice was assigned and no ticket of it names fails, in that slice", () => {
    const ctx = context({ slices: [slice("s01", { requirement_ids: ["R-1", "R-7"], baseline_items: ["PB-004"] })] });
    const out = of(failures(ctx, [t("t-s01-001", "s01", { requirement_ids: ["R-1"] })]), "coverage");
    expect(out.map((f) => f.key).sort()).toEqual(["coverage:s01:PB-004", "coverage:s01:R-7"]);
    expect(out.every((f) => f.slice === "s01")).toBe(true);
    expect(out.map((f) => f.finding).join("\n")).toContain("`baseline_ids`");
  });

  it("a slice whose tickets declare nothing fails for each item, not once as undeclared", () => {
    const ctx = context({ slices: [slice("s01", { requirement_ids: ["R-1", "R-7"] })] });
    expect(of(failures(ctx, [t("t-s01-001", "s01")]), "coverage").map((f) => f.key)).toEqual(["coverage:s01:R-1", "coverage:s01:R-7"]);
  });

  it("a criterion that tests a slice's requirement and no ticket carries fails, in the last slice holding one of its requirements", () => {
    const ctx = context({
      pack: pack(),
      slices: [slice("s01", { requirement_ids: ["CAT-F-001"] }), slice("s02", { requirement_ids: ["CAT-F-002", "CAT-N-001"] })],
    });
    const tickets = [
      t("t-s01-001", "s01", { requirement_ids: ["CAT-F-001"], criterion_ids: ["CAT-AC-01"] }),
      t("t-s02-001", "s02", { requirement_ids: ["CAT-F-002", "CAT-N-001"] }),
    ];
    const out = of(failures(ctx, tickets), "coverage");
    expect(out.map((f) => [f.slice, f.key])).toEqual([["s02", "coverage:s02:CAT-AC-02"]]);
    expect(out[0]?.finding).toContain("`criterion_ids`");
  });

  it("a criterion is not due before the last slice holding its requirements is planned", () => {
    const ctx = context({
      pack: pack(),
      slices: [slice("s01", { requirement_ids: ["CAT-F-001", "CAT-F-002"] }), slice("s02", { requirement_ids: ["CAT-N-001"] })],
    });
    const out = failures(ctx, [t("t-s01-001", "s01", { requirement_ids: ["CAT-F-001", "CAT-F-002"], criterion_ids: ["CAT-AC-01"] })]);
    expect(out).toEqual([]);
  });

  it("a criterion that tests only withdrawn requirements is not due, even in a slice that still holds one", () => {
    const p = pack();
    if (p === null) throw new Error("the pack fixture parses");
    const [base] = p.criteria;
    if (base === undefined) throw new Error("the pack fixture holds a criterion");
    const ctx = context({ pack: { ...p, criteria: [...p.criteria, { ...base, id: "CAT-AC-99", requirements: ["CAT-F-003"] }] }, slices: [slice("s01", { requirement_ids: ["CAT-F-003"] })] });
    const tickets = [t("t-s01-001", "s01", { requirement_ids: ["CAT-F-003"] })];
    expect(of(failures(ctx, tickets), "coverage").map((f) => f.key)).not.toContain("coverage:s01:CAT-AC-99");
  });

  it("a ticket naming a requirement, baseline item or criterion its slice was not assigned fails", () => {
    const ctx = context({
      pack: pack(),
      slices: [slice("s01", { requirement_ids: ["CAT-F-001"], baseline_items: ["PB-001"] }), slice("s02", { requirement_ids: ["CHK-F-001"] })],
    });
    const tickets = [
      t("t-s01-001", "s01", { requirement_ids: ["CAT-F-001", "CHK-F-001"], baseline_ids: ["PB-001", "PB-009"], criterion_ids: ["CAT-AC-01", "CHK-AC-01"] }),
      t("t-s02-001", "s02", { requirement_ids: ["CHK-F-001"], criterion_ids: ["CHK-AC-01"] }),
    ];
    const out = of(failures(ctx, tickets), "coverage").filter((f) => f.key.startsWith("coverage:foreign:"));
    expect(out.map((f) => f.key)).toEqual(["coverage:foreign:s01:CHK-F-001", "coverage:foreign:s01:PB-009", "coverage:foreign:s01:CHK-AC-01"]);
    expect(out.every((f) => f.ticket === "t-s01-001" && f.slice === "s01")).toBe(true);
  });
});

describe("PRDR-293 contracts", () => {
  it("a name nobody provides fails in the consumer's slice, and says which name, so the earliest consumer can be sent it", () => {
    const tickets = [t("t-s01-001", "s01", { consumes: [{ kind: "config", id: "PORT" }] }), t("t-s02-001", "s02", { consumes: [{ kind: "config", id: "PORT" }] })];
    const out = of(failures(context(), tickets), "contracts");
    expect(out.map((f) => [f.slice, f.unowned, f.key])).toEqual([
      ["s01", "config:PORT", "contracts:unowned:config:PORT:s01"],
      ["s02", "config:PORT", "contracts:unowned:config:PORT:s02"],
    ]);
  });

  it("a name with two providers fails once in each owner's slice", () => {
    const provides = [{ kind: "config" as const, id: "SHARED", note: "n" }];
    const tickets = [t("t-s01-001", "s01", { provides }), t("t-s02-001", "s02", { provides }), t("t-s02-002", "s02", { provides })];
    const out = of(failures(context(), tickets), "contracts");
    expect(out.map((f) => [f.slice, f.ticket, f.key])).toEqual([
      ["s01", "t-s01-001", "contracts:two-providers:config:SHARED:s01"],
      ["s02", "t-s02-001", "contracts:two-providers:config:SHARED:s02"],
    ]);
  });

  it("a name provided only by a later slice fails in the consumer's", () => {
    const tickets = [t("t-s01-001", "s01", { consumes: [{ kind: "config", id: "K" }] }), t("t-s02-001", "s02", { provides: [{ kind: "config", id: "K", note: "n" }] })];
    expect(of(failures(context(), tickets), "contracts").map((f) => f.key)).toEqual(["contracts:later:config:K:s01"]);
  });

  it("a catalogued kind named by anything but its catalogue id fails", () => {
    const ctx = context({ pack: pack(), slices: [slice("s01")] });
    const tickets = [t("t-s01-001", "s01", { provides: [{ kind: "event", id: "order.created", note: "n" }, { kind: "event", id: "order.placed", note: "n" }] })];
    expect(of(failures(ctx, tickets), "contracts").map((f) => f.key)).toEqual(["contracts:catalogue:event:order.created:s01"]);
  });

  it("a name a DONE ticket and a drafted one in its slice both provide still fails: the drafted owner yields", () => {
    const provides = [{ kind: "config" as const, id: "SHARED", note: "n" }];
    const ctx = context({ done: [{ id: "t-s01-001", provides }] });
    const tickets = [t("t-s01-001", "s01", { provides }), t("t-s01-002", "s01", { provides })];
    expect(of(failures(ctx, tickets), "contracts").map((f) => [f.ticket, f.key])).toEqual([["t-s01-001", "contracts:two-providers:config:SHARED:s01"]]);
  });

  it("DONE work provides its names, and a DONE ticket is no failure's subject", () => {
    const ctx = context({ done: [{ id: "t-old", provides: [{ kind: "config", id: "PORT", note: "n" }] }, { id: "t-s01-002", provides: [] }] });
    const tickets = [t("t-s01-001", "s01", { consumes: [{ kind: "config", id: "PORT" }] }), t("t-s01-002", "s01", { consumes: [{ kind: "config", id: "GONE" }] })];
    expect(failures(ctx, tickets)).toEqual([]);
  });
});

describe("PRDR-293 milestone order", () => {
  it("a ticket delivering an M0 requirement that depends, directly or through another, on one delivering M1 fails", () => {
    const ctx = context({ pack: pack(), slices: [slice("s01", { requirement_ids: ["CAT-F-001", "CAT-F-002", "CAT-N-001"] })] });
    const tickets = [
      t("t-s01-001", "s01", { requirement_ids: ["CAT-F-001"], criterion_ids: ["CAT-AC-01"], depends_on: ["t-s01-002"] }),
      t("t-s01-002", "s01", { depends_on: ["t-s01-003"] }),
      t("t-s01-003", "s01", { requirement_ids: ["CAT-F-002", "CAT-N-001"], criterion_ids: ["CAT-AC-02"] }),
    ];
    const out = failures(ctx, tickets);
    expect(out.map((f) => [f.check, f.ticket, f.key])).toEqual([["milestones", "t-s01-001", "milestones:s01:t-s01-001:t-s01-003"]]);
    expect(out[0]?.finding).toContain("through t-s01-002");
    expect(out[0]?.finding).toContain("M1");
  });

  it("a ticket's milestone is the earliest it delivers: one delivering M0 and M1 may not wait on M1's work", () => {
    const ctx = context({ pack: pack(), slices: [slice("s01", { requirement_ids: ["CAT-F-001", "CAT-F-002", "CAT-N-001"] })] });
    const tickets = [
      t("t-s01-001", "s01", { requirement_ids: ["CAT-F-001", "CAT-F-002"], depends_on: ["t-s01-002"] }),
      t("t-s01-002", "s01", { requirement_ids: ["CAT-N-001"] }),
    ];
    expect(of(failures(ctx, tickets), "milestones").map((f) => f.key)).toEqual(["milestones:s01:t-s01-001:t-s01-002"]);
  });

  it("a later milestone waiting on an earlier one is the order, and passes", () => {
    const ctx = context({ pack: pack(), slices: [slice("s01", { requirement_ids: ["CAT-F-001", "CAT-F-002", "CAT-N-001"] })] });
    const tickets = [
      t("t-s01-001", "s01", { requirement_ids: ["CAT-F-001"], criterion_ids: ["CAT-AC-01"] }),
      t("t-s01-002", "s01", { requirement_ids: ["CAT-F-002", "CAT-N-001"], criterion_ids: ["CAT-AC-02"], depends_on: ["t-s01-001"] }),
    ];
    expect(failures(ctx, tickets)).toEqual([]);
  });
});

describe("PRDR-293 gates", () => {
  const gates = { bindings: [{ package: ".", slot: "test" as const }, { package: "web", slot: "build" as const }], packages: [".", "web"] };

  it("a path in a package with no gate a ticket runs fails, and so does a manifest that starts a package", () => {
    const tickets = [t("t-s01-001", "s01", { surface: ["web/src/**"] }), t("t-s02-001", "s02", { surface: ["src/**", "admin/package.json"] })];
    const out = of(failures(context({ gates }), tickets), "gates");
    expect(out.map((f) => [f.slice, f.ticket, f.key])).toEqual([
      ["s01", "t-s01-001", "gates:web:s01"],
      ["s02", "t-s02-001", "gates:starts:admin:s02"],
    ]);
    expect(out[0]?.finding).toContain("narrow the surface");
  });

  it("without the gates, none is checked; a DONE ticket runs no gate and is not checked", () => {
    const tickets = [t("t-s01-001", "s01", { surface: ["web/src/**"] })];
    expect(of(failures(context(), tickets), "gates")).toEqual([]);
    expect(of(failures(context({ gates, done: [{ id: "t-s01-001", provides: [] }] }), tickets), "gates")).toEqual([]);
  });
});

describe("PRDR-293 the graph", () => {
  it("an edge the contracts imply and refuse, because it would close a cycle, fails", () => {
    const tickets = [
      t("t-s01-001", "s01", { provides: [{ kind: "config", id: "A", note: "n" }], consumes: [{ kind: "config", id: "B" }] }),
      t("t-s01-002", "s01", { provides: [{ kind: "config", id: "B", note: "n" }], consumes: [{ kind: "config", id: "A" }] }),
    ];
    const out = of(failures(context(), tickets), "graph");
    expect(out.map((f) => f.key)).toEqual(["graph:refused:config:A:s01"]);
  });

  it("a cycle among the tickets' edges fails once, at the edge that closes it", () => {
    const tickets = [t("a", "s01", { depends_on: ["b"] }), t("b", "s01", { depends_on: ["c"] }), t("c", "s01", { depends_on: ["a"] })];
    const out = of(failures(context(), tickets), "graph");
    expect(out.map((f) => [f.ticket, f.key])).toEqual([["c", "graph:cycle:s01:a,b,c"]]);
    expect(out[0]?.finding).toContain("a → b → c → a");
  });
});

describe("PRDR-293 what a failure says", () => {
  it("cites no mark only Detent's own records explain, since a redraft reads it as it is", () => {
    const ctx = context({
      pack: pack(),
      gates: { bindings: [], packages: ["."] },
      slices: [slice("s01", { requirement_ids: ["CAT-F-001", "CAT-F-002", "CAT-N-001"], baseline_items: ["PB-004"] }), slice("s02")],
    });
    const provides = [{ kind: "config" as const, id: "SHARED", note: "n" }];
    const tickets = [
      t("t-s01-001", "s01", { requirement_ids: ["CAT-F-001", "R-9"], depends_on: ["t-s01-002"], provides, consumes: [{ kind: "config", id: "NOPE" }] }),
      t("t-s01-002", "s01", { requirement_ids: ["CAT-F-002"], provides: [{ kind: "event", id: "x.y", note: "n" }] }),
      t("t-s02-001", "s02", { provides, consumes: [{ kind: "config", id: "LATER" }] }),
      t("t-s02-002", "s02", { provides: [{ kind: "config", id: "LATER", note: "n" }] }),
    ];
    const out = failures(ctx, tickets);
    expect(new Set(out.map((f) => f.check))).toEqual(new Set(["coverage", "contracts", "milestones", "gates"]));
    /* A mark is a letter, a number and a prime or superscript, or one in brackets: `A-1⁷`, `(C-8)`. A pack's ids are not marks. */
    for (const f of out) expect(f.finding, f.key).not.toMatch(/\([A-Z]-\d|PRDR-\d|\b[A-Z]-\d+[′″‴⁗⁵⁶⁷⁸⁹]/u);
  });
});

/**
 * The sixth criterion: the doc-block on `sliceSchema` claimed every
 * requirement id lands in exactly one slice, and no code checked it where
 * there is no parse, nor for the baseline items at all.
 */
describe("PRDR-293 an id lands in one slice", () => {
  const cut = (slices: readonly Partial<SliceSpec>[]) =>
    slicesSchema.safeParse({ schema_version: SCHEMA_VERSION, slices: slices.map((s, i) => ({ ...slice(`s0${String(i + 1)}`), ...s })) });

  it("a slicing that places a requirement id, or a baseline item, in two slices is refused, pack or none", () => {
    const twice = cut([{ requirement_ids: ["R-1"] }, { requirement_ids: ["R-2", "R-1"] }]);
    expect(twice.success).toBe(false);
    expect(twice.error?.issues.map((i) => i.message).join("\n")).toContain("R-1 is placed in s01 and s02");
    const item = cut([{ baseline_items: ["PB-004"] }, { baseline_items: ["PB-004"] }]);
    expect(item.error?.issues.map((i) => i.message).join("\n")).toContain("PB-004 is placed in s01 and s02");
    expect(cut([{ requirement_ids: ["R-1"], baseline_items: ["PB-004"] }, { requirement_ids: ["R-2"] }]).success).toBe(true);
  });

  it("the schema's doc-block says where each half of the claim is checked", () => {
    const text = readFileSync(new URL("../../src/schemas/init.ts", import.meta.url), "utf8");
    const block = text.slice(text.indexOf("SLICE's artifact"), text.indexOf("export const sliceSchema"));
    expect(block).toContain("`cutIssue`");
    expect(block).toContain("`slicesSchema`");
    expect(block).toContain("`init/plan-checks.ts`");
    expect(block).not.toContain("no code checks it");
  });
});
