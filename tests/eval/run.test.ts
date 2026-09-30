import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildClaimsSet } from "../../src/eval/claims-set.js";
import { report } from "../../src/eval/report.js";
import { buildReviewsSet } from "../../src/eval/reviews-set.js";
import { runEvaluation, type EvalDeps } from "../../src/eval/run.js";
import { readSet, treeDiff } from "../../src/eval/sets.js";
import { readLedgerRows } from "../../src/kernel/ledger-rows.js";
import { acquireRunLock, liveRunLock } from "../../src/kernel/run-lock.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { MockBackend, okResult, resultFromSdk, type StageFn } from "../../src/sessions/mock.js";
import { git, gitInit, writeTree } from "../helpers.js";
import { PROMPTS } from "../init/plan-fixture.js";
import { inputsOf } from "../init/slicing-fixture.js";
import { review } from "../init/validate-fixture.js";
import { CODES, prdOf } from "../init/validate-wide-fixture.js";
import { armACopy, brief, outside, type Json } from "./eval-fixture.js";
import { at, stoppedCopy } from "./review-fixture.js";

/**
 * PRDR-326 — an evaluation runs a set's units through `init`'s own check and
 * review, on the route named, on a disposable copy that is never the project
 * the set came from, and within its budget (N-8). What it spends is on the
 * copy's ledger.
 */

const tmp = (): string => realpathSync(mkdtempSync(path.join(tmpdir(), "detent-copy-")));

function clone(from: string): string {
  const to = path.join(tmp(), "copy");
  git(path.dirname(to), "clone", "-q", from, to);
  return to;
}

/** A fresh repository with one commit that holds nothing of the set's. */
function unrelated(): string {
  const root = tmp();
  gitInit(root);
  writeTree(root, { "NOTES.md": "# notes\n" });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "notes");
  return root;
}

interface Checks {
  readonly stage: StageFn;
  readonly specs: SessionSpec[];
  readonly max: () => number;
}

const CRASH = resultFromSdk({ subtype: "success", is_error: true, result: "the session crashed", total_cost_usd: 0.5, modelUsage: {}, num_turns: 3 });

/** Check sessions that each find their claim `verdict(hash)`, cost `usd`, and are held a moment so a batch is in flight at once; `crash` crashes one. */
function checks(verdict: (hash: string) => string, usd = 2, crash: (hash: string) => boolean = () => false): Checks {
  const specs: SessionSpec[] = [];
  let inFlight = 0;
  let max = 0;
  const stage: StageFn = async (spec) => {
    specs.push(spec);
    if (liveRunLock(spec.cwd)?.pid !== process.pid) throw new Error("a session ran while the evaluation did not hold the copy's run lock");
    inFlight += 1;
    max = Math.max(max, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 10));
    inFlight -= 1;
    const given = ((inputsOf(spec) as Json)["claims"] as Json[])[0] ?? {};
    const hash = given["claim_hash"] as string;
    if (crash(hash)) return CRASH;
    const found = brief(0, verdict(hash));
    writeFileSync(spec.artifactOut, `${JSON.stringify({ schema_version: found["schema_version"], briefs: [{ ...found, claim: given["claim"], claim_hash: hash }] })}\n`);
    return okResult({ turns: 3, costEstimateUsd: usd });
  };
  return { stage, specs, max: () => max };
}

const EARLIER = `${JSON.stringify({ planted: "an earlier verdict" })}\n`;

/** Plants `rels` in `copy` as an earlier run's records, and gives a stage that notes, at the first launch, which of them still hold it. */
function planted(copy: string, rels: readonly string[], stage: StageFn): { readonly stage: StageFn; readonly atFirst: () => string[] | null } {
  writeTree(copy, Object.fromEntries(rels.map((rel) => [rel, EARLIER])));
  let atFirst: string[] | null = null;
  return {
    stage: async (spec) => {
      atFirst ??= rels.filter((rel) => existsSync(path.join(copy, rel)) && readFileSync(path.join(copy, rel), "utf8") === EARLIER);
      return await stage(spec);
    },
    atFirst: () => atFirst,
  };
}

const base = (setDir: string, copy: string, stage: StageFn, over: Partial<EvalDeps> = {}): EvalDeps & { notes: string[] } => {
  const notes: string[] = [];
  return {
    setDir,
    copy,
    route: { model: "claude-opus-5-5", effort: "max" },
    budgetUsd: 100,
    atOnce: 4,
    stage: false,
    backend: () => new MockBackend({ audit: stage, spec_review: stage }),
    prompts: PROMPTS,
    runtime: "2.1.285",
    note: (t) => notes.push(t),
    sandbox: async () => await Promise.resolve({ kind: "off" as const, reason: "the test's own" }),
    ...over,
    notes,
  };
};

async function claimsSet(): Promise<{ from: string; setDir: string }> {
  const from = armACopy();
  const setDir = outside();
  buildClaimsSet(from, setDir, { confirmed: 2 });
  return await Promise.resolve({ from, setDir });
}

describe("PRDR-326 an evaluation runs only on a disposable copy whose files are the set's tree (N-8)", () => {
  it("refuses the copy the set was read from, and any worktree of its repository", async () => {
    const { from, setDir } = await claimsSet();
    const stage = checks(() => "wrong").stage;
    await expect(runEvaluation(base(setDir, from, stage))).rejects.toThrow(/is the copy the set was read from, and no evaluation runs there/u);
    const tree = path.join(tmp(), "worktree");
    git(from, "worktree", "add", "-q", tree);
    await expect(runEvaluation(base(setDir, tree, stage))).rejects.toThrow(/is a worktree of the repository the set was read from/u);
  });

  it("refuses a copy whose files are not the set's tree, naming them, unless asked to stage it", async () => {
    const { from, setDir } = await claimsSet();
    const copy = clone(from);
    writeTree(copy, { "docs/prd.md": "# edited\n", "EXTRA.md": "x\n" });
    await expect(runEvaluation(base(setDir, copy, checks(() => "wrong").stage))).rejects.toThrow(/docs\/prd.md changed, EXTRA.md not in the set\. Pass --stage/u);
  });

  it("stages the set's tree as a commit on a branch of its own, leaving the copy's own branch as it was", async () => {
    const { setDir } = await claimsSet();
    const copy = unrelated();
    const main = git(copy, "rev-parse", "main").trim();
    const run = base(setDir, copy, checks(() => "wrong").stage, { stage: true });
    await runEvaluation(run);
    expect(git(copy, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("detent-eval/claims");
    expect(git(copy, "rev-parse", "main").trim()).toBe(main);
    expect(treeDiff(copy, readSet(setDir).tree)).toEqual({ missing: [], changed: [], extra: [] });
    expect(run.notes).toContain(`N-8: the claims set's tree is committed to the branch detent-eval/claims of ${copy}`);
  });

  it("stages nothing over changes no commit holds", async () => {
    const { setDir } = await claimsSet();
    const copy = unrelated();
    writeTree(copy, { "draft.md": "unsaved\n" });
    await expect(runEvaluation(base(setDir, copy, checks(() => "wrong").stage, { stage: true }))).rejects.toThrow(/holds changes no commit has, which staging would lose: draft.md/u);
  });

  it("refuses a copy another process holds", async () => {
    const { from, setDir } = await claimsSet();
    const copy = clone(from);
    const held = acquireRunLock(copy);
    try {
      await expect(runEvaluation(base(setDir, copy, checks(() => "wrong").stage))).rejects.toThrow(new RegExp(`is held by process ${String(process.pid)}`, "u"));
    } finally {
      if (held.ok) held.release();
    }
  });

  it("refuses a set whose area's key the copy's round-1 task does not give", async () => {
    const from = await stoppedCopy();
    const setDir = outside().replace(/claims$/u, "reviews");
    buildReviewsSet(from, setDir, { promptHash: PROMPTS.hashes.spec_review });
    const file = path.join(setDir, "set.json");
    const set = JSON.parse(readFileSync(file, "utf8")) as { areas: { key: string }[] };
    for (const area of set.areas) area.key = "0".repeat(64);
    writeFileSync(file, `${JSON.stringify(set)}\n`);
    await expect(runEvaluation(base(setDir, unrelated(), checks(() => "wrong").stage, { stage: true }))).rejects.toThrow(/is not the one its kept review was given/u);
  });

  it("runs only within a budget above nothing", async () => {
    const { from, setDir } = await claimsSet();
    await expect(runEvaluation(base(setDir, clone(from), checks(() => "wrong").stage, { budgetUsd: 0 }))).rejects.toThrow(/runs only within a budget/u);
  });
});

describe("PRDR-326 a claims evaluation checks each claim as AUDIT does, on the route named (N-8)", () => {
  it("checks every claim on the model and effort named, at most as many at once as asked, each session on the copy's ledger", async () => {
    const { from, setDir } = await claimsSet();
    const set = readSet(setDir);
    const expected = new Map(set.kind === "claims" ? set.claims.map((c) => [c.claim_hash, c.expected]) : []);
    const stub = checks((hash) => expected.get(hash) ?? "unverified");
    const copy = clone(from);
    const run = base(setDir, copy, stub.stage, { route: { model: "claude-opus-5-5", effort: "high" }, atOnce: 2 });
    const results = await runEvaluation(run);

    expect(stub.max()).toBe(2);
    expect(new Set(stub.specs.map((s) => `${s.model} ${String(s.effort)} ${s.role}`))).toEqual(new Set(["claude-opus-5-5 high audit"]));
    expect(results.kind === "claims" ? results.claims.map((c) => c.verdict) : []).toEqual([...expected.values()]);
    const rows = readLedgerRows(copy);
    expect(rows.map((r) => [r.role, r.phase, r.task, r.effort])).toEqual(Array.from({ length: 5 }, () => ["audit", "AUDIT", "verify_claims", "high"]));
    expect(results).toMatchObject({ spend_usd: 10, sessions: 5, budget_usd: 100, route: { model: "claude-opus-5-5", effort: "high" }, runtime: "2.1.285", copy });
    expect(run.notes[0]).toBe(
      "N-8: 5 claim checks on claude-opus-5-5 at high, 2 at once: about $14.30 and 23.4 min, by no figure yet for claude-opus-5-5 at high, " +
        "so the dearest measured one of its kind, $2.86 and 7.8 min on claude-opus-5-5 at max. The budget is $100.00, and no session starts that its figure would take past it",
    );
    expect(report(results, {}).verdict).toBe("pass");
  });

  it("counts the sessions in flight at their figure, and starts none after the budget first refuses one", async () => {
    const { from, setDir } = await claimsSet();
    const stub = checks(() => "wrong", 0);
    const results = await runEvaluation(base(setDir, clone(from), stub.stage, { atOnce: 4, budgetUsd: 6 }));
    expect(stub.specs, "two at $2.86 fit in $6, a third does not, and none starts after").toHaveLength(2);
    expect((results.kind === "claims" ? results.claims : []).filter((c) => c.unfinished !== undefined)).toHaveLength(3);
  });

  it("leaves unfinished only the claim whose session failed, and checks the rest", async () => {
    const { from, setDir } = await claimsSet();
    const set = readSet(setDir);
    const first = set.kind === "claims" ? (set.claims[0]?.claim_hash ?? "") : "";
    const results = await runEvaluation(base(setDir, clone(from), checks(() => "wrong", 2, (hash) => hash === first).stage));
    const claims = results.kind === "claims" ? results.claims : [];
    expect(claims[0]?.unfinished).toMatch(/^a session failed: /u);
    expect(claims.slice(1).every((c) => c.verdict === "wrong")).toBe(true);
  });

  it("counts only the spend of its own sessions, not what the copy's ledger held before", async () => {
    const { from, setDir } = await claimsSet();
    const copy = clone(from);
    writeTree(copy, { ".detent/ledger.jsonl": `${JSON.stringify({ at: "2026-01-01T00:00:00.000Z", ticket: "init", generation: 0, role: "audit", cost_estimate_usd: 50, input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, turns: 1, models: ["claude-opus-5-5"] })}\n` });
    const results = await runEvaluation(base(setDir, copy, checks(() => "wrong").stage, { budgetUsd: 20 }));
    expect(results).toMatchObject({ spend_usd: 10, sessions: 5 });
  });

  it("removes every earlier verdict on a claim of the set from the copy before a session starts, and keeps other claims' briefs", async () => {
    const { from, setDir } = await claimsSet();
    const set = readSet(setDir);
    const copy = clone(from);
    const other = `.detent/research/audit/${"f".repeat(64)}.json`;
    const records = [
      ...(set.kind === "claims" ? set.claims.map((c) => `.detent/research/audit/${c.claim_hash}.json`) : []),
      ".detent/state/audit-claim-0123456789ab.json",
      ".detent/state/AUDIT.json",
      ".detent/runs/init/journal.jsonl",
    ];
    const plant = planted(copy, [...records, other], checks(() => "wrong").stage);
    const run = base(setDir, copy, plant.stage);
    await runEvaluation(run);
    expect(plant.atFirst()).toEqual([other]);
    expect(readFileSync(path.join(copy, other), "utf8")).toBe(EARLIER);
    expect(run.notes[0]).toMatch(/^N-8: 8 records of a verdict on the set's units are removed from the copy, .*: \.detent\/research\/audit\/[0-9a-f]{64}\.json, .*, and 5 more$/u);
  });

  it("keeps in its results the brief each check committed, since the next evaluation on the copy removes it", async () => {
    const { from, setDir } = await claimsSet();
    const set = readSet(setDir);
    const first = set.kind === "claims" ? (set.claims[0]?.claim_hash ?? "") : "";
    const results = await runEvaluation(base(setDir, clone(from), checks((hash) => (hash === first ? "unsure" : "wrong")).stage));
    const claims = results.kind === "claims" ? results.claims : [];
    expect(claims.map((c) => [c.checked, c.brief?.claim_hash, c.brief?.verdict])).toEqual(claims.map((c, i) => (i === 0 ? [false, undefined, undefined] : [true, c.claim_hash, "wrong"])));
  });

  it("checks only the claims arm A found wrong where asked, and is scored on those alone", async () => {
    const { from, setDir } = await claimsSet();
    const stub = checks(() => "wrong");
    const run = base(setDir, clone(from), stub.stage, { only: "wrong" });
    const results = await runEvaluation(run);
    expect(stub.specs).toHaveLength(3);
    expect(results).toMatchObject({ only: "wrong", sessions: 3 });
    expect(results.kind === "claims" ? results.claims.map((c) => c.verdict) : []).toEqual(["wrong", "wrong", "wrong"]);
    expect(run.notes[0]).toMatch(/^N-8: 3 claim checks on claude-opus-5-5 at max, 4 at once: about \$8\.58 /u);
    const scored = report(results, {});
    expect(scored.verdict).toBe("pass");
    expect(scored.text).toMatch(/^N-8: the claims set's wrong claims on claude-opus-5-5 at max: PASS\n {2}wrong claims found wrong: 3 of 3\n/u);
  });

  it("starts no session its figure would take past the budget, and leaves the claims after it unfinished", async () => {
    const { from, setDir } = await claimsSet();
    const stub = checks(() => "wrong");
    const results = await runEvaluation(base(setDir, clone(from), stub.stage, { atOnce: 1, budgetUsd: 6 }));
    expect(stub.specs).toHaveLength(2);
    const claims = results.kind === "claims" ? results.claims : [];
    expect(claims.filter((c) => c.verdict !== undefined)).toHaveLength(2);
    expect(claims.slice(2).map((c) => c.unfinished)).toEqual(Array.from({ length: 3 }, () => "the budget, $6.00: the next session's figure would take the spend past it"));
    expect(results.spend_usd).toBe(4);
    expect(report(results, {}).verdict).toBe("incomplete");
  });
});

describe("PRDR-326 a reviews evaluation reviews each area on the task VALIDATE's round 1 gives it (N-8)", () => {
  async function reviewsRun(severity: string): Promise<{ verdict: string; inputs: Json[] }> {
    const from = await stoppedCopy();
    const setDir = outside().replace(/claims$/u, "reviews");
    buildReviewsSet(from, setDir, { promptHash: PROMPTS.hashes.spec_review });
    const inputs: Json[] = [];
    const stage: StageFn = (spec) => {
      const given = inputsOf(spec) as Json;
      inputs.push(given);
      writeFileSync(spec.artifactOut, `${JSON.stringify(review(given, [at(severity, prdOf(0))]))}\n`);
      return okResult({ turns: 4, costEstimateUsd: 3 });
    };
    const results = await runEvaluation(base(setDir, unrelated(), stage, { stage: true }));
    return { verdict: report(results, {}).verdict, inputs };
  }

  it("passes a reviewer that reports the blocker as a major at its place, given the task the kept review was given", async () => {
    const { verdict, inputs } = await reviewsRun("major");
    expect(verdict).toBe("pass");
    expect(inputs.map((i) => [i["task"], i["round"], i["area"], i["documents"]])).toEqual([["review", 1, `Area ${CODES[0] ?? ""}`, [prdOf(0)]]]);
  });

  it("fails a reviewer that reports it as a minor", async () => {
    expect((await reviewsRun("minor")).verdict).toBe("fail");
  });

  it("removes the copy's kept reviews, review artifacts and VALIDATE's checkpoint before a reviewer starts", async () => {
    const from = await stoppedCopy();
    const setDir = outside().replace(/claims$/u, "reviews");
    buildReviewsSet(from, setDir, { promptHash: PROMPTS.hashes.spec_review });
    const copy = unrelated();
    const records = [".detent/state/validate/reviews-kept.json", ".detent/state/review-artifact-0.json", ".detent/state/VALIDATE.json", ".detent/runs/init/journal.jsonl"];
    const plant = planted(copy, records, (spec) => {
      writeFileSync(spec.artifactOut, `${JSON.stringify(review(inputsOf(spec) as Json, [at("blocker", prdOf(0))]))}\n`);
      return okResult({ turns: 4, costEstimateUsd: 3 });
    });
    const run = base(setDir, copy, plant.stage, { stage: true });
    expect(report(await runEvaluation(run), {}).verdict).toBe("pass");
    expect(plant.atFirst()).toEqual([]);
    expect(run.notes).toContain(
      "N-8: 4 records of a verdict on the set's units are removed from the copy, since no session of AUDIT's or VALIDATE's finds the answer it is asked for: " +
        ".detent/state/validate, .detent/state/review-artifact-0.json, .detent/state/VALIDATE.json, and 1 more",
    );
  });

  it("runs only a claims set on the claims arm A found wrong alone", async () => {
    const from = await stoppedCopy();
    const setDir = outside().replace(/claims$/u, "reviews");
    buildReviewsSet(from, setDir, { promptHash: PROMPTS.hashes.spec_review });
    await expect(runEvaluation(base(setDir, unrelated(), checks(() => "wrong").stage, { stage: true, only: "wrong" }))).rejects.toThrow(/only a claims set is run on the claims arm A found wrong alone/u);
  });
});

describe("PRDR-326 results are scored only against the set they ran on (N-8)", () => {
  it("refuses results that ran on another build of the set, or on a set of the other kind", async () => {
    const { from, setDir } = await claimsSet();
    const results = await runEvaluation(base(setDir, clone(from), checks(() => "wrong").stage, { only: "wrong" }));
    expect(report(results, {}).verdict).toBe("pass");
    const built = readSet(setDir).built.at;
    expect(() => report({ ...results, set: { ...results.set, built_at: "2026-01-01T00:00:00.000Z" } }, {})).toThrow(
      new RegExp(`was built at ${built.replace(/\./gu, "\\.")}, and these results ran on the set built at 2026-01-01T00:00:00\\.000Z`, "u"),
    );
    const reviews = { ...results, kind: "reviews" as const, areas: [] };
    expect(() => report(reviews as unknown as typeof results, {})).toThrow(/these are reviews results, and .* is a claims set/u);
  });
});
