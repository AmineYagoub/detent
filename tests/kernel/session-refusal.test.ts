import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { ensureRunBranch, installTrailerHook } from "../../src/kernel/git.js";
import { RunJournal } from "../../src/kernel/journal.js";
import { runsDir } from "../../src/kernel/journal.js";
import { RefereeCore } from "../../src/kernel/referee.js";
import { loadConfig } from "../../src/kernel/worstcase.js";
import { MockBackend, okResult } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree } from "../helpers.js";
import { addTicket, makeRunRepo, reviewApprove } from "../kernel/run-fixture.js";

/**
 * T-140 (PRDR-072) — a usage-limit outage turned four live sessions into
 * $0/zero-turn no-ops and the machine marched on: gates re-greened unchanged
 * trees, ladder slots burned, and a refused reviewer REPLAYED the previous
 * round's review.json as a fresh verdict. Two guarantees pin the fix:
 * a refused session halts the run, and a freshly launched session can never
 * inherit a stale artifact.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

async function makeCore(backend: MockBackend): Promise<{ core: RefereeCore; root: string }> {
  const repo = await makeRunRepo();
  cleanups.push(() => removeTree(repo.root));
  addTicket(repo.root, { id: "t-1" });
  const loaded = loadConfig(JSON.parse(readFileSync(path.join(stateDir(repo.root), "config.json"), "utf8")));
  const journal = RunJournal.open(repo.root);
  cleanups.push(() => journal.close());
  const core = new RefereeCore(
    { root: repo.root, backend, prompts: loadPromptSet() },
    loaded,
    journal,
    ensureRunBranch(repo.root, "session-refusal"),
  );
  installTrailerHook(repo.root);
  return { core, root: repo.root };
}

describe("T-140 a refused session is an outage, not an attempt (PRDR-072)", () => {
  it("crashed-with-zero-turns halts the run naming the refusal", { timeout: 60_000 }, async () => {
    const backend = new MockBackend({
      implement: () => ({ ...okResult(), ok: false, crashed: true, turns: 0, rawTail: "usage limit reached" }),
    });
    const { core } = await makeCore(backend);
    expect(core.acquire("t-1").ok).toBe(true);
    await expect(core.attempt("t-1", "IN_PROGRESS")).rejects.toThrow(/refused implement session for t-1/);
  });

  it("a crash WITH turns keeps PRDR-053's judge-the-tree behavior", { timeout: 60_000 }, async () => {
    const backend = new MockBackend({
      implement: () => ({ ...okResult(), ok: false, crashed: true, turns: 7 }),
    });
    const { core } = await makeCore(backend);
    expect(core.acquire("t-1").ok).toBe(true);
    await expect(core.attempt("t-1", "IN_PROGRESS")).resolves.not.toThrow();
  });
});

describe("PRDR-090 a run of crashes is an outage, not work", () => {
  it("three consecutive crashes WITH turns halt the run", { timeout: 60_000 }, async () => {
    /**
     * Observed live: nineteen consecutive crashed sessions at $0.00 raced nine
     * tickets through blind fix and research into NEEDS_HUMAN in minutes.
     * Each crash carried turns, so PRDR-072's zero-turn rule let them past and
     * PRDR-053 correctly judged the tree — of work that never happened.
     */
    const backend = new MockBackend({
      implement: () => ({ ...okResult(), ok: false, crashed: true, turns: 12 }),
      blind_fix: () => ({ ...okResult(), ok: false, crashed: true, turns: 9 }),
    });
    const { core } = await makeCore(backend);
    expect(core.acquire("t-1").ok).toBe(true);

    /* Two crashes are plausible partial work; the third is an outage. */
    await core.attempt("t-1", "IN_PROGRESS");
    await core.attempt("t-1", "BLIND_FIX");
    await expect(core.attempt("t-1", "IN_PROGRESS")).rejects.toThrow(/consecutive crashed sessions/);
  });

  it("a session that returns real work resets the streak", { timeout: 60_000 }, async () => {
    let calls = 0;
    const backend = new MockBackend({
      implement: () => {
        calls += 1;
        /* crash, crash, GOOD, crash, crash — never three in a row. */
        return calls === 3 ? okResult() : { ...okResult(), ok: false, crashed: true, turns: 5 };
      },
    });
    const { core } = await makeCore(backend);
    expect(core.acquire("t-1").ok).toBe(true);
    for (let i = 0; i < 5; i += 1) {
      await expect(core.attempt("t-1", "IN_PROGRESS")).resolves.not.toThrow();
    }
  });
});

describe("T-140 a fresh launch never inherits a stale artifact (PRDR-072)", () => {
  it("a no-write reviewer yields 'no artifact', never the previous verdict", { timeout: 60_000 }, async () => {
    const backend = new MockBackend({
      implement: () => okResult(),
      /* The reviewer session runs but writes nothing at all. */
      review: () => okResult(),
    });
    const { core, root } = await makeCore(backend);

    /* A previous round's verdict sits in the runs area. */
    const stale = path.join(runsDir(root, "t-1"), "review.json");
    mkdirSync(path.dirname(stale), { recursive: true });
    writeFileSync(
      stale,
      `${JSON.stringify({ schema_version: 1, verdict: "changes", changes: [{ tag: "requirement", finding: "stale" }] })}\n`,
    );

    expect(core.acquire("t-1").ok).toBe(true);
    await core.attempt("t-1", "IN_PROGRESS");
    await expect(core.recordStage("t-1", "review")).rejects.toThrow(/no artifact/);
    expect(existsSync(stale)).toBe(false);
  });
});

describe("X-1″ (PRDR-106) no session is terminated on turns", () => {
  /**
   * Four breaches on the certification gate — 103, 145, 307, 222 turns —
   * caught zero runaways: every breached ticket finished on resume in 46-63
   * turns, and every firing halted the run, recorded $0 and stranded the
   * work. The ceiling is deleted; the ledger keeps the measurement.
   */
  it("a long session is an ordinary session: no halt, no partial row, turns recorded", { timeout: 60_000 }, async () => {
    const backend = new MockBackend({
      implement: () => ({ ...okResult(), turns: 5000 }),
    });
    const { core, root } = await makeCore(backend);
    expect(core.acquire("t-1").ok).toBe(true);
    await core.attempt("t-1", "IN_PROGRESS");
    const rows = readFileSync(path.join(stateDir(root), "ledger.jsonl"), "utf8")
      .split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as { turns?: number; partial?: string });
    expect(rows.at(-1)?.turns).toBe(5000);
    expect(rows.at(-1)?.partial).toBeUndefined();
  });
});

describe("A-5′ (PRDR-109) a review with no usable verdict is relaunched once", () => {
  /**
   * Six of the certification gate's human stops were a reviewer that crashed
   * or wrote nothing, escalated as a budget breach; every one was requeued
   * with "not a finding" and reviewed cleanly on the next launch.
   */
  it("a no-write first review is followed by one more launch, and the second verdict counts", { timeout: 60_000 }, async () => {
    let launches = 0;
    const review: typeof reviewApprove = (spec) => {
      launches += 1;
      return launches === 1 ? okResult() : reviewApprove(spec);
    };
    const backend = new MockBackend({ implement: () => okResult(), review });
    const { core, root } = await makeCore(backend);
    expect(core.acquire("t-1").ok).toBe(true);
    await core.attempt("t-1", "IN_PROGRESS");
    await expect(core.recordStage("t-1", "review")).resolves.toBeDefined();
    expect(backend.calls.filter((c) => c.role === "review")).toHaveLength(2);
    const ticket = JSON.parse(readFileSync(path.join(stateDir(root), "plan", "t-1.json"), "utf8")) as {
      notes: { text: string }[];
    };
    expect(ticket.notes.map((n) => n.text).join(" ")).toContain("relaunched once");
  });

  it("two failures still breach, and the breach names the relaunch", { timeout: 60_000 }, async () => {
    const backend = new MockBackend({ implement: () => okResult(), review: () => okResult() });
    const { core } = await makeCore(backend);
    expect(core.acquire("t-1").ok).toBe(true);
    await core.attempt("t-1", "IN_PROGRESS");
    await expect(core.recordStage("t-1", "review")).rejects.toThrow(/after one relaunch/);
    expect(backend.calls.filter((c) => c.role === "review")).toHaveLength(2);
  });
});
