import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeTicket } from "../../src/kernel/tickets/mutations.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { DECISION_LOG_PATH } from "../../src/schemas/pack.js";
import type { MockBackend } from "../../src/sessions/mock.js";
import type { Json } from "./decide-fixture.js";
import { CONFORMING_PACK, ORACLE_ROUNDS, commitRecord, oracleRecord, packRepo } from "./pack-fixture.js";
import { BUDGETS, LONE_CANDIDATE, repo } from "./plan-fixture.js";
import { scriptedPlanner, ticket } from "./slicing-fixture.js";
import { LENDING, PACK, RAW, WROTE, write, writesPack, type Write } from "./write-fixture.js";
import {
  LENDING_PRD,
  appliesAll,
  byRound,
  clean,
  finding,
  initThroughValidate,
  record,
  validateOutputs,
  writer,
  type Reviewers,
  type Writer,
} from "./validate-fixture.js";

/**
 * PRDR-284 — the pipeline around VALIDATE (C-2⁶, C-2⁷, C-2¹⁴): nothing plans
 * from a red pack, a conforming pack runs no specification session, the risks
 * reach PRESENT, and a re-validation reads the change and whatever cites it.
 * The whole pipeline runs, with scripted sessions, in an existing project
 * whose lone test script binds without a question.
 */

const PROJECT = { ...LONE_CANDIDATE, ...RAW };
const INDEX = "docs/prd/index.md";
const PACK_DOCS = ["README.md", DECISION_LOG_PATH, LENDING_PRD, INDEX, "docs/research/verified-facts.md"];
const PLANNING = ["ANALYZE", "DETERMINE_VERIFICATION", "SLICE", "PLAN", "PREPARE_AGENTS"];

const LENDING_SLICE = {
  schema_version: SCHEMA_VERSION,
  slices: [
    { id: "s01", title: "lending", goal: "loans work", requirement_ids: ["LND-F-001"], baseline_items: [], docs: [LENDING_PRD], depends_on: [], expected_tickets: 2, rationale: "" },
  ],
  questions: [],
};
const draft = (): object => ({ schema_version: SCHEMA_VERSION, tickets: [ticket("t-s01-001"), ticket("t-s01-002", ["t-s01-001"])], questions: [] });
const approve = (): object => ({ schema_version: SCHEMA_VERSION, verdict: "approve", findings: [] });

interface Opts {
  readonly reviewers?: Reviewers;
  readonly writer?: Writer;
  readonly stub?: Write;
  readonly notes?: string[];
  readonly rounds?: number;
}

/** One `init` of the whole pipeline; `planned` keeps every planner session's inputs. */
async function init(root: string, opts: Opts = {}) {
  const planned: Json[] = [];
  const seen = { backend: null as MockBackend | null };
  const planner = scriptedPlanner({ slices: LENDING_SLICE, draft, review: approve }, [], planned);
  const result = await initThroughValidate(
    root,
    {
      all: true,
      reviewers: opts.reviewers ?? clean(),
      ...(opts.writer === undefined ? {} : { writer: opts.writer }),
      ...(opts.notes === undefined ? {} : { notes: opts.notes }),
      seen,
      script: { planner },
      ...(opts.rounds === undefined ? {} : { more: { budgets: { ...BUDGETS, spec_validation_rounds: opts.rounds } } }),
    },
    opts.stub ?? writesPack(),
  );
  return { ...result, planned, roles: seen.backend?.rolesLaunched() ?? [] };
}

describe("PRDR-284: nothing plans from a red pack (C-2⁷)", () => {
  it("runs no phase after VALIDATE while the checker stays red: not DETERMINE_VERIFICATION, not SLICE, not PLAN", async () => {
    const root = repo(PROJECT);
    const uncovered = LENDING.split("\n").filter((l) => !l.includes("LND-AC-02")).join("\n");
    const red = write(() => ({ files: { ...PACK, [LENDING_PRD]: uncovered }, artifact: WROTE() }));
    const first = await init(root, { stub: red, writer: writer(() => ({})) });
    expect(first.reachedPhase).toBe("VALIDATE");
    expect(first.interrupt?.interrupt).toBe("AWAIT_INFO");
    for (const phase of PLANNING) expect(first.executed, phase).not.toContain(phase);
    expect(first.planned, "no planner session").toEqual([]);
    const again = await init(root, { stub: red, writer: writer(() => ({})) });
    expect(again.reachedPhase, "and a re-run stops there again, for as long as it stays red").toBe("VALIDATE");
    expect(again.planned).toEqual([]);
  });

  it("plans once the operator settles a blocker left at the ceiling, and not before", async () => {
    const root = repo(PROJECT);
    const r = byRound((round, area) => (round === 1 && area === "Lending" ? [finding({ severity: "blocker", category: "invariant" })] : []));
    const stopped = await init(root, { reviewers: r, writer: appliesAll(), rounds: 1 });
    expect(stopped.reachedPhase).toBe("VALIDATE");
    expect(stopped.planned).toEqual([]);
    appendFileSync(path.join(root, ...LENDING_PRD.split("/")), "\nA late loan is one day past its due date.\n");
    const settled = await init(root, { reviewers: r, writer: appliesAll(), rounds: 1 });
    expect(settled.executed).toEqual(expect.arrayContaining(["VALIDATE", ...PLANNING]));
    expect(settled.planned.length).toBeGreaterThan(0);
  });
});

describe("PRDR-284: VALIDATE hands planning the pack (C-2⁶, F-4)", () => {
  it("hands on the pack it validated, the stack markers, the log's entries and the checker's parse, and no phase runs twice", async () => {
    const root = repo(PROJECT);
    const first = await init(root);
    expect(first.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
    expect(new Set(first.executed).size, "each phase once (F-4)").toBe(first.executed.length);
    expect(first.executed.slice(first.executed.indexOf("WRITE"), first.executed.indexOf("WRITE") + 3)).toEqual(["WRITE", "VALIDATE", "ANALYZE"]);
    const outputs = validateOutputs(root);
    expect(outputs["docs"]).toEqual(PACK_DOCS);
    expect(outputs["stack_markers"]).toEqual(expect.arrayContaining(["package.json"]));
    expect((outputs["defaults"] as Json[]).map((d) => d["id"])).toEqual(["X-1", "X-2", "X-3"]);
    expect(((outputs["pack"] as Json)["requirements"] as Json[]).map((r) => r["id"])).toEqual(["LND-F-001", "LND-F-002", "LND-F-003"]);
    expect(outputs).toMatchObject({ ran: true, validated: true, rounds: 1, risks: [] });
    expect(first.planned.find((i) => i["stage"] === undefined && i["expected_output"] !== undefined)?.["docs"]).toEqual(PACK_DOCS);
  });

  it("runs no specification session on a conforming pack: VALIDATE's checker is DISCOVER's, and its risks are the record's (specification decision 6)", async () => {
    const root = packRepo();
    const [one, two] = ORACLE_ROUNDS;
    const major = { ...two.open[0], id: "R2-2", severity: "major", left: "unverified", reason: "fixed in the round the loop stopped at, which no round verified" };
    commitRecord(root, { ...oracleRecord(root), rounds: [one, { ...two, open: [...two.open, major] }] });
    const notes: string[] = [];
    const seen = { backend: null as MockBackend | null };
    const result = await initThroughValidate(root, { notes, seen }, writesPack());
    expect(result.reachedPhase).toBe("READY");
    expect(seen.backend?.rolesLaunched(), "no audit, spec_write or spec_review session").toEqual([]);
    expect(notes).toContain("VALIDATE: the pack conforms and its checker is green, so it runs no session, and planning reads it (C-2⁶, specification decision 6)");
    expect(validateOutputs(root)).toMatchObject({
      ran: false,
      reason: "conforming",
      validated: true,
      risks: [{ id: "R2-2", where: "docs/prd/01-catalog.md:8", fix: major.fix, left: "unverified", reason: major.reason }],
    });
    expect(Object.keys(CONFORMING_PACK)).toContain("docs/prd/01-catalog.md");
  });
});

describe("PRDR-284: the risks reach PRESENT, beside the defaults (C-2¹⁴)", () => {
  it("lists each major the last round left open, where it is and its fix, after the defaults", async () => {
    const root = repo(PROJECT);
    const r = byRound((round, area) => (area === "Lending" ? [finding()] : []));
    const first = await init(root, { reviewers: r, writer: appliesAll(), rounds: 1 });
    const shown = first.interrupt?.message ?? "";
    expect(shown).toContain("Risks (1) — majors VALIDATE's last round left open; the plan proceeds, and to settle one, fix it in the pack and re-run `detent init` (C-2¹⁴):");
    expect(shown).toContain(`  R1-1 ${LENDING_PRD}:6 (unverified): state the grace period in LND-F-002\n      why: fixed in the round the loop stopped at, which no round verified`);
    expect(shown.indexOf("Defaults (")).toBeGreaterThan(-1);
    expect(shown.indexOf("Risks (")).toBeGreaterThan(shown.indexOf("Defaults ("));
  });
});

describe("PRDR-284: a default VALIDATE's writer adds is vetoable at PRESENT (C-3⁗)", () => {
  it("lists it with DECIDE's, from the log as VALIDATE left it", async () => {
    const root = repo(PROJECT);
    const r = byRound((round, area) => (round === 1 && area === "Lending" ? [finding()] : []));
    const w = writer((_, inputs) => {
      const id = String(inputs["next_default"]);
      return {
        edit: {
          [DECISION_LOG_PATH]: (t) =>
            t.includes(`| ${id} |`) ? t : t.replace(/(\| X-\d+ \|[^\n]*\n)(?![\s\S]*\| X-\d+ \|)/u, `$1| ${id} | A loan is late one day past its due date. | The documents imply it. |\n`),
          [LENDING_PRD]: (t) => t.replace(/until the tool is back \(([^)]*)\)/u, (_m, ids: string) => `until the tool is back (${ids}, ${id})`),
        },
      };
    });
    const first = await init(root, { reviewers: r, writer: w });
    const id = String(w.inputs[0]?.["next_default"]);
    expect(record(root).rounds[0]?.changed).toEqual([DECISION_LOG_PATH, LENDING_PRD]);
    expect(first.interrupt?.message ?? "").toContain(`  ${id}: A loan is late one day past its due date.`);
  });
});

describe("PRDR-284: a re-validation reads the change and whatever cites it (C-2⁷)", () => {
  it("reviews only the index when only the index moved, and replays the planning from VALIDATE", async () => {
    const root = repo(PROJECT);
    await init(root);
    appendFileSync(path.join(root, ...INDEX.split("/")), "\nThe codes are stable.\n");
    const r = clean();
    const edited = await init(root, { reviewers: r });
    expect(r.inputs.map((i) => [i["round"], i["task"], i["area"], i["documents"]])).toEqual([[1, "review", "foundations", [INDEX]]]);
    expect(edited.executed).toEqual(expect.arrayContaining(["VALIDATE", "ANALYZE", "PLAN"]));
    expect(record(root)).toMatchObject({ validated: true, rounds: [{ round: 1 }] });
  });

  it("reviews an edited module PRD and the index that links it, and not the log or the facts", async () => {
    const root = repo(PROJECT);
    await init(root);
    appendFileSync(path.join(root, ...LENDING_PRD.split("/")), "\nA loan names its tool.\n");
    const r = clean();
    await init(root, { reviewers: r });
    expect(r.inputs.map((i) => [i["area"], i["documents"]])).toEqual([
      ["foundations", [INDEX]],
      ["Lending", [LENDING_PRD]],
    ]);
  });

  it("reviews what the last validation left open with the change, since the new record replaces it", async () => {
    const root = repo(PROJECT);
    await init(root, { reviewers: byRound((round, area) => (area === "Lending" ? [finding()] : [])), writer: appliesAll(), rounds: 1 });
    appendFileSync(path.join(root, ...INDEX.split("/")), "\nThe codes are stable.\n");
    const r = clean();
    await init(root, { reviewers: r });
    expect(r.inputs.map((i) => [i["area"], i["documents"]])).toEqual([
      ["foundations", [INDEX]],
      ["Lending", [LENDING_PRD]],
    ]);
    expect(record(root).rounds).toEqual([expect.objectContaining({ round: 1, open: [] })]);
    expect(validateOutputs(root)["risks"], "the new record's risks, and there are none").toEqual([]);
  });

  it("reviews a document added to the pack, and records it", async () => {
    const root = repo(PROJECT);
    await init(root);
    mkdirSync(path.join(root, "docs", "design"), { recursive: true });
    writeFileSync(path.join(root, "docs", "design", "loans.md"), "# Loans\n\nA loan is late one day past its due date.\n");
    const r = clean();
    await init(root, { reviewers: r });
    expect(r.inputs.map((i) => [i["area"], i["documents"]])).toEqual([["foundations", ["docs/design/loans.md"]]]);
    expect(Object.keys(record(root).documents)).toContain("docs/design/loans.md");
  });

  it("renews the record without a round when only a context document moved", async () => {
    const root = repo(PROJECT);
    await init(root);
    appendFileSync(path.join(root, "README.md"), "\nSee docs/.\n");
    const r = clean();
    const notes: string[] = [];
    await init(root, { reviewers: r, notes });
    expect(r.inputs).toEqual([]);
    expect(notes).toContain("VALIDATE: nothing that moved is a document a round reviews, so no round runs (C-2¹⁴)");
    expect(record(root)).toMatchObject({ validated: true, rounds: [] });
    const readme = JSON.parse(readFileSync(path.join(root, "docs", "conformance.json"), "utf8")) as { documents: Record<string, string> };
    expect(Object.keys(readme.documents)).toContain("README.md");
  });
});

describe("PRDR-284: VALIDATE restarts C-8's chain (C-8″)", () => {
  it("lets the next init through while a ticket is in flight, and refuses a re-validation that would re-plan before any session", async () => {
    const root = repo(PROJECT);
    await init(root);
    writeTicket(root, { ...readTicket(root, "t-s01-001"), state: "IN_PROGRESS" });
    const again = await init(root);
    expect(again.messages.join(" ")).not.toContain("re-planning refused");
    expect(again.executed).toEqual(["DISCOVER", "AUDIT", "DECIDE", "WRITE"]);
    writeFileSync(path.join(root, ...LENDING_PRD.split("/")), `${readFileSync(path.join(root, ...LENDING_PRD.split("/")), "utf8")}\nA loan names its tool.\n`);
    const r = clean();
    const refused = await init(root, { reviewers: r });
    expect(refused.messages.join(" ")).toContain("re-planning refused");
    expect(r.inputs, "refused before VALIDATE spends a session").toEqual([]);
  });
});
