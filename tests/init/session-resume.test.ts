import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { launchInitSession, withInitJournal } from "../../src/init/session.js";
import type { SessionBackend, SessionResult, SessionSpec } from "../../src/sessions/backend.js";
import { okResult, resultFromSdk } from "../../src/sessions/mock.js";
import { OUTAGE_BACKOFF_MS } from "../../src/schemas/backend-limit.js";
import { PROMPTS, repo } from "./plan-fixture.js";

/**
 * X-8″ (PRDR-321) — `init` carries on the conversation a usage limit stopped,
 * after the wait, instead of launching the session afresh. PRDR-185 and
 * PRDR-189 waited for the reset and then called `launchOnce` again, so the
 * conversation a claim check had built over dozens of turns was dropped, and
 * its thinking, tool calls and cache were paid for twice.
 */

const LIMIT = "Claude Code returned an error result: You've hit your session limit · resets 3pm (Africa/Algiers)";
/** 12:00 in Algiers (UTC+1): the stated reset is three hours and the minute's margin away. */
const NOON = new Date("2026-09-30T11:00:00Z");
const THREE_HOURS = (3 * 60 + 1) * 60_000;

/** What the SDK backend returns for a session the limit stopped after `turns` turns (`sdk.ts`'s crash path). */
function stopped(turns: number, sessionId: string | undefined, tail = LIMIT, cost = 1.25): SessionResult {
  return {
    ...resultFromSdk({ type: "result", subtype: "error_during_execution", is_error: true, num_turns: turns, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 }, result: tail }),
    costEstimateUsd: cost,
    crashed: true,
    ...(sessionId === undefined ? {} : { sessionId }),
  };
}

/** Launches one init session against `results`, in order, and returns what each launch was asked for. */
async function launch(results: readonly ((spec: SessionSpec) => SessionResult)[]): Promise<{ specs: SessionSpec[]; notes: string[]; sleeps: number[]; root: string }> {
  const root = repo();
  const specs: SessionSpec[] = [];
  const backend: SessionBackend = {
    name: "scripted",
    checkVersion: async () => undefined,
    run: async (spec) => {
      specs.push(spec);
      const next = results[specs.length - 1];
      if (next === undefined) throw new Error("no more scripted results");
      return next(spec);
    },
  };
  const notes: string[] = [];
  const sleeps: number[] = [];
  const artifactOut = path.join(stateDir(root), "state", "audit-claim.json");
  await withInitJournal(root, async (journal) =>
    await launchInitSession(
      {
        root,
        backend,
        prompts: PROMPTS,
        spendCeiling: 100,
        journal,
        note: (t) => notes.push(t),
        now: () => NOON,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
      { role: "audit", inputs: { task: "verify_claims" }, artifactOut },
    ),
  );
  return { specs, notes, sleeps, root };
}

const finishes = (spec: SessionSpec): SessionResult => {
  writeFileSync(spec.artifactOut, "{}\n");
  return okResult({ turns: 4, sessionId: spec.resume?.sessionId ?? "fresh", ...(spec.resume === undefined ? {} : { resume: { sessionId: spec.resume.sessionId } }) });
};

describe("X-8″ init resumes what a usage limit stopped", () => {
  it("waits for the stated reset, then resumes the stopped session's own conversation", async () => {
    const { specs, notes, sleeps, root } = await launch([() => stopped(23, "sess-1"), finishes]);
    expect(sleeps).toEqual([THREE_HOURS]);
    expect(specs[0]?.resume).toBeUndefined();
    expect(specs[1]?.resume).toEqual({ sessionId: "sess-1" });
    expect(notes.join(" ")).toContain("for the stated reset, resets 3pm (Africa/Algiers); session sess-1 resumes where it stopped");
    const journal = readFileSync(path.join(stateDir(root), "runs", "init", "journal.jsonl"), "utf8");
    expect(journal).toContain('"resumes":"sess-1"');
  });

  it("launches afresh a session the limit stopped before its first turn, since there is nothing to carry on", async () => {
    const { specs, notes } = await launch([() => stopped(0, "sess-1", LIMIT, 0), finishes]);
    expect(specs[1]?.resume).toBeUndefined();
    expect(notes.join(" ")).toContain("it stopped before its first turn, so it is launched afresh");
  });

  it("launches afresh when no session id arrived, and says so", async () => {
    const { specs, notes } = await launch([() => stopped(12, undefined), finishes]);
    expect(specs[1]?.resume).toBeUndefined();
    expect(notes.join(" ")).toContain("no session id arrived, so it is launched afresh");
  });

  it("does not resume a session that ended for any other reason: an overload is waited out and launched afresh", async () => {
    const { specs, sleeps } = await launch([() => stopped(9, "sess-1", "Claude Code returned an error result: API Error: 529 overloaded"), finishes]);
    expect(sleeps).toEqual([OUTAGE_BACKOFF_MS[0]]);
    expect(specs[1]?.resume).toBeUndefined();
  });

  it("resumes the same conversation again when the resume itself is stopped before its first turn", async () => {
    const { specs, sleeps } = await launch([
      () => stopped(23, "sess-1"),
      (spec) => ({ ...stopped(0, "sess-1", LIMIT, 0), resume: { sessionId: spec.resume?.sessionId ?? "" } }),
      finishes,
    ]);
    expect(sleeps).toEqual([THREE_HOURS, THREE_HOURS]);
    expect(specs.map((s) => s.resume?.sessionId)).toEqual([undefined, "sess-1", "sess-1"]);
  });

  it("says so when the runtime would not resume the conversation and the session was launched afresh", async () => {
    const { notes } = await launch([
      () => stopped(23, "sess-1"),
      (spec) => {
        writeFileSync(spec.artifactOut, "{}\n");
        return okResult({ sessionId: "sess-2", resume: { sessionId: "sess-1", refused: "No conversation found with session ID: sess-1" } });
      },
    ]);
    expect(notes.join(" ")).toContain("the runtime would not resume session sess-1 (No conversation found with session ID: sess-1), so it was launched afresh");
  });
});
