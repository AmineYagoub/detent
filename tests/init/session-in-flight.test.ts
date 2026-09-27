import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { RunJournal } from "../../src/kernel/journal.js";
import { launchInitSession, type InitSessionDeps } from "../../src/init/session.js";
import type { SessionBackend, SessionSpec } from "../../src/sessions/backend.js";
import { okResult } from "../../src/sessions/mock.js";
import { PROMPTS, repo } from "./plan-fixture.js";

/**
 * PRDR-203 — two init sessions in flight on one root.
 *
 * C-4⁗″'s three review draws were independent by construction, and ran one
 * after another. What a concurrent launch actually hit was never the ledger —
 * rows are appended and the gate re-reads the file — but the journal, which
 * `launchOnce` opened per LAUNCH and refused on the second, and the review
 * artifact, which every draw deleted and rewrote at one path. The draws are
 * gone (C-4⁸, PRDR-294), and a phase still holds one journal for its launches.
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

const ledgerRows = (root: string): number => {
  const file = path.join(stateDir(root), "ledger.jsonl");
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "").length : 0;
};

describe("PRDR-203 two init sessions in flight on one root", () => {
  it("both launches complete, and both reach the ledger (F-1: one writer — the process, not the launch)", async () => {
    const root = repo();
    const journal = RunJournal.open(root);
    const hold = deferred();
    try {
      const deps: InitSessionDeps = { root, backend: heldBackend(hold.promise), prompts: PROMPTS, spendCeiling: 0, journal };
      const launch = (name: string): Promise<unknown> =>
        launchInitSession(deps, { role: "planner", inputs: { stage: "PLAN" }, artifactOut: path.join(stateDir(root), "state", `${name}.json`) });
      const both = Promise.all([launch("a"), launch("b")]);
      hold.release();
      await both;
    } finally {
      journal.close();
    }
    expect(ledgerRows(root), "two sessions, two rows").toBe(2);
  });
});
