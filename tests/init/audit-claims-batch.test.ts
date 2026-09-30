import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { auditBriefPath, claimHash } from "../../src/init/audit-claims.js";
import { runInit } from "../../src/init/machine.js";
import { buildPipeline } from "../../src/init/pipeline.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import type { SessionBackend } from "../../src/sessions/backend.js";
import { okResult, resultFromSdk } from "../../src/sessions/mock.js";
import { briefsOf, claimsGiven, triageOf } from "./audit-fixture.js";
import { BUDGETS, PROMPTS, repo } from "./plan-fixture.js";
import { inputsOf } from "./slicing-fixture.js";

/**
 * PRDR-304 — AUDIT checks its claims in batches (C-2¹⁶).
 *
 * Driven through the real pipeline, stopped after AUDIT, on a backend that
 * holds every claim session until no other has started for a moment and then
 * lets the held ones end last-first: a batch is seen whole, and ends out of
 * the order it began in. On tabachir's first live `init` the survey found 132
 * claims, and each waited for the one before it, about six minutes apiece.
 * The triage checks every claim alone (C-2¹⁸, PRDR-306), so a session is a
 * claim here, as it was when this was written.
 */

type Json = Record<string, unknown>;

const PRD = ["# Toolshed", "", "Borrowing is free in the MVP.", "", "Payments use the Stripe API, and a refund returns the card fee.", ""].join("\n");
const STRIPE = { file: "PRD.md", line: 5, quote: "Payments use the Stripe API" };
const FREE = { file: "PRD.md", line: 3, quote: "Borrowing is free in the MVP." };
const THROUGH_AUDIT = new Set(["INIT_FS", "DISCOVER", "AUDIT"]);

const claimsOf = (n: number): Json[] => Array.from({ length: n }, (_, i) => ({ claim: `Stripe fact ${String(i)}.`, subject: "Stripe API", passage: STRIPE }));

const survey = (claims: readonly Json[]): Json => ({
  schema_version: SCHEMA_VERSION,
  documents_read: ["PRD.md"],
  contradictions: [],
  gaps: [],
  drift: [],
  claims,
});

/** A `wrong` verdict whose correction names its claim, so a verdict recorded against another place shows. */
const brief = (inputs: Json): Json => ({
  schema_version: SCHEMA_VERSION,
  claim: inputs["claim"],
  claim_hash: inputs["claim_hash"],
  verdict: "wrong",
  source: "https://docs.stripe.com/refunds",
  correction: `not so: ${String(inputs["claim"])}`,
  evidence: [{ source: "https://docs.stripe.com/refunds", claim: "what Stripe says" }],
  sources_consulted: [{ tier: 3, ref: "https://docs.stripe.com/refunds" }],
  local_search: { docs_checked: ["PRD.md"], code_checked: [] },
  what_would_falsify: "a Stripe page saying otherwise",
});

interface Holding {
  readonly backend: SessionBackend;
  /** Each claim session's claim, in the order they started. */
  readonly launched: string[];
  /** What each claim session was given, in the same order. */
  readonly given: Json[];
  readonly max: () => number;
  readonly inFlight: () => number;
}

function holding(claims: readonly Json[], failing: ReadonlySet<string> = new Set()): Holding {
  const launched: string[] = [];
  const given: Json[] = [];
  const held: (() => void)[] = [];
  let inFlight = 0;
  let max = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hold = async (): Promise<void> =>
    await new Promise<void>((resolve) => {
      held.push(resolve);
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const release of held.splice(0).reverse()) release();
      }, 10);
    });
  const backend: SessionBackend = {
    name: "holding",
    checkVersion: async () => {},
    run: async (spec) => {
      const inputs = inputsOf(spec) as Json;
      if (inputs["task"] === "survey" || inputs["task"] === "triage") {
        writeFileSync(spec.artifactOut, `${JSON.stringify(inputs["task"] === "survey" ? survey(claims) : triageOf(inputs))}\n`);
        return okResult({ turns: 3 });
      }
      const group = claimsGiven(inputs);
      launched.push(...group.map((c) => String(c["claim"])));
      given.push(...group);
      inFlight += 1;
      max = Math.max(max, inFlight);
      await hold();
      inFlight -= 1;
      if (group.some((c) => failing.has(String(c["claim"])))) {
        return resultFromSdk({ subtype: "success", is_error: true, result: "the session crashed", total_cost_usd: 0.5, modelUsage: {}, num_turns: 3 });
      }
      writeFileSync(spec.artifactOut, `${JSON.stringify(briefsOf(inputs, brief))}\n`);
      return okResult({ turns: 3 });
    },
  };
  return { backend, launched, given, max: () => max, inFlight: () => inFlight };
}

async function initThroughAudit(root: string, backend: SessionBackend) {
  const handlers = buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }).filter((h) => THROUGH_AUDIT.has(h.phase));
  return await runInit(root, handlers);
}

const auditClaims = (root: string): Json[] =>
  (JSON.parse(readFileSync(path.join(stateDir(root), "state", "AUDIT.json"), "utf8")) as { outputs: { claims: Json[] } }).outputs.claims;

const briefed = (root: string, claim: string): boolean => existsSync(auditBriefPath(root, claimHash(claim, "Stripe API")));

describe("PRDR-304 AUDIT checks its claims in batches (C-2¹⁶)", () => {
  it("checks four claims at once and never five, and starts the next as each one ends", async () => {
    const root = repo({ "PRD.md": PRD });
    const claims = claimsOf(7);
    const stub = holding(claims);

    await initThroughAudit(root, stub.backend);

    expect(stub.max()).toBe(4);
    expect(BUDGETS.init_sessions_at_once, "four where the config does not say (X-1⁸)").toBe(4);
    expect(stub.launched.slice(0, 4), "the first batch is the survey's first four claims").toEqual(claims.slice(0, 4).map((c) => c["claim"]));
    expect([...stub.launched].sort()).toEqual(claims.map((c) => String(c["claim"])).sort());
  });

  it("records the verdicts in the survey's order whatever order they end in, and checks a claim relied on twice once", async () => {
    const root = repo({ "PRD.md": PRD });
    const distinct = claimsOf(6);
    const again: Json = { ...distinct[0], passage: FREE };
    const claims = [...distinct.slice(0, 3), again, ...distinct.slice(3)];
    const stub = holding(claims);

    await initThroughAudit(root, stub.backend);

    expect(stub.launched.filter((c) => c === distinct[0]!["claim"]), "one session for the claim both places rely on").toHaveLength(1);
    expect(stub.given.find((i) => i["claim"] === distinct[0]!["claim"])?.["passage"], "checked as its first place states it").toEqual(STRIPE);
    expect(stub.launched).toHaveLength(6);
    expect(auditClaims(root).map((c) => [c["claim"], c["passage"], c["correction"]])).toEqual(
      claims.map((c) => [c["claim"], c["passage"], `not so: ${String(c["claim"])}`]),
    );
  });

  it("fails the phase for a session that failed, once every check in flight has ended with its brief committed, and starts no other", async () => {
    const root = repo({ "PRD.md": PRD });
    const claims = claimsOf(8);
    const stub = holding(claims, new Set([String(claims[0]!["claim"])]));

    await expect(initThroughAudit(root, stub.backend)).rejects.toThrow(/audit session failed: the session crashed/u);

    expect(stub.max(), "the failure met a whole batch in flight").toBe(BUDGETS.init_sessions_at_once);
    expect(stub.inFlight(), "no session is left running when the phase fails").toBe(0);
    expect(stub.launched.length, "the claims not yet started stay unstarted").toBeLessThan(claims.length);
    for (const claim of stub.launched.slice(1)) expect(briefed(root, claim), claim).toBe(true);
    expect(briefed(root, String(claims[0]!["claim"]))).toBe(false);
  });
});
