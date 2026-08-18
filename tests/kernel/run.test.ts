import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifySync } from "../../src/cli/verify.js";
import { dossierSchema, ledgerRowSchema, transitionLineSchema } from "../../src/schemas/records.js";
import {
  EXIT_ERROR,
  EXIT_HUMAN_GATED,
  EXIT_NOT_READY,
  EXIT_OK,
  run,
  runWithConfig,
  type RunOptions,
} from "../../src/kernel/run.js";
import { RunJournal } from "../../src/kernel/journal.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { prefixHash } from "../../src/sessions/backend.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { git, removeTree, writeTree } from "../helpers.js";
import {
  addTicket,
  fixGreen,
  implementGreen,
  implementRed,
  makeRunRepo,
  noopFix,
  researchValid,
  reviewApprove,
} from "./run-fixture.js";

/**
 * T-041 — the kernel run loop. Four oracle e2e ports plus the plan's AC
 * fixtures. Oracle-shape divergences are the PRD's, recorded in the parity
 * map: the merge-into-main assertion becomes B-1's run branch; the oracle's
 * `fix` role is `blind_fix` (PRDR-044); triage did not survive D-10, so its
 * test splits into the approval precheck and the human-gated exit.
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

function opts(root: string, backend: MockBackend, over: Partial<RunOptions> = {}): RunOptions {
  return { root, backend, prompts: PROMPTS, runId: "test", ...over };
}

const transitions = (root: string) =>
  readFileSync(path.join(root, ".detent/transitions.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => transitionLineSchema.parse(JSON.parse(line)));

describe("T-041 oracle happy path (test_feature_to_done_and_merged)", () => {
  it("a feature ticket reaches DONE on the run branch; the base branch is untouched", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    const baseSha = git(root, "rev-parse", "main").trim();

    const backend = new MockBackend({ implement: implementGreen, review: reviewApprove });
    const outcome = await run(opts(root, backend));

    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(readTicket(root, "t1").state).toBe("DONE");
    // B-1 supersedes the oracle's merge-into-main: work lands on the run
    // branch, and the base SHA is byte-identical (P7).
    expect(existsSync(path.join(root, "src/feature-t1.txt"))).toBe(true);
    expect(git(root, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("detent/run-test");
    expect(git(root, "rev-parse", "main").trim()).toBe(baseSha);

    // The transition log exists, is schema-valid, and starts at READY|CLAIMED.
    const log = transitions(root);
    expect(log[0]).toMatchObject({ ticket: "t1", from: "READY", event: "CLAIMED", to: "IN_PROGRESS" });
    expect(log.at(-1)).toMatchObject({ event: "GATE_GREEN", to: "DONE" });

    // S-6: one stable prefix hash per role within the run.
    const byRole = new Map<string, Set<string>>();
    for (const call of backend.calls) {
      const set = byRole.get(call.role) ?? new Set<string>();
      set.add(prefixHash(call.spec));
      byRole.set(call.role, set);
    }
    expect(byRole.size).toBeGreaterThanOrEqual(2);
    for (const [role, hashes] of byRole) expect(hashes.size, role).toBe(1);

    // Ledger rows are schema-valid and cover every launch.
    const rows = readFileSync(path.join(root, ".detent/ledger.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => ledgerRowSchema.parse(JSON.parse(line)));
    expect(rows).toHaveLength(backend.calls.length);
    // Generation closed as done, counters preserved.
    const t1 = readTicket(root, "t1");
    expect(t1.generations.at(-1)).toMatchObject({ outcome: "done" });
    expect(t1.generations.at(-1)?.counters.sessions).toBe(backend.calls.length);
  });
});

describe("T-041 oracle full ladder (test_ladder_exhausts_to_needs_human_with_dossier)", () => {
  it("implement red → blind fix → research → informed fix → NEEDS_HUMAN, one launch per slot", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });

    const backend = new MockBackend({
      implement: implementRed,
      blind_fix: noopFix,
      research: researchValid,
      informed_fix: noopFix,
    });
    const outcome = await run(opts(root, backend));

    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(outcome.summary.pending.map((p) => p.id)).toEqual(["t1"]);

    const t1 = readTicket(root, "t1");
    expect(t1.state).toBe("NEEDS_HUMAN");
    // PRD §13 counter mapping: the oracle's fix_sessions == 2 is
    // (blind, informed) == (1, 1); research_sessions carries over.
    const counters = t1.generations.at(-1)!.counters;
    expect(counters.blind_fix_attempts).toBe(1);
    expect(counters.informed_fix_attempts).toBe(1);
    expect(counters.research_sessions).toBe(1);
    expect(counters.sessions).toBe(4); // implement + blind + research + informed

    const roles = backend.rolesLaunched();
    expect(roles.filter((r) => r === "blind_fix")).toHaveLength(1);
    expect(roles.filter((r) => r === "informed_fix")).toHaveLength(1);
    expect(roles.filter((r) => r === "research")).toHaveLength(1);

    // The dossier exists and validates (A-8); the failure record is on disk.
    // The oracle also asserted the research brief was cached — that is D-18's
    // env-keyed cache now, and closes at T-045.
    const dossier = dossierSchema.parse(
      JSON.parse(readFileSync(path.join(root, ".detent/runs/t1/dossier.json"), "utf8")),
    );
    expect(dossier.suggested_resolutions.length).toBeGreaterThan(0);
    expect(existsSync(path.join(root, ".detent/runs/t1/last_failure.json"))).toBe(true);
    expect(readTicket(root, "t1").generations.at(-1)).toMatchObject({ outcome: "needs_human" });
  });
});

describe("T-041 oracle crash-resume (test_no_second_blind_fix_after_crash)", () => {
  it("a crash during the blind fix never buys a second one; resume enters RESEARCH", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });

    const crashingFix: StageFn = () => {
      throw new Error("simulated crash");
    };
    const script = {
      implement: implementRed,
      blind_fix: crashingFix,
      research: researchValid,
      informed_fix: fixGreen,
      review: reviewApprove,
    };

    const first = new MockBackend(script);
    const crashed = await run(opts(root, first));
    expect(crashed.exitCode).toBe(EXIT_ERROR);
    expect(crashed.summary.reason).toContain("simulated crash");

    // The crash left the ticket mid-BLIND_FIX with the launch already charged
    // (B-5: count before launch) and an unterminated journal entry.
    const mid = readTicket(root, "t1");
    expect(mid.state).toBe("BLIND_FIX");
    expect(mid.generations.at(-1)!.counters.blind_fix_attempts).toBe(1);
    expect(mid.generations.at(-1)!.counters.sessions).toBe(2);

    // Resume with a FRESH kernel over the same store and backend.
    const second = new MockBackend(script);
    const resumed = await run(opts(root, second));
    expect(resumed.exitCode).toBe(EXIT_OK);
    expect(readTicket(root, "t1").state).toBe("DONE");

    // Exactly one blind-fix launch EVER, across both processes; the informed
    // fix legitimately consumes the second slot after research.
    const blindLaunches = [...first.rolesLaunched(), ...second.rolesLaunched()].filter((r) => r === "blind_fix");
    expect(blindLaunches).toHaveLength(1);
    expect(second.rolesLaunched()).not.toContain("blind_fix");
    expect(second.rolesLaunched().filter((r) => r === "informed_fix")).toHaveLength(1);

    const journal = readFileSync(path.join(root, ".detent/runs/t1/journal.jsonl"), "utf8");
    expect(journal).toContain("skipped_after_crash");

    const counters = readTicket(root, "t1").generations.at(-1)!.counters;
    expect(counters.blind_fix_attempts).toBe(1);
    expect(counters.informed_fix_attempts).toBe(1);
    expect(counters.research_sessions).toBe(1);
  });
});

describe("T-041 the triage translation (test_triage_unverified_blocks)", () => {
  // The oracle's triage stage did not survive the PRD: D-10 moved planning to
  // init. The preserved properties are (a) work never starts on an unverified
  // premise — C-9 executes only an approved plan — and (b) human-gated items
  // surface as exit 10 with a machine-readable summary.
  it("an unapproved plan runs nothing: exit 2, zero sessions launched", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    rmSync(path.join(root, ".detent/plan/approval.json"));

    const backend = new MockBackend({ implement: implementGreen });
    const outcome = await run(opts(root, backend));

    expect(outcome.exitCode).toBe(EXIT_NOT_READY);
    expect(outcome.summary.reason).toContain("approved plan");
    expect(backend.calls).toHaveLength(0);
    expect(readTicket(root, "t1").state).toBe("READY");
  });

  it("a human-gated pool exits 10 with the blocked ticket in the summary", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    addTicket(root, { id: "t2" });
    // t2 is blocked out-of-band (the shape UPSTREAM_BUG produces).
    const t2 = readTicket(root, "t2");
    writeFileSync(
      path.join(root, ".detent/plan/t2.json"),
      `${JSON.stringify({ ...t2, state: "BLOCKED" }, null, 2)}\n`,
    );

    const backend = new MockBackend({ implement: implementGreen, review: reviewApprove });
    const outcome = await run(opts(root, backend));

    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(readTicket(root, "t1").state).toBe("DONE");
    expect(outcome.summary.pending).toEqual([{ id: "t2", state: "BLOCKED", reason: "" }]);
  });
});

describe("T-041 X-1 enforcement fixtures", () => {
  it("the ticket wall clock trips BUDGET_BREACH → NEEDS_HUMAN with a dossier", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });

    // First reading arms the clock; every later reading is past the ceiling.
    let calls = 0;
    const now = () => (calls++ === 0 ? 0 : 4_000_000);
    const backend = new MockBackend({ implement: implementGreen });
    const outcome = await run(opts(root, backend, { now }));

    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    const t1 = readTicket(root, "t1");
    expect(t1.state).toBe("NEEDS_HUMAN");
    expect(t1.notes.map((n) => n.text).join(" ")).toContain("wall clock");
    expect(existsSync(path.join(root, ".detent/runs/t1/dossier.json"))).toBe(true);
    expect(transitions(root).at(-1)).toMatchObject({ event: "BUDGET_BREACH", to: "NEEDS_HUMAN" });
  });

  it("the net-sessions backstop trips at launch (unreachable via loadConfig — tested via runWithConfig)", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });

    const loaded = {
      config: {
        schema_version: 1 as const,
        budgets: {
          blind_fix_attempts: 1 as const,
          informed_fix_attempts: 1 as const,
          review_fix_attempts: 1,
          research_sessions: 1 as const,
          hypotheses: 2,
          sessions: 1,
          ticket_wall_clock_ms: 3_600_000,
          turns_per_stage: 30,
          failure_research_tool_calls: 8,
          planning_research_tool_calls: 16,
          flake_reruns: 1,
          gate_timeout_ms: 900_000,
          binding_probe_timeout_ms: 120_000,
          run_spend_usd: 999,
        },
        protected: [],
        risk: [],
        model_routing: {},
        pinned: { agent_sdk: "0.3.191", claude_code: "2.1.191" },
        setting_sources: [],
      },
      computedWorstCase: 14,
    };

    const backend = new MockBackend({ implement: implementRed });
    const outcome = await runWithConfig(opts(root, backend), loaded);

    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    // Exactly one launch (implement); the blind fix was refused at launch.
    expect(backend.calls.map((c) => c.role)).toEqual(["implement"]);
    const t1 = readTicket(root, "t1");
    expect(t1.state).toBe("NEEDS_HUMAN");
    expect(t1.notes.map((n) => n.text).join(" ")).toContain("net session ceiling");
  });
});

describe("T-041 drift halt (V-3/D-23, plan 1.7)", () => {
  it("mid-run drift applies GATE_DRIFT, releases the claim, exits 2; sync + rerun requeues and finishes", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });

    // The implement session edits the Makefile's test recipe — a gate
    // redefinition by a session, which SEC-5 treats as tampering.
    const tamper: StageFn = (spec) => {
      const makefile = readFileSync(path.join(spec.cwd, "Makefile"), "utf8");
      writeTree(spec.cwd, { Makefile: makefile.replace("sh scripts/test.sh", "sh scripts/test.sh # tampered") });
      return implementGreen(spec);
    };
    const backend = new MockBackend({ implement: tamper, review: reviewApprove });
    const outcome = await run(opts(root, backend));

    expect(outcome.exitCode).toBe(EXIT_NOT_READY);
    expect(outcome.summary.reason).toContain("re-baseline");

    const t1 = readTicket(root, "t1");
    expect(t1.state).toBe("BLOCKED");
    expect(existsSync(path.join(root, ".detent/claims/t1.claim"))).toBe(false);
    // Reconstructable from the journal: GATE_DRIFT rows, which a crash never leaves.
    expect(transitions(root).at(-1)).toMatchObject({ event: "GATE_DRIFT", to: "BLOCKED" });

    // The human re-baselines via verify sync (the consent IS the human act)...
    const synced = await verifySync(root, { consent: async () => true });
    expect(synced.exitCode).toBe(0);

    // ...and the next run requeues the drift-blocked ticket into a fresh
    // generation whose reason records the drift, then completes it.
    const second = new MockBackend({ implement: implementGreen, review: reviewApprove });
    const resumed = await run(opts(root, second));
    expect(resumed.exitCode).toBe(EXIT_OK);

    const finished = readTicket(root, "t1");
    expect(finished.state).toBe("DONE");
    expect(finished.generations).toHaveLength(2);
    expect(finished.generations[0]).toMatchObject({ outcome: "requeued" });
    expect(finished.generations[1]?.reason).toContain("drift");
  });
});

describe("T-041 exit codes are public API (C-11)", () => {
  it("exit 0 when the queue drains", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    const outcome = await run(opts(root, new MockBackend({ implement: implementGreen, review: reviewApprove })));
    expect(outcome.exitCode).toBe(0);
  });

  it("exit 1 on a kernel error, with the reason in the summary", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    writeFileSync(path.join(root, ".detent/plan/t1.json"), "{ not json");
    const outcome = await run(opts(root, new MockBackend()));
    expect(outcome.exitCode).toBe(EXIT_ERROR);
    expect(outcome.summary.reason).toBeTruthy();
  });

  it("exit 2 when config is missing or rejected", async () => {
    const root = await fixture();
    rmSync(path.join(root, ".detent/config.json"));
    const outcome = await run(opts(root, new MockBackend()));
    expect(outcome.exitCode).toBe(EXIT_NOT_READY);
    expect(outcome.summary.reason).toContain("config");
  });

  it("exit 10's summary is machine-readable and schema-stable", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    const outcome = await run(
      opts(root, new MockBackend({ implement: implementRed, blind_fix: noopFix, research: researchValid, informed_fix: noopFix })),
    );
    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    const parsed = JSON.parse(JSON.stringify(outcome.summary)) as typeof outcome.summary;
    expect(parsed.schema_version).toBe(1);
    expect(parsed.pending[0]).toMatchObject({ id: "t1", state: "NEEDS_HUMAN" });
  });
});

describe("T-041 stale claims never spin the loop (C-9/C-12)", () => {
  it("a claimed in-flight ticket is skipped, not retried forever; the rest of the pool completes", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    addTicket(root, { id: "t2" });
    // t1 sits mid-flight under another worker's claim (e.g. a kill -9 left it).
    const t1 = readTicket(root, "t1");
    writeFileSync(path.join(root, ".detent/plan/t1.json"), `${JSON.stringify({ ...t1, state: "IN_PROGRESS" }, null, 2)}\n`);
    writeFileSync(path.join(root, ".detent/claims/t1.claim"), JSON.stringify({ owner: "w9", pid: 1, at: "x" }));

    const backend = new MockBackend({ implement: implementGreen, review: reviewApprove });
    const outcome = await run(opts(root, backend));

    // t2 finished; t1 was left alone — breaking a stale claim is plumbing's
    // job (T-055), and the loop never guesses about another process.
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(readTicket(root, "t2").state).toBe("DONE");
    expect(readTicket(root, "t1").state).toBe("IN_PROGRESS");
    expect(backend.callsFor("t1")).toHaveLength(0);
  });
});

describe("T-041 F-1 single-writer (R-8)", () => {
  it("a second journal on the same root is refused while the first is open", async () => {
    const root = await fixture();
    const journal = RunJournal.open(root);
    try {
      expect(() => RunJournal.open(root)).toThrow(/single-writer/);
    } finally {
      journal.close();
    }
    // Closed → reopenable (a later run is a new single writer).
    const again = RunJournal.open(root);
    again.close();
  });

  it("malformed rows can never land in the journals — lines validate before append", async () => {
    const root = await fixture();
    const journal = RunJournal.open(root);
    try {
      expect(() =>
        journal.appendTransition({
          // @ts-expect-error deliberately malformed
          at: 12345,
          ticket: "t1",
        }),
      ).toThrow();
    } finally {
      journal.close();
    }
  });
});

describe("T-041 S-4 breaker in the loop", () => {
  it("unparsable telemetry is budget-breaching → NEEDS_HUMAN", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    const backend = new MockBackend({ implement: () => okResult({ telemetryParsed: false }) });
    const outcome = await run(opts(root, backend));
    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    const t1 = readTicket(root, "t1");
    expect(t1.state).toBe("NEEDS_HUMAN");
    expect(t1.notes.map((n) => n.text).join(" ")).toContain("telemetry");
  });
});
