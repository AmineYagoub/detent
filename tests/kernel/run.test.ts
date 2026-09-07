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
import { requeueTicket } from "../../src/kernel/plumbing.js";
import { acquireRunLock } from "../../src/kernel/run-lock.js";
import { claim } from "../../src/kernel/tickets/mutations.js";
import { writePlan } from "../../src/init/plan-write.js";
import { planHash } from "../../src/init/machine.js";
import { mkdirSync } from "node:fs";
import { tmpTree } from "../helpers.js";
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
    /**
     * B-1 supersedes the oracle's merge-into-main: work lands on the run
     * branch, and the base SHA is byte-identical (P7).
     */
    expect(existsSync(path.join(root, "src/feature-t1.txt"))).toBe(true);
    expect(git(root, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("detent/run-test");
    expect(git(root, "rev-parse", "main").trim()).toBe(baseSha);

    /** The transition log exists, is schema-valid, and starts at READY|CLAIMED. */
    const log = transitions(root);
    expect(log[0]).toMatchObject({ ticket: "t1", from: "READY", event: "CLAIMED", to: "IN_PROGRESS" });
    expect(log.at(-1)).toMatchObject({ event: "GATE_GREEN", to: "DONE" });

    /** S-6: one stable prefix hash per role within the run. */
    const byRole = new Map<string, Set<string>>();
    for (const call of backend.calls) {
      const set = byRole.get(call.role) ?? new Set<string>();
      set.add(prefixHash(call.spec));
      byRole.set(call.role, set);
    }
    expect(byRole.size).toBeGreaterThanOrEqual(2);
    for (const [role, hashes] of byRole) expect(hashes.size, role).toBe(1);

    /** Ledger rows are schema-valid and cover every launch. */
    const rows = readFileSync(path.join(root, ".detent/ledger.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => ledgerRowSchema.parse(JSON.parse(line)));
    expect(rows).toHaveLength(backend.calls.length);
    /** Generation closed as done, counters preserved. */
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
    /**
     * PRD §13 counter mapping: the oracle's fix_sessions == 2 is
     * (blind, informed) == (1, 1); research_sessions carries over.
     */
    const counters = t1.generations.at(-1)!.counters;
    expect(counters.blind_fix_attempts).toBe(1);
    expect(counters.informed_fix_attempts).toBe(1);
    expect(counters.research_sessions).toBe(1);
    /** implement + blind + research + informed */
    expect(counters.sessions).toBe(4);

    const roles = backend.rolesLaunched();
    expect(roles.filter((r) => r === "blind_fix")).toHaveLength(1);
    expect(roles.filter((r) => r === "informed_fix")).toHaveLength(1);
    expect(roles.filter((r) => r === "research")).toHaveLength(1);

    /**
     * The dossier exists and validates (A-8); the failure record is on disk.
     * The oracle also asserted the research brief was cached — that is D-18's
     * env-keyed cache now, and closes at T-045.
     */
    const dossier = dossierSchema.parse(
      JSON.parse(readFileSync(path.join(root, ".detent/runs/t1/dossier.json"), "utf8")),
    );
    expect(dossier.suggested_resolutions.length).toBeGreaterThan(0);
    expect(existsSync(path.join(root, ".detent/runs/t1/last_failure.json"))).toBe(true);
    expect(readTicket(root, "t1").generations.at(-1)).toMatchObject({ outcome: "needs_human" });
  });
});

/**
 * B-5′ (PRDR-131) — the crash skip belongs to the generation that crashed.
 *
 * `unfinished` counted `start` against `end` over the ticket's WHOLE journal
 * and the skip event rebalanced neither, so one killed session suppressed that
 * role on that ticket forever. The ladder still spent real money fixing an
 * implementation that had never been written, and requeue — the documented
 * remedy — could not clear it. Both halves are asserted here, because the
 * within-generation skip is B-5 working and must survive the fix.
 */
/**
 * Phase-2 remediation: V-1″ (PRDR-135), X-1‴ (PRDR-147), S-4″ (PRDR-138).
 */
describe("V-1″ a run with nothing bound verifies nothing, and refuses", () => {
  it("refuses at startup when no `test` gate is bound, rather than greening every gate", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    /* The gate used to read "no binding matched" as a pass and march the ticket to DONE. */
    writeFileSync(path.join(root, ".detent", "bindings.json"), JSON.stringify({ schema_version: 1, bindings: [], skips: [] }));
    const backend = new MockBackend({ implement: implementGreen, review: reviewApprove });
    const outcome = await run(opts(root, backend));
    expect(outcome.exitCode).toBe(EXIT_NOT_READY);
    expect(JSON.stringify(outcome.summary)).toContain("no `test` gate is bound");
    expect(readTicket(root, "t1").state).toBe("READY");
    expect(backend.rolesLaunched()).toEqual([]);
  });
});

/**
 * C-9′ (PRDR-139) / X-1⁗ (PRDR-140) / B-2″ (PRDR-145b) — phase 3.
 */
/**
 * PRDR-144 — an EMPTY diff reaching a reviewer.
 *
 * P7′ (PRDR-130) showed a swallowed git error handed the reviewer `""`, which
 * is under `DIFF_BODY_CAP`, so the "never truncate silently" banner never
 * fired and a ticket was judged against nothing. That was found by reading the
 * code, not by a test: nothing in the suite asserted what a review receives or
 * does when the diff is empty.
 */
describe("PRDR-144 a review handed an empty diff", () => {
  it("the reviewer is given the empty diff verbatim, and its verdict still governs", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    let sawDiff: string | null = null;
    /* A session that commits nothing: the gate is green on the unchanged tree. */
    const implementNothing: StageFn = () => okResult();
    const capturing: StageFn = (spec) => {
      sawDiff = (JSON.parse(spec.promptVariable) as { inputs: { diff?: string } }).inputs.diff ?? "";
      return reviewApprove(spec);
    };
    await run(opts(root, new MockBackend({ implement: implementNothing, review: capturing })));

    expect(sawDiff, "the reviewer must be launched at all").not.toBeNull();
    expect(sawDiff, "an empty diff reaches the reviewer as empty — not as a banner, not as a throw").toBe("");
    /*
     * And the verdict is what decides: Detent does not second-guess an approve
     * on an empty diff, which is precisely why the reviewer must be able to SEE
     * that it is empty. If that ever changes to a kernel-side refusal, this
     * assertion is where it should be stated.
     */
    expect(readTicket(root, "t1").state).toBe("DONE");
  });
});

describe("C-9′ a run executes only the plan a human approved", () => {
  it("refuses when a ticket's approved content changed after the approval", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    /* Edit what a human approved — not the run state stored beside it. */
    const file = path.join(root, ".detent/plan/t1.json");
    const t = JSON.parse(readFileSync(file, "utf8")) as { acceptance_criteria: string[] };
    t.acceptance_criteria = [...t.acceptance_criteria, "and something nobody approved"];
    writeFileSync(file, JSON.stringify(t, null, 2));

    const outcome = await run(opts(root, new MockBackend()));
    expect(outcome.exitCode).toBe(EXIT_NOT_READY);
    expect(JSON.stringify(outcome.summary)).toContain("different plan");
  });

  /**
   * The check is only safe because `planHash` covers the APPROVED fields. It
   * used to hash whole ticket files, which `writeTicket` rewrites on every
   * transition — so this check would have refused every resume.
   */
  it("a resume of an approved plan still runs, though the run has rewritten its tickets", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    /*
     * PRDR-153: NO intervening `addTicket`. It calls `approveFixturePlan`, which
     * re-stamps the hash from whatever is on disk — so the original version of
     * this test would have passed even if `planHash` still covered whole ticket
     * files, which is the very thing it claims to prove. The approval must be
     * the one given BEFORE run 1 rewrote anything.
     */
    addTicket(root, { id: "t2" });
    const approvedHash = JSON.parse(readFileSync(path.join(root, ".detent/plan/approval.json"), "utf8")) as { plan_hash: string };

    const first = await run(opts(root, new MockBackend({ implement: implementGreen, review: reviewApprove })));
    expect(first.exitCode).toBe(EXIT_OK);
    /* Both tickets now carry DONE states, counters and notes they lacked at approval. */
    expect(readTicket(root, "t1").state).toBe("DONE");
    const still = JSON.parse(readFileSync(path.join(root, ".detent/plan/approval.json"), "utf8")) as { plan_hash: string };
    expect(still.plan_hash, "the approval was not re-stamped").toBe(approvedHash.plan_hash);

    const resumed = await run(opts(root, new MockBackend({ implement: implementGreen, review: reviewApprove })));
    expect(resumed.exitCode, "a rewritten ticket file must not read as an edited plan").toBe(EXIT_OK);
  });

  /**
   * PRDR-152: `APPROVED_FIELDS` listed `depends_on` — a DRAFTED ticket's field
   * name — so it hashed a key that is always absent and ignored `blockers` and
   * `waits_on`, the two that hold the dependency graph. A ticket's edges could
   * be rewritten after approval and C-9's check would not notice.
   *
   * This asserts against the SCHEMA rather than a remembered list, so a field
   * added to a ticket later cannot be silently left out of what a human is
   * taken to have approved.
   */
  it("every ticket field is either approved-content or declared run state — nothing is silently ignored", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    const file = path.join(root, ".detent/plan/t1.json");
    const ticket = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    /**
     * The fields that legitimately change DURING a run. `waits_on` is set by
     * X-4′ dependency discovery (`dependency.ts`) and `links` by X-6 discovery
     * (`linkDiscovered`) — PRDR-152 briefly treated both as approved content,
     * which refused the next resume of any run that discovered anything.
     * `blockers` is genuinely plan-time: no run-time writer exists.
     */
    const runState = new Set(["schema_version", "state", "generations", "notes", "waits_on", "links"]);

    for (const field of Object.keys(ticket)) {
      if (runState.has(field)) continue;
      const before = planHash(root);
      const mutated = { ...ticket, [field]: Array.isArray(ticket[field]) ? [...(ticket[field] as unknown[]), "x"] : `${String(ticket[field])}-edited` };
      writeFileSync(file, JSON.stringify(mutated, null, 2));
      expect(planHash(root), `editing \`${field}\` after approval is invisible to C-9`).not.toBe(before);
      writeFileSync(file, JSON.stringify(ticket, null, 2));
    }
  });

  it("a replan refuses to delete a ticket a live process has claimed", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    /* A live claim: this process. */
    expect(claim(root, "t1", "w1")).toBe(true);
    /* A plan that no longer contains t1, so the orphan sweep reaches it. */
    const replacement = [
      {
        id: "t9",
        type: "feature" as const,
        title: "replacement",
        description: "",
        acceptance_criteria: ["it works"],
        non_goals: [],
        surface: ["src/**"],
        depends_on: [],
        provides: [],
        consumes: [],
        risk_label: false,
        slice: "s01",
      },
    ];
    expect(() =>
      writePlan({ root, greenfield: false, analysis: null, docs: [], boundSlots: [] }, replacement, []),
    ).toThrow(/claimed by a live process/);
    expect(existsSync(path.join(root, ".detent/plan/t1.json")), "the ticket must survive").toBe(true);
  });
});

describe("X-1⁗ the wall clock is enforced where the work is launched", () => {
  it("breaches through the referee rather than only through the headless loop", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    /*
     * Advance the clock rather than backdate the claim: the run takes its own
     * claim with `wx`, so a pre-existing one makes the ticket read as held by
     * someone else and it is skipped entirely. A zero ceiling is refused by the
     * X-1 worst-case check at config load, so that route is closed too.
     */
    /*
     * PRDR-153: a clock that ADVANCES, by just over the default ceiling per
     * read. Claim time and the check now read the same injectable clock — they
     * used to be two different ones, which is why this check never fired under
     * a frozen fixture clock — so a constant offset yields zero elapsed, and
     * counting calls is fragile because `iso()` is read many times per stage.
     */
    let clock = Date.now();
    const advancing = (): number => (clock += 3_600_001);
    const outcome = await run({ ...opts(root, new MockBackend({ implement: implementGreen, review: reviewApprove })), now: advancing });
    expect(JSON.stringify(outcome.summary)).toContain("wall clock");
  });
});

describe("X-1‴ one run per root", () => {
  it("a second run against the same root refuses and names the holder", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    const held = acquireRunLock(root);
    expect(held.ok).toBe(true);
    try {
      const outcome = await run(opts(root, new MockBackend({ implement: implementGreen, review: reviewApprove })));
      expect(outcome.exitCode).toBe(EXIT_NOT_READY);
      expect(JSON.stringify(outcome.summary)).toContain("another run holds this root");
    } finally {
      if (held.ok) held.release();
    }
  });

  it("a completed run leaves no lock behind", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    await run(opts(root, new MockBackend({ implement: implementGreen, review: reviewApprove })));
    expect(existsSync(path.join(root, ".detent", "state", "run.lock"))).toBe(false);
  });

  /**
   * The lock sat at `.detent/run.lock` — committed territory — and
   * `finalizeDone` runs `git add -A` in the default non-worktree mode, so a run
   * would have COMMITTED its own lock. On another machine the host would not
   * match, so `runLockBreakable` refuses to break it: a lock that travels is a
   * lock nobody can clear.
   */
  it("the lock is local run state and never travels — git does not see it", async () => {
    const root = await fixture();
    const held = acquireRunLock(root);
    expect(held.ok).toBe(true);
    try {
      const tracked = git(root, "status", "--porcelain", "--untracked-files=all");
      expect(tracked, "the run lock must be gitignored").not.toContain("run.lock");
      expect(existsSync(path.join(root, ".detent", "state", "run.lock"))).toBe(true);
    } finally {
      if (held.ok) held.release();
    }
  });

  it("a lock left by a dead process on this host is breakable; a live one is not", () => {
    const root = tmpTree({});
    roots.push(root);
    mkdirSync(path.join(root, ".detent", "state"), { recursive: true });
    const mine = acquireRunLock(root, { pid: 4242, alive: () => false });
    expect(mine.ok).toBe(true);
    /* Dead holder, same host: broken and taken. */
    const after = acquireRunLock(root, { pid: 5, alive: () => false });
    expect(after.ok).toBe(true);
    expect(after.ok && after.brokeStale?.pid).toBe(4242);
    /* Live holder: refused. */
    expect(acquireRunLock(root, { pid: 6, alive: () => true }).ok).toBe(false);
  });
});

/**
 * PRDR-151 — `finalize` breaching, and a COVERAGE GAP recorded rather than
 * papered over.
 *
 * `finalize` sat outside `processTicket`'s breach handler, so a worktree merge
 * conflict escaped, `loop()` rethrew it, and the run exited 1 with the
 * generation left `in_flight` and `detent status` showing nothing wrong. That
 * is fixed in `driver.ts`, and `mergeWorktree`'s half is covered by
 * `tests/kernel/git.test.ts` ("B-2′ a conflicting worktree merge…").
 *
 * The DRIVER-level routing is NOT covered here. Forcing a conflict through the
 * real loop needs two worktrees alive at once, and the driver is sequential —
 * t1 merges before t2's worktree can diverge from it. The resume shape (a
 * worktree surviving from an earlier claim) was tried and did not reproduce it
 * either. Rather than ship a test that passes without exercising the condition
 * it names — the defect this line has spent a day removing — the gap is written
 * down. It belongs with PRDR-144's worktree coverage, where a fixture can be
 * built deliberately instead of squeezed out of the happy path.
 */

describe("S-4″ a transport death is a crash, not a success", () => {
  it("a telemetry-less session is recorded as a crash and halts the run, rather than as a success", async () => {
    const root = await fixture();
    for (const id of ["t1", "t2", "t3", "t4"]) addTicket(root, { id });
    /* `ok: true, telemetryParsed: false` is what a stream ending with no result message parses as. */
    /**
     * PRDR-151: the PRODUCTION shape. `parseResultMessage` hard-codes
     * `turns: 0` whenever telemetry is absent, and it is the only producer of
     * `telemetryParsed: false` — so `okResult({ telemetryParsed: false })`,
     * whose `turns` defaults to 1, is a shape the product cannot emit. The
     * first version of this test used it, which is the unrealistic-fixture
     * pattern this line has been auditing for, in the test written to close it.
     */
    const backend = new MockBackend({ implement: () => okResult({ telemetryParsed: false, turns: 0 }) });
    const sleeps: number[] = [];
    const outcome = await run({ ...opts(root, backend), sleep: async (ms) => void sleeps.push(ms) });

    /*
     * The substance of S-4″: it used to parse as ok:true with no `crashed`
     * flag, so the ledger took an unflagged $0 row, the journal recorded a
     * successful end for a session that died on the wire, and the run marched
     * on. It now halts, and the row says what happened.
     */
    expect(outcome.exitCode).not.toBe(0);
    const rows = readFileSync(path.join(root, ".detent", "ledger.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as { partial?: string; role: string });
    const implementRows = rows.filter((r) => r.role === "implement");
    expect(implementRows.length).toBeGreaterThan(0);
    for (const r of implementRows) expect(r.partial, "a session that died on the wire is a crash").toBe("crash");
  });
});

describe("B-5′ a crash suppresses the relaunch within its generation, and not beyond it", () => {
  it("the implement session is skipped on resume, then LAUNCHES again after a requeue opens a new generation", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });

    /* A session that began work and died: the gate is left RED, as after an OOM kill. */
    const crashingImplement: StageFn = (spec) => {
      writeTree(spec.cwd, { ".fail": "half-written work\n" });
      throw new Error("simulated OOM kill");
    };
    /* What a working implement session would do — clear the failure and commit. */
    const implementRepairs: StageFn = (spec) => {
      rmSync(path.join(spec.cwd, ".fail"), { force: true });
      writeTree(spec.cwd, { [`src/feature-${spec.ticketId}.txt`]: "done\n" });
      git(spec.cwd, "add", "-A");
      git(spec.cwd, "commit", "-q", "-m", `${spec.ticketId}: implement`);
      return okResult();
    };

    /* 1. The implement session dies mid-flight, leaving a `start` with no `end`. */
    const first = new MockBackend({ implement: crashingImplement });
    expect((await run(opts(root, first))).exitCode).toBe(EXIT_ERROR);
    expect(first.rolesLaunched().filter((r) => r === "implement")).toHaveLength(1);

    /*
     * 2. Resume in the SAME generation: B-5 holds — the session is not
     *    relaunched, the gate judges the tree as-is, and the ladder exhausts
     *    onto the human. This half must survive the fix.
     */
    const second = new MockBackend({ implement: implementRepairs, review: reviewApprove });
    await run(opts(root, second));
    expect(second.rolesLaunched()).not.toContain("implement");
    const crashed = readTicket(root, "t1");
    expect(crashed.state).toBe("NEEDS_HUMAN");

    /* 3. A requeue opens a fresh generation with zeroed counters (X-8). */
    const requeue = requeueTicket(root, "t1", "operator", "try again");
    expect(requeue.exitCode).toBe(0);
    expect(readTicket(root, "t1").generations.length).toBe(crashed.generations.length + 1);

    /*
     * 4. The new generation must actually implement. Before B-5′ it launched
     *    nothing — on this generation or any later one — so the gate ran on the
     *    same unchanged tree, went red again, and the ladder burned blind_fix,
     *    research and informed_fix on work that had never been written. The
     *    documented remedy could not clear it.
     */
    const third = new MockBackend({ implement: implementRepairs, review: reviewApprove });
    await run(opts(root, third));
    expect(third.rolesLaunched()).toContain("implement");
    expect(readTicket(root, "t1").state).toBe("DONE");
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

    /**
     * The crash left the ticket mid-BLIND_FIX with the launch already charged
     * (B-5: count before launch) and an unterminated journal entry.
     */
    const mid = readTicket(root, "t1");
    expect(mid.state).toBe("BLIND_FIX");
    expect(mid.generations.at(-1)!.counters.blind_fix_attempts).toBe(1);
    expect(mid.generations.at(-1)!.counters.sessions).toBe(2);

    /** Resume with a FRESH kernel over the same store and backend. */
    const second = new MockBackend(script);
    const resumed = await run(opts(root, second));
    expect(resumed.exitCode).toBe(EXIT_OK);
    expect(readTicket(root, "t1").state).toBe("DONE");

    /**
     * Exactly one blind-fix launch EVER, across both processes; the informed
     * fix legitimately consumes the second slot after research.
     */
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
  /**
   * The oracle's triage stage did not survive the PRD: D-10 moved planning to
   * init. The preserved properties are (a) work never starts on an unverified
   * premise — C-9 executes only an approved plan — and (b) human-gated items
   * surface as exit 10 with a machine-readable summary.
   */
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
    /** t2 is blocked out-of-band (the shape UPSTREAM_BUG produces). */
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

    /**
     * The implement attempt consumes the ceiling: the clock reads 0 until the
     * stage runs and past-the-ceiling after. Armed by the stage rather than by
     * call order, so referee-internal clock reads (the T-120 hook-policy TTLs)
     * cannot shift the timeline; BUDGET_BREACH is legal from every non-DONE
     * state, so the breach lands wherever the check next runs.
     */
    let t = 0;
    const now = () => t;
    const backend = new MockBackend({
      implement: (spec) => {
        t = 4_000_000;
        return implementGreen(spec);
      },
    });
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
        pinned: { agent_sdk: "0.3.258", claude_code: "2.1.191" },
        setting_sources: [],
        plan_docs: [],
        plan_baseline: "production" as const,
        slice_size: { min: 12, max: 18 },
        symbols: { enabled: false, command: "serena-agent", pinned: "0.1.4" },
      },
      computedWorstCase: 14,
    };

    const backend = new MockBackend({ implement: implementRed });
    const outcome = await runWithConfig(opts(root, backend), loaded);

    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    /** Exactly one launch (implement); the blind fix was refused at launch. */
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

    /**
     * The implement session edits the Makefile's test recipe — a gate
     * redefinition by a session, which SEC-5 treats as tampering.
     */
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
    /** Reconstructable from the journal: GATE_DRIFT rows, which a crash never leaves. */
    expect(transitions(root).at(-1)).toMatchObject({ event: "GATE_DRIFT", to: "BLOCKED" });

    /** The human re-baselines via verify sync (the consent IS the human act)... */
    const synced = await verifySync(root, { consent: async () => true });
    expect(synced.exitCode).toBe(0);

    /**
     * ...and the next run requeues the drift-blocked ticket into a fresh
     * generation whose reason records the drift, then completes it.
     */
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
    /**
     * t1 sits mid-flight under ANOTHER LIVE worker's claim (this process's
     * own pid — unambiguously alive on every OS). C-9′/PRDR-079: only a
     * verifiably DEAD owner's claim self-heals (tested in
     * claim-self-heal.test.ts); a live peer's claim is never guessed about.
     */
    const t1 = readTicket(root, "t1");
    writeFileSync(path.join(root, ".detent/plan/t1.json"), `${JSON.stringify({ ...t1, state: "IN_PROGRESS" }, null, 2)}\n`);
    writeFileSync(path.join(root, ".detent/claims/t1.claim"), JSON.stringify({ owner: "w9", pid: process.pid, at: "x" }));

    const backend = new MockBackend({ implement: implementGreen, review: reviewApprove });
    const outcome = await run(opts(root, backend));

    /**
     * t2 finished; t1 was left alone — breaking a stale claim is plumbing's
     * job (T-055), and the loop never guesses about another process.
     */
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
    /** Closed → reopenable (a later run is a new single writer). */
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
