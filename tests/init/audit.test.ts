import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { checkPack } from "../../src/init/pack-check.js";
import { conformanceRecord, writeConformanceRecord } from "../../src/init/pack.js";
import { discoverDocs } from "../../src/init/discover-docs.js";
import { runInit } from "../../src/init/machine.js";
import { buildPipeline } from "../../src/init/pipeline.js";
import { auditBriefPath, claimArtifactPath, claimHash } from "../../src/init/audit-claims.js";
import { surveyPath } from "../../src/init/audit.js";
import { readProgressMark } from "../../src/kernel/ledger.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { artifactWriteRule, type SessionSpec } from "../../src/sessions/backend.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { writeTree } from "../helpers.js";
import { BUDGETS, PROMPTS, repo } from "./plan-fixture.js";
import { inputsOf } from "./slicing-fixture.js";

/**
 * PRDR-281 — AUDIT (C-2⁶, C-2¹¹).
 *
 * Driven through the real pipeline, stopped after AUDIT: INIT_FS, DISCOVER and
 * AUDIT are the only handlers, so what reaches the checkpoint is what the
 * phase wrote, and nothing after it can mask a defect. The session is a stub
 * that answers by task, as the one audit prompt is told its task by its inputs.
 */

const PRD = ["# Toolshed", "", "Borrowing is free in the MVP.", "", "Payments use the Stripe API, and a refund returns the card fee.", ""].join("\n");
const ROADMAP = ["# Roadmap", "", "Launch is in spring.", "Borrowing costs two dollars a day from launch.", ""].join("\n");
const DOCS = { "PRD.md": PRD, "docs/roadmap.md": ROADMAP };
const EXISTING = { ...DOCS, "package.json": `${JSON.stringify({ name: "toolshed", scripts: { test: "node --test" } })}\n`, "src/borrow.js": "export const price = 0;\n" };

const FREE = { file: "PRD.md", line: 3, quote: "Borrowing is free in the MVP." };
const PAID = { file: "docs/roadmap.md", line: 4, quote: "Borrowing costs two dollars a day from launch." };
const FEE = { file: "PRD.md", line: 5, quote: "a refund returns the card fee" };
const CLAIM = { claim: "A Stripe refund returns the card processing fee.", subject: "Stripe API", passage: FEE };

type Json = Record<string, unknown>;

const survey = (over: Json = {}): Json => ({
  schema_version: SCHEMA_VERSION,
  documents_read: ["PRD.md", "docs/roadmap.md"],
  contradictions: [{ topic: "the price of borrowing", passages: [FREE, PAID], why: "free and two dollars a day cannot both hold at launch" }],
  gaps: [{ topic: "late returns", detail: "no document says what happens when a tool comes back late", passages: [] }],
  drift: [],
  claims: [CLAIM],
  ...over,
});

const brief = (inputs: Json, verdict: "confirmed" | "wrong" | "unverified", over: Json = {}): Json => ({
  schema_version: SCHEMA_VERSION,
  claim: inputs["claim"],
  claim_hash: inputs["claim_hash"],
  verdict,
  ...(verdict === "unverified" ? {} : { source: "https://docs.stripe.com/refunds" }),
  ...(verdict === "wrong" ? { correction: "Stripe keeps the processing fee when a payment is refunded." } : {}),
  evidence: [{ source: "https://docs.stripe.com/refunds", claim: "the processing fee is not returned" }],
  sources_consulted: [{ tier: 3, ref: "https://docs.stripe.com/refunds" }],
  local_search: { docs_checked: ["PRD.md"], code_checked: [] },
  what_would_falsify: "a Stripe page saying the fee is refunded",
  ...over,
});

interface Audit {
  readonly stage: StageFn;
  readonly specs: SessionSpec[];
}

/** One stub for both tasks; each answer is picked by the attempt it is. */
function audit(answers: {
  readonly survey?: (attempt: number, inputs: Json) => Json | null;
  readonly verify?: (attempt: number, inputs: Json) => Json | null;
}): Audit {
  const specs: SessionSpec[] = [];
  const attempts = new Map<string, number>();
  const stage: StageFn = (spec) => {
    specs.push(spec);
    const inputs = inputsOf(spec) as Json;
    const key = inputs["task"] === "survey" ? "survey" : String(inputs["claim_hash"]);
    const n = attempts.get(key) ?? 0;
    attempts.set(key, n + 1);
    const answer = inputs["task"] === "survey" ? (answers.survey ?? (() => survey()))(n, inputs) : (answers.verify ?? ((_, i) => brief(i, "wrong")))(n, inputs);
    if (answer !== null) writeFileSync(spec.artifactOut, `${JSON.stringify(answer)}\n`);
    return okResult({ turns: 3 });
  };
  return { stage, specs };
}

const THROUGH_AUDIT = new Set(["INIT_FS", "DISCOVER", "AUDIT"]);

async function initThroughAudit(root: string, stub: Audit, notes: string[] = [], routing: Record<string, string> = {}, prompts = PROMPTS) {
  const handlers = buildPipeline({
    root,
    backend: new MockBackend({ audit: stub.stage }),
    prompts,
    budgets: BUDGETS,
    modelRouting: routing,
    note: (t) => notes.push(t),
  }).filter((h) => THROUGH_AUDIT.has(h.phase));
  return await runInit(root, handlers);
}

const auditOutputs = (root: string): Json =>
  (JSON.parse(readFileSync(path.join(stateDir(root), "state", "AUDIT.json"), "utf8")) as { outputs: Json }).outputs;

describe("PRDR-281: AUDIT reads the documents before anything plans from them", () => {
  it("runs directly after DISCOVER, and both passages of a contradiction reach its checkpoint", async () => {
    const root = repo(DOCS);
    const stub = audit({});
    const result = await initThroughAudit(root, stub);
    expect(result.executed).toEqual(["INIT_FS", "DISCOVER", "AUDIT"]);
    const out = auditOutputs(root);
    expect(out["ran"]).toBe(true);
    expect(out["contradictions"]).toEqual([{ topic: "the price of borrowing", passages: [FREE, PAID], why: "free and two dollars a day cannot both hold at launch" }]);
    expect(out["gaps"]).toEqual([expect.objectContaining({ topic: "late returns" })]);
  });

  it("reads the code in an existing project, where a document stating as built what the code does not do is a finding", async () => {
    const root = repo(EXISTING);
    const drift = { passage: FREE, code_checked: ["src/borrow.js"], finding: "the code prices borrowing at zero but charges nothing anywhere, so this holds; the roadmap's price is not built" };
    const stub = audit({ survey: () => survey({ drift: [drift] }) });
    await initThroughAudit(root, stub);
    expect(auditOutputs(root)["drift"]).toEqual([drift]);
    expect(inputsOf(stub.specs[0] as SessionSpec)["greenfield"]).toBe(false);
  });

  it("refuses drift in a greenfield project, where there is no code to drift from", async () => {
    const root = repo(DOCS);
    const drift = { passage: FREE, code_checked: ["src/borrow.js"], finding: "not built" };
    const stub = audit({ survey: (n) => survey(n === 0 ? { drift: [drift] } : {}) });
    await initThroughAudit(root, stub);
    const second = inputsOf(stub.specs[1] as SessionSpec);
    expect(String((second["previous_attempt"] as Json | undefined)?.["issue"])).toMatch(/greenfield/u);
    expect(auditOutputs(root)["drift"]).toEqual([]);
  });

  it("refuses a survey that did not read every document it was given", async () => {
    const root = repo(DOCS);
    const stub = audit({ survey: (n) => survey(n === 0 ? { documents_read: ["PRD.md"] } : {}) });
    await initThroughAudit(root, stub);
    const second = inputsOf(stub.specs[1] as SessionSpec);
    expect(String((second["previous_attempt"] as Json | undefined)?.["issue"])).toContain("docs/roadmap.md");
    expect(auditOutputs(root)["unread"]).toEqual([]);
  });

  it("records the documents a relaunched survey still did not read, and says so", async () => {
    const root = repo(DOCS);
    const notes: string[] = [];
    await initThroughAudit(root, audit({ survey: () => survey({ documents_read: ["PRD.md"] }) }), notes);
    expect(auditOutputs(root)["unread"]).toEqual(["docs/roadmap.md"]);
    expect(notes.join("\n")).toMatch(/did not read docs\/roadmap\.md/u);
  });

  it("names each contradiction and each claim the documents have wrong, since no phase reads the checkpoint yet", async () => {
    const root = repo(DOCS);
    const notes: string[] = [];
    await initThroughAudit(root, audit({}), notes);
    const said = notes.join("\n");
    expect(said).toMatch(/1 contradiction, 1 gap, 0 drift findings and 1 external claim \(0 confirmed, 1 wrong, 0 unverified\)/u);
    expect(said).toContain("the price of borrowing: PRD.md:3 vs docs/roadmap.md:4");
    expect(said).toContain("Stripe keeps the processing fee when a payment is refunded.");
    expect(said).not.toMatch(/AUDIT dropped/u);
  });
});

describe("PRDR-281: a quoted passage must be at its file:line", () => {
  it("relaunches a survey whose passage is not there, naming it, and keeps the corrected one", async () => {
    const root = repo(DOCS);
    const moved = { ...PAID, line: 2 };
    const stub = audit({ survey: (n) => survey(n === 0 ? { contradictions: [{ topic: "t", passages: [FREE, moved], why: "w" }] } : {}) });
    await initThroughAudit(root, stub);
    const second = inputsOf(stub.specs[1] as SessionSpec);
    expect(String((second["previous_attempt"] as Json | undefined)?.["issue"])).toContain("docs/roadmap.md:2");
    expect((auditOutputs(root)["contradictions"] as Json[])[0]?.["passages"]).toEqual([FREE, PAID]);
    expect(auditOutputs(root)["dropped"]).toEqual([]);
  });

  it("drops what is still not there after the relaunch, counts it, and says so", async () => {
    const root = repo(DOCS);
    const invented = { file: "PRD.md", line: 3, quote: "Borrowing is free forever." };
    const notes: string[] = [];
    const stub = audit({ survey: () => survey({ contradictions: [{ topic: "t", passages: [invented, PAID], why: "w" }] }) });
    await initThroughAudit(root, stub, notes);
    const out = auditOutputs(root);
    expect(out["contradictions"]).toEqual([]);
    expect(out["dropped"]).toEqual([expect.objectContaining({ kind: "contradiction", passage: "PRD.md:3" })]);
    expect(notes.join("\n")).toMatch(/dropped 1 finding/u);
  });

  it("finds a quote across whitespace and line breaks, from the line it starts on", async () => {
    const root = repo({ ...DOCS, "PRD.md": PRD.replace("Payments use the Stripe API, and a refund", "Payments use the Stripe API, and a\n   refund") });
    const stub = audit({ survey: () => survey({ contradictions: [], claims: [{ ...CLAIM, passage: { file: "PRD.md", line: 5, quote: "and a refund returns the card fee" } }] }) });
    await initThroughAudit(root, stub);
    expect(auditOutputs(root)["claims"]).toHaveLength(1);
    expect(auditOutputs(root)["dropped"]).toEqual([]);
  });
});

describe("PRDR-281: every external claim is checked, and carries its source and a verdict", () => {
  it("records a confirmed claim with its source, a wrong one with its correction, and an unverified one with neither", async () => {
    const claims = [
      CLAIM,
      { claim: "Stripe pays out daily in the US.", subject: "Stripe API", passage: { file: "PRD.md", line: 5, quote: "Payments use the Stripe API" } },
      { claim: "Card payments settle in two days.", subject: "Stripe API", passage: { file: "PRD.md", line: 5, quote: "Payments use the Stripe API" } },
    ];
    const verdicts: Record<string, "confirmed" | "wrong" | "unverified"> = { [claims[0]!.claim]: "wrong", [claims[1]!.claim]: "confirmed", [claims[2]!.claim]: "unverified" };
    const root = repo(DOCS);
    const stub = audit({ survey: () => survey({ claims }), verify: (_, i) => brief(i, verdicts[String(i["claim"])]!) });
    await initThroughAudit(root, stub);
    const out = (auditOutputs(root)["claims"] as Json[]).map((c) => [c["claim"], c["verdict"], c["source"], c["correction"], c["checked"]]);
    expect(out).toEqual([
      [claims[0]!.claim, "wrong", "https://docs.stripe.com/refunds", "Stripe keeps the processing fee when a payment is refunded.", true],
      [claims[1]!.claim, "confirmed", "https://docs.stripe.com/refunds", undefined, true],
      [claims[2]!.claim, "unverified", undefined, undefined, true],
    ]);
  });

  it("refuses an unverified verdict that never looked outside the project (X-6a, PRDR-266)", async () => {
    const root = repo(DOCS);
    const stub = audit({ verify: (n, i) => brief(i, "unverified", n === 0 ? { sources_consulted: [{ tier: 1, ref: "PRD.md" }] } : {}) });
    await initThroughAudit(root, stub);
    const verifies = stub.specs.filter((s) => inputsOf(s)["task"] === "verify_claim");
    expect(verifies).toHaveLength(2);
    expect(String((inputsOf(verifies[1] as SessionSpec)["previous_attempt"] as Json | undefined)?.["issue"])).toMatch(/tier 3/u);
  });

  it("refuses a verdict that cites a repository path that is not there, and records the claim unchecked when it happens twice", async () => {
    const root = repo(DOCS);
    const notes: string[] = [];
    const stub = audit({ verify: (_, i) => brief(i, "confirmed", { source: "node_modules/stripe/lib/refunds.js:40" }) });
    await initThroughAudit(root, stub, notes);
    expect((auditOutputs(root)["claims"] as Json[])[0]).toMatchObject({ verdict: "unverified", checked: false });
    expect((auditOutputs(root)["claims"] as Json[])[0]?.["source"]).toBeUndefined();
    expect(notes.join("\n")).toMatch(/node_modules\/stripe\/lib\/refunds\.js/u);
  });

  it("accepts a repository path that is there, at the pinned version the survey named", async () => {
    const root = repo({ ...DOCS, "node_modules/stripe/lib/refunds.js": "module.exports = {};\n" });
    const stub = audit({ verify: (_, i) => brief(i, "confirmed", { source: "node_modules/stripe/lib/refunds.js:1" }) });
    await initThroughAudit(root, stub);
    expect((auditOutputs(root)["claims"] as Json[])[0]).toMatchObject({ verdict: "confirmed", source: "node_modules/stripe/lib/refunds.js:1", checked: true });
  });

  it("refuses a brief that checks another claim, and records this one unchecked", async () => {
    const root = repo(DOCS);
    const notes: string[] = [];
    await initThroughAudit(root, audit({ verify: (_, i) => brief(i, "confirmed", { claim_hash: claimHash("another", "Stripe API") }) }), notes);
    expect((auditOutputs(root)["claims"] as Json[])[0]).toMatchObject({ verdict: "unverified", checked: false });
    expect(notes.join("\n")).toMatch(/checks another claim/u);
  });

  it("never reads a claim's stale artifact as its session's answer (D-19)", async () => {
    const root = repo(DOCS);
    writeTree(root, { [path.relative(root, claimArtifactPath(root, claimHash(CLAIM.claim, CLAIM.subject)))]: "{" });
    const notes: string[] = [];
    await initThroughAudit(root, audit({ verify: () => null }), notes);
    expect(notes.join("\n")).toMatch(/wrote no artifact/u);
    expect(notes.join("\n")).not.toMatch(/not JSON/u);
  });

  it("checks a claim once, however many passages rely on it, and records each with the verdict", async () => {
    const root = repo(DOCS);
    const elsewhere = { file: "PRD.md", line: 5, quote: "Payments use the Stripe API" };
    const twice = [CLAIM, { ...CLAIM, passage: elsewhere }];
    const stub = audit({ survey: () => survey({ claims: twice }) });
    await initThroughAudit(root, stub);
    expect(stub.specs.filter((s) => inputsOf(s)["task"] === "verify_claim")).toHaveLength(1);
    const claims = auditOutputs(root)["claims"] as Json[];
    expect(claims.map((c) => [c["passage"], c["verdict"], c["correction"]])).toEqual([
      [FEE, "wrong", "Stripe keeps the processing fee when a payment is refunded."],
      [elsewhere, "wrong", "Stripe keeps the processing fee when a payment is refunded."],
    ]);
    /* The second place is answered by the first check, not by the cache the first check wrote. */
    expect(auditOutputs(root)["research"]).toMatchObject({ sessions: 1, cache_hits: 0 });
  });

  it("checks a cached claim again when the file its verdict cites has gone", async () => {
    const root = repo({ ...DOCS, "node_modules/stripe/lib/refunds.js": "module.exports = {};\n" });
    await initThroughAudit(root, audit({ verify: (_, i) => brief(i, "confirmed", { source: "node_modules/stripe/lib/refunds.js:1" }) }));
    rmSync(path.join(root, "node_modules"), { recursive: true });
    const again = audit({});
    await initThroughAudit(root, again);
    expect(again.specs.map((s) => inputsOf(s)["task"])).toEqual(["survey", "verify_claim"]);
  });

  it("commits each brief, keyed by the claim and its subject, and pays nothing for it on a re-run", async () => {
    const root = repo(DOCS);
    const stub = audit({});
    await initThroughAudit(root, stub);
    const hash = claimHash(CLAIM.claim, CLAIM.subject);
    expect(existsSync(auditBriefPath(root, hash))).toBe(true);
    expect(auditBriefPath(root, hash)).toContain(path.join(".detent", "research", "audit"));
    writeFileSync(path.join(root, "PRD.md"), `${PRD}\nA new line changes the documents.\n`);
    const again = audit({});
    await initThroughAudit(root, again);
    expect(again.specs.map((s) => inputsOf(s)["task"])).toEqual(["survey"]);
    expect(claimHash(CLAIM.claim, "Stripe API v2")).not.toBe(hash);
  });
});

describe("PRDR-281: AUDIT's sessions (S-1‴, S-5⁵, C-2⁶)", () => {
  it("are audit sessions: routed as configured, read-only, with the research role's reach and no share to stay within", async () => {
    const root = repo(DOCS);
    const stub = audit({});
    const notes: string[] = [];
    await initThroughAudit(root, stub, notes, { audit: "claude-opus-5-5" });
    expect(stub.specs).toHaveLength(2);
    for (const spec of stub.specs) {
      expect(spec.role).toBe("audit");
      expect(spec.model).toBe("claude-opus-5-5");
      expect(spec.allowedTools).toContain("WebSearch");
      expect(spec.allowedTools.filter((t) => /^(Edit|Write|Bash)/u.test(t)), "S-1′: its own artifact, and nothing else").toEqual([artifactWriteRule(spec.artifactOut)]);
      expect(JSON.stringify(inputsOf(spec))).not.toMatch(/tool_call_budget|share/u);
    }
    expect(Object.keys(inputsOf(stub.specs[0] as SessionSpec))).toContain("expected_output");
    expect(Object.keys(inputsOf(stub.specs[1] as SessionSpec))).toEqual(
      expect.arrayContaining(["expected_output", "expected_output_if_wrong", "expected_output_if_unverified", "hierarchy", "passage", "subject"]),
    );
    expect(auditOutputs(root)["research"]).toEqual({ sessions: 1, cache_hits: 0, tool_calls: 3 });
    expect(notes.join("\n")).toMatch(/3 tool call.*planning_research_tool_calls/su);
  });

  it("marks progress when it completes, for the no-progress breaker (X-1⁵)", async () => {
    const root = repo(DOCS);
    expect(readProgressMark(root).spent).toBeNull();
    await initThroughAudit(root, audit({ survey: () => survey({ claims: [] }) }));
    /* The ledger pins a mark at the spend when it first launches, which is none; completing moves it to the survey's. */
    expect(readProgressMark(root).spent).toBeGreaterThan(0);
  });

  it("marks progress for each brief it writes, as PLAN does for each slice (C-2¹¹)", async () => {
    const root = repo(DOCS);
    const claims = [CLAIM, { claim: "Stripe pays out daily in the US.", subject: "Stripe API", passage: { file: "PRD.md", line: 5, quote: "Payments use the Stripe API" } }];
    const marks: (number | null)[] = [];
    const stub = audit({
      survey: () => survey({ claims }),
      verify: (_, i) => {
        marks.push(readProgressMark(root).spent);
        return brief(i, "wrong");
      },
    });
    await initThroughAudit(root, stub);
    expect(marks).toHaveLength(2);
    expect(marks[1], "the second check starts from the first one's brief").toBeGreaterThan(marks[0] ?? 0);
  });

  it("says nothing of research when there was no claim to check", async () => {
    const root = repo(DOCS);
    const notes: string[] = [];
    await initThroughAudit(root, audit({ survey: () => survey({ claims: [] }) }), notes);
    expect(auditOutputs(root)["research"]).toEqual({ sessions: 0, cache_hits: 0, tool_calls: 0 });
    expect(notes.join("\n")).not.toMatch(/AUDIT's research/u);
  });

  it("is not shown the decision log", async () => {
    const root = repo({ ...DOCS, "docs/founder-decisions.md": "# Decisions\n\n- **D-1** Borrowing is free.\n" });
    const stub = audit({});
    await initThroughAudit(root, stub);
    expect(inputsOf(stub.specs[0] as SessionSpec)["documents"]).toEqual(["PRD.md", "docs/roadmap.md"]);
  });
});

describe("PRDR-281: what re-runs AUDIT (C-8, C-2¹¹)", () => {
  it("does not re-run for a decision log DECIDE writes, though DISCOVER does", async () => {
    const root = repo(DOCS);
    await initThroughAudit(root, audit({}));
    writeTree(root, { "docs/founder-decisions.md": "# Decisions\n\n- **D-1** Borrowing is free in the MVP.\n" });
    const again = audit({});
    const result = await initThroughAudit(root, again);
    expect(result.executed).toContain("DISCOVER");
    expect(result.reused).toContain("AUDIT");
    expect(again.specs).toEqual([]);
  });

  it("re-runs for an edited document", async () => {
    const root = repo(DOCS);
    await initThroughAudit(root, audit({}));
    writeFileSync(path.join(root, "docs", "roadmap.md"), ROADMAP.replace("spring", "summer"));
    const again = audit({});
    const result = await initThroughAudit(root, again);
    expect(result.executed).toContain("AUDIT");
    expect(again.specs.length).toBeGreaterThan(0);
  });

  it("never reads a stale survey as its session's answer, so a survey that writes nothing fails the phase (D-19)", async () => {
    const root = repo(DOCS);
    await initThroughAudit(root, audit({}));
    expect(existsSync(surveyPath(root)), "the last survey is still on disk").toBe(true);
    writeFileSync(path.join(root, "PRD.md"), `${PRD}\nMore.\n`);
    await expect(initThroughAudit(root, audit({ survey: () => null }))).rejects.toThrow(/AUDIT's survey produced no usable artifact/u);
  });

  it("keys on the pack's kind and the stack markers, as well as the files", () => {
    const root = repo(DOCS);
    const handler = buildPipeline({ root, backend: new MockBackend({}), prompts: PROMPTS, budgets: BUDGETS }).find((h) => h.phase === "AUDIT");
    const digest = (discover: Json): string => handler?.digest({ root, outputs: { DISCOVER: { docs: ["PRD.md"], ...discover } }, now: () => 0 }) ?? "";
    const raw = digest({ stack_markers: [], pack: { kind: "raw" } });
    expect(digest({ stack_markers: [], pack: { kind: "conforming" } })).not.toBe(raw);
    expect(digest({ stack_markers: ["package.json"], pack: { kind: "raw" } })).not.toBe(raw);
    expect(digest({ stack_markers: [] }), "a DISCOVER checkpoint from before C-2⁹ is raw").toBe(raw);
  });

  it("re-runs for a new audit prompt", async () => {
    const root = repo(DOCS);
    await initThroughAudit(root, audit({}));
    const prompts = { ...PROMPTS, hashes: { ...PROMPTS.hashes, audit: "0".repeat(64) } };
    const result = await initThroughAudit(root, audit({}), [], {}, prompts);
    expect(result.executed).toContain("AUDIT");
  });

  it("re-runs for changed code in an existing project, and not for Detent's own state", async () => {
    const root = repo(EXISTING);
    await initThroughAudit(root, audit({}));
    writeTree(root, { ".detent/plan/t-1.json": "{}\n", "archive/PRD.md": "# old\n" });
    const same = audit({});
    expect((await initThroughAudit(root, same)).reused).toContain("AUDIT");
    writeFileSync(path.join(root, "src", "borrow.js"), "export const price = 2;\n");
    const again = audit({});
    expect((await initThroughAudit(root, again)).executed).toContain("AUDIT");
  });
});

describe("PRDR-281: a pack is not audited (specification decision 6, C-2⁷)", () => {
  function packRepo(): string {
    const fixture = path.join(import.meta.dirname, "..", "fixtures", "pack");
    const files: Record<string, string> = {};
    for (const entry of readdirSync(fixture, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const abs = path.join(entry.parentPath, entry.name);
      files[path.relative(fixture, abs).split(path.sep).join("/")] = readFileSync(abs, "utf8");
    }
    const root = repo(files);
    const checker = checkPack(root, discoverDocs(root).docs, { greenfield: true });
    writeConformanceRecord(root, conformanceRecord(root, { checker, rounds: [], date: "2026-09-26" }));
    return root;
  }

  it("completes without a session on a conforming pack, and says why", async () => {
    const root = packRepo();
    const stub = audit({});
    const notes: string[] = [];
    await initThroughAudit(root, stub, notes);
    expect(stub.specs).toEqual([]);
    expect(auditOutputs(root)).toEqual({ ran: false, reason: "conforming" });
    expect(notes.join("\n")).toMatch(/AUDIT.*conforming/su);
    expect(readProgressMark(root).spent, "a completed phase is a progress mark, sessions or none (C-2⁶)").not.toBeNull();
  });

  it("does not audit a changed pack as a raw PRD, and says that nothing re-validates it in this build", async () => {
    const root = packRepo();
    const prd = readdirSync(path.join(root, "docs", "prd")).find((f) => f.endsWith(".md") && f !== "index.md") ?? "";
    writeFileSync(path.join(root, "docs", "prd", prd), `${readFileSync(path.join(root, "docs", "prd", prd), "utf8")}\n`);
    const stub = audit({});
    const notes: string[] = [];
    await initThroughAudit(root, stub, notes);
    expect(stub.specs).toEqual([]);
    expect(auditOutputs(root)).toEqual({ ran: false, reason: "changed" });
    expect(notes.join("\n")).toMatch(/changed pack.*no VALIDATE.*unaudited/su);
  });
});
