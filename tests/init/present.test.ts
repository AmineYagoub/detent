import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { presentStage, renderPresentation, type PresentInput } from "../../src/init/present.js";
import { presentInputsFromOutputs } from "../../src/init/present-inputs.js";
import { newTicket } from "../../src/kernel/tickets/mutations.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import type { PlanFinding, PlanRisk } from "../../src/schemas/init.js";
import type { Binding } from "../../src/schemas/records.js";
import type { Ticket } from "../../src/schemas/ticket.js";
import { removeTree } from "../helpers.js";

/**
 * C-4⁸ (PRDR-294) — what PRESENT shows of the plan's review.
 *
 * Each slice's review read its draft once, and a blocker or major bought one
 * revision that nothing read again, so each is shown as a risk with the fix it
 * asked for. The minors, and the repairs code made to drafts, went to the
 * sessions that run their tickets: PRESENT counts them and lists none. D-24′'s
 * labels, its advice file and PRDR-196's revision and churn lines are gone
 * with the sampled reads they measured.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

function root(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "detent-present-"));
  roots.push(dir);
  mkdirSync(path.join(dir, ".detent", "state"), { recursive: true });
  return dir;
}

const base = (dir: string): PresentInput => ({ root: dir, tickets: [], bindings: [], skips: [], bootstrap: null, assignments: {}, slices: [], derivedEdges: [], gateNotices: [] });

const risk = (slice: string, ticket: string, severity: PlanRisk["severity"], finding: string): PlanRisk => ({
  slice,
  ticket,
  severity,
  tag: "sizing",
  finding,
  fix: `split what ${finding} names`,
});

const minors = (n: number): PlanFinding[] =>
  Array.from({ length: n }, (_, i) => ({ tag: "coherence" as const, ticket: `t-s01-${String(i).padStart(3, "0")}`, finding: `minor finding ${String(i)}`, severity: "minor" as const, fix: "say so" }));

describe("C-4⁸ PRESENT shows the review's risks, the slices it did not read, and a count of what it recorded", () => {
  it("lists each blocker and major as a risk, with its slice, ticket, grade, tag and fix, blockers first", () => {
    const text = renderPresentation({ ...base("/tmp/x"), reviewRisks: [risk("s02", "t-s02-001", "major", "the major"), risk("s01", "t-s01-003", "blocker", "the blocker")] });
    expect(text).toMatch(/Plan review risks \(2\)/u);
    expect(text).toContain("s01 t-s01-003 [blocker sizing]: the blocker");
    expect(text).toContain("fix: split what the blocker names");
    expect(text.indexOf("the blocker"), "a blocker leads").toBeLessThan(text.indexOf("the major"));
    expect(text).toMatch(/no review read again/u);
  });

  it("names a slice no review read, and why", () => {
    const text = renderPresentation({ ...base("/tmp/x"), unreviewed: [{ slice: "s03", reason: "its draft fails 2 check(s) after its redraft" }] });
    expect(text).toContain("s03: not reviewed — its draft fails 2 check(s) after its redraft");
  });

  it("counts the minors recorded on tickets and lists none of them, however many there are", () => {
    const text = renderPresentation({ ...base("/tmp/x"), findings: minors(30) });
    expect(text).toMatch(/Minor review findings \(30\) are recorded on their tickets/u);
    expect(text).not.toContain("minor finding 7");
  });

  it("lists what code did to a draft, since code decided it on the operator's behalf (A-1″)", () => {
    const repair: PlanFinding = { tag: "dependency", ticket: "t-s02-001", finding: "depends on t-s09-999, which no slice planned — the edge was dropped" };
    const text = renderPresentation({ ...base("/tmp/x"), findings: [repair, ...minors(3)] });
    expect(text).toContain("What code did to the drafts (1)");
    expect(text).toContain(`dependency (t-s02-001): ${repair.finding}`);
    expect(text).toMatch(/Minor review findings \(3\)/u);
  });

  it("reads a risk from PLAN's outputs only where it is whole and graded blocker or major", () => {
    const row = { slice: "s01", ticket: "t-s01-001", severity: "major", tag: "sizing", finding: "larger than one session", fix: "split it" };
    const built = presentInputsFromOutputs({ PLAN: { review_risks: [row, { ...row, severity: "minor" }, { ...row, severity: "grave" }, { ...row, fix: undefined }, null] } });
    expect(built.reviewRisks).toEqual([row]);
  });

  it("says nothing of the review where it left nothing", () => {
    const text = renderPresentation(base("/tmp/x"));
    expect(text).not.toMatch(/Plan review risks|not reviewed|What code did|Minor review findings/u);
  });

  it("writes no advice file and prints no revision or churn line, however many findings there are", async () => {
    const dir = root();
    const outcome = await presentStage({ ...base(dir), findings: minors(40), reviewRisks: [risk("s01", "t-s01-001", "major", "the major")] });
    const message = outcome.kind === "interrupt" ? outcome.message : "";
    expect(existsSync(path.join(dir, ".detent", "state", "advice.md"))).toBe(false);
    expect(message).not.toMatch(/Revision rounds|full list:|repeated reads/u);
    expect(message).toContain("the major");
  });
});

/**
 * PRDR-196 — what code proved reaches PRESENT, labelled as proved.
 *
 * Run against the finished gate-312 plan, the checker produced 7 findings,
 * including the one certain failure in it: two tickets both creating
 * `plugin/skills/init/SKILL.md`. That was proved, for nothing, and shown to
 * nobody. PRDR-293: PRESENT proves it itself now, from the tickets as they
 * stand, and what it proves holds approval.
 */
describe("PRDR-196 what code proved reaches PRESENT, labelled as proved", () => {
  const owning = (id: string): Ticket =>
    newTicket({ id, type: "feature", title: `t ${id}`, acceptance_criteria: ["it works"], surface: ["src/**"], provides: [{ kind: "file", id: "plugin/skills/init/SKILL.md", note: "the skill" }] });
  const gate: Binding = {
    schema_version: SCHEMA_VERSION,
    package: ".",
    slot: "test",
    adapter: "make",
    ref: "test",
    resolved: "make test",
    config_hash: "a".repeat(64),
    executed_at: "2026-09-27T00:00:00.000Z",
    approved_by: "auto",
    status: "approved",
  };
  const gated = (dir: string): PresentInput => ({ ...base(dir), bindings: [gate] });
  const proved = (dir: string): PresentInput => ({ ...gated(dir), tickets: [owning("t-s12-012"), owning("t-s12-013")] });

  it("renders what the checks prove, and says code proved them", async () => {
    const outcome = await presentStage(proved(root()));
    const message = outcome.kind === "interrupt" ? outcome.message : "";
    expect(message).toContain("plugin/skills/init/SKILL.md");
    expect(message).toMatch(/proved by code/iu);
  });

  it("keeps them apart from the review's risks, because one kind is proved and the other is judgement", async () => {
    const outcome = await presentStage({ ...proved(root()), reviewRisks: [risk("s01", "t-s01-012", "major", "larger than one implement session")] });
    const message = outcome.kind === "interrupt" ? outcome.message : "";
    expect(message).toContain("larger than one implement session");
    expect(message).toContain("plugin/skills/init/SKILL.md");
    /* Two headings, not one merged list — the operator must be able to tell them apart. */
    expect(message).toMatch(/Checks that still fail/iu);
    expect(message).toMatch(/Plan review risks/iu);
  });

  it("says nothing extra when code found nothing", async () => {
    const outcome = await presentStage(gated(root()));
    const message = outcome.kind === "interrupt" ? outcome.message : "";
    expect(message).not.toMatch(/Checks that still fail/iu);
  });
});
