import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { RunJournal } from "../../src/kernel/journal.js";
import { planReviewPath, reviewPlan, type ReviewDeps } from "../../src/init/plan-review.js";
import { launchInitSession, type InitSessionDeps } from "../../src/init/session.js";
import { planDraftSchema } from "../../src/schemas/init.js";
import type { SessionBackend, SessionSpec } from "../../src/sessions/backend.js";
import { okResult } from "../../src/sessions/mock.js";
import { BUDGETS, PROMPTS, repo } from "./plan-fixture.js";
import { ticket } from "./slicing-fixture.js";

/**
 * PRDR-203 — two init sessions in flight on one root.
 *
 * C-4⁗″'s three review draws are independent by construction and run one after
 * another. What a concurrent launch actually hit was never the ledger — rows
 * are appended and the gate re-reads the file — but the journal, which
 * `launchOnce` opened per LAUNCH and refused on the second, and the review
 * artifact, which every draw deleted and rewrote at one path.
 *
 * The backend here holds every session at an `await` until the test releases
 * it, so "in flight" is literal: the second launch happens while the first is
 * still inside `backend.run`.
 */

function deferred(): { readonly promise: Promise<void>; readonly release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** Writes its artifact only once released — a session that is genuinely still running. */
function heldBackend(hold: Promise<void>): SessionBackend {
  return {
    name: "held",
    checkVersion: async () => {},
    run: async (spec: SessionSpec) => {
      await hold;
      writeFileSync(spec.artifactOut, "{}\n");
      return okResult({ costEstimateUsd: 1 });
    },
  };
}

/**
 * Writes its artifact FIRST and then holds — the interleaving that exposes a
 * shared path: three writes land before any read, so every read sees the last.
 */
function writeThenHold(hold: Promise<void>, artifactFor: (n: number) => object): SessionBackend {
  let n = 0;
  return {
    name: "write-then-hold",
    checkVersion: async () => {},
    run: async (spec: SessionSpec) => {
      n += 1;
      writeFileSync(spec.artifactOut, `${JSON.stringify(artifactFor(n))}\n`);
      await hold;
      return okResult();
    },
  };
}

const ledgerRows = (root: string): number => {
  const file = path.join(stateDir(root), "ledger.jsonl");
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "").length : 0;
};

const TICKETS = planDraftSchema.parse({ schema_version: 1, tickets: [ticket("t-1"), ticket("t-2"), ticket("t-3")], questions: [] }).tickets;

describe("PRDR-203 two init sessions in flight on one root", () => {
  it("both launches complete, and both reach the ledger (F-1: one writer — the process, not the launch)", async () => {
    const root = repo();
    const journal = RunJournal.open(root);
    const hold = deferred();
    try {
      const deps: InitSessionDeps = { root, backend: heldBackend(hold.promise), prompts: PROMPTS, spendCeiling: 0, journal };
      const launch = (name: string): Promise<unknown> =>
        launchInitSession(deps, { role: "planner", inputs: {}, artifactOut: path.join(stateDir(root), "state", `${name}.json`) });
      const both = Promise.all([launch("a"), launch("b")]);
      hold.release();
      await both;
    } finally {
      journal.close();
    }
    expect(ledgerRows(root), "two sessions, two rows").toBe(2);
  });

  it("three draws in flight each keep their own artifact (S-1″: one surface per session, one file per draw)", async () => {
    const root = repo();
    const journal = RunJournal.open(root);
    const hold = deferred();
    const backend = writeThenHold(hold.promise, (n) => ({
      schema_version: 1,
      verdict: "changes",
      findings: [{ tag: "sizing", finding: `draw ${String(n)} saw this`, ticket: `t-${String(n)}` }],
    }));
    const init: InitSessionDeps = { root, backend, prompts: PROMPTS, spendCeiling: 0, journal };
    const deps: ReviewDeps = {
      root,
      docs: [],
      budgets: BUDGETS,
      launch: async (inputs, artifactOut, options) => {
        await launchInitSession(init, {
          role: "planner",
          inputs,
          artifactOut: artifactOut ?? planReviewPath(root),
          ...(options?.batch === undefined ? {} : { batch: options.batch }),
          ...(options?.told === undefined ? {} : { artifactTold: options.told }),
        });
      },
    };
    try {
      const draws = Promise.all([1, 2, 3].map((index) => reviewPlan(deps, TICKETS, undefined, { index })));
      hold.release();
      const reads = await draws;
      /* Before PRDR-203 every read is the third draw's: the shared file was rewritten three times before anyone read it. */
      expect(reads.flatMap((r) => (r?.findings ?? []).map((f) => f.ticket)).sort(), "each draw read what IT was told").toEqual(["t-1", "t-2", "t-3"]);
    } finally {
      journal.close();
    }
  });
});
