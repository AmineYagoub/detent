import { describe, expect, it } from "vitest";
import { applyContracts, resolveOwner } from "../../src/init/contracts.js";
import { scopeInputs } from "../../src/init/plan-review.js";
import { CONTRACT_KINDS, contractKey, planDraftSchema } from "../../src/schemas/init.js";
import type { DraftedTicket } from "../../src/init/plan-write.js";

/**
 * A-1‴ (PRDR-120) — the contract checks, against the defects that produced them.
 *
 * Every case here is modelled on a finding a fresh reviewer produced by hand on
 * ksar-cloud's walking-skeleton slice, and each cost a revision round to
 * surface. The point of the suite is that none of them needs a model any more:
 * the same conclusion falls out of the declarations, in code, for free.
 */

const bare = (id: string) => ({
  id,
  type: "feature" as const,
  title: `t ${id}`,
  description: "",
  acceptance_criteria: ["it works"],
  non_goals: [],
  surface: ["src/**"],
  depends_on: [],
  provides: [],
  consumes: [],
  risk_label: false,
});

const t = (id: string, over: Partial<DraftedTicket> = {}): DraftedTicket => ({
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
  risk_label: false,
  slice: "s01",
  ...over,
});

/** A written plan whose blockers contain a cycle is a pool that never offers those tickets. */
function noCycle(tickets: readonly DraftedTicket[]): boolean {
  const edges = new Map(tickets.map((x) => [x.id, x.depends_on]));
  const done = new Set<string>();
  let ok = true;
  const walk = (id: string, stack: Set<string>): void => {
    if (stack.has(id)) { ok = false; return; }
    if (done.has(id)) return;
    stack.add(id);
    for (const d of edges.get(id) ?? []) walk(d, stack);
    stack.delete(id);
    done.add(id);
  };
  for (const id of edges.keys()) walk(id, new Set());
  return ok;
}

describe("A-1‴ the four checks, each against a real ksar defect", () => {
  it("duplicate ownership: `t-004` and `t-005` both defining run() is caught without a reviewer", () => {
    const out = applyContracts([
      t("t-s01-004", { provides: [{ kind: "symbol", id: "controlplane/cmd.run", note: "starts the server on :0" }] }),
      t("t-s01-005", { provides: [{ kind: "symbol", id: "controlplane/cmd.run", note: "starts the server after migrations" }] }),
    ]);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]!.tag).toBe("coherence");
    expect(out.findings[0]!.finding).toContain("t-s01-004 and t-s01-005 both provide");
    expect(out.findings[0]!.finding).toContain("controlplane/cmd.run");
  });

  it("ordering: a config key needed by one ticket and added by another DERIVES the missing edge", () => {
    const out = applyContracts([
      t("t-s01-018", { consumes: [{ kind: "config", id: "KSAR_BUILD_TIMEOUT" }] }),
      t("t-s01-027", { provides: [{ kind: "config", id: "KSAR_BUILD_TIMEOUT", note: "build deadline, default 30m" }] }),
    ]);
    /** The plan gains an edge the planner never wrote — X-4′ would have found this a generation later. */
    expect(out.tickets.find((x) => x.id === "t-s01-018")!.depends_on).toEqual(["t-s01-027"]);
    expect(out.derived).toEqual([{ consumer: "t-s01-018", provider: "t-s01-027", contract: "config:KSAR_BUILD_TIMEOUT" }]);
    expect(out.findings).toEqual([]);
  });

  it("an edge the planner already declared is left alone, directly or transitively", () => {
    const out = applyContracts([
      t("a", { provides: [{ kind: "symbol", id: "pkg.Deps", note: "composition root" }] }),
      t("b", { depends_on: ["a"] }),
      t("c", { depends_on: ["b"], consumes: [{ kind: "symbol", id: "pkg.Deps" }] }),
    ]);
    /** `c` reaches `a` through `b`; nothing to add. */
    expect(out.derived).toEqual([]);
    expect(out.tickets.find((x) => x.id === "c")!.depends_on).toEqual(["b"]);
  });

  it("unowned consumption: the port nobody assigns is a finding, not a silent gap", () => {
    const out = applyContracts([t("t-s01-029", { consumes: [{ kind: "config", id: "KSAR_PORT_RANGE" }] })]);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]!.tag).toBe("dependency");
    expect(out.findings[0]!.finding).toContain("no ticket in the plan provides it");
    expect(out.findings[0]!.finding).toContain("KSAR_PORT_RANGE");
  });

  it("contended file: four tickets editing controlplane/go.mod is named as the conflict it is", () => {
    const out = applyContracts([
      t("t-s01-024", { provides: [{ kind: "file", id: "controlplane/go.mod", note: "adds traefik dynamic config" }] }),
      t("t-s01-002", { provides: [{ kind: "file", id: "controlplane/go.mod", note: "adds pgx" }] }),
    ]);
    expect(out.findings[0]!.tag).toBe("coherence");
    expect(out.findings[0]!.finding).toContain("a file two tickets both create is a conflict");
  });

  it("a mutual need is a contradiction, and the edge is refused rather than closing a cycle", () => {
    const out = applyContracts([
      t("a", { provides: [{ kind: "symbol", id: "pkg.A", note: "" }], consumes: [{ kind: "symbol", id: "pkg.B" }] }),
      t("b", { depends_on: ["a"], provides: [{ kind: "symbol", id: "pkg.B", note: "" }] }),
    ]);
    /** `a` needs `b`, but `b` already depends on `a` — adding the edge would deadlock the pool. */
    expect(out.tickets.find((x) => x.id === "a")!.depends_on).toEqual([]);
    expect(out.findings[0]!.tag).toBe("dependency");
    expect(out.findings[0]!.finding).toContain("one of them owns the wrong half");
  });

  it("two tickets that each consume the other's name cannot BOTH derive an edge — that was a silent deadlock", () => {
    const out = applyContracts([
      t("a", { provides: [{ kind: "symbol", id: "pkg.A", note: "" }], consumes: [{ kind: "symbol", id: "pkg.B" }] }),
      t("b", { provides: [{ kind: "symbol", id: "pkg.B", note: "" }], consumes: [{ kind: "symbol", id: "pkg.A" }] }),
    ]);
    /**
     * Judging each candidate against a reachability snapshot taken BEFORE any
     * derivation let both edges through: in the original graph neither reached
     * the other. The plan was written with a blocked on b and b blocked on a,
     * no finding, and `ready()` never offered either again.
     */
    expect(out.derived.map((d) => `${d.consumer}->${d.provider}`)).toEqual(["a->b"]);
    expect(out.tickets.find((x) => x.id === "b")!.depends_on).toEqual([]);
    expect(out.findings.map((f) => f.tag)).toEqual(["dependency"]);
    expect(out.findings[0]!.finding).toContain("one of them owns the wrong half");
  });

  it("a ring of three closes the same way — no pairwise check could have seen it", () => {
    const ring = applyContracts([
      t("x", { provides: [{ kind: "symbol", id: "p.X", note: "" }], consumes: [{ kind: "symbol", id: "p.Y" }] }),
      t("y", { provides: [{ kind: "symbol", id: "p.Y", note: "" }], consumes: [{ kind: "symbol", id: "p.Z" }] }),
      t("z", { provides: [{ kind: "symbol", id: "p.Z", note: "" }], consumes: [{ kind: "symbol", id: "p.X" }] }),
    ]);
    expect(ring.derived.map((d) => `${d.consumer}->${d.provider}`)).toEqual(["x->y", "y->z"]);
    expect(noCycle(ring.tickets)).toBe(true);
    expect(ring.findings.some((f) => f.finding.includes("owns the wrong half"))).toBe(true);
  });

  it("a long legitimate chain still derives every edge — the guard refuses cycles, not depth", () => {
    const chain = applyContracts(
      Array.from({ length: 6 }, (_, i) =>
        t(`t${i}`, {
          provides: [{ kind: "symbol", id: `p.S${i}`, note: "" }],
          ...(i === 0 ? {} : { consumes: [{ kind: "symbol" as const, id: `p.S${i - 1}` }] }),
        }),
      ),
    );
    expect(chain.derived).toHaveLength(5);
    expect(chain.findings).toEqual([]);
    expect(noCycle(chain.tickets)).toBe(true);
    /** And the ordering is real: the last ticket transitively reaches the first. */
    expect(chain.tickets.find((x) => x.id === "t5")!.depends_on).toEqual(["t4"]);
  });

  it("a ticket consuming what it provides itself is not a dependency on anyone", () => {
    const out = applyContracts([
      t("a", { provides: [{ kind: "symbol", id: "pkg.X", note: "" }], consumes: [{ kind: "symbol", id: "pkg.X" }] }),
    ]);
    expect(out.findings).toEqual([]);
    expect(out.derived).toEqual([]);
  });

  it("is pure: it never mutates its input, and a plan with no declarations is unchanged", () => {
    const before = [t("a"), t("b", { depends_on: ["a"] })];
    const snapshot = JSON.stringify(before);
    const out = applyContracts(before);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(out.findings).toEqual([]);
    expect(out.tickets.map((x) => x.depends_on)).toEqual([[], ["a"]]);
  });

  it("end to end: the derived edge reaches the written plan and the presentation says Detent added it", async () => {
    const { repo, PROMPTS, BUDGETS, ANALYSIS, APPROVE_PLAN } = await import("./plan-fixture.js");
    const { buildPipeline } = await import("../../src/init/pipeline.js");
    const { runInit } = await import("../../src/init/machine.js");
    const { MockBackend, okResult } = await import("../../src/sessions/mock.js");
    const { readTicket } = await import("../../src/kernel/tickets/readers.js");
    const { writeFileSync } = await import("node:fs");

    const root = repo({ "PRD.md": "# spec\n", "package.json": JSON.stringify({ scripts: { test: "sh t.sh" } }), "package-lock.json": "{}\n", "t.sh": "exit 0\n" });
    const draft = {
      schema_version: 1,
      tickets: [
        /** The consumer is drafted FIRST and declares no edge — exactly the ksar shape. */
        { ...bare("t-s01-001"), consumes: [{ kind: "config", id: "KSAR_BUILD_TIMEOUT" }] },
        { ...bare("t-s01-002"), provides: [{ kind: "config", id: "KSAR_BUILD_TIMEOUT", note: "build deadline, default 30m" }] },
      ],
      questions: [],
    };
    const backend = new MockBackend({
      planner: (spec) => {
        const artifact = spec.artifactOut.endsWith("plan-draft.json")
          ? draft
          : spec.artifactOut.endsWith("plan-review.json")
            ? APPROVE_PLAN
            : spec.artifactOut.endsWith("slices.json")
              ? { schema_version: 1, slices: [{ id: "s01", title: "the product", goal: "g", requirement_ids: [], baseline_items: [], docs: [], depends_on: [], expected_tickets: 2, rationale: "" }], questions: [] }
              : ANALYSIS(null);
        writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
        return okResult();
      },
    });
    const result = await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    /** The planner never wrote this edge; the coupling did. */
    expect(readTicket(root, "t-s01-001").blockers).toEqual(["t-s01-002"]);
    expect(result.interrupt?.message).toContain("Dependencies Detent derived (1)");
    expect(result.interrupt?.message).toContain("t-s01-001 → t-s01-002   (config:KSAR_BUILD_TIMEOUT)");
    /** And the interface travels to the work: the consumer is handed the owner's own note. */
    const { publicTicket } = await import("../../src/kernel/referee-context.js");
    const seen = publicTicket(readTicket(root, "t-s01-001"), root);
    expect(seen["consumes"]).toEqual([
      { kind: "config", id: "KSAR_BUILD_TIMEOUT", owned_by: "t-s01-002", note: "build deadline, default 30m" },
    ]);
  });

  it("a name provided by a LATER slice is refused, not derived — deriving it deadlocked both slices", () => {
    const out = applyContracts(
      [
        t("t-s01-001", { slice: "s01", consumes: [{ kind: "config", id: "SHARED_KEY" }] }),
        t("t-s02-001", { slice: "s02", provides: [{ kind: "config", id: "SHARED_KEY", note: "the key" }] }),
      ],
      ["s01", "s02"],
    );
    /**
     * The ordinary shape: an early ticket needs a key a later slice defines.
     * Deriving the backwards edge blocked s01 on s02, while capstoneBlockers
     * blocked s02 on s01 for slice order. Both READY, neither ever claimable,
     * and nothing said so.
     */
    expect(out.derived).toEqual([]);
    expect(out.tickets.find((x) => x.id === "t-s01-001")!.depends_on).toEqual([]);
    expect(out.findings[0]!.finding).toContain("LATER slice");
    expect(out.findings[0]!.finding).toContain("would deadlock");
  });

  it("slice order is derived from the tickets when the caller does not pass it — the default is not fail-open", () => {
    const out = applyContracts([
      t("t-s01-001", { slice: "s01", consumes: [{ kind: "config", id: "K" }] }),
      t("t-s02-001", { slice: "s02", provides: [{ kind: "config", id: "K", note: "" }] }),
    ]);
    expect(out.derived).toEqual([]);
    expect(out.findings[0]!.finding).toContain("LATER slice");
  });

  it("a name owned by DONE work this plan no longer redrafts is not reported unowned", () => {
    const consumer = [t("t-s02-001", { slice: "s02", consumes: [{ kind: "config", id: "SHARED_KEY" }] })];
    expect(applyContracts(consumer).findings).toHaveLength(1);
    /** The DONE ticket still owns it; the false alarm would have invited a second provider. */
    expect(applyContracts(consumer, [], ["config:SHARED_KEY"]).findings).toEqual([]);
  });

  it("both halves of the system bind a contested name to the SAME provider", () => {
    expect(resolveOwner(["t-b", "t-a", "t-c"], "t-self")).toBe("t-a");
    /** Order of declaration must not change the answer — the edge and the note agree. */
    expect(resolveOwner(["t-c", "t-a", "t-b"], "t-self")).toBe("t-a");
    expect(resolveOwner(["t-a"], "t-a")).toBeUndefined();
  });

  it("a stray space does not turn one name into two", () => {
    const parsed = planDraftSchema.parse({
      schema_version: 1,
      tickets: [
        { ...bare("t-s01-001"), provides: [{ kind: "config", id: " SHARED_PORT ", note: "n" }] },
        { ...bare("t-s01-002"), consumes: [{ kind: "config", id: "SHARED_PORT " }] },
      ],
    });
    const out = applyContracts(parsed.tickets.map((x) => ({ ...x, slice: "s01" })));
    expect(out.findings).toEqual([]);
    expect(out.derived.map((d) => d.contract)).toEqual(["config:SHARED_PORT"]);
  });

  it("the vocabulary is closed and the key is stable", () => {
    expect([...CONTRACT_KINDS]).toEqual(["symbol", "config", "file", "route", "table", "event"]);
    expect(contractKey({ kind: "symbol", id: "pkg.Name" })).toBe("symbol:pkg.Name");
    /** Two kinds sharing an id are two different names. */
    expect(contractKey({ kind: "config", id: "X" })).not.toBe(contractKey({ kind: "file", id: "X" }));
  });
});

/**
 * PRDR-193 — the free check runs before the paid review, and tells it.
 *
 * gate-312's whole-plan review spent a session on `t-s02-003 consumes a name no
 * ticket provides` — a finding `applyContracts` emits verbatim for nothing — and
 * said so itself, citing the mechanical checker by ticket id and observing the
 * defects "should be corrected rather than discovered by it". Then the finding
 * triggered a redraft: a second paid session for a one-line declaration fix.
 *
 * Asserted on `scopeInputs`, which is what a review session is actually handed.
 */
describe("PRDR-193 the whole-plan review is told what code already proved", () => {
  const known = [{ tag: "dependency" as const, ticket: "t-s02-003", finding: "consumes a name nobody provides" }];

  it("carries the mechanical findings into the review's own inputs", () => {
    const inputs = scopeInputs({ kind: "whole", slices: [], known });
    expect(JSON.stringify(inputs)).toContain("t-s02-003");
  });

  it("tells the review not to spend its budget restating them", () => {
    const inputs = scopeInputs({ kind: "whole", slices: [], known });
    expect(String(inputs["scope_instruction"])).toMatch(/already|do not restate|no need to report/i);
  });

  it("says nothing extra when code found nothing", () => {
    const inputs = scopeInputs({ kind: "whole", slices: [] });
    expect(Object.keys(inputs)).not.toContain("already_found");
  });
});
