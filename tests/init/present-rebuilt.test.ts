import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { bindingTable } from "../../src/init/bind.js";
import { listingDigest, runInit, type PhaseHandler } from "../../src/init/machine.js";
import { presentStage, readPresentation, renderPresentation, type PresentInput } from "../../src/init/present.js";
import { presentInputsFromOutputs } from "../../src/init/present-inputs.js";
import { readRecordedSpend } from "../../src/kernel/ledger.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { ledgerRowSchema, presentationSchema, type Binding } from "../../src/schemas/records.js";
import { git, gitInit, removeTree, tmpTree } from "../helpers.js";
import { CONFORMING_PACK } from "./pack-fixture.js";
import { seeded, slicing } from "./seed-fixture.js";

/**
 * PRDR-296 — PRESENT rebuilt (C-7‴).
 *
 * ksar-cloud's presentation listed 457 held findings and a revision headline
 * that summed 16 of its 24 slices, and never named a default the plan had
 * assumed. What an operator decides at approval is short: the plan, the
 * decisions and defaults it rests on, what is still proved wrong, what the
 * pack failed to settle, and what planning cost. PRDR-292, PRDR-293 and
 * PRDR-294 built the defects, the failing checks and the review's risks; these
 * cases hold the rest: the decision log, the milestones, the cost, the
 * question list gone, and the presentation printed once and persisted as
 * printed.
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

const base = (dir: string): PresentInput => ({ root: dir, tickets: [], bindings: [], skips: [], bootstrap: null, assignments: {} });

/** What `init` interrupted with, which on a seeded pack with no asker is the whole presentation and the deferral. */
async function presented(): Promise<{ readonly root: string; readonly text: string }> {
  const s = seeded();
  const result = await s.init();
  expect(result.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
  return { root: s.root, text: result.interrupt?.message ?? "" };
}

const occurrences = (text: string, part: string): number => text.split(part).length - 1;

describe("PRDR-296: PRESENT shows the decision log, every default marked vetoable (C-7‴)", () => {
  it("lists every D-n with its answer and every X-n as vetoable, from the log the specification phase left", async () => {
    const { text } = await presented();
    expect(text).toContain("Decisions (1)");
    expect(text).toContain("  D-1: Which currencies does checkout accept? → DZD only in V1");
    expect(text).toContain("Defaults (2), each vetoable — the plan follows each; to veto one, edit its row in docs/founder-decisions.md");
    expect(text).toContain("  X-1: Prices are stored in minor units.\n      because: Integer arithmetic has no rounding drift.");
    expect(text).toContain("  X-2: The stack is TypeScript on Node.js 22 with pnpm.");
    expect(text.indexOf("Decisions (1)"), "the decisions lead the log").toBeLessThan(text.indexOf("Defaults (2)"));
  });

  it("reads the decisions from the phase that left the log, and shows a row only where it is whole", () => {
    const row = (id: string, answer?: string) => ({ id, question: `question ${id}?`, ...(answer === undefined ? {} : { answer }), reason: "r" });
    const inputs = presentInputsFromOutputs({
      DECIDE: { decisions: [row("D-1", "stale")], defaults: [] },
      WRITE: { decisions: [row("D-1", "one"), row("D-2"), null, row("D-3", "three")], defaults: [] },
    });
    expect(inputs.decisions).toEqual([
      { id: "D-1", question: "question D-1?", answer: "one" },
      { id: "D-3", question: "question D-3?", answer: "three" },
    ]);
  });
});

describe("PRDR-296: PRESENT shows the slices, the tickets and their milestones (C-7‴)", () => {
  it("lists every slice with its milestones, before the tickets, and each ticket with the milestone of what it delivers", async () => {
    const { text } = await presented();
    expect(text).toMatch(/^ {2}s01 {2}M0 {2}s01, take 1/mu);
    expect(text).toMatch(/^ {2}s02 {2}M1 {2}s02, take 1/mu);
    expect(text).toMatch(/^ {2}s03 {2}M1 {2}s03, take 1/mu);
    expect(text).toMatch(/^ {2}t-s01-001 {2}M0 {2}t t-s01-001/mu);
    expect(text).toMatch(/^ {2}t-s03-001 {2}M1 {2}t t-s03-001/mu);
    expect(text, "the bootstrap delivers no requirement, so it has no milestone").toMatch(/^ {2}t-001-bootstrap {2}Bootstrap/mu);
    expect(text.indexOf("Slices (3)"), "the plan's increments come first").toBeLessThan(text.indexOf("Tickets (4)"));
  });

  it("lists a plan of one slice too", () => {
    const text = renderPresentation({ ...base("/nowhere"), slices: [{ id: "s01", title: "the only increment", tickets: [] }] });
    expect(text).toContain("Slices (1)");
    expect(text).toMatch(/^ {2}s01 {2}the only increment/mu);
    expect(text, "no spend was read, so none is shown").not.toContain("has spent");
    expect(text, "and no decision was read").not.toContain("Decisions (");
  });

  it("shows each milestone a slice spans, and its ticket the earliest of what it delivers", async () => {
    const s = seeded(CONFORMING_PACK, {
      slices: (take) =>
        slicing(
          [
            { id: "s01", requirement_ids: ["CAT-F-002", "CAT-F-001"] },
            { id: "s02", requirement_ids: ["CAT-N-001"], depends_on: ["s01"] },
            { id: "s03", requirement_ids: ["CHK-F-001", "CHK-F-002"], depends_on: ["s01"] },
          ],
          take,
        ),
    });
    const result = await s.init();
    const text = result.interrupt?.message ?? "";
    expect(result.interrupt?.interrupt, text).toBe("AWAIT_APPROVAL");
    expect(text).toMatch(/^ {2}s01 {2}M0,M1 {2}s01, take 1/mu);
    expect(text).toMatch(/^ {2}t-s01-001 {2}M0 {2}t t-s01-001/mu);
  });
});

describe("PRDR-296: PRESENT reports what each specification phase and planning cost, and caps nothing (decision 16)", () => {
  const row = (ticket: string, role: string, usd: number, phase?: string) =>
    JSON.stringify({
      at: "2026-09-27T00:00:00.000Z",
      ticket,
      generation: 0,
      role,
      cost_estimate_usd: usd,
      input_tokens: 1,
      output_tokens: 1,
      turns: 1,
      ...(phase === undefined ? {} : { phase }),
    });

  it("sums init's ledger rows by the phase each names: the four specification phases apiece, SLICE and PLAN as planning", async () => {
    const dir = root();
    writeFileSync(
      path.join(stateDir(dir), "ledger.jsonl"),
      [
        row("init", "audit", 1.5, "AUDIT"),
        row("init", "spec_write", 0.25, "DECIDE"),
        row("init", "spec_review", 1.25, "VALIDATE"),
        row("init", "spec_write", 0.75, "VALIDATE"),
        row("init", "planner", 0.5, "SLICE"),
        row("init", "planner", 1, "PLAN"),
        row("init", "plan_review", 1, "PLAN"),
        row("init", "planner", 1, "PLAN"),
        row("init", "planner", 0.125),
        row("init", "planner", 0.5, "SKETCH"),
        row("t-1", "implement", 9, undefined),
        row("(out-of-band)", "smoke", 0.5, undefined),
        "",
      ].join("\n"),
    );
    const { phaseSpend } = await import("../../src/init/phase-spend.js");
    expect(phaseSpend(dir)).toEqual([
      { label: "AUDIT", usd: 1.5, sessions: 1 },
      { label: "DECIDE", usd: 0.25, sessions: 1 },
      { label: "WRITE", usd: 0, sessions: 0 },
      { label: "VALIDATE", usd: 2, sessions: 2 },
      { label: "planning", usd: 3.5, sessions: 4 },
      { label: "SKETCH", usd: 0.5, sessions: 1 },
      { label: "earlier", usd: 0.125, sessions: 1 },
    ]);
    const text = renderPresentation({ ...base(dir), spend: phaseSpend(dir) });
    expect(text, "a phase a later build names is shown by its name").toMatch(/^ {2}SKETCH +\$0\.5000 +1 session$/mu);
    expect(text).toMatch(/^ {2}earlier +\$0\.1250 +1 session +\(recorded before a row named its phase\)$/mu);
    expect(text).toMatch(/^ {2}total +\$7\.8750 +10 sessions$/mu);
  });

  it("records the phase on every row an init session writes, and the presentation shows planning's cost beside the others", async () => {
    const { root: at, text } = await presented();
    const rows = readFileSync(path.join(stateDir(at), "ledger.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { ticket: string; role: string; phase?: string });
    expect(rows.map((r) => `${r.role}@${String(r.phase)}`)).toEqual([
      "planner@SLICE",
      ...Array.from({ length: 3 }, () => ["planner@PLAN", "plan_review@PLAN"]).flat(),
    ]);
    expect(text).toMatch(/reported, and nothing stops for it/u);
    expect(text).toMatch(/^ {2}AUDIT +\$0\.0000 +0 sessions$/mu);
    expect(text).toMatch(/^ {2}planning +\$0\.0070 +7 sessions$/mu);
    expect(text).toMatch(/^ {2}total +\$0\.0070 +7 sessions$/mu);
  });

  it("takes a row that names its phase, and still reads one written before the field", () => {
    const dir = root();
    const named = JSON.parse(row("init", "audit", 0.5, "AUDIT")) as Record<string, unknown>;
    expect(ledgerRowSchema.safeParse(named).success).toBe(true);
    writeFileSync(path.join(stateDir(dir), "ledger.jsonl"), `${row("init", "audit", 0.5, "AUDIT")}\n${row("init", "planner", 0.25)}\n`);
    expect(readRecordedSpend(dir), "X-1's reader sums both").toBe(0.75);
  });
});

describe("PRDR-296: the question list is gone; DECIDE owns questions (C-3⁗)", () => {
  it("shows no planning question, even where an older build's outputs hold them", () => {
    const asked = { id: "pq1", question: "Which region hosts the data?", blocking: true, assumption: "eu-west-1" };
    const inputs = presentInputsFromOutputs({ SLICE: { questions: [asked] }, PLAN: { questions: [{ ...asked, id: "pq2" }] } });
    expect(Object.keys(inputs)).not.toContain("questions");
    const text = renderPresentation({ ...base("/nowhere"), ...inputs });
    expect(text).not.toContain("Open questions");
    expect(text).not.toContain("Not asked again");
    expect(text).not.toContain("Which region hosts the data?");
  });

  it("persists no question count, so a record carrying one is not this build's", () => {
    const record = {
      schema_version: SCHEMA_VERSION,
      presentation: "Plan ready for approval.",
      plan_hash: "a".repeat(64),
      spec_defects: 0,
      check_failures: 0,
      /* N-5″ (PRDR-297): what made the plan, which PRESENT records beside the counts. */
      builds: ["3.1.0+000000000000"],
      pack_hash: null,
    };
    expect(presentationSchema.safeParse(record).success).toBe(true);
    expect(presentationSchema.safeParse({ ...record, blocking: 0 }).success).toBe(false);
    /* A record without either count was written before it, and so with `blocking`. */
    const { spec_defects, check_failures, ...counted } = record;
    expect(presentationSchema.safeParse({ ...counted, check_failures }).success, "no spec defect count").toBe(false);
    expect(presentationSchema.safeParse({ ...counted, spec_defects }).success, "no failing check count").toBe(false);
  });
});

describe("PRDR-296: the presentation is printed once, and persisted as printed", () => {
  const defect = { slice: "s01", kind: "contradiction", defect: "the two passages disagree", passages: [{ id: "CAT-F-001", quote: "MUST" }] };

  it("prints nothing where it does not ask: the interrupt carries the presentation, once", async () => {
    const dir = root();
    const printed: string[] = [];
    const outcome = await presentStage({ ...base(dir), print: (t) => printed.push(t) });
    expect(printed, "nothing asks, so the interrupt is what shows it").toEqual([]);
    const shown = readPresentation(dir)?.presentation ?? "";
    expect(outcome.kind === "interrupt" ? occurrences(outcome.message, shown) : 0).toBe(1);
  });

  it("prints it once before asking, as persisted, and the answer's interrupt does not repeat it", async () => {
    const dir = root();
    const printed: string[] = [];
    const asked: string[] = [];
    const outcome = await presentStage({
      ...base(dir),
      print: (t) => printed.push(t),
      ask: async (p) => {
        asked.push(p);
        return { kind: "deferred" };
      },
    });
    const shown = readPresentation(dir)?.presentation ?? "";
    expect(printed, "shown before the question").toEqual([shown]);
    expect(asked).toEqual([shown]);
    expect(outcome.kind).toBe("interrupt");
    expect(outcome.kind === "interrupt" ? outcome.message : "").not.toContain(shown);
    expect(outcome.kind === "interrupt" ? outcome.message : "").toMatch(/^Approval deferred/u);
  });

  it("where an asker has nothing to print on, the answer's interrupt carries the presentation", async () => {
    const dir = root();
    const outcome = await presentStage({ ...base(dir), ask: async () => ({ kind: "declined" }) });
    const message = outcome.kind === "interrupt" ? outcome.message : "";
    expect(occurrences(message, readPresentation(dir)?.presentation ?? "")).toBe(1);
    expect(message).toMatch(/Approval declined/u);
  });

  it("prints nothing and asks nothing while a spec defect holds approval", async () => {
    const dir = root();
    const printed: string[] = [];
    let asked = 0;
    const outcome = await presentStage({
      ...base(dir),
      specDefects: [defect],
      print: (t) => printed.push(t),
      ask: async () => {
        asked += 1;
        return { kind: "approved", by: "op" };
      },
    });
    expect(printed).toEqual([]);
    expect(asked).toBe(0);
    expect(outcome.kind === "interrupt" ? outcome.interrupt : "").toBe("AWAIT_INFO");
    expect(outcome.kind === "interrupt" ? occurrences(outcome.message, readPresentation(dir)?.presentation ?? "") : 0).toBe(1);
  });

  it("does not repeat an interrupt's message among the run's messages", async () => {
    const dir = tmpTree({ "seed.txt": "seed\n" });
    roots.push(dir);
    gitInit(dir);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "init");
    const handlers: PhaseHandler[] = [
      { phase: "INIT_FS", digest: () => listingDigest(["INIT_FS"]), run: async () => ({ kind: "complete", outputs: {} }) },
      { phase: "PRESENT", digest: () => listingDigest(["PRESENT"]), run: async () => ({ kind: "interrupt", interrupt: "AWAIT_APPROVAL", message: "the whole plan", items: [] }) },
    ];
    const result = await runInit(dir, handlers);
    expect(result.interrupt?.message).toBe("the whole plan");
    expect(result.messages, "the CLI prints the messages and then the interrupt").not.toContain("the whole plan");
  });
});

describe("PRDR-296, found along the way: the binding table", () => {
  it("aligns its columns whatever a package's label", () => {
    const bound = (pkg: string): Binding => ({
      schema_version: SCHEMA_VERSION,
      package: pkg,
      slot: "test",
      adapter: "npm",
      ref: "scripts.test",
      resolved: "pnpm test",
      config_hash: "a".repeat(64),
      executed_at: "2026-09-27T00:00:00.000Z",
      approved_by: "auto",
      status: "provisional",
    });
    const long = { ...bound("dashboard"), slot: "lint" as const, resolved: "pnpm --filter dashboard run lint --max-warnings=0" };
    const table = bindingTable([bound("."), bound("dashboard"), long], [], [".", "dashboard", "packages/dashboard-admin"]);
    const at = (part: string): Set<number> => new Set(table.split("\n").filter((line) => line.includes(part)).map((line) => line.indexOf(part)));
    expect(at("pnpm").size, table).toBe(1);
    expect(at("provisional").size, table).toBe(1);
    expect([...at("(no gates")], "a package with no gate lines up with the commands").toEqual([...at("pnpm")]);
  });
});
