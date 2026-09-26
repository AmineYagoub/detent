import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionArm } from "../../src/kernel/referee-session.js";
import { removeTree } from "../helpers.js";
import { codeOnly } from "../../scripts/check-rules.js";
import { newTicket } from "../../src/kernel/tickets/mutations.js";
import { planFindingsInput } from "../../src/kernel/session-inputs.js";
import { findingLine, readPlanFindings } from "../../src/kernel/plan-findings.js";
import { buildDossier, dossierSummary } from "../../src/kernel/dossier.js";
import { heldFindings } from "../../src/init/plan-signal.js";
import type { SampledReview } from "../../src/init/plan-sample.js";
import type { PlanReview } from "../../src/schemas/init.js";
import type { Ticket } from "../../src/schemas/ticket.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";

/**
 * PRDR-271 — a held plan finding reaches the session that can confirm it.
 *
 * PLAN's reviews produce findings naming the tickets they concern, and
 * `revisionOutcome` keeps the ones at or above the ⌈k/2⌉ threshold. They are
 * rendered for a human by `renderHeldFindings`, spilled to `advice.md` when the
 * list is long, and read by nothing under `src/kernel/`. `attemptInputs` hands
 * an `IN_PROGRESS` session `publicTicket` and the operator record, so the one
 * process that could find out whether a finding is true by trying to build
 * against it never sees it.
 *
 * Measured over six reads of one slice (D-30): 14 of 16 distinct findings
 * reproduce three or more times, and none sits at two of six, so what is being
 * dropped here is reproducible criticism rather than noise.
 */
describe("PRDR-271 an attempt session receives the plan findings naming its ticket", () => {
  const FINDING = { ticket: "t-s07-004", tag: "dependency", finding: "consumes a contract no ticket provides", held: "after-revision", seen: 3 };

  const roots: string[] = [];
  afterEach(() => {
    for (const r of roots.splice(0)) removeTree(r);
  });

  /** A root whose PLAN checkpoint holds `findings` — what `writeCheckpoint` leaves on disk. */
  function rootWith(findings: readonly unknown[]): string {
    const root = mkdtempSync(path.join(tmpdir(), "prdr271-"));
    roots.push(root);
    const dir = path.join(root, ".detent", "state");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "PLAN.json"), JSON.stringify({ schema_version: SCHEMA_VERSION, phase: "PLAN", outputs: { review_findings: findings } }));
    return root;
  }

  function ticket(): Ticket {
    return newTicket({ id: "t-s07-004", type: "feature", title: "t", acceptance_criteria: ["a"] }, "2026-01-01T00:00:00.000Z");
  }

  /** Only the inputs seam is under test; the context members it reaches for are stubbed. The findings are read off a real checkpoint. */
  function arm(root: string): SessionArm {
    return new SessionArm({ root, maybeArtifact: () => null, diff: () => "" } as never);
  }

  it("carries the finding that names the ticket into IN_PROGRESS", () => {
    const inputs = arm(rootWith([FINDING])).attemptInputs(ticket(), "IN_PROGRESS", "/nonexistent");
    const held = inputs["plan_findings"] as ReadonlyArray<{ ticket: string; tag: string }> | undefined;
    expect(held).toBeDefined();
    expect(held?.[0]?.ticket).toBe("t-s07-004");
    expect(held?.[0]?.tag).toBe("dependency");
  });

  it("carries the reproduction count, so the session can order what it chases", () => {
    const inputs = arm(rootWith([FINDING])).attemptInputs(ticket(), "IN_PROGRESS", "/nonexistent");
    const held = inputs["plan_findings"] as ReadonlyArray<{ seen?: number }> | undefined;
    expect(held?.[0]?.seen).toBe(3);
  });

  /**
   * PRDR-271 — the reader, against a real PLAN checkpoint.
   *
   * `writeCheckpoint` persists the stage's outputs to `state/PLAN.json`, so the
   * findings were on disk in a structured form the whole time. Ordering is by
   * `seen` descending: over six reads of one slice about half of what survives
   * the ⌈k/2⌉ filter reproduced five or six times and half three or four, and a
   * session that cannot chase all of them should chase the reproduced ones first.
   */
  describe("reading PLAN's checkpoint", () => {
    it("returns only the findings naming the ticket, strongest first", () => {
      const root = rootWith([
        { ticket: "t-s07-004", tag: "sizing", finding: "a", seen: 2 },
        { ticket: "t-s07-009", tag: "dependency", finding: "b", seen: 3 },
        { ticket: "t-s07-004", tag: "dependency", finding: "c", seen: 3 },
      ]);
      const got = readPlanFindings(root, "t-s07-004") as ReadonlyArray<{ tag: string; seen: number }>;
      expect(got.map((f) => f.tag)).toStrictEqual(["dependency", "sizing"]);
      expect(got.map((f) => f.seen)).toStrictEqual([3, 2]);
    });

    it("sorts an uncounted finding last rather than above a measured one", () => {
      const root = rootWith([
        { ticket: "t1", tag: "coverage", finding: "no count — unsampled or an older cache" },
        { ticket: "t1", tag: "dependency", finding: "counted", seen: 2 },
      ]);
      const got = readPlanFindings(root, "t1") as ReadonlyArray<{ tag: string }>;
      expect(got.map((f) => f.tag)).toStrictEqual(["dependency", "coverage"]);
    });

    it("answers null, not a throw, when PLAN has not run or names no such ticket", () => {
      expect(readPlanFindings(mkdtempSync(path.join(tmpdir(), "prdr271-empty-")), "t1")).toBeNull();
      expect(readPlanFindings(rootWith([{ ticket: "other", tag: "sizing", finding: "x" }]), "t1")).toBeNull();
    });

    /**
     * PRDR-271 acceptance criterion 5 — the finding is readable at EVERY rung.
     *
     * `attemptInputs` covers the four states the driver launches an attempt in,
     * because it adds the key around the switch. RESEARCH is the exception: it
     * is not an attempt, `referee-stage.ts` assembles `ticketInputs` for it by
     * hand, and it is the rung the ladder spends on finding out why — so a
     * finding that does not reach it is rediscovered by the session paying the
     * most to rediscover it.
     */
    it("reaches the RESEARCH rung, which assembles its own inputs", () => {
      const root = rootWith([{ ticket: "t1", tag: "dependency", finding: "f", seen: 2 }]);
      expect(planFindingsInput({ root }, "t1")["plan_findings"]).toBeDefined();
      expect(planFindingsInput({ root }, "t2")).toStrictEqual({});
      /* `research()` is not exported, so the call site is asserted the way the P6 oracle asserts its own: on code with comments and string literals stripped, which no doc-block can satisfy. */
      const source = codeOnly(readFileSync(new URL("../../src/kernel/referee-stage.ts", import.meta.url), "utf8"));
      const body = source.slice(source.indexOf("async function research("));
      expect(body.slice(0, body.indexOf("\n}"))).toContain("planFindingsInput(ctx, id)");
    });

    /**
     * PRDR-271 acceptance criterion 5 — named in what reaches NEEDS_HUMAN.
     *
     * The dossier is the ladder's last act. A human who reads four failed
     * attempts without what PLAN said about the ticket is being asked to
     * rediscover it a fifth time, by hand.
     */
    it("names the findings in the dossier a human reads at NEEDS_HUMAN", () => {
      const root = rootWith([
        { ticket: "t-s07-004", tag: "dependency", finding: "consumes a contract no ticket provides", seen: 3 },
        { ticket: "t-s07-004", tag: "sizing", finding: "two features in one ticket", seen: 2 },
      ]);
      const t = newTicket({ id: "t-s07-004", type: "feature", title: "t", acceptance_criteria: ["a"] }, "2026-01-01T00:00:00.000Z");
      const dossier = buildDossier(root, t, "informed fix left the gate red");
      expect(dossier.plan_findings).toStrictEqual([
        "dependency: consumes a contract no ticket provides (seen in 3 of the plan's reads)",
        "sizing: two features in one ticket (seen in 2 of the plan's reads)",
      ]);
      expect(dossierSummary(t, dossier)).toContain("plan review said (2):");
    });

    /**
     * PRDR-271 acceptance criterion 3 — the count travels from where it is
     * COUNTED to where it is read.
     *
     * `sampleReviewPlan` builds `seen` per sample, and BOTH the pre- and the
     * post-revision review are sampled. `heldFindings` is the only place those
     * two maps are merged; with the merge gone every finding reaches PLAN's
     * checkpoint uncounted, the reader's sort becomes arbitrary, and nothing
     * downstream can tell 3-of-3 from 2-of-3. Asserted here rather than only on
     * `labelHeld`, which takes the merged map already built.
     */
    it("carries each sample's count into the held list, post-revision winning a shared key", () => {
      const f = (ticket: string, tag: "dependency" | "sizing"): PlanReview["findings"][number] => ({ ticket, tag, finding: `${ticket} ${tag}` });
      const sample = (findings: PlanReview["findings"], seenOnce: PlanReview["findings"], seen: ReadonlyMap<string, number>): SampledReview =>
        ({ verdict: "changes", findings, seenOnce, reads: [], threshold: 2, seen }) as SampledReview;
      const before = sample([f("t1", "dependency")], [f("t2", "sizing")], new Map([["t1 dependency", 2], ["t2 sizing", 1]]));
      const after = sample([f("t1", "dependency")], [], new Map([["t1 dependency", 3]]));
      const held = heldFindings([f("t1", "dependency")], [f("t1", "dependency")], before, after);
      expect(held.find((h) => h.tag === "dependency")?.seen).toBe(3);
      expect(held.find((h) => h.tag === "sizing")?.seen).toBe(1);
    });

    it("leaves the dossier's own shape alone when PLAN named nothing", () => {
      const root = mkdtempSync(path.join(tmpdir(), "prdr271-nodoss-"));
      roots.push(root);
      const t = newTicket({ id: "t1", type: "feature", title: "t", acceptance_criteria: ["a"] }, "2026-01-01T00:00:00.000Z");
      const dossier = buildDossier(root, t, "why");
      expect(dossier.plan_findings).toStrictEqual([]);
      expect(dossierSummary(t, dossier)).not.toContain("plan review said");
    });
  });
});

/**
 * PRDR-272 (D-32) — the reader side: ranking survives the shape change, and a
 * count says which draft it counted.
 *
 * `seen` was shipped by PRDR-271 one day before this ticket, so the only
 * artifacts carrying it are run 6's — and that run's PLAN.json is exactly what
 * the run phase reads. A finding backfilled to the panel fields, and a finding
 * still holding only the legacy `seen`, have to rank by one rule or the feature
 * silently stops ordering a corpus that cost four figures to produce.
 */
describe("PRDR-272 held findings rank and read the same whichever shape they carry", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const r of roots.splice(0)) removeTree(r);
  });

  function rootWith(findings: readonly unknown[]): string {
    const root = mkdtempSync(path.join(tmpdir(), "prdr272-"));
    roots.push(root);
    const dir = path.join(root, ".detent", "state");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "PLAN.json"), JSON.stringify({ schema_version: SCHEMA_VERSION, phase: "PLAN", outputs: { review_findings: findings } }));
    return root;
  }

  const weak = { ticket: "t-1", tag: "sizing", finding: "weak", held: "seen-once", seen_after: 1 };
  const strong = { ticket: "t-1", tag: "dependency", finding: "strong", held: "introduced", seen_after: 3 };

  it("ranks a finding carrying only the panel counts, not just the legacy `seen`", () => {
    const got = readPlanFindings(rootWith([weak, strong]), "t-1");
    expect(got?.map((f) => f.finding), "weakest first on disk, so a no-op sort would leave it there").toStrictEqual(["strong", "weak"]);
  });

  it("falls back to the post-revision panel, the one that read the draft on disk", () => {
    const older = { ticket: "t-1", tag: "sizing", finding: "strong-before", seen_before: 3, seen_after: 1 };
    const newer = { ticket: "t-1", tag: "dependency", finding: "strong-after", seen_before: 1, seen_after: 2 };
    const got = readPlanFindings(rootWith([older, newer]), "t-1");
    expect(got?.map((f) => f.finding), "the revision is the draft that still exists — `own = a ?? b` in the writer, same rule here").toStrictEqual(["strong-after", "strong-before"]);
  });

  it("still ranks run 6's artifacts, which carry only `seen`", () => {
    const legacy = readPlanFindings(rootWith([{ ticket: "t-1", tag: "sizing", finding: "one", seen: 1 }, { ticket: "t-1", tag: "dependency", finding: "three", seen: 3 }]), "t-1");
    expect(legacy?.map((f) => f.finding)).toStrictEqual(["three", "one"]);
  });

  it("names both drafts when a finding crossed the threshold between them", () => {
    const line = findingLine({ ticket: "t-1", tag: "dependency", finding: "crossed", held: "introduced", seen: 2, seen_before: 1, seen_after: 2 });
    expect(line, "an unqualified count cannot say which draft was read").toContain("first draft");
    expect(line).toContain("revision");
  });

  it("keeps the unqualified form for a finding that carries only `seen`", () => {
    expect(findingLine({ ticket: "t-1", tag: "sizing", finding: "legacy", seen: 3 })).toContain("3 of the plan's reads");
  });
});
