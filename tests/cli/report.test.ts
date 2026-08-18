import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { METRIC_KEYS, buildReport, renderReport } from "../../src/cli/report.js";
import { LABEL_FOR_STATE, renderStatus } from "../../src/cli/status.js";
import { EXIT_OK, run } from "../../src/kernel/run.js";
import { STATES } from "../../src/schemas/states.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree } from "../helpers.js";
import { addTicket, implementGreen, implementRed, makeRunRepo, noopFix, researchValid, reviewApprove } from "../kernel/run-fixture.js";

/**
 * T-053 — status/report and the §14 metrics (C-12, C-13).
 *
 * The enumeration test pins the reporter's key set against the PRD's own §14
 * table, so a metric added there without a reporter fails CI — the check that
 * would have caught scope-canary going unreported.
 */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

describe("T-053 §14 enumeration (the metric key set equals the PRD table)", () => {
  it("the reporter has exactly one key per §14 row — both directions", () => {
    const prd = readFileSync("detent-prd-v2.md", "utf8");
    const section = prd.slice(prd.indexOf("## 14. Metrics"), prd.indexOf("## 15. Risks"));
    const rows = section
      .split("\n")
      .filter((l) => l.startsWith("| ") && !l.startsWith("| Metric") && !l.startsWith("|---"));
    /** One reporter key per PRD row; adding a row without a key fails here. */
    expect(rows).toHaveLength(METRIC_KEYS.length);
    expect(METRIC_KEYS).toHaveLength(8);
  });

  it("every §14 cell is non-empty (the markdown table lint the PRD's AC names)", () => {
    const prd = readFileSync("detent-prd-v2.md", "utf8");
    const section = prd.slice(prd.indexOf("## 14. Metrics"), prd.indexOf("## 15. Risks"));
    for (const row of section.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("|---"))) {
      for (const cell of row.split("|").slice(1, -1)) {
        expect(cell.trim(), row).not.toBe("");
      }
    }
  });
});

describe("T-053 report computes from artifacts alone (N-5)", () => {
  it("a mixed run produces every metric, with honest n/a where the denominator is empty", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    /** will complete autonomously */
    addTicket(root, { id: "t1" });
    /** will exhaust the ladder */
    addTicket(root, { id: "t2" });

    const backend = new MockBackend({
      "t1:implement": implementGreen,
      "t2:implement": implementRed,
      blind_fix: noopFix,
      research: researchValid,
      informed_fix: noopFix,
      review: reviewApprove,
    });
    await run({ root, backend, prompts: PROMPTS, runId: "report" });

    const report = buildReport(root, { baseBranch: "main" });
    /** t1 is the only DONE ticket and it never saw a human. */
    expect(report.autonomous_completion_rate.value).toBe(1);
    expect(report.autonomous_completion_rate.denominator).toBe(1);
    /** t1 took 2 sessions (implement + review); close-check launches none. */
    expect(report.median_sessions_per_completed_ticket.value).toBe(2);
    /** No canary corpus supplied: n/a, never a fake 100%. */
    expect(report.scope_canary_block_rate.value).toBeNull();
    /** A clean run writes the base exactly zero times (§14 target). */
    expect(report.base_branch_writes.value).toBe(0);
    /** One research entry, served live (no cache seeded). */
    expect(report.research_cache_hit_rate.value).toBe(0);
    expect(report.research_cache_hit_rate.denominator).toBe(1);
    /** The mock reports zero cache reads; the ratio is 0, not n/a. */
    expect(report.prompt_cache_read_rate.value).toBe(0);
    /** No crash was injected. */
    expect(report.crash_resume_correctness.value).toBeNull();
    expect(report.self_build_gate.value).toBe("not-yet-run");

    const rendered = renderReport(report);
    for (const key of METRIC_KEYS) expect(rendered).toContain(key);
  });

  it("an intervened DONE ticket lowers the autonomous rate — the numerator excludes it", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });

    /** Exhaust the ladder, then approve at the escalation after a hand-fix. */
    const backend = new MockBackend({
      implement: implementRed,
      blind_fix: noopFix,
      research: researchValid,
      informed_fix: noopFix,
      review: reviewApprove,
    });
    const { rmSync } = await import("node:fs");
    const outcome = await run({
      root,
      backend,
      prompts: PROMPTS,
      runId: "intervene",
      escalate: async () => {
        rmSync(`${root}/.fail`, { force: true });
        return { kind: "approve", by: "op" };
      },
    });
    expect(outcome.exitCode).toBe(EXIT_OK);

    const report = buildReport(root);
    expect(report.autonomous_completion_rate.denominator).toBe(1);
    /** DONE, but a human touched it */
    expect(report.autonomous_completion_rate.value).toBe(0);
  });
});

describe("T-053 C-13: the five-label vocabulary", () => {
  it("the mapping is total over the state vocabulary", () => {
    for (const state of STATES) {
      expect(LABEL_FOR_STATE[state], state).toBeTruthy();
    }
  });

  it("terminal snapshot contains no internal state names", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });
    addTicket(root, { id: "t2" });
    const backend = new MockBackend({
      "t1:implement": implementGreen,
      "t2:implement": implementRed,
      blind_fix: noopFix,
      research: researchValid,
      informed_fix: noopFix,
      review: reviewApprove,
    });
    await run({ root, backend, prompts: PROMPTS, runId: "status" });

    const snapshot = renderStatus(root);
    for (const state of STATES) {
      expect(snapshot, `status leaked ${state}`).not.toContain(state);
    }
    expect(snapshot).toContain("waiting on you");
    expect(snapshot).toContain("done");
    expect(snapshot).toContain("t2");
  });

  it("resume announces itself in user vocabulary, never internal state names", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });

    /** Crash mid-blind-fix, then resume with an announcer attached. */
    const crash = () => {
      throw new Error("boom");
    };
    await run({
      root,
      backend: new MockBackend({ implement: implementRed, blind_fix: crash }),
      prompts: PROMPTS,
      runId: "ann",
    });

    const announcements: string[] = [];
    const { rmSync } = await import("node:fs");
    rmSync(`${root}/.fail`, { force: true });
    await run({
      root,
      backend: new MockBackend({ review: reviewApprove }),
      prompts: PROMPTS,
      runId: "ann",
      announce: (m) => announcements.push(m),
    });

    expect(announcements.length).toBeGreaterThanOrEqual(1);
    expect(announcements[0]).toContain("resuming t1");
    for (const state of STATES) {
      expect(announcements.join(" "), `announcement leaked ${state}`).not.toContain(state);
    }
  });
});
