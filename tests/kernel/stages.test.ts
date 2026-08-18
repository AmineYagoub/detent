import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cacheKey, type EnvFingerprint } from "../../src/adapter/env.js";
import { EXIT_HUMAN_GATED, EXIT_OK, run } from "../../src/kernel/run.js";
import { briefCachePath, researchStage } from "../../src/kernel/stages/research.js";
import { REVIEWER_INPUT_KEYS, REVIEWER_TICKET_KEYS } from "../../src/kernel/stages/review.js";
import { readTicket, allTickets } from "../../src/kernel/tickets/readers.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { git, removeTree, writeTree } from "../helpers.js";
import {
  FAIL_OUTPUT,
  addTicket,
  fixGreen,
  implementGreen,
  implementRed,
  makeRunRepo,
  noopFix,
  researchValid,
  reviewApprove,
  reviewChanges,
  writeArtifactStage,
} from "./run-fixture.js";

/**
 * T-043 (diagnosis gate), T-044 (review routing), T-045 (research cache) —
 * six oracle e2e ports plus the stage-level discipline tests.
 */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

async function fixture(): Promise<string> {
  const { root } = await makeRunRepo();
  roots.push(root);
  return root;
}

const opts = (root: string, backend: MockBackend) => ({ root, backend, prompts: PROMPTS, runId: "test" });

/** A diagnose stage that plants the failure and hypothesizes it correctly. */
const diagnoseAsPredicted: StageFn = (spec) => {
  writeTree(spec.cwd, { ".fail": FAIL_OUTPUT });
  return writeArtifactStage({
    schema_version: 1,
    claim: "totals drops the seed row",
    evidence: [{ file: "src/calc.py", line: 2, what: "sum only" }],
    repro_test: "sh scripts/test.sh",
    predicted_failure: "totals mismatch",
    status: "proposed",
  })(spec);
};

describe("T-043 X-4: the kernel executes the repro", () => {
  it("oracle falsified-premise recycle: falsify once → re-diagnose → corrected pass → DONE", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1", type: "bug" });

    const falsify: StageFn = (spec) => {
      const variable = JSON.parse(spec.promptVariable) as { falsified_out: string };
      writeTree(path.dirname(variable.falsified_out), {
        [path.basename(variable.falsified_out)]: JSON.stringify({ note: "the seed row was never dropped" }),
      });
      return okResult();
    };
    const correct: StageFn = (spec) => {
      const wt = spec.cwd;
      writeTree(wt, { "src/feature-t1.txt": "done\n" });
      git(wt, "add", "-A");
      git(wt, "commit", "-q", "-m", "t1: corrected implementation");
      // The fix removes the failure the diagnose stage planted.
      rmSync(path.join(wt, ".fail"), { force: true });
      return okResult();
    };

    const backend = new MockBackend({
      diagnose: diagnoseAsPredicted,
      "implement:0": falsify,
      "implement:1": correct,
      review: reviewApprove,
    });
    const outcome = await run(opts(root, backend));

    expect(outcome.exitCode).toBe(EXIT_OK);
    const t1 = readTicket(root, "t1");
    expect(t1.state).toBe("DONE");
    expect(t1.generations.at(-1)!.counters.hypotheses).toBe(1);
    expect(t1.notes.map((n) => n.text).join(" ")).toContain("falsified mid-implementation");
    expect(backend.rolesLaunched().filter((r) => r === "diagnose")).toHaveLength(2);
  });

  it("oracle hypothesis thrash: three unverifiable hypotheses escalate to a human", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1", type: "bug" });

    // The repro PASSES — the hypothesis never verifies (X-4).
    const wrongHypothesis = writeArtifactStage({
      schema_version: 1,
      claim: "lint is broken",
      evidence: [{ file: "scripts/lint.sh", line: 1, what: "exit 0" }],
      repro_test: "sh scripts/lint.sh",
      predicted_failure: "boom",
      status: "proposed",
    });
    const backend = new MockBackend({ diagnose: wrongHypothesis });
    const outcome = await run(opts(root, backend));

    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    const t1 = readTicket(root, "t1");
    expect(t1.state).toBe("NEEDS_HUMAN");
    expect(t1.generations.at(-1)!.counters.hypotheses).toBe(3);
    expect(backend.rolesLaunched().filter((r) => r === "diagnose")).toHaveLength(3);
    expect(t1.notes.map((n) => n.text).join(" ")).toContain("repro passed");
  });

  it("a verified hypothesis is persisted with status confirmed, and the repro evidence lands in the journal", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1", type: "bug" });

    const backend = new MockBackend({
      diagnose: diagnoseAsPredicted,
      implement: (spec) => {
        rmSync(path.join(spec.cwd, ".fail"), { force: true });
        return implementGreen(spec);
      },
      review: reviewApprove,
    });
    const outcome = await run(opts(root, backend));

    expect(outcome.exitCode).toBe(EXIT_OK);
    const hypothesis = JSON.parse(readFileSync(path.join(root, ".detent/runs/t1/hypothesis.json"), "utf8")) as {
      status: string;
    };
    expect(hypothesis.status).toBe("confirmed");
    const journal = readFileSync(path.join(root, ".detent/transitions.jsonl"), "utf8");
    expect(journal).toContain("REPRO_AS_PREDICTED");
    expect(journal).toContain("as-predicted");
  });
});

describe("T-044 review routing (D-6, A-5)", () => {
  it("oracle changes→fix→approve: one review-fix round-trip reaches DONE", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });

    const backend = new MockBackend({
      implement: implementGreen,
      "review:0": reviewChanges,
      "review:1": reviewApprove,
      review_fix: noopFix,
    });
    const outcome = await run(opts(root, backend));

    expect(outcome.exitCode).toBe(EXIT_OK);
    const t1 = readTicket(root, "t1");
    expect(t1.state).toBe("DONE");
    expect(t1.generations.at(-1)!.counters.review_fix_attempts).toBe(1);
    expect(backend.rolesLaunched().filter((r) => r === "review")).toHaveLength(2);
    expect(backend.rolesLaunched().filter((r) => r === "review_fix")).toHaveLength(1);
  });

  it("oracle repeated-changes escalate: the second changes verdict finds the slot consumed → NEEDS_HUMAN (D-6)", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });

    const backend = new MockBackend({ implement: implementGreen, review: reviewChanges, review_fix: noopFix });
    const outcome = await run(opts(root, backend));

    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    const t1 = readTicket(root, "t1");
    expect(t1.state).toBe("NEEDS_HUMAN");
    // D-6 divergence from the oracle's shared fix pool: review has its OWN
    // unit budget, so the second changes verdict escalates directly.
    expect(t1.generations.at(-1)!.counters.review_fix_attempts).toBe(1);
    expect(t1.generations.at(-1)!.counters.blind_fix_attempts).toBe(0);
  });

  it("the reviewer's input set is closed: diff + criteria + rules + hypothesis, nothing else (SEC-3)", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });

    const backend = new MockBackend({ implement: implementGreen, review: reviewApprove });
    await run(opts(root, backend));

    const reviewCall = backend.calls.find((c) => c.role === "review");
    expect(reviewCall).toBeDefined();
    const variable = JSON.parse(reviewCall!.spec.promptVariable) as { inputs: Record<string, unknown> };
    expect(Object.keys(variable.inputs).sort()).toEqual([...REVIEWER_INPUT_KEYS].sort());
    expect(Object.keys(variable.inputs["ticket"] as object).sort()).toEqual([...REVIEWER_TICKET_KEYS].sort());
    // The rules travel in the stable prefix, not the variable inputs (S-6).
    expect(reviewCall!.spec.promptPrefix).toContain("== RULES ==");
  });

  it("an invalid review artifact is a breaker — never partial acceptance", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });

    const malformed = writeArtifactStage({ schema_version: 1, verdict: "changes", changes: [] });
    const backend = new MockBackend({ implement: implementGreen, review: malformed });
    const outcome = await run(opts(root, backend));

    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    const t1 = readTicket(root, "t1");
    expect(t1.state).toBe("NEEDS_HUMAN");
    expect(t1.notes.map((n) => n.text).join(" ")).toContain("review artifact invalid");
  });
});

describe("T-045 research cache (X-6, D-18)", () => {
  it("oracle cache hit: t1 exhausts and caches the brief; t2's same failure skips the research session entirely", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    addTicket(root, { id: "t2" });

    const backend = new MockBackend({
      implement: implementRed,
      blind_fix: noopFix,
      research: researchValid,
      "t1:informed_fix": noopFix, // t1 exhausts → NEEDS_HUMAN, brief cached
      "t2:informed_fix": fixGreen, // t2 hits the cache, then succeeds
      review: reviewApprove,
    });
    const outcome = await run(opts(root, backend));

    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED); // t1 pending; t2 done
    expect(readTicket(root, "t1").state).toBe("NEEDS_HUMAN");
    expect(readTicket(root, "t2").state).toBe("DONE");

    // Zero research calls for t2; the slot was still consumed on entry (X-2).
    expect(backend.callsFor("t2").map((c) => c.role)).not.toContain("research");
    expect(readTicket(root, "t2").generations.at(-1)!.counters.research_sessions).toBe(1);
    expect(readTicket(root, "t2").notes.map((n) => n.text).join(" ")).toContain("research cache hit");

    // Exactly one brief in the env-keyed cache, shared by both tickets.
    const failures = path.join(root, ".detent/research/failures");
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(failures).filter((f) => f.endsWith(".json"))).toHaveLength(1);
  });

  it("oracle upstream bug: the brief blocks the ticket with a linked discovered ticket", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });

    const upstreamBrief: StageFn = (spec) =>
      writeArtifactStage({
        schema_version: 1,
        failure_signature: "0".repeat(64),
        cache_key: "1".repeat(64),
        root_cause: { claim: "vendored parser bug", confidence: "high" },
        evidence: [{ source: "https://github.com/vendor/lib/issues/99", claim: "same trace upstream" }],
        version_facts: {},
        recommended_fix: { strategy: "wait for upstream or pin a workaround" },
        what_would_falsify: "issue closed as invalid",
        upstream_bug: "https://github.com/vendor/lib/issues/99",
        sources_consulted: [{ tier: 4, ref: "github.com/vendor/lib" }],
        local_search: { docs_checked: ["PRD.md"], code_checked: ["src/calc.py"] },
      })(spec);

    const backend = new MockBackend({ implement: implementRed, blind_fix: noopFix, research: upstreamBrief });
    const outcome = await run(opts(root, backend));

    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    const t1 = readTicket(root, "t1");
    expect(t1.state).toBe("BLOCKED");
    const upstream = allTickets(root).find((t) => t.id === "t1-upstream");
    expect(upstream).toBeDefined();
    expect(upstream!.links).toContainEqual({ rel: "discovered_from", ref: "t1" });
    expect(t1.links).toContainEqual({ rel: "related", ref: "t1-upstream" });
  });

  it("a version_facts contradiction is a cache MISS — the same key under a changed environment re-researches (X-6)", async () => {
    const root = await fixture();
    const envA: EnvFingerprint = {
      ecosystems: [],
      lockfile_hash: "a".repeat(64),
      runtime_version: "node 22.0.0",
      version_facts: { node: "22.0.0" },
    };
    const envB: EnvFingerprint = { ...envA, version_facts: { node: "24.1.0" } };
    const signature = "f".repeat(64);
    const key = cacheKey(signature, envA);

    writeTree(path.dirname(briefCachePath(root, key)), {
      [path.basename(briefCachePath(root, key))]: JSON.stringify({
        schema_version: 1,
        failure_signature: signature,
        cache_key: key,
        root_cause: { claim: "stale", confidence: "low" },
        evidence: [{ source: "src/x.py", claim: "old world" }],
        version_facts: { node: "22.0.0" },
        recommended_fix: { strategy: "old strategy" },
        what_would_falsify: "anything",
        local_search: { docs_checked: ["a"], code_checked: [] },
      }),
    });

    let launches = 0;
    const outcome = await researchStage({
      root,
      launch: async () => {
        launches += 1;
      },
      readArtifact: () => null,
      readFailureSignature: () => signature,
      toolCallCeiling: 8,
      note: () => {},
      env: async () => envB, // same lockfile+runtime → same KEY, contradicting facts
      ticketInputs: {},
    });

    expect(launches).toBe(1); // the hit was refused; a live session ran
    expect(outcome.cached).toBe(false);
  });

  it("a changed lockfile is a different key — fresh research, never the old brief (D-18)", () => {
    const envA: EnvFingerprint = { ecosystems: [], lockfile_hash: "a".repeat(64), runtime_version: "node 22", version_facts: {} };
    const envB: EnvFingerprint = { ...envA, lockfile_hash: "b".repeat(64) };
    const signature = "e".repeat(64);
    expect(cacheKey(signature, envA)).not.toBe(cacheKey(signature, envB));
  });
});
