import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readPlannedRoot, runDirectly, sliceTickets } from "../../scripts/plan-corpus.js";
import { coverageFindings } from "../../scripts/coverage-report.js";
import { nullRates } from "../../scripts/null-review.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { removeTree, tmpTree } from "../helpers.js";

/**
 * PRDR-202 — the measurement harnesses, gated.
 *
 * This suite exists as much for its IMPORTS as its assertions. `scripts/` is
 * not in `tsconfig.json`'s `include`; every script in it is typechecked because
 * a test imports it, which is the convention all six existing scripts already
 * follow. The harnesses did not, so when `revisionOutcome` moved out of
 * `plan-slices.ts` the broken import survived six green gates and surfaced as a
 * crash mid-sweep.
 *
 * The assertions cover the half that actually drifts: reading a planned root
 * off disk. Two shipped tickets have changed that shape underneath it —
 * `churn` (PRDR-200) and `requirement_ids`/`baseline_ids` (PRDR-201) — and both
 * were added as DEFAULTED fields so an older cache still hits. A hand-rolled
 * reader gets no schema and therefore no defaults.
 */

const ticket = (id: string, slice: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
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
  slice,
  ...over,
});

/** A root as `init` leaves it: slice specs, one cache per planned slice, a ledger. */
function plannedRoot(caches: Record<string, Record<string, unknown>[]>, specs: Record<string, unknown>[]): string {
  const root = tmpTree({});
  const state = path.join(root, ".detent", "state");
  mkdirSync(path.join(state, "plan"), { recursive: true });
  for (const [id, tickets] of Object.entries(caches)) {
    writeFileSync(
      path.join(state, "plan", `${id}.json`),
      JSON.stringify({ schema_version: SCHEMA_VERSION, key: "k", tickets, questions: [], remaining: [], external_deps: [], reviewed: true }),
    );
  }
  writeFileSync(path.join(state, "slices.json"), JSON.stringify({ schema_version: SCHEMA_VERSION, slices: specs, questions: [] }));
  writeFileSync(path.join(state, "DISCOVER.json"), JSON.stringify({ outputs: { docs: ["PRD.md"] } }));
  writeFileSync(path.join(root, ".detent", "ledger.jsonl"), `${JSON.stringify({ cost_estimate_usd: 1.5 })}\n${JSON.stringify({ cost_estimate_usd: 2.5 })}\n`);
  return root;
}

const spec = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  title: id,
  goal: "g",
  requirement_ids: [],
  baseline_items: [],
  docs: [],
  depends_on: [],
  expected_tickets: 2,
  rationale: "",
  ...over,
});

describe("PRDR-202 the harnesses read a planned root the way the schema does", () => {
  it("defaults the additive fields a cache written before them does not carry", () => {
    /* Exactly the shape every slice cached before PRDR-200 and PRDR-201 has. */
    const root = plannedRoot({ s01: [ticket("t-s01-001", "s01")] }, [spec("s01")]);
    try {
      const corpus = readPlannedRoot(root);
      expect(corpus.tickets).toHaveLength(1);
      expect(corpus.tickets[0]?.requirement_ids, "absent must read as empty, not undefined").toEqual([]);
      expect(corpus.tickets[0]?.baseline_ids).toEqual([]);
      expect(corpus.planned).toEqual(["s01"]);
      expect(corpus.docs).toEqual(["PRD.md"]);
      expect(corpus.spend).toEqual({ usd: 4, sessions: 2 });
    } finally {
      removeTree(root);
    }
  });

  it("keeps what a newer cache does carry, and groups by slice", () => {
    const root = plannedRoot(
      {
        s01: [ticket("t-s01-001", "s01", { requirement_ids: ["R-1"], baseline_ids: ["PB-004"] })],
        s02: [ticket("t-s02-001", "s02"), ticket("t-s02-002", "s02")],
      },
      [spec("s01"), spec("s02")],
    );
    try {
      const corpus = readPlannedRoot(root);
      expect(corpus.tickets).toHaveLength(3);
      expect(sliceTickets(corpus, "s01")[0]?.requirement_ids).toEqual(["R-1"]);
      expect(sliceTickets(corpus, "s02")).toHaveLength(2);
      expect(corpus.planned).toEqual(["s01", "s02"]);
    } finally {
      removeTree(root);
    }
  });

  it("an unplanned slice is not a gap: coverage judges only what has tickets", () => {
    const root = plannedRoot(
      { s01: [ticket("t-s01-001", "s01", { requirement_ids: ["R-1"] })] },
      [spec("s01", { requirement_ids: ["R-1"] }), spec("s02", { requirement_ids: ["R-9"] })],
    );
    try {
      const findings = coverageFindings(readPlannedRoot(root));
      expect(findings, "s01 is complete and s02 is not planned yet").toEqual([]);
    } finally {
      removeTree(root);
    }
  });

  it("reports the undeclared slice the deterministic checker reports", () => {
    const root = plannedRoot({ s01: [ticket("t-s01-001", "s01")] }, [spec("s01", { requirement_ids: ["R-1", "R-7"] })]);
    try {
      const findings = coverageFindings(readPlannedRoot(root));
      expect(findings).toHaveLength(1);
      expect(findings[0]?.finding).toMatch(/declares no coverage/);
      expect(findings[0]?.finding, "never named as dropped").not.toContain("R-7");
    } finally {
      removeTree(root);
    }
  });

  it("refuses a root that was never planned rather than reporting an empty one", () => {
    const root = tmpTree({});
    try {
      expect(() => readPlannedRoot(root)).toThrow(/no slice cache/);
    } finally {
      removeTree(root);
    }
  });

  it("states both rate denominators rather than assuming them", () => {
    expect(nullRates({ resolved: 3, survived: 1, introduced: 6 }, 12, 24)).toEqual({
      c: 0.25,
      g: 0.25,
      introPerResolved: 2,
    });
    const empty = nullRates({ resolved: 0, survived: 0, introduced: 0 }, 0, 0);
    expect(Number.isNaN(empty.c), "no findings before means no rate, not zero").toBe(true);
    expect(Number.isNaN(empty.g)).toBe(true);
  });

  /**
   * The guard that stopped a real accident. An injected import error failed to
   * crash `null-review.ts` — the unused symbol was stripped — and the harness
   * went on to start a live sweep against a planned root. A test importing it
   * for typechecking must never launch a session.
   */
  it("a harness imported rather than run does not execute its CLI", () => {
    expect(runDirectly("file:///definitely/not/the/entry/point.ts")).toBe(false);
  });
});
