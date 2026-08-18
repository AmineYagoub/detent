import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { TABLE, apply, transitionKey } from "../../src/kernel/machine.js";
import { RunJournal } from "../../src/kernel/journal.js";
import { ZERO_COUNTERS } from "../../src/kernel/generations.js";
import { writeTicket, createTicket } from "../../src/kernel/tickets/mutations.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { transitionLineSchema } from "../../src/schemas/records.js";
import type { Event, State } from "../../src/schemas/states.js";
import type { Counters } from "../../src/schemas/ticket.js";
import { DEFAULT_BUDGETS, removeTree, tmpTree } from "../helpers.js";
import { initLayout } from "../../src/fs/layout.js";

/**
 * N-4 — kernel transition overhead (T-041 AC).
 *
 * Kernel overhead is the wall time from event construction to the transition
 * being durable: validate the journal line, apply the table, append the line,
 * persist the ticket. Gates and sessions are excluded by definition — here
 * they are stubbed to constant-time green by simply not existing.
 *
 * ≥500 transitions traversing every X-3 row at least once; p95 < 100 ms and
 * max < 500 ms; the per-component split is printed so a regression names its
 * cause. This file is normatively located by N-4 and runs in CI as a test.
 */

/** Counters that make every row's guard legal from zero state. */
function countersFor(from: State, event: Event): Counters {
  if (from === "RESEARCH" && event === "RESEARCH_VALID") return { ...ZERO_COUNTERS, research_sessions: 1 };
  return { ...ZERO_COUNTERS };
}

describe("N-4 transition overhead", () => {
  it("p95 < 100ms and max < 500ms over ≥500 durable transitions covering every X-3 row", () => {
    const root = tmpTree();
    initLayout(root);
    const journal = RunJournal.open(root);
    createTicket(root, { id: "bench", type: "bug", title: "bench", acceptance_criteria: ["x"] });

    const rows = [...TABLE.keys()].map((key) => {
      const [from, event] = key.split("|") as [State, Event];
      return { from, event };
    });
    expect(rows.length).toBeGreaterThan(40);

    const samples: number[] = [];
    const split = { validate: 0, apply: 0, append: 0, checkpoint: 0 };
    const ROUNDS = Math.ceil(500 / rows.length) + 1;

    try {
      for (let round = 0; round < ROUNDS; round += 1) {
        for (const { from, event } of rows) {
          const counters = countersFor(from, event);
          const started = performance.now();

          const t0 = performance.now();
          const result = apply(from, event, counters, { ticket: { type: "bug" }, budgets: DEFAULT_BUDGETS });
          const t1 = performance.now();

          const line = transitionLineSchema.parse({
            at: new Date().toISOString(),
            ticket: "bench",
            generation: 0,
            from: result.from,
            event,
            to: result.to,
            evidence: "bench",
            counters: result.counters,
          });
          const t2 = performance.now();

          journal.appendTransition(line);
          const t3 = performance.now();

          /**
           * The durable ticket write is N-4's "checkpoint" component: the
           * state that must survive a crash for C-9's resume to work.
           */
          const ticket = readTicket(root, "bench");
          writeTicket(root, { ...ticket, state: "READY" });
          const t4 = performance.now();

          split.apply += t1 - t0;
          split.validate += t2 - t1;
          split.append += t3 - t2;
          split.checkpoint += t4 - t3;
          samples.push(t4 - started);
        }
      }
    } finally {
      journal.close();
      removeTree(root);
    }

    expect(samples.length).toBeGreaterThanOrEqual(500);
    const sorted = [...samples].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] as number;
    const max = sorted.at(-1) as number;
    const n = samples.length;

    /* The per-component split, so a regression names its cause (N-4 AC). */
    console.log(
      `[N-4] n=${n} p95=${p95.toFixed(3)}ms max=${max.toFixed(3)}ms | per-transition avg: ` +
        `validate=${(split.validate / n).toFixed(3)}ms apply=${(split.apply / n).toFixed(3)}ms ` +
        `append=${(split.append / n).toFixed(3)}ms checkpoint=${(split.checkpoint / n).toFixed(3)}ms`,
    );

    expect(p95).toBeLessThan(100);
    expect(max).toBeLessThan(500);

    /** Sanity: the corpus really covered every row. */
    const covered = new Set(rows.map((r) => transitionKey(r.from, r.event)));
    expect(covered.size).toBe(TABLE.size);
  });
});
