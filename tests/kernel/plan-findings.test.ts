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
import type { Ticket } from "../../src/schemas/ticket.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";

/**
 * PRDR-271 — what PLAN recorded on a ticket reaches the session that can
 * confirm it.
 *
 * PLAN's review names the tickets its findings concern, and until PRDR-271
 * nothing under `src/kernel/` read them: `attemptInputs` handed an
 * `IN_PROGRESS` session `publicTicket` and the operator record, so the one
 * process that could find out whether a finding is true by trying to build
 * against it never saw it. C-4⁸ (PRDR-294): what PLAN records is the review's
 * minors, each graded with its fix, and the repairs code made to a draft.
 */
describe("PRDR-271 an attempt session receives the plan findings naming its ticket", () => {
  const FINDING = { ticket: "t-s07-004", severity: "minor", tag: "dependency", finding: "consumes a contract no ticket provides", fix: "name the provider in depends_on" };

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

  it("carries the grade and the fix, so the session knows what the review asked for", () => {
    const inputs = arm(rootWith([FINDING])).attemptInputs(ticket(), "IN_PROGRESS", "/nonexistent");
    const held = inputs["plan_findings"] as ReadonlyArray<{ severity?: string; fix?: string }> | undefined;
    expect(held?.[0]?.severity).toBe("minor");
    expect(held?.[0]?.fix).toBe("name the provider in depends_on");
  });

  /**
   * PRDR-271 — the reader, against a real PLAN checkpoint.
   *
   * `writeCheckpoint` persists the stage's outputs to `state/PLAN.json`, so the
   * findings were on disk in a structured form the whole time. C-4⁸: they are
   * read gravest first, by the review's grade, and a repair code made, which
   * carries no grade, after them.
   */
  describe("reading PLAN's checkpoint", () => {
    it("returns only the findings naming the ticket, gravest first", () => {
      const root = rootWith([
        { ticket: "t-s07-004", tag: "coverage", finding: "a repair code made" },
        { ticket: "t-s07-009", severity: "minor", tag: "dependency", finding: "b", fix: "x" },
        { ticket: "t-s07-004", severity: "minor", tag: "sizing", finding: "c", fix: "x" },
        { ticket: "t-s07-004", severity: "major", tag: "shape", finding: "d", fix: "x" },
      ]);
      const got = readPlanFindings(root, "t-s07-004") ?? [];
      expect(got.map((f) => f.tag)).toStrictEqual(["shape", "sizing", "coverage"]);
    });

    it("reads a finding an older build graded by its reads, and orders it with the ungraded", () => {
      const root = rootWith([
        { ticket: "t1", tag: "coverage", finding: "held by an older build", held: "after-revision", seen: 3 },
        { ticket: "t1", severity: "minor", tag: "dependency", finding: "graded", fix: "x" },
      ]);
      const got = readPlanFindings(root, "t1") ?? [];
      expect(got.map((f) => f.tag)).toStrictEqual(["dependency", "coverage"]);
      expect(findingLine(got[1]!)).toBe("coverage: held by an older build");
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
      const root = rootWith([{ ticket: "t1", severity: "minor", tag: "dependency", finding: "f", fix: "x" }]);
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
        { ticket: "t-s07-004", severity: "minor", tag: "dependency", finding: "consumes a contract no ticket provides", fix: "name the provider" },
        { ticket: "t-s07-004", tag: "dependency", finding: "depends on t-s07-099, which no slice planned — the edge was dropped" },
      ]);
      const t = newTicket({ id: "t-s07-004", type: "feature", title: "t", acceptance_criteria: ["a"] }, "2026-01-01T00:00:00.000Z");
      const dossier = buildDossier(root, t, "informed fix left the gate red");
      expect(dossier.plan_findings).toStrictEqual([
        "minor dependency: consumes a contract no ticket provides — fix: name the provider",
        "dependency: depends on t-s07-099, which no slice planned — the edge was dropped",
      ]);
      expect(dossierSummary(t, dossier)).toContain("plan review said (2):");
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
