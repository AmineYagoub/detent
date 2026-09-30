import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runInit } from "../../src/init/machine.js";
import { buildPipeline } from "../../src/init/pipeline.js";
import { loadConfig } from "../../src/kernel/worstcase.js";
import { CEILINGS, type Budgets } from "../../src/schemas/budgets.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import type { SessionBackend, SessionSpec } from "../../src/sessions/backend.js";
import { MockBackend, okResult } from "../../src/sessions/mock.js";
import { briefsOf, claimsGiven, triageOf, type Json } from "./audit-fixture.js";
import { BUDGETS, PROMPTS, repo } from "./plan-fixture.js";
import { inputsOf } from "./slicing-fixture.js";
import { byRound, initThroughValidate, writer } from "./validate-fixture.js";
import { CODES, prdOf, wide } from "./validate-wide-fixture.js";

/**
 * X-1⁸ (PRDR-324) — how many sessions `init` runs at once is a budget.
 * AUDIT's claim checks and a VALIDATE round's reviews ran four at a time,
 * fixed in code. On tabachir a claim check takes 7.8 minutes at the median and
 * a review 31.5, so 117 checks took about 3.8 hours at four. With X-8″ a limit
 * reached loses no finished work, so the number is a trade of wall clock
 * against how fast an account's usage window is spent, and the operator's.
 */

const PRD = ["# Toolshed", "", "Borrowing is free in the MVP.", "", "Payments use the Stripe API, and a refund returns the card fee.", ""].join("\n");
const STRIPE = { file: "PRD.md", line: 5, quote: "Payments use the Stripe API" };
const THROUGH_AUDIT = new Set(["INIT_FS", "DISCOVER", "AUDIT"]);
/* The routes Detent's measured figures were taken on, so the notes carry an estimate whose wall clock counts batches of the width. */
const ROUTED = { modelRouting: { audit: "claude-opus-5-5", spec_review: "claude-opus-5-5" }, effortRouting: { audit: "max", spec_review: "max" } };

const config = (budgets: Record<string, unknown>): Json => ({
  schema_version: SCHEMA_VERSION,
  budgets: { ...Object.fromEntries(Object.entries(CEILINGS).map(([k, v]) => [k, v.default])), ...budgets },
  pinned: { agent_sdk: "0.3.285", claude_code: "2.1.285" },
});

/** Claim checks that hold until a moment passes with no other starting, so a whole batch is in flight at once. */
function holdingChecks(claims: number): { backend: SessionBackend; max: () => number } {
  let inFlight = 0;
  let max = 0;
  const held: (() => void)[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const survey = { schema_version: SCHEMA_VERSION, documents_read: ["PRD.md"], contradictions: [], gaps: [], drift: [], claims: Array.from({ length: claims }, (_, i) => ({ claim: `Stripe fact ${String(i)}.`, subject: "Stripe API", passage: STRIPE })) };
  const brief = (inputs: Json): Json => ({
    schema_version: SCHEMA_VERSION,
    claim: inputs["claim"],
    claim_hash: inputs["claim_hash"],
    verdict: "confirmed",
    source: "https://docs.stripe.com/refunds",
    evidence: [{ source: "https://docs.stripe.com/refunds", claim: "what Stripe says" }],
    sources_consulted: [{ tier: 3, ref: "https://docs.stripe.com/refunds" }],
    local_search: { docs_checked: ["PRD.md"], code_checked: [] },
    what_would_falsify: "a Stripe page saying otherwise",
  });
  const backend: SessionBackend = {
    name: "holding",
    checkVersion: async () => {},
    run: async (spec) => {
      const inputs = inputsOf(spec) as Json;
      if (inputs["task"] === "survey" || inputs["task"] === "triage") {
        writeFileSync(spec.artifactOut, `${JSON.stringify(inputs["task"] === "survey" ? survey : triageOf(inputs))}\n`);
        return okResult({ turns: 3 });
      }
      void claimsGiven(inputs);
      inFlight += 1;
      max = Math.max(max, inFlight);
      await new Promise<void>((resolve) => {
        held.push(resolve);
        clearTimeout(timer);
        timer = setTimeout(() => {
          for (const release of held.splice(0)) release();
        }, 10);
      });
      inFlight -= 1;
      writeFileSync(spec.artifactOut, `${JSON.stringify(briefsOf(inputs, brief))}\n`);
      return okResult({ turns: 3 });
    },
  };
  return { backend, max: () => max };
}

async function audit(width: number | null, claims: number, notes: string[] = []): Promise<number> {
  const root = repo({ "PRD.md": PRD });
  const stub = holdingChecks(claims);
  const budgets = (width === null ? BUDGETS : { ...BUDGETS, init_sessions_at_once: width }) as Budgets;
  await runInit(
    root,
    buildPipeline({ root, backend: stub.backend, prompts: PROMPTS, budgets, note: (t) => notes.push(t), ...ROUTED }).filter((h) => THROUGH_AUDIT.has(h.phase)),
  );
  return stub.max();
}

describe("X-1⁸ budgets.init_sessions_at_once", () => {
  it("is a key a config may set, from one to sixteen, and four where it is not set", () => {
    expect(loadConfig(config({ init_sessions_at_once: 8 })).config.budgets.init_sessions_at_once).toBe(8);
    expect(loadConfig(config({ init_sessions_at_once: 1 })).config.budgets.init_sessions_at_once).toBe(1);
    expect(loadConfig(config({ init_sessions_at_once: 16 })).config.budgets.init_sessions_at_once).toBe(16);
    const without = Object.fromEntries(Object.entries((config({}) as { budgets: Record<string, unknown> }).budgets).filter(([key]) => key !== "init_sessions_at_once"));
    expect(loadConfig({ ...config({}), budgets: without }).config.budgets.init_sessions_at_once).toBe(4);
  });

  it("refuses a number outside one to sixteen, or not a whole one, naming the range", () => {
    for (const bad of [0, 17, 2.5, -4]) {
      expect(() => loadConfig(config({ init_sessions_at_once: bad })), String(bad)).toThrow(/init_sessions_at_once is how many sessions init runs at once, a whole number from 1 to 16/u);
    }
  });

  it("sets how many claim checks run at once: eight at eight, and never more", async () => {
    const notes: string[] = [];
    expect(await audit(8, 10, notes)).toBe(8);
    /* Ten checks at eight are two batches of a check's 7.8 minutes; at four they would be three. */
    expect(notes.join("\n")).toContain("AUDIT: 10 claims to check, a session each, 8 at once — about $28.60 and 15.6 min");
  });

  it("holds the checks to two at two, and keeps four where the config does not say", async () => {
    expect(await audit(2, 6)).toBe(2);
    expect(await audit(null, 6)).toBe(4);
  });

  it("sets how many of a round's reviewers run at once, and the round's note says how many", async () => {
    const root = repo({ "PRD.md": PRD });
    const notes: string[] = [];
    let inFlight = 0;
    let max = 0;
    class Holding extends MockBackend {
      override async run(spec: SessionSpec) {
        if (spec.role !== "spec_review") return await super.run(spec);
        inFlight += 1;
        max = Math.max(max, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return await super.run(spec);
      }
    }
    const reviewers = byRound((round, area) => {
      const i = CODES.findIndex((code) => area === `Area ${code}`);
      return round === 1 && i === 0 ? [{ severity: "minor", category: "gap", places: [{ file: prdOf(i), line: 5, quote: "Borrowing a tool MUST cost nothing in the MVP" }], why: "w", fix: "f", previous: null }] : [];
    });
    await initThroughValidate(root, { reviewers, writer: writer(() => ({})), notes, more: { ...ROUTED, budgets: { ...BUDGETS, init_sessions_at_once: 3 } as Budgets }, backend: (script) => new Holding(script) }, wide());
    expect(max).toBe(3);
    /* Seven areas at three are three batches of a review's 31.5 minutes, 94.5 in all; at four they would be two. */
    expect(notes.join("\n")).toContain("VALIDATE round 1: 7 areas to review, a session each, 3 at once — about $67.48 and 1 h 35 min");
  });
});
