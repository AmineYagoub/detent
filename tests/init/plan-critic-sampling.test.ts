import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { runInit } from "../../src/init/machine.js";
import { buildPipeline } from "../../src/init/pipeline.js";
import { planReviewPath, type ReviewDeps } from "../../src/init/plan-review.js";
import { FIRST_RESPONSE_WAIT_MS, sampleReviewPlan } from "../../src/init/plan-sample.js";
import { launchInitSession, type InitSessionDeps } from "../../src/init/session.js";
import { RunJournal } from "../../src/kernel/journal.js";
import { planDraftSchema } from "../../src/schemas/init.js";
import type { SessionBackend, SessionSpec } from "../../src/sessions/backend.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { ANALYSIS, APPROVE_PLAN, BUDGETS, DRAFT, LONE_CANDIDATE, ONE_SLICE, PROMPTS, repo } from "./plan-fixture.js";
import { ticket } from "./slicing-fixture.js";

/**
 * C-4⁗″ (PRDR-200) — the review is sampled, and only what recurs buys the revision.
 *
 * The fixture is not invented. These are the three finding sets `s01` actually
 * produced when the production `reviewPlan` was run three times over
 * byte-identical tickets with no redraft between the passes, ids remapped onto
 * this repo's: two findings recur, six appear once.
 *
 * A fake reviewer that answers the same thing every time would make this test
 * vacuous — with a deterministic critic k=1 and k=3 are the same run, and the
 * assertion below passes before and after any fix. The critic's disagreement
 * with itself IS the fixture; that is the whole defect.
 */

const IDS = ["t-100", "t-101", "t-102", "t-103", "t-104"];

const f = (ticket: string, tag: string): object => ({ tag, finding: `${ticket} is ${tag}`, ticket });

/** The measured reads. `t-100/dependency` and `t-102/sizing` are the only two that recur. */
const READS: readonly (readonly object[])[] = [
  [f("t-100", "dependency"), f("t-102", "coherence"), f("t-102", "sizing")],
  [f("t-100", "dependency"), f("t-101", "sizing"), f("t-102", "sizing"), f("t-101", "testability")],
  [f("t-103", "sizing"), f("t-102", "dependency"), f("t-104", "coherence")],
];

const RECUR = ["t-100 dependency", "t-102 sizing"];

const TICKETS = planDraftSchema.parse({ schema_version: 1, tickets: IDS.map((id) => ticket(id)), questions: [] }).tickets;

const keyOf = (x: unknown): string => {
  const r = x as { ticket?: string; tag?: string };
  return `${r.ticket ?? ""} ${r.tag ?? ""}`;
};

/** A planner whose REVIEW_PLAN answers come from a script and whose draft inputs are captured. */
function scripted(reads: readonly (readonly object[])[]): {
  stage: StageFn;
  draftFindings: unknown[][];
} {
  let n = 0;
  const draftFindings: unknown[][] = [];
  const stage: StageFn = (spec) => {
    const inputs = (JSON.parse(spec.promptVariable) as { inputs: Record<string, unknown> }).inputs;
    let artifact: object;
    if (spec.artifactOut.endsWith("plan-draft.json")) {
      /* PRDR-084 passes the revision's findings as `review_findings` (plan.ts:209). */
      if (inputs["review_findings"] !== undefined) draftFindings.push(inputs["review_findings"] as unknown[]);
      artifact = DRAFT(IDS);
    } else if (spec.artifactOut.endsWith("plan-review.json")) {
      const read = n < reads.length ? reads[n] : undefined;
      n += 1;
      artifact = read === undefined ? APPROVE_PLAN : { schema_version: 1, verdict: "changes", findings: read };
    } else if (spec.artifactOut.endsWith("slices.json")) {
      artifact = ONE_SLICE;
    } else {
      artifact = ANALYSIS(null);
    }
    writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
    return okResult();
  };
  return { stage, draftFindings };
}

async function init(stage: StageFn): Promise<{ backend: MockBackend; notes: string[]; message: string }> {
  const root = repo(LONE_CANDIDATE);
  const backend = new MockBackend({ planner: stage });
  const notes: string[] = [];
  const result = await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS, note: (t) => notes.push(t) }));
  return { backend, notes, message: result.interrupt?.message ?? "" };
}

const reviews = (b: MockBackend): number => b.calls.filter((c) => c.spec.artifactOut.endsWith("plan-review.json")).length;

describe("C-4⁗″ the review is sampled and only what recurs buys the revision", () => {
  it("hands the reviser the findings that recurred, and not the ones seen once", async () => {
    const { stage, draftFindings } = scripted(READS);
    await init(stage);

    /**
     * The whole ticket in one assertion. Before PRDR-200 this is the FIRST
     * read's three findings — two of which no second read ever saw — and the
     * revision pays an index-carrying session to chase them.
     */
    expect(draftFindings[0]?.map(keyOf).sort()).toEqual([...RECUR].sort());
  });

  it("samples the review k times before revising, not once", async () => {
    const { stage } = scripted(READS);
    const { backend } = await init(stage);
    /* three samples, then one re-review of the revised draft */
    expect(reviews(backend)).toBe(4);
  });

  it("announces the k and the threshold that produced the findings (PRDR-197)", async () => {
    const { stage } = scripted(READS);
    const { notes } = await init(stage);
    expect(notes.some((t) => /sampled 3.*2 of 3|3 sample|recurr/i.test(t))).toBe(true);
  });

  it("the findings seen once reach PRESENT marked as such, apart from what survived a revision (D-24′, PRDR-209)", async () => {
    const { stage } = scripted(READS);
    const { message } = await init(stage);
    /* Six findings were seen in one read only; PRESENT says so on each, rather than listing them as if they had survived. */
    expect(message).toMatch(/coherence \(t-102\)[^\n]*seen once/);
  });

  it("a reviewer that agrees with itself loses nothing to the filter", async () => {
    const same = [READS[0] ?? [], READS[0] ?? [], READS[0] ?? []];
    const { stage, draftFindings } = scripted(same);
    await init(stage);
    expect(draftFindings[0]?.map(keyOf).sort()).toEqual((READS[0] ?? []).map(keyOf).sort());
  });
});

/**
 * D-28′ (PRDR-203) — a batch of draws is gated once, as one in-flight unit.
 *
 * D-25 evaluates the launch gate at launch and D-28 bounds the overshoot at one
 * in-flight session. Three draws that will one day launch together all pass the
 * gate at the same figure, so the bound is the batch, k sessions — and it has to
 * be the batch whether the draws run together or one after another, or the
 * bound would depend on scheduling. The breaker here allows exactly one mean
 * session's worth of spend, so a per-launch bound would have stopped the third
 * draw.
 *
 * PRDR-265: the breaker refuses nothing now, and D-28′'s property survives as
 * the thing that replaced it. "Gated once per batch" becomes "said once per
 * no-progress episode" — the same claim that the figure is evaluated against
 * the unit of work rather than the individual launch, and the same failure it
 * was written against: an operator told the same thing four times learns to
 * scroll past it, exactly as a driver refused mid-batch learned nothing.
 */
describe("D-28′ a batch of review draws is accounted once", () => {
  it("runs every draw, says it once, and does not refuse the launch after the batch", async () => {
    const root = repo();
    const journal = RunJournal.open(root);
    const backend: SessionBackend = {
      name: "a-dollar-a-session",
      checkVersion: async () => {},
      run: async (spec) => {
        writeFileSync(spec.artifactOut, `${JSON.stringify(APPROVE_PLAN)}\n`);
        return okResult({ costEstimateUsd: 1 });
      },
    };
    const said: string[] = [];
    const init: InitSessionDeps = {
      root,
      backend,
      prompts: PROMPTS,
      spendCeiling: 0,
      journal,
      note: (t) => said.push(t),
      /* One mean session: $1 once the first draw has been paid for. */
      progressBreaker: { spend_without_progress_floor_usd: 0, spend_without_progress_multiple: 1, spend_without_progress_sessions: 1 },
    };
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
      const review = await sampleReviewPlan(deps, TICKETS);
      expect(review?.reads, "all three draws ran").toHaveLength(3);
      await launchInitSession(init, {
        role: "planner",
        inputs: {},
        artifactOut: path.join(stateDir(root), "state", "after.json"),
      });
      /**
       * Three draws and the launch after them produce ONE accounting, because
       * the batch is gated once — gated per draw, draws two and three would
       * each have spoken. The say-once flag is a separate mechanism, pinned in
       * `tests/kernel/x1-counting.test.ts`; this line would pass with or
       * without it, and it is the batch that D-28′ is about.
       */
      expect(
        said.filter((t) => t.includes("no-progress breaker")),
        "the batch is accounted as one unit, not once per draw",
      ).toHaveLength(1);
    } finally {
      journal.close();
    }
  });
});

/**
 * C-4⁗‴ (PRDR-204) — the draws launch together, and the second waits for the
 * first to answer.
 *
 * A reviewer the test drives by hand: every session reports its first model
 * response only when told, holds until released, and answers with a finding
 * that names which launch it was. `sleep` is injected so the bounded wait can
 * be made to never fire (the ordering tests) or to fire at once (the fallback).
 */
function drivenReviewer(): {
  readonly backend: SessionBackend;
  readonly launches: () => number;
  readonly respond: (n: number) => void;
  readonly release: (n: number) => void;
} {
  const sessions: { respond: () => void; release: () => void }[] = [];
  const backend: SessionBackend = {
    name: "driven",
    checkVersion: async () => {},
    run: async (spec) => {
      const n = sessions.length + 1;
      let respond!: () => void;
      let release!: () => void;
      const responded = new Promise<void>((r) => {
        respond = r;
      });
      const released = new Promise<void>((r) => {
        release = r;
      });
      sessions.push({ respond, release });
      void responded.then(() => spec.onFirstResponse?.());
      await released;
      writeFileSync(
        spec.artifactOut,
        `${JSON.stringify({ schema_version: 1, verdict: "changes", findings: [{ tag: "sizing", finding: `draw ${String(n)}`, ticket: `t-${String(n)}` }] })}\n`,
      );
      return okResult();
    },
  };
  const at = (n: number): { respond: () => void; release: () => void } => {
    const s = sessions[n - 1];
    if (s === undefined) throw new Error(`no session ${String(n)} has been launched (${String(sessions.length)} so far)`);
    return s;
  };
  return { backend, launches: () => sessions.length, respond: (n) => at(n).respond(), release: (n) => at(n).release() };
}

/** Let every queued microtask and the stagger's own race settle. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await new Promise<void>((r) => setTimeout(r, 0));
};

const NEVER = (): Promise<void> => new Promise<void>(() => {});

function drivenDeps(root: string, backend: SessionBackend, journal: RunJournal, sleep: (ms: number) => Promise<void>, notes: string[] = []): ReviewDeps {
  const init: InitSessionDeps = { root, backend, prompts: PROMPTS, spendCeiling: 0, journal };
  return {
    root,
    docs: [],
    budgets: BUDGETS,
    sleep,
    note: (t) => notes.push(t),
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
}

describe("C-4⁗‴ the draws launch together", () => {
  it("launches the second and third draws once the first has answered, not before and not after it returns", async () => {
    const root = repo();
    const journal = RunJournal.open(root);
    const r = drivenReviewer();
    const notes: string[] = [];
    try {
      const pending = sampleReviewPlan(drivenDeps(root, r.backend, journal, NEVER, notes), TICKETS);
      await settle();
      expect(r.launches(), "one draw in flight until it answers — the stagger (S-6)").toBe(1);
      r.respond(1);
      await settle();
      /* Before PRDR-204 this stays at one: the loop awaited the whole first draw. */
      expect(r.launches(), "the rest launch on the first response").toBe(3);
      expect(notes.some((n) => /the first began its answer after \d+ s — launching 2 more/.test(n)), "and says so").toBe(true);
      for (const n of [1, 2, 3]) r.release(n);
      const review = await pending;
      expect(review?.reads).toHaveLength(3);
    } finally {
      journal.close();
    }
  });

  it("collects the reads in launch order whatever order the draws complete in (PRDR-203's fifth criterion)", async () => {
    const root = repo();
    const journal = RunJournal.open(root);
    const r = drivenReviewer();
    try {
      const pending = sampleReviewPlan(drivenDeps(root, r.backend, journal, NEVER), TICKETS);
      await settle();
      r.respond(1);
      await settle();
      expect(r.launches()).toBe(3);
      for (const n of [3, 2, 1]) {
        r.release(n);
        await settle();
      }
      const review = await pending;
      expect(review?.reads.map((read) => read[0]?.ticket), "the third draw finished first and is still read third").toEqual(["t-1", "t-2", "t-3"]);
    } finally {
      journal.close();
    }
  });

  it("launches the rest after the bounded wait when the first never answers", async () => {
    const root = repo();
    const journal = RunJournal.open(root);
    const r = drivenReviewer();
    let waited: number | null = null;
    try {
      const atOnce = async (ms: number): Promise<void> => {
        waited = ms;
      };
      const notes: string[] = [];
      const pending = sampleReviewPlan(drivenDeps(root, r.backend, journal, atOnce, notes), TICKETS);
      await settle();
      expect(r.launches(), "the wait ran out, the rest launched").toBe(3);
      expect(waited, "and it was the named wait, not an ad-hoc one").toBe(FIRST_RESPONSE_WAIT_MS);
      expect(notes.some((n) => n.includes("did not begin answering in time")), "and says which way it went").toBe(true);
      for (const n of [1, 2, 3]) r.release(n);
      await pending;
    } finally {
      journal.close();
    }
  });
});

/**
 * PRDR-205 — the draws share one first turn again.
 *
 * PRDR-203 gave each draw its own artifact and put its path at the tail of the
 * one user message the SDK is handed, so the three first turns differed in
 * their last few dozen bytes and the prompt cache missed the whole block for
 * the second and third — measured at about 25k tokens a draw (PRDR-204). The
 * draws are now TOLD one path; each still has its own file.
 */
describe("PRDR-205 the k draws hand the backend one first turn", () => {
  it("byte-identical prefix and variable for every draw, each with its own file, all told the one path", async () => {
    const root = repo();
    const journal = RunJournal.open(root);
    const specs: SessionSpec[] = [];
    const backend: SessionBackend = {
      name: "recording",
      checkVersion: async () => {},
      run: async (spec) => {
        specs.push(spec);
        writeFileSync(spec.artifactOut, `${JSON.stringify(APPROVE_PLAN)}\n`);
        return okResult();
      },
    };
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
      await sampleReviewPlan(deps, TICKETS);
      expect(specs).toHaveLength(3);
      expect(new Set(specs.map((s) => s.promptPrefix)).size, "one prefix (S-6)").toBe(1);
      /* Before PRDR-205 this is three: `artifact_out` differed at the tail, and the cache key with it. */
      expect(new Set(specs.map((s) => s.promptVariable)).size, "one first turn — the cache key").toBe(1);
      expect(specs.map((s) => path.relative(root, s.artifactOut)), "and still a file each").toEqual(
        [1, 2, 3].map((n) => path.join(".detent", "state", "draws", String(n), "plan-review.json")),
      );
      expect(new Set(specs.map((s) => s.artifactTold)), "every draw told the one shared path").toEqual(new Set([planReviewPath(root)]));
    } finally {
      journal.close();
    }
  });
});
