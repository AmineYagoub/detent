import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderStatus } from "../../src/cli/status.js";
import { stateDir } from "../../src/fs/layout.js";
import { acquireRunLock } from "../../src/kernel/run-lock.js";
import { MEASURED, OWN_FIGURE_MIN, estimateStep, estimateText, median, sessionFigure, sliceFigure, span, type Unit } from "../../src/init/estimate.js";
import { clearProgress, estimator, progressLines, progressPath, readProgress, sliceFiguresPath } from "../../src/init/progress.js";
import type { LedgerRow } from "../../src/schemas/records.js";
import { definitionText } from "../docs/prd-marks.js";
import { removeTree } from "../helpers.js";

/**
 * N-5⁗ (PRDR-325) — the figures a costly step of `init` is estimated from,
 * the arithmetic, and the progress `detent status` reads.
 */

const REPO = path.resolve(import.meta.dirname, "..", "..");
const CHECK = { role: "audit", task: "verify_claims" } as const;
const OPUS_MAX = { model: "claude-opus-5-5", effort: "max" };
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

function root(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "detent-estimate-"));
  roots.push(dir);
  mkdirSync(path.join(stateDir(dir), "state"), { recursive: true });
  return dir;
}

const row = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  at: "2026-09-30T10:00:00.000Z",
  ticket: "init",
  generation: 0,
  role: "audit",
  cost_estimate_usd: 1,
  input_tokens: 1,
  output_tokens: 1,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  turns: 3,
  models: ["claude-haiku-4-5-20251001", "claude-opus-5-5"],
  phase: "AUDIT",
  task: "verify_claims",
  effort: "max",
  duration_ms: 60_000,
  ...over,
});

function ledger(dir: string, rows: readonly LedgerRow[]): void {
  appendFileSync(path.join(stateDir(dir), "ledger.jsonl"), rows.map((r) => `${JSON.stringify(r)}\n`).join(""));
}

describe("N-5⁗ a unit's figure", () => {
  it("is a median, so one long session does not move it", () => {
    expect(median([1, 2, 100])).toBe(2);
    expect(median([1, 2, 3, 100])).toBe(2.5);
  });

  it("is Detent's measured one, named with its run and build, until this project has five rows of the kind", () => {
    const four = [1, 2, 3, 4].map((n) => row({ cost_estimate_usd: n }));
    const figure = sessionFigure(four, CHECK, OPUS_MAX);
    expect(figure?.usd).toBe(2.86);
    expect(figure?.ms).toBe(7.8 * 60_000);
    expect(figure?.from).toBe(
      "Detent's measured figure for a claim check, $2.86 and 7.8 min on claude-opus-5-5 at max, the medians of tabachir's test run at build 34585b8, 171 ledger rows and 153 transcripts",
    );
  });

  it("is this project's own median from its fifth row of the same role, task, model and effort", () => {
    const rows = [1, 2, 3, 4, 50].map((n) => row({ cost_estimate_usd: n, duration_ms: n * 60_000 }));
    const figure = sessionFigure(rows, CHECK, OPUS_MAX);
    expect(OWN_FIGURE_MIN).toBe(5);
    expect(figure).toEqual({ usd: 3, ms: 180_000, from: "this project's own figure for a claim check, $3.00 and 3 min on claude-opus-5-5 at max, the medians of its 5 ledger rows" });
  });

  it("counts no row of another kind, model or effort, a crashed row, a row with no length, or a run's row", () => {
    const others = [
      row({ task: "survey" }),
      row({ effort: "high" }),
      row({ models: ["claude-opus-5"] }),
      row({ partial: "crash" }),
      row({ duration_ms: undefined }),
      row({ ticket: "t-1" }),
      row({ role: "spec_review" }),
    ];
    expect(sessionFigure([...others, row(), row(), row(), row()], CHECK, OPUS_MAX)?.from).toMatch(/^Detent's measured figure/u);
    expect(sessionFigure([...others, row(), row(), row(), row(), row()], CHECK, OPUS_MAX)?.from).toMatch(/^this project's own figure/u);
  });

  it("is none where neither the project nor Detent has measured the kind on its route", () => {
    expect(sessionFigure([], { role: "spec_write", task: "fix" }, OPUS_MAX)).toBeNull();
    expect(sessionFigure([], CHECK, { model: "claude-opus-5-5", effort: "high" })).toBeNull();
    expect(sessionFigure([], CHECK, { model: "", effort: "default" })).toBeNull();
  });

  it("is, for a slice, this project's median of the slices it planned on the same routes, and none before five", () => {
    const route = "planner on claude-opus-5-5 at max and plan_review on claude-opus-5-5 at max";
    const four = [1, 2, 3, 4].map((usd) => ({ route, usd, ms: usd * 60_000 }));
    expect(sliceFigure(four, route)).toBeNull();
    const five = [...four, { route, usd: 9, ms: 9 * 60_000 }, { route: "another", usd: 100, ms: 1 }];
    expect(sliceFigure(five, route)).toEqual({ usd: 3, ms: 180_000, from: `this project's own figure for a slice, $3.00 and 3 min with ${route}, the medians of the 5 it planned` });
  });

  it("MEASURED holds the claim check's and the review's figures, as N-5⁗ states them", () => {
    const text = (definitionText(readFileSync(path.join(REPO, "detent-prd-v3.md"), "utf8"), "N-5⁗")[0] ?? "").replace(/\s+/gu, " ");
    for (const m of MEASURED) {
      expect(text, `${m.role}/${m.task}`).toContain(`$${m.usd.toFixed(2)} and ${String(m.minutes)} minutes`);
    }
    expect(MEASURED.map((m) => `${m.role}/${m.task}`)).toEqual(["audit/verify_claims", "spec_review/review"]);
  });
});

describe("N-5⁗ a step's estimate", () => {
  const fixed = (usd: number, minutes: number) => (): { usd: number; ms: number; from: string } => ({ usd, ms: minutes * 60_000, from: "a figure" });

  it("is the units times the figure, and the wall clock the units a batch at a time", () => {
    const units: Unit[] = Array.from({ length: 117 }, () => CHECK);
    const e = estimateStep(units, 4, fixed(2.86, 7.8));
    expect(e.usd).toBeCloseTo(334.62, 2);
    expect(e.ms, "30 batches of four").toBe(30 * 7.8 * 60_000);
    expect(estimateText(e)).toBe("about $334.62 and 3 h 54 min, by a figure. An estimate, which nothing stops for (N-5⁗)");
    expect(estimateStep(units, 1, fixed(2.86, 7.8)).ms, "one at a time").toBe(117 * 7.8 * 60_000);
  });

  it("names the units with no figure yet, beside the estimate of the ones with one", () => {
    const units: Unit[] = [...Array.from({ length: 3 }, () => ({ role: "spec_review", task: "review" })), ...Array.from({ length: 2 }, () => ({ role: "spec_review", task: "verify" }))];
    const e = estimateStep(units, 4, (unit) => (unit !== "slice" && unit.task === "review" ? { usd: 10, ms: 1_800_000, from: "the review's figure" } : null));
    expect(estimateText(e)).toBe("about $30.00 and 30 min for the 3 with a figure, and none yet for the 2 verifying reviews, by the review's figure. An estimate, which nothing stops for (N-5⁗)");
    expect(estimateText(estimateStep(["slice"], 1, () => null))).toBe(
      "no estimate: neither this project's ledger nor Detent's measurements has a figure yet for the 1 slice on the routes they run on (N-5⁗)",
    );
  });

  it("says a length in minutes to a tenth under an hour, and in hours and minutes past it", () => {
    expect(span(30_000)).toBe("under a minute");
    expect(span(7.8 * 60_000)).toBe("7.8 min");
    expect(span(16 * 60_000)).toBe("16 min");
    expect(span(234 * 60_000)).toBe("3 h 54 min");
    expect(span(120 * 60_000)).toBe("2 h");
  });
});

describe("N-5⁗ a step's progress", () => {
  const clock = (start: number): { now: () => Date; advance: (ms: number) => void } => {
    let at = start;
    return { now: () => new Date(at), advance: (ms) => (at += ms) };
  };

  it("is written when the step begins, counted as each unit is done, and gone when it ends", () => {
    const dir = root();
    const notes: string[] = [];
    const t = clock(Date.parse("2026-09-30T10:00:00Z"));
    const step = estimator({ root: dir, note: (n) => notes.push(n), now: t.now, modelRouting: { audit: "claude-opus-5-5" }, effortRouting: { audit: "max" } }).begin({
      phase: "AUDIT",
      step: "AUDIT's claim checks",
      said: "AUDIT: 5 claims to check",
      units: Array.from({ length: 5 }, () => CHECK),
      atOnce: 4,
    });
    expect(notes).toEqual([
      "AUDIT: 5 claims to check — about $14.30 and 15.6 min, by Detent's measured figure for a claim check, $2.86 and 7.8 min on claude-opus-5-5 at max, the medians of tabachir's test run at build 34585b8, 171 ledger rows and 153 transcripts. An estimate, which nothing stops for (N-5⁗)",
    ]);
    expect(readProgress(dir)).toMatchObject({ phase: "AUDIT", step: "AUDIT's claim checks", units: 5, done: 0, at_once: 4, began: "2026-09-30T10:00:00.000Z", unit_ms: 468_000 });
    expect(readProgress(dir)?.usd).toBeCloseTo(14.3, 6);
    step.start().done();
    step.start().done();
    expect(readProgress(dir)?.done).toBe(2);
    step.end();
    expect(readProgress(dir)).toBeNull();
  });

  it("keeps what each slice's planning spent and took, and estimates the next slices from five of them", () => {
    const dir = root();
    const t = clock(Date.parse("2026-09-30T10:00:00Z"));
    const notes: string[] = [];
    const deps = { root: dir, note: (n: string) => notes.push(n), now: t.now };
    const step = estimator(deps).begin({ phase: "PLAN", step: "PLAN's slices", said: "PLAN: 5 of 5 slices to plan", units: ["slice", "slice", "slice", "slice", "slice"], atOnce: 1 });
    for (const usd of [4, 6, 5, 7, 3]) {
      const unit = step.start();
      ledger(dir, [row({ role: "planner", phase: "PLAN", task: undefined, cost_estimate_usd: usd })]);
      t.advance(usd * 60_000);
      unit.done();
    }
    step.end();
    const kept = (JSON.parse(readFileSync(sliceFiguresPath(dir), "utf8")) as { slices: { usd: number; ms: number }[] }).slices;
    expect(kept.map((s) => [s.usd, s.ms / 60_000])).toEqual([
      [4, 4],
      [6, 6],
      [5, 5],
      [7, 7],
      [3, 3],
    ]);
    estimator(deps).begin({ phase: "PLAN", step: "PLAN's slices", said: "PLAN: 2 of 5 slices to plan", units: ["slice", "slice"], atOnce: 1 });
    expect(notes.at(-1)).toBe(
      "PLAN: 2 of 5 slices to plan — about $10.00 and 10 min, by this project's own figure for a slice, $5.00 and 5 min with planner on the runtime's own model at default and plan_review on the runtime's own model at default, the medians of the 5 it planned. An estimate, which nothing stops for (N-5⁗)",
    );
  });

  it("begins no step with no units, and leaves the progress file as it was", () => {
    const dir = root();
    const notes: string[] = [];
    estimator({ root: dir, note: (n) => notes.push(n) }).begin({ phase: "AUDIT", step: "s", said: "AUDIT: 0 claims", units: [], atOnce: 4 });
    expect(notes).toEqual([]);
    expect(readProgress(dir)).toBeNull();
  });

  it("gives no estimate, and still runs, when the ledger cannot be read", () => {
    const dir = root();
    writeFileSync(path.join(stateDir(dir), "ledger.jsonl"), `${JSON.stringify({ not: "a ledger row" })}\n`);
    const notes: string[] = [];
    const step = estimator({ root: dir, note: (n) => notes.push(n) }).begin({ phase: "AUDIT", step: "s", said: "AUDIT: 1 claim to check", units: [CHECK], atOnce: 4 });
    step.start().done();
    step.end();
    expect(notes[0]).toMatch(/^AUDIT: 1 claim to check — no estimate, since the figures could not be read: .+ \(N-5⁗\)$/u);
  });
});

describe("N-5⁗ detent status during init", () => {
  function progress(dir: string, over: Record<string, unknown> = {}): void {
    writeFileSync(
      progressPath(dir),
      `${JSON.stringify({ schema_version: 2, pid: 4242, phase: "AUDIT", step: "AUDIT's claim checks", units: 117, done: 40, at_once: 4, began: "2026-09-30T08:00:00.000Z", unit_ms: 468_000, usd: 334.62, from: "Detent's measured figure", ...over })}\n`,
    );
  }

  it("shows the step, the units done and left, the step's spend so far and an estimated finish while its init runs", () => {
    const dir = root();
    progress(dir);
    ledger(dir, [row({ at: "2026-09-30T07:59:00.000Z", cost_estimate_usd: 9 }), row({ at: "2026-09-30T08:10:00.000Z", cost_estimate_usd: 3.5 }), row({ at: "2026-09-30T08:20:00.000Z", phase: "DECIDE", cost_estimate_usd: 7 })]);
    const lines = progressLines(dir, new Date("2026-09-30T10:00:00Z"), (pid) => pid === 4242);
    expect(lines.slice(0, 3)).toEqual(["", "`init` is running (N-5⁗) — an estimate, which nothing stops for:", "  AUDIT's claim checks: 40 of 117 done, 77 left, 4 at once; $3.50 spent on them so far"]);
    expect(lines[3], "20 batches of four left at 7.8 minutes").toMatch(/^ {2}estimated to finish in about 2 h 36 min, around \d\d:\d\d, by Detent's measured figure$/u);
  });

  it("says the step an init stopped in, and how to carry on, when no live init holds the root", () => {
    const dir = root();
    progress(dir, { done: 21, units: 26, step: "VALIDATE round 1's reviews", phase: "VALIDATE", at_once: 4 });
    expect(renderStatus(dir, new Date("2026-09-30T10:00:00Z"), () => false)).toContain(
      "`init` stopped in VALIDATE round 1's reviews: 21 of 26 done, 5 left, 4 at once; $0.00 spent on them so far. Re-run `detent init` to carry on (C-8).",
    );
  });

  it("reads the step as stopped when the process that began it does not hold the root", () => {
    const dir = root();
    progress(dir);
    expect(renderStatus(dir), "no lock at all").toContain("`init` stopped in AUDIT's claim checks: 40 of 117 done");
    const lock = acquireRunLock(dir);
    if (!lock.ok) throw new Error("the test could not take the run lock");
    try {
      expect(renderStatus(dir), "the lock is this process's, not the step's pid 4242").toContain("`init` stopped in AUDIT's claim checks");
      progress(dir, { pid: process.pid });
      expect(renderStatus(dir), "the step's own process holds it").toContain("`init` is running (N-5⁗)");
    } finally {
      lock.release();
    }
  });

  it("gives no finish where the step's units have no figure, and shows nothing once the progress is cleared", () => {
    const dir = root();
    progress(dir, { unit_ms: null, usd: null, from: null });
    expect(progressLines(dir, new Date(), () => true)[3]).toBe("  no estimated finish: nothing has measured these units yet");
    clearProgress(dir);
    expect(progressLines(dir, new Date(), () => true)).toEqual([]);
  });

  it("puts a finish on another day with its date", () => {
    const dir = root();
    progress(dir, { done: 0, units: 400, at_once: 1, unit_ms: 3_600_000 });
    const line = progressLines(dir, new Date("2026-09-30T10:00:00Z"), () => true)[3] ?? "";
    expect(line).toMatch(/around \d{4}-\d\d-\d\d \d\d:\d\d, by/u);
  });
});
