import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { runInit } from "../../src/init/machine.js";
import { buildPipeline } from "../../src/init/pipeline.js";
import { readProgressMark } from "../../src/kernel/ledger.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { guardToolUse } from "../../src/sessions/guard.js";
import { MockBackend, okResult, resultFromSdk, type StageFn } from "../../src/sessions/mock.js";
import { BUDGETS, PROMPTS, repo } from "./plan-fixture.js";
import { inputsOf } from "./slicing-fixture.js";

/**
 * PRDR-305 — AUDIT keeps its checked survey until it completes (C-2¹⁷).
 *
 * Each case runs AUDIT twice through the real pipeline, stopped after AUDIT.
 * The first run's check of one claim fails after the survey, which ends the
 * phase as a stopped run would. The second run's survey, where one is
 * launched, words the same claims differently, as a new survey does: on
 * tabachir's relaunch the survey ran again, and the briefs the stopped run
 * had paid for are committed under the old words' hashes.
 */

type Json = Record<string, unknown>;

const PRD = ["# Toolshed", "", "Borrowing is free in the MVP.", "", "Payments use the Stripe API, and a refund returns the card fee.", ""].join("\n");
const FEE = { file: "PRD.md", line: 5, quote: "a refund returns the card fee" };
const STRIPE = { file: "PRD.md", line: 5, quote: "Payments use the Stripe API" };
const THROUGH_AUDIT = new Set(["INIT_FS", "DISCOVER", "AUDIT"]);

const REFUND = { claim: "A Stripe refund returns the card processing fee.", subject: "Stripe API", passage: FEE };
const PAYOUT = { claim: "Stripe pays out daily in the US.", subject: "Stripe API", passage: STRIPE };
/** The same two claims, as a second survey words them. */
const REWORDED = [
  { claim: "Refunding a Stripe charge gives back the card fee.", subject: "Stripe API", passage: FEE },
  { claim: "Stripe sends payouts every day in the US.", subject: "Stripe API", passage: STRIPE },
];

const survey = (claims: readonly Json[]): Json => ({
  schema_version: SCHEMA_VERSION,
  documents_read: ["PRD.md"],
  contradictions: [],
  gaps: [],
  drift: [],
  claims,
});

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

const CRASH = resultFromSdk({ subtype: "success", is_error: true, result: "the session crashed", total_cost_usd: 0.5, modelUsage: {}, num_turns: 3 });

interface Audit {
  readonly stage: StageFn;
  readonly specs: SessionSpec[];
  /** The progress mark each claim session started from. */
  readonly marks: (number | null)[];
}

/** A survey of `claims`, and a brief for every claim but the ones `failing` names, whose sessions fail. */
function audit(root: string, claims: readonly Json[], failing: ReadonlySet<string> = new Set()): Audit {
  const specs: SessionSpec[] = [];
  const marks: (number | null)[] = [];
  const stage: StageFn = (spec) => {
    specs.push(spec);
    const inputs = inputsOf(spec) as Json;
    if (inputs["task"] === "survey") {
      writeFileSync(spec.artifactOut, `${JSON.stringify(survey(claims))}\n`);
      return okResult({ turns: 3 });
    }
    marks.push(readProgressMark(root).spent);
    if (failing.has(String(inputs["claim"]))) return CRASH;
    writeFileSync(spec.artifactOut, `${JSON.stringify(brief(inputs))}\n`);
    return okResult({ turns: 3 });
  };
  return { stage, specs, marks };
}

async function initThroughAudit(root: string, stub: Audit, notes: string[] = []) {
  const handlers = buildPipeline({ root, backend: new MockBackend({ audit: stub.stage }), prompts: PROMPTS, budgets: BUDGETS, note: (t) => notes.push(t) }).filter(
    (h) => THROUGH_AUDIT.has(h.phase),
  );
  return await runInit(root, handlers);
}

const keptFile = (root: string): string => path.join(stateDir(root), "state", "audit-survey-kept.json");
const tasks = (stub: Audit): unknown[] => stub.specs.map((s) => inputsOf(s)["task"]);
const auditClaims = (root: string): Json[] =>
  (JSON.parse(readFileSync(path.join(stateDir(root), "state", "AUDIT.json"), "utf8")) as { outputs: { claims: Json[] } }).outputs.claims;

/** The first run: the survey stands, the refund claim is briefed, and the payout claim's session fails, which ends the phase. */
async function stopped(root: string): Promise<Audit> {
  const first = audit(root, [REFUND, PAYOUT], new Set([PAYOUT.claim]));
  await expect(initThroughAudit(root, first)).rejects.toThrow(/audit session failed: the session crashed/u);
  return first;
}

describe("PRDR-305 AUDIT keeps its checked survey until it completes (C-2¹⁷)", () => {
  it("a re-run whose key has not moved launches no survey, and checks only the claims the stopped run had not", async () => {
    const root = repo({ "PRD.md": PRD });
    await stopped(root);

    const notes: string[] = [];
    const second = audit(root, REWORDED);
    await initThroughAudit(root, second, notes);

    expect(tasks(second)).toEqual(["verify_claim"]);
    expect(inputsOf(second.specs[0]!)["claim"]).toBe(PAYOUT.claim);
    expect(auditClaims(root).map((c) => [c["claim"], c["verdict"], c["checked"]])).toEqual([
      [REFUND.claim, "confirmed", true],
      [PAYOUT.claim, "confirmed", true],
    ]);
    expect(notes.join("\n")).toMatch(/AUDIT's survey is the one an earlier run checked.*2 claims/su);
  });

  it("a survey kept is a unit of work, so the first claim check starts from it (X-1⁵)", async () => {
    const root = repo({ "PRD.md": PRD });
    const first = await stopped(root);

    expect(first.marks[0], "the survey's spend is behind the mark before any brief lands").toBeGreaterThan(0);
  });

  it("a re-run whose key moved surveys again", async () => {
    const root = repo({ "PRD.md": PRD });
    await stopped(root);
    writeFileSync(path.join(root, "PRD.md"), `${PRD}Refunds take five days.\n`);

    const second = audit(root, REWORDED);
    await initThroughAudit(root, second);

    expect(tasks(second)).toEqual(["survey", "verify_claim", "verify_claim"]);
    expect(auditClaims(root).map((c) => c["claim"])).toEqual(REWORDED.map((c) => c.claim));
  });

  it("a kept survey this build cannot read is surveyed again, not trusted", async () => {
    const spoiled: Record<string, (kept: Json) => string> = {
      "not JSON": () => "{",
      "another schema version": (kept) => JSON.stringify({ ...kept, schema_version: SCHEMA_VERSION + 1 }),
      "a shape it does not know": (kept) => JSON.stringify({ ...kept, kept: { claims: "all of them" } }),
    };
    for (const [why, spoil] of Object.entries(spoiled)) {
      const root = repo({ "PRD.md": PRD });
      await stopped(root);
      writeFileSync(keptFile(root), spoil(JSON.parse(readFileSync(keptFile(root), "utf8")) as Json));

      const second = audit(root, REWORDED);
      await initThroughAudit(root, second);

      expect(tasks(second)[0], why).toBe("survey");
    }
  });

  it("is kept once the survey is checked, and removed when AUDIT completes", async () => {
    const root = repo({ "PRD.md": PRD });
    await stopped(root);
    expect(existsSync(keptFile(root))).toBe(true);

    await initThroughAudit(root, audit(root, REWORDED));

    expect(existsSync(keptFile(root))).toBe(false);
  });

  it("no session can write it: the structural floor keeps every session out of `.detent/state/` (SEC-3′)", async () => {
    const root = repo({ "PRD.md": PRD });
    const first = await stopped(root);

    for (const spec of first.specs) {
      expect(guardToolUse("Write", { file_path: keptFile(root) }, spec.policy!).decision, String(inputsOf(spec)["task"])).toBe("deny");
    }
  });
});
