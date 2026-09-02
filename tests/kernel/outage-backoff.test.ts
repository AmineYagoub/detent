import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OUTAGE_BACKOFF_MS } from "../../src/kernel/driver.js";
import { EXIT_ERROR, EXIT_OK, run } from "../../src/kernel/run.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree } from "../helpers.js";
import { addTicket, implementGreen, makeRunRepo, reviewApprove } from "./run-fixture.js";

/**
 * PRDR-112 — an outage halt is right to detect and wrong to leave. Observed on
 * the certification gate: three $0 crashes in four seconds halted the run
 * correctly, and then it sat for eighty minutes until a person restarted it
 * and requeued t-160 with "not a finding against this ticket" — the twelfth
 * time that sentence was typed across three gates.
 */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

const crash = (turns: number): ReturnType<StageFn> => ({ ...okResult(), ok: false, crashed: true, turns });

describe("PRDR-112 outage backoff and the outage's victims", () => {
  it("backs off, retries, and the ticket the outage pushed to a human comes back by itself", { timeout: 120_000 }, async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-a", surface: ["src/feature-t-a.txt"] });
    addTicket(root, { id: "t-b", surface: ["src/feature-t-b.txt"] });

    /* t-a implements fine; its review crashes twice ($0) → NEEDS_HUMAN. Then t-b's implement crashes: three in a row. */
    let reviews = 0;
    let bImplements = 0;
    const backend = new MockBackend({
      implement: (spec) => {
        if (spec.ticketId === "t-b") {
          bImplements += 1;
          if (bImplements === 1) return crash(3);
        }
        return implementGreen(spec);
      },
      review: (spec) => {
        reviews += 1;
        return reviews <= 2 ? crash(2) : reviewApprove(spec);
      },
    });
    const sleeps: number[] = [];
    const announced: string[] = [];
    const outcome = await run({
      root,
      backend,
      prompts: PROMPTS,
      runId: "outage",
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      announce: (m) => announced.push(m),
    });

    expect(outcome.exitCode).toBe(EXIT_OK);
    /** One backoff, at the first level, then the backend was back. */
    expect(sleeps).toEqual([OUTAGE_BACKOFF_MS[0]]);
    expect(announced.some((m) => m.startsWith("backend outage — waiting 1 min"))).toBe(true);

    const ta = readTicket(root, "t-a");
    expect(ta.state).toBe("DONE");
    /** The outage pushed t-a to NEEDS_HUMAN; the pool brought it back without a person. */
    expect(ta.generations).toHaveLength(2);
    /** X-8 semantics: a re-queued generation reads `requeued`, exactly as after a human requeue. */
    expect(ta.generations[0]?.outcome).toBe("requeued");
    expect(ta.generations[1]?.reason).toContain("requeued after a backend outage");
    const notes = ta.notes.map((n) => n.text);
    expect(notes.some((n) => n.startsWith("outage:") && n.includes("not a finding against the ticket"))).toBe(true);
    expect(notes.some((n) => n.startsWith("requeued after outage (PRDR-112)"))).toBe(true);
    expect(readTicket(root, "t-b").state).toBe("DONE");

    /** The run journal keeps the window and the sessions it touched. */
    const journal = readFileSync(path.join(root, ".detent/runs/run/journal.jsonl"), "utf8");
    const outage = journal.split("\n").filter((l) => l.includes('"event":"outage"'));
    expect(outage).toHaveLength(1);
    const record = JSON.parse(outage[0] as string) as { sessions: { ticket: string; role: string }[] };
    expect(record.sessions.map((s) => `${s.ticket}/${s.role}`)).toEqual(["t-a/review", "t-a/review", "t-b/implement"]);
    const transitions = readFileSync(path.join(root, ".detent/transitions.jsonl"), "utf8");
    expect(transitions).toContain("OUTAGE_REQUEUE");
  });

  it("an outage that outlasts the ladder still exits 1, after every level was tried", { timeout: 120_000 }, async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-a" });
    /* Every role crashes: implement, then the review and its relaunch — a persistent outage. */
    const backend = new MockBackend({ implement: () => crash(4), review: () => crash(2) });
    const sleeps: number[] = [];
    const outcome = await run({
      root,
      backend,
      prompts: PROMPTS,
      runId: "outage-long",
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(outcome.exitCode).toBe(EXIT_ERROR);
    expect(outcome.summary.reason).toContain("backend outage");
    expect(sleeps).toEqual([...OUTAGE_BACKOFF_MS]);
  });
});
