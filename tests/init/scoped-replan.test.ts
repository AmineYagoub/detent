import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureConfig } from "../../src/init/config.js";
import { recordApproval } from "../../src/init/present.js";
import { appendNote, claim, writeTicket } from "../../src/kernel/tickets/mutations.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import type { State } from "../../src/schemas/states.js";
import { git } from "../helpers.js";
import { CONFORMING_PACK } from "./pack-fixture.js";
import { clear, draft, edit, planned, seeded, slicing, type Cut, type Script, type Seeded } from "./seed-fixture.js";
import { covering, sliceOf, ticket } from "./slicing-fixture.js";

/**
 * PRDR-286 (C-8⁵) — an amendment ends in a re-plan of the slices it changed.
 *
 * Re-planning an approved plan meant `--replan`, which re-derives every slice,
 * and C-8″ refused it while the ticket that proved the pack wrong sat in
 * NEEDS_HUMAN: the ticket that asked for the re-plan was the one thing that
 * stopped it. An applied amendment asks `init` for the re-plan of the slices
 * its edit changed, on an approved plan too; each slice PLAN plans again is
 * asked the in-flight question for its own tickets alone, and every other
 * slice keeps its cache and its tickets as they stand.
 *
 * The amendment is written here as the JSON X-4⁸ keeps it in, and the pack's
 * conformance record is committed after the edit as a validation would leave
 * it (C-2¹⁴), so what a case asserts is what planning did.
 */

/** The pack fixture's live requirements cut two ways: M0's catalog, then all of M1. */
const TWO: readonly Cut[] = [
  { id: "s01", requirement_ids: ["CAT-F-001"] },
  { id: "s02", requirement_ids: ["CAT-F-002", "CAT-N-001", "CHK-F-001", "CHK-F-002"], depends_on: ["s01"] },
];

const CHECKOUT = "docs/prd/02-checkout.md";
const OLD = "Checkout MUST accept DZD only (D-1).";
const NEW = "Checkout MUST accept DZD only, and refuse every other currency (D-1).";

/** An amendment's one edit: the requirement it names, the document that writes it, and the text replaced. */
interface Change {
  readonly id: string;
  readonly file: string;
  readonly old: string;
  readonly new: string;
}

const ON_CHECKOUT: Change = { id: "CHK-F-002", file: CHECKOUT, old: OLD, new: NEW };
const ON_CATALOG: Change = {
  id: "CAT-F-001",
  file: "docs/prd/01-catalog.md",
  old: "with a title and a price in minor units (X-1).",
  new: "with a title and a positive price in minor units (X-1).",
};

/** A two-slice plan on the pack fixture, planned, presented and approved. */
async function approvedPlan(script: Script = {}): Promise<Seeded> {
  const s = seeded(CONFORMING_PACK, { slices: (take) => slicing(TWO, take), ...script });
  /* As `detent init` does before any phase runs: a requeue reads the budgets. */
  ensureConfig(s.root);
  const first = await s.init();
  expect(first.interrupt?.interrupt, first.interrupt?.message).toBe("AWAIT_APPROVAL");
  recordApproval(s.root, "the operator", Date.parse("2026-09-27T09:00:00Z"), { builds: [], pack_hash: null });
  return s;
}

/** `id` left in `state`, as a run leaves it. */
const put = (root: string, id: string, state: State): void => {
  writeTicket(root, { ...readTicket(root, id), state });
};

/** The amendment `ticket` filed on CHK-F-002, or on `change`'s requirement, applied as the operator approved it: the edit is in the pack and committed. */
function applied(root: string, ticket: string, change: Change = ON_CHECKOUT): void {
  edit(root, change.file, [change.old, change.new]);
  mkdirSync(path.join(root, ".detent", "amendments"), { recursive: true });
  const edits = [{ id: change.id, old: change.old, new: change.new }];
  const record = {
    schema_version: SCHEMA_VERSION,
    id: "AM-001",
    ticket,
    filed_at: "2026-09-27T10:00:00.000Z",
    proposal: {
      requirement_ids: [change.id],
      defect_class: "wrong",
      evidence: { kind: "test", test: "tests/app.test.ts", output: "the test the record contradicts failed" },
      edits,
    },
    status: "applied",
    decision: { kind: "approved", by: "the operator", at: "2026-09-27T11:00:00.000Z", edits },
    commit: git(root, "rev-parse", "HEAD").trim(),
  };
  writeFileSync(path.join(root, ".detent", "amendments", "AM-001.json"), `${JSON.stringify(record, null, 2)}\n`);
}

const amendment = (root: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(root, ".detent", "amendments", "AM-001.json"), "utf8")) as Record<string, unknown>;

const requeues = (root: string): string[] =>
  (existsSync(path.join(root, ".detent", "transitions.jsonl")) ? readFileSync(path.join(root, ".detent", "transitions.jsonl"), "utf8") : "")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as { ticket: string; event: string })
    .filter((t) => t.event === "HUMAN_REQUEUE")
    .map((t) => t.ticket);

describe("PRDR-286: an applied amendment re-plans the slices it changed (C-8⁵)", () => {
  it("AC 7: an approved two-slice plan, a NEEDS_HUMAN ticket in the second: the second slice is planned again, and the first reused", async () => {
    const s = await approvedPlan();
    put(s.root, "t-s02-001", "NEEDS_HUMAN");
    applied(s.root, "t-s02-001");
    clear(s);

    /* `--replan` is unchanged (a non-goal): it re-derives every slice, and C-8″ refuses it on the ticket in NEEDS_HUMAN. */
    const whole = await s.init({ replan: true });
    expect(whole.exitCode).toBe(2);
    expect(whole.messages.join("\n")).toContain("--replan refused: t-s02-001 (NEEDS_HUMAN) still in flight");
    expect(s.log, "refused before any session").toEqual([]);

    const result = await s.init();

    /* Before PRDR-286: "plan approved … pass --replan to regenerate it (C-8)", and nothing planned. */
    expect(result.messages.join("\n")).not.toContain("pass --replan");
    expect(planned(s)).toEqual(["PLAN:s02"]);
    expect(s.notes.filter((n) => n.startsWith("s01 ") && n.includes(": reused")), s.notes.join("\n")).toHaveLength(1);
    const filing = readTicket(s.root, "t-s02-001");
    expect([filing.state, filing.generations.length], "the filing ticket, written afresh by its slice's re-plan").toEqual(["READY", 1]);
    expect(requeues(s.root), "superseded, not requeued").toEqual([]);
    expect(amendment(s.root)).toMatchObject({ status: "replanned", replanned: ["s02"] });
    expect(result.interrupt?.interrupt, "the changed plan is presented again (C-7′)").toBe("AWAIT_APPROVAL");

    /* Settled: the next init is C-8's again, and the redraft left the approved fields as they were, so the approval stands. */
    clear(s);
    const again = await s.init();
    expect(s.log).toEqual([]);
    expect(again.messages.join("\n")).toContain("pass --replan to regenerate it (C-8)");
  });

  it("a slice it would plan again with a ticket in flight is refused before any session, and nothing is written", async () => {
    const s = await approvedPlan();
    put(s.root, "t-s01-001", "NEEDS_HUMAN");
    put(s.root, "t-s02-001", "IN_PROGRESS");
    applied(s.root, "t-s01-001");
    clear(s);

    const result = await s.init();

    expect(result.exitCode).toBe(2);
    expect(result.reachedPhase).toBe("PLAN");
    expect(result.messages.join("\n")).toContain("re-planning refused: t-s02-001 (IN_PROGRESS) still in flight");
    expect(planned(s)).toEqual([]);
    expect(readTicket(s.root, "t-s02-001").state).toBe("IN_PROGRESS");
    expect(readTicket(s.root, "t-s01-001").state).toBe("NEEDS_HUMAN");
    expect(amendment(s.root)).toMatchObject({ status: "applied" });
  });

  it("a filing ticket still in flight in a slice it would plan again refuses it: a bug's false premise sends it back to diagnosis", async () => {
    const s = await approvedPlan();
    put(s.root, "t-s02-001", "DIAGNOSED");
    applied(s.root, "t-s02-001");
    clear(s);

    const result = await s.init();

    expect(result.exitCode).toBe(2);
    expect(result.messages.join("\n")).toContain("re-planning refused: t-s02-001 (DIAGNOSED) still in flight");
    expect(planned(s)).toEqual([]);
  });

  it("an amendment whose edit was undone by hand is settled all the same: PLAN runs, reuses every slice, and returns the filing ticket", async () => {
    const s = await approvedPlan();
    put(s.root, "t-s01-001", "NEEDS_HUMAN");
    applied(s.root, "t-s01-001");
    edit(s.root, CHECKOUT, [NEW, OLD]);
    clear(s);

    await s.init();

    expect(planned(s)).toEqual([]);
    expect(readTicket(s.root, "t-s01-001").state).toBe("READY");
    expect(amendment(s.root)).toMatchObject({ status: "replanned", replanned: [] });
  });

  it("a slice not planned again keeps its tickets as they stand, and the filing ticket there returns through HUMAN_REQUEUE", async () => {
    const s = await approvedPlan();
    put(s.root, "t-001-bootstrap", "IN_PROGRESS");
    /* Held by a live process: a ticket left exactly as it stands is not written, so its claim is not in the way. */
    expect(claim(s.root, "t-001-bootstrap", "a live run", () => "2026-09-27T12:00:00.000Z")).toBe(true);
    put(s.root, "t-s01-001", "NEEDS_HUMAN");
    applied(s.root, "t-s01-001");
    const bootstrap = readTicket(s.root, "t-001-bootstrap");
    clear(s);

    await s.init();

    expect(planned(s)).toEqual(["PLAN:s02"]);
    expect(readTicket(s.root, "t-001-bootstrap"), "in flight in no re-planned slice: left exactly as it was").toEqual(bootstrap);
    expect(s.notes.filter((n) => n.includes("bootstrap ticket t-001-bootstrap created")), "kept, so not said to be created").toEqual([]);
    const filing = readTicket(s.root, "t-s01-001");
    expect(filing.state).toBe("READY");
    expect(filing.generations).toHaveLength(2);
    expect(filing.notes.at(-1)?.text).toContain("requeued with guidance (C-12): the pack was amended (AM-001) and the slices it changed were planned again");
    expect(requeues(s.root)).toEqual(["t-s01-001"]);
    expect(amendment(s.root)).toMatchObject({ status: "replanned", replanned: ["s02"] });
  });

  it("a kept ticket the re-plan gives new blockers keeps its state, generations and notes, and takes only the blockers", async () => {
    /* The first slice's re-plan drafts a second ticket after its first, so the second slice's capstone blocker moves (C-2‴). */
    const s = await approvedPlan({
      draft: (take, inputs) =>
        sliceOf(inputs) === "s01" && take > 1
          ? (covering(inputs, [ticket("t-s01-001"), ticket("t-s01-002", ["t-s01-001"])]) as Record<string, unknown>)
          : draft(inputs),
    });
    put(s.root, "t-s01-001", "NEEDS_HUMAN");
    put(s.root, "t-s02-001", "IN_PROGRESS");
    appendNote(s.root, "t-s02-001", { author: "the operator", text: "halfway there" });
    const before = readTicket(s.root, "t-s02-001");
    expect(before.blockers).toEqual(["t-001-bootstrap", "t-s01-001"]);
    applied(s.root, "t-s01-001", ON_CATALOG);
    clear(s);

    await s.init();

    expect(planned(s)).toEqual(["PLAN:s01"]);
    expect(readTicket(s.root, "t-s02-001")).toEqual({ ...before, blockers: ["t-001-bootstrap", "t-s01-002"] });
    expect(amendment(s.root)).toMatchObject({ status: "replanned", replanned: ["s01"] });
  });
});
