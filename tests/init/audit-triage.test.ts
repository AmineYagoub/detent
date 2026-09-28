import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stateDir, writeArtifact } from "../../src/fs/layout.js";
import { claimHash } from "../../src/init/audit-claims.js";
import { keepSurvey, keepTriage, keptSurveyPath, readKeptTriage } from "../../src/init/audit-survey.js";
import { openItems } from "../../src/init/decide-items.js";
import { runInit } from "../../src/init/machine.js";
import { buildPipeline } from "../../src/init/pipeline.js";
import { readProgressMark } from "../../src/kernel/ledger.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import type { TriageEntry } from "../../src/schemas/audit.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { MockBackend, okResult, resultFromSdk, type StageFn } from "../../src/sessions/mock.js";
import { briefsOf, claimsGiven, triageOf, type Judged, type Json } from "./audit-fixture.js";
import { BUDGETS, PROMPTS, repo } from "./plan-fixture.js";
import { inputsOf } from "./slicing-fixture.js";

/**
 * PRDR-306 — AUDIT triages its claims before it checks any (C-2¹⁸).
 *
 * On tabachir's run AUDIT checked 138 claims one session apiece on
 * claude-opus-5-5 at max, for $426: the 77 confirmed changed nothing
 * downstream, and many of the 48 unverified were claims no source could
 * settle. The user's decision (D-34): check only what a decision in the
 * documents rests on and a primary source could settle, up to five claims of
 * a topic to a session; send a load-bearing claim no source can settle to
 * DECIDE, and record one nothing rests on.
 */

const PRD = ["# Toolshed", "", "Borrowing is free in the MVP.", "", "Payments use the Stripe API, and a refund returns the card fee.", ""].join("\n");
const STRIPE = { file: "PRD.md", line: 5, quote: "Payments use the Stripe API" };
const THROUGH_AUDIT = new Set(["INIT_FS", "DISCOVER", "AUDIT"]);

const claim = (text: string, subject = "Stripe API"): Json => ({ claim: text, subject, passage: STRIPE });
const NOTHING = claim("Stripe was founded in 2010.", "Stripe");
const UNCHECKABLE = claim("Most toolshed members would rather pay by card.", "toolshed members");
const REFUNDS = Array.from({ length: 7 }, (_, n) => claim(`A Stripe refund rule, number ${String(n)}.`));
const PAYOUT = claim("Stripe pays out daily in the US.");

/** The last refund's topic is worded apart from the others, as a session may word it: one topic all the same. */
const JUDGED = (c: Json): Judged =>
  c["claim"] === NOTHING["claim"]
    ? { load_bearing: false }
    : c["claim"] === UNCHECKABLE["claim"]
      ? { checkable: false }
      : { topic: c["claim"] === PAYOUT["claim"] ? "Stripe payouts" : c["claim"] === REFUNDS[6]!["claim"] ? "  stripe  REFUNDS " : "Stripe refunds" };

const brief = (c: Json): Json => ({
  schema_version: SCHEMA_VERSION,
  claim: c["claim"],
  claim_hash: c["claim_hash"],
  verdict: "confirmed",
  source: "https://docs.stripe.com/refunds",
  evidence: [{ source: "https://docs.stripe.com/refunds", claim: "what Stripe says" }],
  sources_consulted: [{ tier: 3, ref: "https://docs.stripe.com/refunds" }],
  local_search: { docs_checked: ["PRD.md"], code_checked: [] },
  what_would_falsify: "a Stripe page saying otherwise",
});

interface Audit {
  readonly stage: StageFn;
  readonly specs: SessionSpec[];
}

const CRASH = resultFromSdk({ subtype: "success", is_error: true, result: "the session crashed", total_cost_usd: 0.5, modelUsage: {}, num_turns: 3 });

/**
 * A survey of `claims`; triage by `triage`, which returns null to write
 * nothing; a check's artifact by `check`, each attempt counted, or a crash
 * where `crash` says. `launched` hears each task as it starts.
 */
function audit(
  claims: readonly Json[],
  opts: {
    readonly triage?: (inputs: Json, attempt: number) => Json | null;
    readonly check?: (inputs: Json, attempt: number) => Json;
    readonly crash?: boolean;
    readonly launched?: (task: string) => void;
  } = {},
): Audit {
  const specs: SessionSpec[] = [];
  let triages = 0;
  let checks = 0;
  const stage: StageFn = (spec) => {
    specs.push(spec);
    const inputs = inputsOf(spec) as Json;
    const task = String(inputs["task"]);
    opts.launched?.(task);
    if (task === "verify_claims" && opts.crash === true) return CRASH;
    const out =
      task === "survey"
        ? { schema_version: SCHEMA_VERSION, documents_read: ["PRD.md"], contradictions: [], gaps: [], drift: [], claims }
        : task === "triage"
          ? (opts.triage ?? ((i) => triageOf(i, JUDGED)))(inputs, triages++)
          : (opts.check ?? ((i) => briefsOf(i, brief)))(inputs, checks++);
    if (out !== null) writeFileSync(spec.artifactOut, `${JSON.stringify(out)}\n`);
    return okResult({ turns: 3 });
  };
  return { stage, specs };
}

async function initThroughAudit(root: string, stub: Audit, notes: string[] = []) {
  const handlers = buildPipeline({ root, backend: new MockBackend({ audit: stub.stage }), prompts: PROMPTS, budgets: BUDGETS, note: (t) => notes.push(t) }).filter(
    (h) => THROUGH_AUDIT.has(h.phase),
  );
  return await runInit(root, handlers);
}

const auditOutputs = (root: string): Json => (JSON.parse(readFileSync(path.join(stateDir(root), "state", "AUDIT.json"), "utf8")) as { outputs: Json }).outputs;
const tasks = (stub: Audit): unknown[] => stub.specs.map((s) => inputsOf(s)["task"]);
const checked = (stub: Audit): string[][] =>
  stub.specs.filter((s) => inputsOf(s)["task"] === "verify_claims").map((s) => claimsGiven(inputsOf(s) as Json).map((c) => String(c["claim"])));
const recorded = (root: string, c: Json): Json | undefined => (auditOutputs(root)["claims"] as Json[]).find((x) => x["claim"] === c["claim"]);
/** The progress mark each task first launched from. */
const firstMark = (marks: readonly [string, number | null][], task: string): number => marks.find(([t]) => t === task)?.[1] ?? 0;

describe("PRDR-306 AUDIT triages its claims before it checks any (C-2¹⁸, D-34)", () => {
  it("checks only what a decision rests on and a source could settle, five of a topic to a session", async () => {
    const root = repo({ "PRD.md": PRD });
    const notes: string[] = [];
    const stub = audit([NOTHING, UNCHECKABLE, ...REFUNDS, PAYOUT]);

    await initThroughAudit(root, stub, notes);

    expect(tasks(stub)).toEqual(["survey", "triage", "verify_claims", "verify_claims", "verify_claims"]);
    expect(checked(stub)).toEqual([REFUNDS.slice(0, 5).map((c) => c["claim"]), REFUNDS.slice(5).map((c) => c["claim"]), [PAYOUT["claim"]]]);
    expect(recorded(root, NOTHING)).toMatchObject({ verdict: "unverified", checked: false, triage: "not_load_bearing" });
    expect(recorded(root, UNCHECKABLE)).toMatchObject({ verdict: "unverified", checked: false, triage: "uncheckable" });
    expect(recorded(root, PAYOUT)).toMatchObject({ verdict: "confirmed", checked: true });
    expect(recorded(root, PAYOUT)?.["triage"]).toBeUndefined();
    const said = notes.join("\n");
    expect(said).toMatch(/triage.*8 claims checked.*1 that a decision rests on and no source could settle.*1 that nothing rests on/su);
    expect(said, "the claim nothing rests on is not counted unverified").toContain("10 external claims (8 confirmed, 0 wrong, 1 unverified, 1 not checked)");
    expect(said).toContain(`${String(UNCHECKABLE["claim"])} (PRD.md:5), which no source could settle`);
    expect(said).not.toContain(`${String(NOTHING["claim"])} (PRD.md:5)`);
  });

  it("gives DECIDE the load-bearing claim no source can settle, and not the claim nothing rests on", async () => {
    const root = repo({ "PRD.md": PRD });
    await initThroughAudit(root, audit([NOTHING, UNCHECKABLE, PAYOUT]));

    const items = openItems(auditOutputs(root), { stackOpen: false }).map((i) => i.summary);

    expect(items).toEqual([`${String(UNCHECKABLE["claim"])} (unverified)`]);
  });

  it("answers a claim with a committed brief from it, and does not triage it", async () => {
    const root = repo({ "PRD.md": PRD });
    const hash = claimHash(String(PAYOUT["claim"]), String(PAYOUT["subject"]));
    writeArtifact(root, `research/audit/${hash}.json`, brief({ ...PAYOUT, claim_hash: hash }));
    const stub = audit([NOTHING, PAYOUT]);

    await initThroughAudit(root, stub);

    const triaged = claimsGiven(inputsOf(stub.specs.find((s) => inputsOf(s)["task"] === "triage")!) as Json).map((c) => c["claim"]);
    expect(triaged).toEqual([NOTHING["claim"]]);
    expect(checked(stub)).toEqual([]);
    expect(recorded(root, PAYOUT)).toMatchObject({ verdict: "confirmed", checked: true });
  });

  it("asks once more, alone, for a brief a group left out, and records the claim unchecked when it is left out again", async () => {
    const root = repo({ "PRD.md": PRD });
    const [first, left, third] = REFUNDS;
    const stub = audit([first!, left!, third!], { check: (i) => briefsOf(i, (c) => (c["claim"] === left!["claim"] ? null : brief(c))) });

    await initThroughAudit(root, stub);

    expect(checked(stub)).toEqual([[first!["claim"], left!["claim"], third!["claim"]], [left!["claim"]]]);
    expect(recorded(root, left!)).toMatchObject({ verdict: "unverified", checked: false });
    expect(recorded(root, third!)).toMatchObject({ verdict: "confirmed", checked: true });
  });

  it("checks alone a claim the relaunched triage still leaves out, and says so", async () => {
    const root = repo({ "PRD.md": PRD });
    const notes: string[] = [];
    const without = (i: Json): Json => ({ ...triageOf(i, JUDGED), claims: (triageOf(i, JUDGED)["claims"] as Json[]).filter((e) => e["claim_hash"] !== claimHash(String(NOTHING["claim"]), String(NOTHING["subject"]))) });
    const stub = audit([NOTHING, PAYOUT], { triage: without });

    await initThroughAudit(root, stub, notes);

    expect(tasks(stub)).toEqual(["survey", "triage", "triage", "verify_claims", "verify_claims"]);
    expect(checked(stub)).toContainEqual([NOTHING["claim"]]);
    expect(notes.join("\n")).toMatch(/triage left 1 claim unsorted/u);
  });

  it("takes neither of two briefs for one claim, and asks for it again alone", async () => {
    const root = repo({ "PRD.md": PRD });
    const [first, second] = REFUNDS;
    const hashed = (c: Json): Json => ({ ...c, claim_hash: claimHash(String(c["claim"]), String(c["subject"])) });
    const wrong = { ...brief(hashed(first!)), verdict: "wrong", correction: "Stripe keeps it." };
    const stub = audit([first!, second!], {
      check: (i, n) => (n === 0 ? { schema_version: SCHEMA_VERSION, briefs: [brief(hashed(first!)), wrong, brief(hashed(second!))] } : { schema_version: SCHEMA_VERSION, briefs: [wrong] }),
    });

    await initThroughAudit(root, stub);

    expect(checked(stub)).toEqual([[first!["claim"], second!["claim"]], [first!["claim"]]]);
    const again = stub.specs.filter((s) => inputsOf(s)["task"] === "verify_claims")[1]!;
    expect(String((inputsOf(again)["previous_attempt"] as Json | undefined)?.["issue"])).toMatch(/another brief already checked, so neither stands/u);
    expect(recorded(root, first!)).toMatchObject({ verdict: "wrong", checked: true });
    expect(recorded(root, second!)).toMatchObject({ verdict: "confirmed", checked: true });
  });

  it("keeps its triage with the survey, so a re-run sorts only what no run has sorted, and keeps each sort (C-2¹⁷)", async () => {
    const root = repo({ "PRD.md": PRD });
    await expect(initThroughAudit(root, audit([NOTHING, PAYOUT], { crash: true }))).rejects.toThrow(/the session crashed/u);

    const again = audit([NOTHING, PAYOUT]);
    await initThroughAudit(root, again);

    expect(tasks(again)).toEqual(["verify_claims"]);
    expect(recorded(root, NOTHING)).toMatchObject({ verdict: "unverified", checked: false, triage: "not_load_bearing" });
    expect(recorded(root, PAYOUT)).toMatchObject({ verdict: "confirmed", checked: true });
  });

  it("a triage kept is a unit of work, so the first check starts from it (X-1⁵)", async () => {
    const root = repo({ "PRD.md": PRD });
    const marks: [string, number | null][] = [];
    await initThroughAudit(root, audit([PAYOUT], { launched: (task) => marks.push([task, readProgressMark(root).spent]) }));

    expect(firstMark(marks, "verify_claims"), "the triage's spend is behind the mark before any brief lands").toBeGreaterThan(firstMark(marks, "triage"));
  });

  it("adds what a triage sorts to what is kept, and keeps nothing where no survey is kept under the key", () => {
    const root = repo({ "PRD.md": PRD });
    const entry = (hash: string): TriageEntry => ({ claim_hash: hash, load_bearing: true, checkable: true, topic: "Stripe", why: "a price rests on it" });
    mkdirSync(path.dirname(keptSurveyPath(root)), { recursive: true });
    keepTriage(root, "k", { ["a".repeat(64)]: entry("a".repeat(64)) });
    expect(readKeptTriage(root, "k")).toEqual({});

    keepSurvey(root, "k", { issues: [], kept: { schema_version: SCHEMA_VERSION, documents_read: [], contradictions: [], gaps: [], drift: [], claims: [] }, dropped: [], unread: [] });
    keepTriage(root, "k", { ["a".repeat(64)]: entry("a".repeat(64)) });
    keepTriage(root, "k", { ["b".repeat(64)]: entry("b".repeat(64)) });

    expect(Object.keys(readKeptTriage(root, "k")).sort()).toEqual(["a".repeat(64), "b".repeat(64)]);
    expect(readKeptTriage(root, "another key")).toEqual({});
  });

  /** PRDR-308: on the A/B copy six of 145 entries carried cut hashes, and the 139 beside them were thrown away. */
  it("keeps every entry that stands when one is refused, and asks again for that claim alone (C-2¹⁹)", async () => {
    const root = repo({ "PRD.md": PRD });
    const cut = (i: Json): Json => {
      const sorted = triageOf(i, JUDGED);
      return { ...sorted, claims: (sorted["claims"] as Json[]).map((e, n) => (n === 1 ? { ...e, claim_hash: String(e["claim_hash"]).slice(0, 8) } : e)) };
    };
    const stub = audit([NOTHING, UNCHECKABLE, PAYOUT], { triage: (i, n) => (n === 0 ? cut(i) : triageOf(i, JUDGED)) });
    const notes: string[] = [];

    await initThroughAudit(root, stub, notes);

    expect(notes.join("\n")).toMatch(/triage sorted all but 1 claim \(entry 2: claim_hash/u);
    const triages = stub.specs.filter((s) => inputsOf(s)["task"] === "triage");
    expect(triages.map((s) => claimsGiven(inputsOf(s) as Json).map((c) => c["claim"]))).toEqual([[NOTHING["claim"], UNCHECKABLE["claim"], PAYOUT["claim"]], [UNCHECKABLE["claim"]]]);
    expect(String((inputsOf(triages[1]!)["previous_attempt"] as Json | undefined)?.["issue"])).toMatch(/entry 2/u);
    expect(recorded(root, NOTHING)).toMatchObject({ triage: "not_load_bearing" });
    expect(recorded(root, UNCHECKABLE)).toMatchObject({ triage: "uncheckable" });
    expect(checked(stub)).toEqual([[PAYOUT["claim"]]]);
  });

  it("checks every claim alone when the triage cannot be read twice, and says so", async () => {
    const root = repo({ "PRD.md": PRD });
    const notes: string[] = [];
    const marks: [string, number | null][] = [];
    const stub = audit([NOTHING, UNCHECKABLE, PAYOUT], { triage: () => null, launched: (task) => marks.push([task, readProgressMark(root).spent]) });

    await initThroughAudit(root, stub, notes);

    expect(tasks(stub)).toEqual(["survey", "triage", "triage", "verify_claims", "verify_claims", "verify_claims"]);
    expect(checked(stub).every((g) => g.length === 1)).toBe(true);
    expect(notes.join("\n")).toMatch(/triage left 3 claims unsorted/u);
    expect(firstMark(marks, "verify_claims"), "a triage that sorted nothing is no progress").toBe(firstMark(marks, "triage"));
  });

  it("refuses a triage that sorts a claim it was not given, or one claim twice, and names both", async () => {
    const root = repo({ "PRD.md": PRD });
    const extra = (i: Json): Json => {
      const sorted = triageOf(i, JUDGED);
      const [entry] = sorted["claims"] as Json[];
      return { ...sorted, claims: [...(sorted["claims"] as Json[]), entry, { ...entry, claim_hash: "f".repeat(64) }] };
    };
    const stub = audit([NOTHING, PAYOUT], { triage: (i, n) => (n === 0 ? extra(i) : triageOf(i, JUDGED)) });

    await initThroughAudit(root, stub);

    const again = stub.specs.filter((s) => inputsOf(s)["task"] === "triage")[1]!;
    const issue = String((inputsOf(again)["previous_attempt"] as Json | undefined)?.["issue"]);
    expect(issue).toMatch(/is sorted twice/u);
    expect(issue).toContain(`${"f".repeat(64)} is not a claim you were given`);
    expect(recorded(root, NOTHING)).toMatchObject({ triage: "not_load_bearing" });
  });
});
