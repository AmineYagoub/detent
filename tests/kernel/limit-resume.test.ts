import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { currentCounters } from "../../src/kernel/generations.js";
import { EXIT_ERROR, EXIT_OK, run } from "../../src/kernel/run.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { limitStop, refusedResumeNote, turnsCarried } from "../../src/kernel/session-resume.js";
import { RunJournal } from "../../src/kernel/journal.js";
import { MockBackend, okResult, resultFromSdk } from "../../src/sessions/mock.js";
import type { SessionResult, SessionSpec } from "../../src/sessions/backend.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { OUTAGE_BACKOFF_MS } from "../../src/schemas/backend-limit.js";
import { gitInit, removeTree, tmpTree } from "../helpers.js";
import { addTicket, implementGreen, makeRunRepo, reviewApprove } from "./run-fixture.js";

/**
 * X-8″ (PRDR-321) — `run` waits for the reset a usage limit names, as `init`
 * has since PRDR-189, and the next launch of the stopped role carries on its
 * conversation. The headless driver waited 1, 5 and 15 minutes whatever the
 * limit said, then exited, and a session stopped after its first turn was a
 * crash whose half-done tree PRDR-053 judged as its work.
 */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

const limitAt = (reset: string): string => `Claude Code returned an error result: You've hit your session limit · resets ${reset} (Africa/Algiers)`;
/** 12:00 in Algiers (UTC+1). */
const NOON = Date.parse("2026-09-30T11:00:00Z");

/** What the SDK backend returns for a session the limit stopped after `turns` turns (`sdk.ts`'s crash path). */
function stopped(turns: number, sessionId: string, tail: string): SessionResult {
  return {
    ...resultFromSdk({ type: "result", subtype: "error_during_execution", is_error: true, num_turns: turns, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 }, result: tail }),
    costEstimateUsd: 1.25,
    crashed: true,
    sessionId,
  };
}

function journalOf(root: string, id: string): Record<string, unknown>[] {
  return readFileSync(path.join(root, ".detent", "runs", id, "journal.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("X-8″ run waits for a limit's reset and resumes the stopped session", () => {
  it("waits for the stated reset, not the ladder's minute, and the next launch resumes the conversation as the same attempt", { timeout: 120_000 }, async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-a", surface: ["src/feature-t-a.txt"] });
    const launches: SessionSpec[] = [];
    const backend = new MockBackend({
      implement: (spec) => {
        launches.push(spec);
        if (launches.length === 1) return stopped(12, "sess-1", limitAt("3pm"));
        return { ...implementGreen(spec), turns: 5, sessionId: "sess-1", resume: { sessionId: "sess-1" } };
      },
      review: reviewApprove,
    });
    const sleeps: number[] = [];
    const announced: string[] = [];
    const outcome = await run({
      root,
      backend,
      prompts: PROMPTS,
      runId: "limit",
      now: () => NOON,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      announce: (m) => announced.push(m),
    });

    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(sleeps, "three hours and the minute's margin, not one minute").toEqual([(3 * 60 + 1) * 60_000]);
    const wait = announced.find((m) => m.startsWith("backend limit — waiting 181 min for the stated reset, resets 3pm (Africa/Algiers)"));
    expect(wait, announced.join("\n")).toBeDefined();
    expect(wait).toContain("implement session sess-1 for t-a after 12 turns; it resumes where it stopped");

    expect(launches.map((s) => s.resume?.sessionId)).toEqual([undefined, "sess-1"]);
    const ticket = readTicket(root, "t-a");
    expect(ticket.state).toBe("DONE");
    expect(ticket.generations, "a limit is no failure of the ticket's: no requeue").toHaveLength(1);
    expect(currentCounters(ticket).sessions, "implement once, resumed, and review once").toBe(2);

    const events = journalOf(root, "t-a").filter((e) => e["stage"] === "implement");
    const ends = events.filter((e) => e["event"] === "end");
    expect(ends[0]?.["stopped_by_limit"]).toEqual({ session_id: "sess-1", turns: 12 });
    expect(ends[1]?.["stopped_by_limit"]).toBeUndefined();
    expect(events.filter((e) => e["event"] === "start").map((e) => e["resumes"])).toEqual([undefined, "sess-1"]);

    const rows = readFileSync(path.join(root, ".detent", "ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    const stoppedRow = rows.find((r) => r["role"] === "implement" && r["partial"] === "crash");
    expect(stoppedRow?.["cost_estimate_usd"], "what the stopped half spent is on the ledger").toBe(1.25);
  });

  it("waits out a limit that stopped a session before its first turn to its reset too, and launches the next one afresh", { timeout: 120_000 }, async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-a", surface: ["src/feature-t-a.txt"] });
    const launches: SessionSpec[] = [];
    const backend = new MockBackend({
      implement: (spec) => {
        launches.push(spec);
        return launches.length === 1 ? { ...stopped(0, "sess-1", limitAt("3pm")), costEstimateUsd: 0 } : implementGreen(spec);
      },
      review: reviewApprove,
    });
    const sleeps: number[] = [];
    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "limit-zero", now: () => NOON, sleep: async (ms) => { sleeps.push(ms); } });
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(sleeps, "the stated reset, not the ladder's first minute").toEqual([(3 * 60 + 1) * 60_000]);
    expect(launches.map((s) => s.resume)).toEqual([undefined, undefined]);
  });

  it("launches afresh, with a note, when the runtime would not resume the conversation", { timeout: 120_000 }, async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-a", surface: ["src/feature-t-a.txt"] });
    let n = 0;
    const backend = new MockBackend({
      implement: (spec) => {
        n += 1;
        if (n === 1) return stopped(12, "sess-1", limitAt("3pm"));
        return { ...implementGreen(spec), sessionId: "sess-2", resume: { sessionId: "sess-1", refused: "No conversation found with session ID: sess-1" } };
      },
      review: reviewApprove,
    });
    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "limit-refused", now: () => NOON, sleep: async () => undefined });
    expect(outcome.exitCode).toBe(EXIT_OK);
    const notes = readTicket(root, "t-a").notes.map((x) => x.text);
    expect(notes.some((t) => t.startsWith("the runtime would not resume implement session sess-1 (No conversation found with session ID: sess-1), so it was launched afresh"))).toBe(true);
  });

  it("hands the decision back when the reset is further off than it will wait", { timeout: 120_000 }, async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-a", surface: ["src/feature-t-a.txt"] });
    const backend = new MockBackend({ implement: () => stopped(12, "sess-1", limitAt("11pm")), review: reviewApprove });
    const sleeps: number[] = [];
    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "limit-far", now: () => NOON, sleep: async (ms) => { sleeps.push(ms); } });
    expect(outcome.exitCode).toBe(EXIT_ERROR);
    expect(outcome.summary.reason).toContain("longer than this will wait (360 min)");
    expect(sleeps).toEqual([]);
  });

  it("keeps the ladder for a limit that names no reset", { timeout: 120_000 }, async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-a", surface: ["src/feature-t-a.txt"] });
    let n = 0;
    const backend = new MockBackend({
      implement: (spec) => {
        n += 1;
        return n === 1 ? stopped(12, "sess-1", "Claude Code returned an error result: You've hit your weekly limit") : { ...implementGreen(spec), resume: { sessionId: "sess-1" } };
      },
      review: reviewApprove,
    });
    const sleeps: number[] = [];
    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "limit-weekly", now: () => NOON, sleep: async (ms) => { sleeps.push(ms); } });
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(sleeps).toEqual([OUTAGE_BACKOFF_MS[0]]);
  });
});

describe("X-8″ a resumed review keeps what it wrote", () => {
  it("a review the limit stopped after writing its verdict is resumed with its artifact in place, and not launched a third time", { timeout: 120_000 }, async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-a", surface: ["src/feature-t-a.txt"] });
    const reviews: SessionSpec[] = [];
    const backend = new MockBackend({
      implement: implementGreen,
      review: (spec) => {
        reviews.push(spec);
        if (reviews.length === 1) {
          reviewApprove(spec);
          return stopped(9, "sess-r", limitAt("3pm"));
        }
        if (reviews.length === 2) return okResult({ turns: 1, sessionId: "sess-r", resume: { sessionId: "sess-r" } });
        return reviewApprove(spec);
      },
    });
    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "limit-review", now: () => NOON, sleep: async () => undefined });
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(reviews.map((s) => s.resume?.sessionId)).toEqual([undefined, "sess-r"]);
    expect(readTicket(root, "t-a").state).toBe("DONE");
  });
});

describe("X-8″ the journal keeps the stopped conversation", () => {
  it("names the conversation the last end of a role's generation stopped, and none once a later session of it ended", () => {
    const root = tmpTree({});
    roots.push(root);
    gitInit(root);
    mkdirSync(path.join(root, ".detent"), { recursive: true });
    const journal = RunJournal.open(root);
    try {
      expect(journal.stoppedConversation("t-a", "review", 0), "no journal yet").toBeNull();
      journal.appendTicketEvent("t-a", { stage: "review", event: "start", generation: 0 });
      journal.appendTicketEvent("t-a", { stage: "review", event: "end", generation: 0, ok: false, stopped_by_limit: { session_id: "s1", turns: 7 } });
      appendFileSync(journal.ticketJournalPath("t-a"), '{"stage":"review","event":"en');
      appendFileSync(journal.ticketJournalPath("t-a"), "\n");
      expect(journal.stoppedConversation("t-a", "review", 0)).toEqual({ sessionId: "s1", turns: 7 });
      expect(journal.stoppedConversation("t-a", "review", 1), "another generation").toBeNull();
      expect(journal.stoppedConversation("t-a", "implement", 0), "another role").toBeNull();
      journal.appendTicketEvent("t-a", { stage: "review", event: "start", generation: 0, resumes: "s1" });
      journal.appendTicketEvent("t-a", { stage: "review", event: "end", generation: 0, ok: true });
      expect(journal.stoppedConversation("t-a", "review", 0), "the resumed session finished").toBeNull();
    } finally {
      journal.close();
    }
  });
});

describe("X-8″ what a stop records", () => {
  const limit = (turns: number, over: Partial<SessionResult> = {}): SessionResult => ({ ...stopped(turns, "sess-1", limitAt("3pm")), ...over });

  it("a stop after the first turn keeps its conversation and refuses, so the driver waits", () => {
    const stop = limitStop("t-a", "implement", limit(12), 0);
    expect(stop.end).toEqual({ stopped_by_limit: { session_id: "sess-1", turns: 12 } });
    expect(stop.refusal).toContain("backend limit stopped implement session sess-1 for t-a after 12 turns");
  });

  it("a resumed attempt counts both halves' turns, and one stopped before its first turn keeps the conversation it resumed", () => {
    expect(limitStop("t-a", "research", okResult({ turns: 5, resume: { sessionId: "sess-1" } }), 12)).toEqual({ end: {}, attemptTurns: 17, refusal: null });
    const again = limitStop("t-a", "implement", limit(0, { resume: { sessionId: "sess-1" } }), 12);
    expect(again.end).toEqual({ stopped_by_limit: { session_id: "sess-1", turns: 12 } });
    expect(again.refusal, "a stop before any turn takes the zero-turn refusal every such session takes").toBeNull();
  });

  it("counts the stopped half's turns only when the launch resumed it, and notes a resume the runtime would not make", () => {
    const resumed = okResult({ resume: { sessionId: "sess-1" } });
    const refused = okResult({ resume: { sessionId: "sess-1", refused: "No conversation found with session ID: sess-1" } });
    expect(turnsCarried({ turns: 12 }, resumed)).toBe(12);
    expect(turnsCarried({ turns: 12 }, refused)).toBe(0);
    expect(turnsCarried(null, okResult())).toBe(0);
    expect(refusedResumeNote("review", resumed)).toBeNull();
    expect(refusedResumeNote("review", refused)).toBe("the runtime would not resume review session sess-1 (No conversation found with session ID: sess-1), so it was launched afresh (X-8″)");
  });

  it("a crash that is no limit keeps no conversation", () => {
    const crash = limitStop("t-a", "implement", limit(12, { rawTail: "Claude Code returned an error result: socket hang up" }), 0);
    expect(crash).toEqual({ end: {}, attemptTurns: 12, refusal: null });
  });
});
