import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FALSIFIED_NOTE } from "../../src/kernel/dependency.js";
import { ZERO_COUNTERS } from "../../src/kernel/generations.js";
import { apply, isLegal, TABLE, transitionKey } from "../../src/kernel/machine.js";
import { EXIT_HUMAN_GATED, EXIT_OK, run } from "../../src/kernel/run.js";
import { strandedByPremise } from "../../src/kernel/referee-sweeps.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { maxPossibleSessions } from "../../src/kernel/worstcase.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { STATES } from "../../src/schemas/states.js";
import type { Counters } from "../../src/schemas/ticket.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { MockBackend, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { ctx, DEFAULT_BUDGETS, removeTree, writeTree } from "../helpers.js";
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
 * PRDR-289 — X-3′ (PRDR-278): a fix session may declare a false premise.
 *
 * The three fix prompts gave a session the signal's shape, `{"note"}` at
 * `falsified_out` (X-4), and the referee read the file only after an
 * IN_PROGRESS session, because X-3 admitted PREMISE_FALSIFIED from there
 * alone. A blind, informed or review fix that found its criterion could not
 * be met as specified wrote the signal, the ladder went on as if it had not,
 * and the next launch deleted it: gate-313's t-s01-004 review fix did exactly
 * that (PRDR-225). The operator decided that implement and the three fix roles
 * may all declare one (decision 12), so each fix state has IN_PROGRESS's two
 * rows, and the referee reads the signal after each.
 */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

async function repo(): Promise<string> {
  const { root } = await makeRunRepo();
  roots.push(root);
  return root;
}

/** Writes `signal` at the path the session's inputs give for the falsified signal. */
function writeSignal(spec: SessionSpec, signal: object): void {
  const { falsified_out: out } = JSON.parse(spec.promptVariable) as { falsified_out: string };
  writeTree(path.dirname(out), { [path.basename(out)]: JSON.stringify(signal) });
}

/** A session that writes the signal, then does what `then` does. */
const signalling =
  (signal: object, then: StageFn = noopFix): StageFn =>
  (spec) => {
    writeSignal(spec, signal);
    return then(spec);
  };

/** The moves the referee admitted, in order. */
function moves(root: string): { from: string; event: string; to: string }[] {
  return readFileSync(path.join(root, ".detent/transitions.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { from: string; event: string; to: string })
    .map(({ from, event, to }) => ({ from, event, to }));
}

const notes = (root: string, id: string): string[] => readTicket(root, id).notes.map((n) => n.text);

/** A diagnose session that plants the failure and hypothesizes it correctly, as in stages.test.ts. */
const diagnoseAsPredicted: StageFn = (spec) => {
  writeTree(spec.cwd, { ".fail": FAIL_OUTPUT });
  return writeArtifactStage({
    schema_version: SCHEMA_VERSION,
    claim: "totals drops the seed row",
    evidence: [{ file: "src/calc.py", line: 2, what: "sum only" }],
    repro_test: "sh scripts/test.sh",
    predicted_failure: "totals mismatch",
    status: "proposed",
  })(spec);
};

const FIX_STATES = ["BLIND_FIX", "INFORMED_FIX", "REVIEW_FIX"] as const;

/** The counters a ticket carries on entering each fix state. */
const ENTERED: Record<(typeof FIX_STATES)[number], Counters> = {
  BLIND_FIX: { ...ZERO_COUNTERS, blind_fix_attempts: 1 },
  INFORMED_FIX: { ...ZERO_COUNTERS, blind_fix_attempts: 1, research_sessions: 1, informed_fix_attempts: 1 },
  REVIEW_FIX: { ...ZERO_COUNTERS, review_fix_attempts: 1 },
};

describe("X-3′ the table admits a false premise from each fix state", () => {
  it("PREMISE_FALSIFIED has IN_PROGRESS's outcome from each fix state, for a feature and for a bug", () => {
    for (const from of FIX_STATES) {
      const spent = { ...ENTERED[from], hypotheses: DEFAULT_BUDGETS.hypotheses };
      for (const type of ["feature", "bug"] as const) {
        for (const counters of [ENTERED[from], spent]) {
          const got = apply(from, "PREMISE_FALSIFIED", counters, ctx(type));
          const want = apply("IN_PROGRESS", "PREMISE_FALSIFIED", counters, ctx(type));
          expect([got.to, got.counters], `${from}, ${type}, hypotheses ${String(counters.hypotheses)}`).toEqual([want.to, want.counters]);
        }
      }
      /* Spelled out, so the comparison cannot pass with both sides wrong. */
      expect(apply(from, "PREMISE_FALSIFIED", ENTERED[from], ctx("feature")).to, from).toBe("NEEDS_HUMAN");
      const bug = apply(from, "PREMISE_FALSIFIED", ENTERED[from], ctx("bug"));
      expect([bug.to, bug.counters], from).toEqual(["DIAGNOSED", { ...ENTERED[from], hypotheses: 1 }]);
      expect(apply(from, "PREMISE_FALSIFIED", spent, ctx("bug")).to, `${from}, past the hypotheses budget`).toBe("NEEDS_HUMAN");
    }
  });

  it("DEPENDENCY_DISCOVERED returns the ticket to the pool from each fix state, as from IN_PROGRESS (X-4′)", () => {
    for (const from of FIX_STATES) {
      const r = apply(from, "DEPENDENCY_DISCOVERED", ENTERED[from], ctx());
      expect([r.to, r.counters], from).toEqual(["READY", ENTERED[from]]);
    }
  });

  it("no other state admits either, and the oversized signal stays IN_PROGRESS's alone", () => {
    /* Review, diagnose and research stay read-only (decision 12); X-4″ is a non-goal here. */
    const four = ["IN_PROGRESS", "BLIND_FIX", "INFORMED_FIX", "REVIEW_FIX"];
    expect(STATES.filter((s) => isLegal(s, "PREMISE_FALSIFIED"))).toEqual(four);
    expect(STATES.filter((s) => isLegal(s, "DEPENDENCY_DISCOVERED"))).toEqual(four);
    expect(STATES.filter((s) => isLegal(s, "TICKET_OVERSIZED"))).toEqual(["IN_PROGRESS"]);
  });

  it("X-1's worst case does not move: 24 for a bug and 19 for a feature, with the six rows and without them", () => {
    /* A fix session's false premise spends a hypothesis as an implementer's does, and the rungs it spent stay spent. */
    const without = new Map(TABLE);
    for (const from of FIX_STATES) {
      for (const event of ["PREMISE_FALSIFIED", "DEPENDENCY_DISCOVERED"] as const) expect(without.delete(transitionKey(from, event)), `${from} ${event}`).toBe(true);
    }
    for (const [type, figure] of [["bug", 24], ["feature", 19]] as const) {
      expect(maxPossibleSessions(DEFAULT_BUDGETS, { ticketType: type }), type).toBe(figure);
      expect(maxPossibleSessions(DEFAULT_BUDGETS, { ticketType: type, table: without }), `${type}, without the rows`).toBe(figure);
    }
  });
});

describe("the fix prompts describe the signal the referee reads", () => {
  it("each gives the signal's three shapes and says to end the session, and none says X-3 admits it only mid-implementation", () => {
    for (const role of FIX_STATES.map((s) => s.toLowerCase() as "blind_fix" | "informed_fix" | "review_fix")) {
      const text = PROMPTS.prompts[role];
      for (const token of ["`falsified_out`", '"missing"', '"retracted": true', "END the session", "X-3′"]) expect(text, `${role}: ${token}`).toContain(token);
      expect(text, role).not.toMatch(/only mid-implementation/u);
    }
  });
});

describe("the referee reads the signal after each fix session", () => {
  it("BLIND_FIX: a feature's false premise goes to a human at once, and the ladder spends nothing more", { timeout: 60_000 }, async () => {
    const root = await repo();
    addTicket(root, { id: "t1" });
    const backend = new MockBackend({
      implement: implementRed,
      blind_fix: signalling({ note: "the criterion asks for a total the schema cannot hold" }),
      research: researchValid,
      informed_fix: noopFix,
    });

    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "blind" });

    /* Before PRDR-289 the signal was never read: research and the informed fix ran, and D-13's red edge escalated. */
    expect(backend.rolesLaunched()).toEqual(["implement", "blind_fix"]);
    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(readTicket(root, "t1").state).toBe("NEEDS_HUMAN");
    expect(moves(root).at(-1)).toEqual({ from: "BLIND_FIX", event: "PREMISE_FALSIFIED", to: "NEEDS_HUMAN" });
    expect(notes(root, "t1")).toContain(`${FALSIFIED_NOTE}the criterion asks for a total the schema cannot hold`);
    expect(existsSync(path.join(root, ".detent/runs/t1/falsified.json")), "consumed, as after IN_PROGRESS").toBe(false);
    /* X-3″: the note keeps its words, so X-4⁶ re-tests this premise after a toolchain install as it would an implementer's. */
    expect(strandedByPremise(root)).toEqual([{ id: "t1", reason: "the criterion asks for a total the schema cannot hold" }]);
  });

  it("INFORMED_FIX: the false premise is admitted, not D-13's red edge", { timeout: 60_000 }, async () => {
    const root = await repo();
    addTicket(root, { id: "t1" });
    const backend = new MockBackend({
      implement: implementRed,
      blind_fix: noopFix,
      research: researchValid,
      informed_fix: signalling({ note: "the brief's falsifying condition holds: the totals are right and the criterion is not" }),
    });

    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "informed" });

    /* Before PRDR-289 the ticket reached a human too, by the red gate, with D-13's reason and not the session's. */
    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(moves(root).at(-1)).toEqual({ from: "INFORMED_FIX", event: "PREMISE_FALSIFIED", to: "NEEDS_HUMAN" });
    expect(notes(root, "t1")).toContain(`${FALSIFIED_NOTE}the brief's falsifying condition holds: the totals are right and the criterion is not`);
    /* The informed fix's gate never ran, so nothing says the ladder cannot reopen. */
    expect(notes(root, "t1").join(" ")).not.toContain("the ladder cannot reopen");
  });

  it("REVIEW_FIX: a finding that shows the criterion wrong reaches a human, not the next review", { timeout: 60_000 }, async () => {
    const root = await repo();
    addTicket(root, { id: "t1" });
    const backend = new MockBackend({
      implement: implementGreen,
      "review:0": reviewChanges,
      "review:1": reviewApprove,
      review_fix: signalling({ note: "the finding is right, and the criterion forbids its fix" }),
    });

    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "review" });

    /* Before PRDR-289 the fix was gated green, the second review approved, and the ticket closed DONE. */
    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(readTicket(root, "t1").state).toBe("NEEDS_HUMAN");
    expect(backend.rolesLaunched()).toEqual(["implement", "review", "review_fix"]);
    expect(moves(root).at(-1)).toEqual({ from: "REVIEW_FIX", event: "PREMISE_FALSIFIED", to: "NEEDS_HUMAN" });
  });

  it("BLIND_FIX on a bug: the ticket returns to diagnosis with a hypothesis spent, and a corrected diagnosis runs to DONE", { timeout: 60_000 }, async () => {
    const root = await repo();
    addTicket(root, { id: "t1", type: "bug" });
    const backend = new MockBackend({
      diagnose: diagnoseAsPredicted,
      "implement:0": implementRed,
      "implement:1": (spec) => {
        rmSync(path.join(spec.cwd, ".fail"), { force: true });
        return implementGreen(spec);
      },
      blind_fix: signalling({ note: "the hypothesis does not hold: the seed row is summed" }),
      research: researchValid,
      informed_fix: noopFix,
      review: reviewApprove,
    });

    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "bug" });

    /* Before PRDR-289 the ladder ran on to research and the informed fix, and a human. */
    expect(outcome.exitCode).toBe(EXIT_OK);
    const t1 = readTicket(root, "t1");
    expect(t1.state).toBe("DONE");
    expect(moves(root)).toContainEqual({ from: "BLIND_FIX", event: "PREMISE_FALSIFIED", to: "DIAGNOSED" });
    expect(t1.generations).toHaveLength(1);
    expect(t1.generations[0]?.counters.hypotheses).toBe(1);
    expect(backend.rolesLaunched()).toEqual(["diagnose", "implement", "blind_fix", "diagnose", "implement", "review"]);
  });
});

describe("`missing` and a retraction mean after a fix session what they mean after IN_PROGRESS", () => {
  it("X-4′: a blind fix that names a sibling's path waits for the sibling, then runs to DONE", { timeout: 120_000 }, async () => {
    const root = await repo();
    addTicket(root, { id: "t-a", surface: ["src/a/**", "src/feature-t-a.txt"] });
    addTicket(root, { id: "t-b", surface: ["src/b/**", "src/feature-t-b.txt"] });
    const backend = new MockBackend({
      "t-a:implement:0": implementRed,
      "t-a:implement:1": implementGreen,
      /* The fixture's tickets share one checkout, so the fix clears its failure before it names what it lacks. */
      "t-a:blind_fix": signalling({ note: "the totals need the ledger t-b builds", missing: ["src/b/lib.ts"] }, fixGreen),
      implement: implementGreen,
      review: reviewApprove,
    });

    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "dep" });

    /* Before PRDR-289 the blind fix was gated green and t-a closed at once, waiting on nothing. */
    expect(outcome.exitCode).toBe(EXIT_OK);
    const ta = readTicket(root, "t-a");
    expect(ta.state).toBe("DONE");
    expect(ta.waits_on).toEqual(["t-b"]);
    expect(moves(root)).toContainEqual({ from: "BLIND_FIX", event: "DEPENDENCY_DISCOVERED", to: "READY" });
    expect(ta.generations.map((g) => g.outcome)).toEqual(["blocked", "done"]);
    expect(backend.calls.filter((c) => c.role === "implement").map((c) => c.ticketId)).toEqual(["t-a", "t-b", "t-a"]);
  });

  it("X-4′: a review fix that names a path nobody builds is a human's, and the note says which path", { timeout: 60_000 }, async () => {
    const root = await repo();
    addTicket(root, { id: "t1" });
    const backend = new MockBackend({
      implement: implementGreen,
      "review:0": reviewChanges,
      "review:1": reviewApprove,
      review_fix: signalling({ note: "the finding needs a module no ticket builds", missing: ["src/zzz/none.ts"] }),
    });

    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "unowned" });

    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(readTicket(root, "t1").waits_on).toEqual([]);
    expect(moves(root).at(-1)).toEqual({ from: "REVIEW_FIX", event: "PREMISE_FALSIFIED", to: "NEEDS_HUMAN" });
    expect(notes(root, "t1").join(" ")).toContain("no ticket's surface owns src/zzz/none.ts");
  });

  it("X-4‴: an informed fix that retracts its signal goes on, and the withdrawal is on the record", { timeout: 60_000 }, async () => {
    const root = await repo();
    addTicket(root, { id: "t1" });
    const backend = new MockBackend({
      implement: implementRed,
      blind_fix: noopFix,
      research: researchValid,
      informed_fix: signalling({ retracted: true, note: "the brief was right after all, and the fix is in" }, fixGreen),
      review: reviewApprove,
    });

    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "retracted" });

    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(readTicket(root, "t1").state).toBe("DONE");
    /* Before PRDR-289 the ticket closed the same way, and the retraction was never read: nothing recorded it. */
    expect(notes(root, "t1")).toContain("falsification withdrawn by the session: the brief was right after all, and the fix is in");
    expect(readFileSync(path.join(root, ".detent/runs/t1/journal.jsonl"), "utf8")).toContain('"event":"falsification_withdrawn"');
  });
});

describe("what stays as it was", () => {
  it("X-4″: an oversized signal a fix session writes is not read (a non-goal)", { timeout: 60_000 }, async () => {
    const root = await repo();
    addTicket(root, { id: "t1" });
    const backend = new MockBackend({
      implement: implementRed,
      blind_fix: (spec) => {
        const { oversized_out: out } = JSON.parse(spec.promptVariable) as { oversized_out: string };
        writeTree(path.dirname(out), { [path.basename(out)]: JSON.stringify({ note: "two tickets' work", split: ["the ledger", "the report"] }) });
        return fixGreen(spec);
      },
      review: reviewApprove,
    });

    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "oversized" });

    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(readTicket(root, "t1").state).toBe("DONE");
    expect(notes(root, "t1").join(" ")).not.toContain("oversized (X-4″)");
  });

  it("PRDR-225: a signal a reviewer left is cleared when the review fix launches, so it never speaks for that session", { timeout: 60_000 }, async () => {
    const root = await repo();
    addTicket(root, { id: "t1" });
    const backend = new MockBackend({
      implement: implementGreen,
      /* A reviewer is read-only in production; this one leaves a signal at a stage that never reads one. */
      "review:0": signalling({ note: "written by the review, not by the fixer" }, reviewChanges),
      "review:1": reviewApprove,
      review_fix: noopFix,
    });

    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "stale" });

    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(readTicket(root, "t1").state).toBe("DONE");
    expect(moves(root).map((m) => m.event)).not.toContain("PREMISE_FALSIFIED");
  });

  it("D-13: the informed fix's red gate says the ladder cannot reopen, and no other gate says it", { timeout: 60_000 }, async () => {
    /* The driver's four attempt states share one case now; D-13's reason must still go with the informed fix's gate alone. */
    const root = await repo();
    addTicket(root, { id: "t1" });
    const backend = new MockBackend({ implement: implementRed, blind_fix: noopFix, research: researchValid, informed_fix: noopFix });

    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "d13" });

    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(moves(root).at(-1)).toEqual({ from: "INFORMED_FIX", event: "GATE_RED", to: "NEEDS_HUMAN" });
    expect(notes(root, "t1").filter((n) => n === "informed fix failed — the ladder cannot reopen (D-13)")).toHaveLength(1);
  });
});
