import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderStatus } from "../../src/cli/status.js";
import { stateDir } from "../../src/fs/layout.js";
import { runInit } from "../../src/init/machine.js";
import { buildPipeline } from "../../src/init/pipeline.js";
import { acquireRunLock } from "../../src/kernel/run-lock.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import type { SessionBackend } from "../../src/sessions/backend.js";
import { MockBackend, okResult } from "../../src/sessions/mock.js";
import { briefsOf, claimsGiven, triageOf, type Json } from "./audit-fixture.js";
import { APPROVE_PLAN, BUDGETS, CLEAN_AUDIT, DRAFT, LONE_CANDIDATE, PROMPTS, planner, planning, planningPipeline, repo } from "./plan-fixture.js";
import { DOCS, inputsOf, reworded, scriptedPlanner, twoSliceDraft } from "./slicing-fixture.js";
import { LENDING_PRD, byRound, clean, initThroughValidate, writer } from "./validate-fixture.js";
import { LENDING, PACK, RAW, WROTE, write } from "./write-fixture.js";
import { CODES, prdOf, wide } from "./validate-wide-fixture.js";

/**
 * N-5⁗ (PRDR-325) — `init` says what a costly step will cost before it spends,
 * and `detent status` shows how far the step has come. Tabachir's test run
 * spent $534 and 9.6 hours in AUDIT before DECIDE asked anything, and nothing
 * said beforehand how many claims would be checked, what that would cost, or
 * when it would end.
 */

const PRD = ["# Toolshed", "", "Borrowing is free in the MVP.", "", "Payments use the Stripe API, and a refund returns the card fee.", ""].join("\n");
const STRIPE = { file: "PRD.md", line: 5, quote: "Payments use the Stripe API" };
const THROUGH_AUDIT = new Set(["INIT_FS", "DISCOVER", "AUDIT"]);
const ROUTED = { modelRouting: { audit: "claude-opus-5-5", spec_review: "claude-opus-5-5" }, effortRouting: { audit: "max", spec_review: "max" } };

const claimsOf = (n: number): Json[] => Array.from({ length: n }, (_, i) => ({ claim: `Stripe fact ${String(i)}.`, subject: "Stripe API", passage: STRIPE }));
const survey = (claims: readonly Json[]): Json => ({ schema_version: SCHEMA_VERSION, documents_read: ["PRD.md"], contradictions: [], gaps: [], drift: [], claims });
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

/** A backend for AUDIT: each claim check costs $2, and `during` runs as each one starts. */
function auditBackend(claims: readonly Json[], events: string[], during: (n: number) => void = () => undefined): SessionBackend {
  let checks = 0;
  return {
    name: "audit",
    checkVersion: async () => {},
    run: async (spec) => {
      const inputs = inputsOf(spec) as Json;
      if (inputs["task"] === "survey" || inputs["task"] === "triage") {
        writeFileSync(spec.artifactOut, `${JSON.stringify(inputs["task"] === "survey" ? survey(claims) : triageOf(inputs))}\n`);
        return okResult({ turns: 3 });
      }
      checks += 1;
      events.push(`check ${String(claimsGiven(inputs)[0]?.["claim"])}`);
      during(checks);
      await new Promise((resolve) => setTimeout(resolve, 5));
      writeFileSync(spec.artifactOut, `${JSON.stringify(briefsOf(inputs, brief))}\n`);
      return okResult({ turns: 3, costEstimateUsd: 2 });
    },
  };
}

const releases: (() => void)[] = [];
afterEach(() => {
  for (const release of releases.splice(0)) release();
});

describe("N-5⁗ AUDIT says what its checks will cost before the first one starts", () => {
  it("notes how many claims it will check, a session each and four at once, with Detent's measured figure named", async () => {
    const root = repo({ "PRD.md": PRD });
    const events: string[] = [];
    const handlers = buildPipeline({ root, backend: auditBackend(claimsOf(7), events), prompts: PROMPTS, budgets: BUDGETS, note: (t) => events.push(`note ${t}`), ...ROUTED });
    await runInit(
      root,
      handlers.filter((h) => THROUGH_AUDIT.has(h.phase)),
    );

    const at = events.findIndex((e) => e.startsWith("note AUDIT: 7 claims to check"));
    expect(at, events.join("\n")).toBeGreaterThanOrEqual(0);
    expect(at, "before the first check").toBeLessThan(events.findIndex((e) => e.startsWith("check ")));
    const said = events[at] ?? "";
    expect(said).toContain("AUDIT: 7 claims to check, a session each, 4 at once — about $20.02 and 15.6 min");
    expect(said, "seven checks at $2.86, two batches of four at 7.8 minutes").toContain("Detent's measured figure for a claim check, $2.86 and 7.8 min on claude-opus-5-5 at max");
    expect(said, "named with the run and build that measured it").toContain("tabachir's test run at build 34585b8");
    expect(said).toContain("An estimate, which nothing stops for (N-5⁗)");
  });

  it("notes the checks without an estimate where nothing has measured the model they are routed to", async () => {
    const root = repo({ "PRD.md": PRD });
    const notes: string[] = [];
    await runInit(
      root,
      buildPipeline({ root, backend: auditBackend(claimsOf(2), []), prompts: PROMPTS, budgets: BUDGETS, note: (t) => notes.push(t) }).filter((h) => THROUGH_AUDIT.has(h.phase)),
    );
    expect(notes.join("\n")).toContain("AUDIT: 2 claims to check, a session each, 4 at once — no estimate: neither this project's ledger nor Detent's measurements has a figure yet for the 2 claim checks");
  });

  it("detent status, during the checks, shows the step, the checks done and left, their spend so far and an estimated finish", async () => {
    const root = repo({ "PRD.md": PRD });
    const lock = acquireRunLock(root);
    if (!lock.ok) throw new Error("the test could not take the run lock");
    releases.push(lock.release);
    const shown: string[] = [];
    const backend = auditBackend(claimsOf(9), [], (n) => {
      if (n === 9) shown.push(renderStatus(root));
    });
    await runInit(
      root,
      buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, ...ROUTED }).filter((h) => THROUGH_AUDIT.has(h.phase)),
    );

    const during = shown[0] ?? "";
    expect(during).toContain("`init` is running (N-5⁗)");
    expect(during).toMatch(/AUDIT's claim checks: [1-8] of 9 done, [1-8] left, 4 at once; \$\d+\.00 spent on them so far/u);
    expect(during).toMatch(/estimated to finish in about [\d.]+ min, around \d\d:\d\d, by Detent's measured figure for a claim check/u);
    expect(renderStatus(root), "once the checks have finished, no step is shown").not.toContain("claim checks:");
  });

  it("records each init session's task, routed effort and length on its ledger row", async () => {
    const root = repo({ "PRD.md": PRD });
    await runInit(
      root,
      buildPipeline({ root, backend: auditBackend(claimsOf(1), []), prompts: PROMPTS, budgets: BUDGETS, ...ROUTED }).filter((h) => THROUGH_AUDIT.has(h.phase)),
    );
    const rows = readFileSync(path.join(stateDir(root), "ledger.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as Json);
    const check = rows.find((r) => r["task"] === "verify_claims");
    expect(check?.["effort"]).toBe("max");
    expect(check?.["duration_ms"]).toBeGreaterThanOrEqual(5);
    expect(rows.map((r) => r["task"])).toEqual(["survey", "triage", "verify_claims"]);
  });
});

describe("N-5⁗ a VALIDATE round and its writer say what they will cost", () => {
  it("notes the round's areas to review with the measured figure for a review, and the writer's batches with none yet", async () => {
    const root = repo({ "PRD.md": PRD });
    const notes: string[] = [];
    const reviewers = byRound((round, area) => {
      const i = CODES.findIndex((code) => area === `Area ${code}`);
      return round === 1 && i !== -1
        ? ["gap", "contradiction", "untestable", "name-drift"].map((category) => ({
            severity: "major",
            category,
            places: [{ file: prdOf(i), line: 5, quote: "Borrowing a tool MUST cost nothing in the MVP" }],
            why: category,
            fix: `fix the ${category}`,
            previous: null,
          }))
        : [];
    });
    await initThroughValidate(root, { reviewers, writer: writer(() => ({})), notes, more: ROUTED }, wide());

    const round = notes.find((n) => /^VALIDATE round 1: \d+ areas to review/u.test(n)) ?? "";
    const areas = Number(/VALIDATE round 1: (\d+) areas to review, a session each, 4 at once/u.exec(round)?.[1]);
    expect(areas, round).toBeGreaterThan(4);
    expect(round).toContain(`about $${(areas * 9.64).toFixed(2)} and`);
    expect(round).toContain("Detent's measured figure for a review, $9.64 and 31.5 min on claude-opus-5-5 at max");
    expect(notes).toContain(
      "VALIDATE's writer, round 1: 2 batches to run — no estimate: neither this project's ledger nor Detent's measurements has a figure yet for the 2 writer batches on the routes they run on (N-5⁗)",
    );
    expect(notes.join("\n"), "round 2 verifies round 1's areas, which nothing has measured yet").toMatch(
      /VALIDATE round 2: \d+ areas to review, a session each, 4 at once — no estimate: neither this project's ledger nor Detent's measurements has a figure yet for the \d+ verifying reviews/u,
    );
    expect(existsSync(path.join(stateDir(root), "state", "init-progress.json")), "a finished step leaves no progress behind").toBe(false);
  });
});

describe("N-5⁗ the checker's writer is one session, and not estimated", () => {
  it("fixes a red checker before any round with no estimate note, and estimates the round after it", async () => {
    const root = repo(RAW);
    const notes: string[] = [];
    const uncovered = LENDING.split("\n").filter((l) => !l.includes("LND-AC-02")).join("\n");
    const restore = (text: string): string => text.replace("- **LND-AC-03**", `${LENDING.split("\n").find((l) => l.includes("LND-AC-02")) ?? ""}\n- **LND-AC-03**`);
    const result = await initThroughValidate(
      root,
      { reviewers: clean(), writer: writer(() => ({ edit: { [LENDING_PRD]: restore } })), notes, more: ROUTED },
      write(() => ({ files: { ...PACK, [LENDING_PRD]: uncovered }, artifact: WROTE() })),
    );
    expect(result.reachedPhase).toBe("READY");
    expect(notes.join("\n")).toContain("VALIDATE: the pack checker is red");
    expect(notes.filter((n) => n.startsWith("VALIDATE's writer, the checker")), "no estimate for the checker's one session").toEqual([]);
    expect(notes.some((n) => /^VALIDATE round 1: \d+ areas? to review/u.test(n))).toBe(true);
  });
});

describe("N-5⁗ PLAN says how many slices it will plan", () => {
  it("counts only the slices it will plan, and says how many it reuses", async () => {
    const root = repo(DOCS);
    const notes: string[] = [];
    const backend = new MockBackend({ audit: CLEAN_AUDIT, ...planning(scriptedPlanner({ slices: reworded, draft: twoSliceDraft, review: () => APPROVE_PLAN }, [])) });
    const handlers = planningPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, note: (t) => notes.push(t) });
    await runInit(root, handlers);
    expect(notes.find((n) => n.startsWith("PLAN: "))).toMatch(/^PLAN: 2 of 2 slices to plan, one at a time — no estimate/u);

    /* Only the billing document changes: s01 read nothing that moved, and is reused. */
    writeFileSync(path.join(root, "prd-billing.md"), "# billing, revised\n");
    notes.splice(0);
    await runInit(root, handlers);
    expect(notes.find((n) => n.startsWith("PLAN: "))).toMatch(/^PLAN: 1 of 2 slices to plan, one at a time, the other 1 reused as they stand — no estimate/u);
  });

  it("notes the slices to plan, one at a time, before the first is drafted", async () => {
    const root = repo(LONE_CANDIDATE);
    const events: string[] = [];
    const draft = planner(DRAFT(["t-100"]));
    const handlers = planningPipeline({
      root,
      backend: new MockBackend({
        audit: CLEAN_AUDIT,
        ...planning((spec) => {
          events.push(`session ${spec.role}`);
          return draft(spec);
        }),
      }),
      prompts: PROMPTS,
      budgets: BUDGETS,
      note: (t: string) => events.push(`note ${t}`),
    });
    await runInit(root, handlers);

    const at = events.findIndex((e) => e.startsWith("note PLAN: 1 of 1 slice to plan, one at a time — no estimate"));
    expect(at, events.join("\n")).toBeGreaterThanOrEqual(0);
    const drafted = events.findIndex((e, n) => n > at && e === "session planner");
    expect(drafted, "the slice is drafted after the note").toBeGreaterThan(at);
  });
});
