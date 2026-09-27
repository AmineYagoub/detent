import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FALSIFIED_NOTE } from "../../src/kernel/dependency.js";
import { EXIT_HUMAN_GATED, EXIT_OK, run, type EscalationAction, type EscalationInput } from "../../src/kernel/run.js";
import { claimRefusal, readTicket, ready } from "../../src/kernel/tickets/readers.js";
import type { AmendmentProposal } from "../../src/schemas/amendment.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { MockBackend, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { git, removeTree, writeTree } from "../helpers.js";
import { CONFORMING_PACK } from "../init/pack-fixture.js";
import { addTicket, implementGreen, makeRunRepo, noopFix, reviewApprove } from "./run-fixture.js";

/**
 * PRDR-286 (X-4⁸) — an amendment rides a falsification to the operator.
 *
 * A session that proved the pack wrong could only falsify its own ticket:
 * the pack stayed wrong, and every ticket on the same requirement was drawn
 * and built on the rule it had just disproved. Filed, an amendment holds
 * those tickets while the run goes on with the rest, and the operator decides
 * it at the escalation, or off a run with `detent amend`.
 */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

export const CHECKOUT = "docs/prd/02-checkout.md";
export const OLD = "Checkout MUST accept DZD only (D-1).";
export const NEW = "Checkout MUST accept DZD only, and refuse every other currency (D-1).";

/** What a session proposes: CHK-F-002 is wrong, with the failing test, and the text that fixes it. */
export const PROPOSAL: AmendmentProposal = {
  requirement_ids: ["CHK-F-002"],
  defect_class: "wrong",
  evidence: { kind: "test", test: "tests/checkout.test.ts", output: "expected 409 for a EUR cart, got 200" },
  edits: [{ id: "CHK-F-002", old: OLD, new: NEW }],
};

/** The run fixture with the pack fixture in place of its PRD, committed: three tickets, one of them on another requirement. */
async function packRun(): Promise<string> {
  const { root } = await makeRunRepo();
  roots.push(root);
  rmSync(path.join(root, "PRD.md"));
  writeTree(root, CONFORMING_PACK);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "the pack");
  addTicket(root, { id: "t-chk", requirement_ids: ["CHK-F-002"], priority: 5, surface: ["src/chk/**", "src/feature-t-chk.txt"] });
  addTicket(root, { id: "t-held", requirement_ids: ["CHK-F-001", "CHK-F-002"], surface: ["src/held/**", "src/feature-t-held.txt"] });
  addTicket(root, { id: "t-other", requirement_ids: ["CAT-F-001"], surface: ["src/other/**", "src/feature-t-other.txt"] });
  return root;
}

/** A session that writes `signal` where its inputs say the falsified signal goes. */
const signalling =
  (signal: object): StageFn =>
  (spec: SessionSpec) => {
    const { falsified_out: out } = JSON.parse(spec.promptVariable) as { falsified_out: string };
    writeTree(path.dirname(out), { [path.basename(out)]: JSON.stringify(signal) });
    return noopFix(spec);
  };

const backendFor = (signal: object): MockBackend =>
  new MockBackend({ "t-chk:implement": signalling(signal), implement: implementGreen, review: reviewApprove });

const notes = (root: string, id: string): string[] => readTicket(root, id).notes.map((n) => n.text);

/** The amendment files as X-4⁸ keeps them, read as JSON, so these cases run against a build without the module too. */
interface Filed {
  readonly status?: string;
  readonly ticket?: string;
  readonly commit?: string;
  readonly proposal?: { readonly edits?: unknown };
}
const amendmentsDir = (root: string): string => path.join(root, ".detent", "amendments");
const readAmendment = (root: string, id: string): Filed | null => {
  const file = path.join(amendmentsDir(root), `${id}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Filed) : null;
};
const readAmendments = (root: string): string[] => (existsSync(amendmentsDir(root)) ? readdirSync(amendmentsDir(root)) : []);

function moves(root: string): { ticket: string; from: string; event: string; to: string }[] {
  return readFileSync(path.join(root, ".detent/transitions.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { ticket: string; from: string; event: string; to: string })
    .map(({ ticket, from, event, to }) => ({ ticket, from, event, to }));
}

const pendingOf = (summary: { pending: readonly { id: string; reason: string }[] }, id: string): string => summary.pending.find((p) => p.id === id)?.reason ?? "";

describe("a falsification that names its fix files an amendment", () => {
  it("files it, holds the tickets on its requirement, and the run goes on with the rest", { timeout: 120_000 }, async () => {
    const root = await packRun();
    /* `missing` names a path t-other builds: with an amendment filed, the pack's defect is the human's, not a dependency (X-4′). */
    const backend = backendFor({ note: "CHK-F-002 lets a EUR cart through", missing: ["src/feature-t-other.txt"], amendment: PROPOSAL });

    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "file" });

    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(moves(root).filter((m) => m.ticket === "t-chk").at(-1)).toEqual({ ticket: "t-chk", from: "IN_PROGRESS", event: "PREMISE_FALSIFIED", to: "NEEDS_HUMAN" });
    const filed = readAmendment(root, "AM-001");
    expect(filed?.status).toBe("open");
    expect(filed?.ticket).toBe("t-chk");
    expect(filed?.proposal?.edits).toEqual(PROPOSAL.edits);
    expect(notes(root, "t-chk")).toContain(`${FALSIFIED_NOTE}CHK-F-002 lets a EUR cart through — missing: src/feature-t-other.txt`);
    expect(notes(root, "t-chk").at(-1)).toMatch(/^amendment AM-001 filed \(X-4⁸\): a wrong in CHK-F-002\. The tickets on them are held/u);
    const journal = readFileSync(path.join(root, ".detent/runs/t-chk/journal.jsonl"), "utf8");
    expect(journal).toContain('"event":"amendment_filed"');

    /* The hold: t-held shares CHK-F-002 and is never drawn; t-other does not, and runs to DONE. */
    expect(backend.callsFor("t-held")).toEqual([]);
    expect(readTicket(root, "t-held").state).toBe("READY");
    expect(readTicket(root, "t-other").state).toBe("DONE");
    expect(ready(root).map((t) => t.id)).toEqual([]);
    expect(claimRefusal(root, "t-held")).toMatch(/^held by amendment AM-001 on CHK-F-002, filed by t-chk and not yet decided/u);

    /* Exit 10 names both: the ticket that filed it, and the ticket it holds. */
    expect(pendingOf(outcome.summary, "t-chk")).toContain("amendment AM-001 filed");
    expect(pendingOf(outcome.summary, "t-held")).toContain("`detent amend AM-001 --approve | --edit <file> | --reject <reason>`");
  });

  it("an amendment the pack does not hold is refused and said, and the falsification stands without it", { timeout: 120_000 }, async () => {
    const root = await packRun();
    const backend = backendFor({ note: "the rule is wrong", amendment: { ...PROPOSAL, requirement_ids: ["CHK-F-009"] } });

    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "refused" });

    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(readTicket(root, "t-chk").state).toBe("NEEDS_HUMAN");
    expect(notes(root, "t-chk").at(-1)).toBe(
      "amendment refused: it names requirement CHK-F-009, which the pack does not define — the falsification stands without it (X-4⁸)",
    );
    expect(readAmendments(root)).toEqual([]);
    expect(readTicket(root, "t-held").state, "nothing was filed, so nothing is held").toBe("DONE");
  });
});

/** An escalation that answers each amendment with the next of `answers`, and skips a ticket's. */
function answering(answers: EscalationAction[], seen: EscalationInput[]): (input: EscalationInput) => Promise<EscalationAction> {
  return async (input) => {
    seen.push(input);
    /* A driver that offers without end awaits only settled promises, so the case's timer never fires: it quits instead, and an assertion fails. */
    if (seen.length > 8) return { kind: "quit" };
    if (input.amendment === undefined) return { kind: "skip", by: "op" };
    return answers.shift() ?? { kind: "skip", by: "op" };
  };
}

describe("the operator decides it at the escalation, inside the run (C-10)", () => {
  it("a rejection frees what it held, and the run builds it; the filing ticket keeps the rejection as its note", { timeout: 120_000 }, async () => {
    const root = await packRun();
    const seen: EscalationInput[] = [];
    const escalate = answering([{ kind: "amend", by: "op", decision: { kind: "reject", reason: "CHK-AC-02 already refuses a EUR cart" } }], seen);

    const outcome = await run({ root, backend: backendFor({ note: "EUR gets through", amendment: PROPOSAL }), prompts: PROMPTS, runId: "reject", escalate });

    expect(seen.map((s) => [s.ticket.id, s.amendment?.id])).toEqual([["t-chk", "AM-001"]]);
    expect(readAmendment(root, "AM-001")?.status).toBe("rejected");
    expect(readTicket(root, "t-held").state, "freed, and drawn by the same run").toBe("DONE");
    expect(readTicket(root, "t-chk").state).toBe("NEEDS_HUMAN");
    expect(notes(root, "t-chk").at(-1)).toMatch(/^amendment AM-001 rejected by op: CHK-AC-02 already refuses a EUR cart — the pack stands/u);
    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(readFileSync(path.join(root, CHECKOUT), "utf8")).toContain(OLD);
  });

  it("an approval changes the pack in its own commit, and holds its tickets for `detent init`", { timeout: 120_000 }, async () => {
    const root = await packRun();
    const announced: string[] = [];
    const escalate = answering([{ kind: "amend", by: "op", decision: { kind: "approve" } }], []);

    const outcome = await run({
      root,
      backend: backendFor({ note: "EUR gets through", amendment: PROPOSAL }),
      prompts: PROMPTS,
      runId: "approve",
      escalate,
      announce: (t) => announced.push(t),
    });

    const text = readFileSync(path.join(root, CHECKOUT), "utf8");
    expect(text).toContain(NEW);
    expect(text).not.toContain(OLD);
    const record = readAmendment(root, "AM-001");
    expect(record?.status).toBe("applied");
    const commit = record?.commit ?? "";
    expect(git(root, "show", "--name-only", "--format=", commit).trim().split("\n")).toEqual([CHECKOUT]);
    const message = git(root, "log", "-1", "--format=%B", commit);
    expect(message).toMatch(/^AM-001: amend the pack \(X-4⁸\)/u);
    expect(message, "the operator's commit carries no ticket's trailer, though t-chk held its claim").not.toContain("Detent-Ticket");
    expect(announced.join("\n")).toContain("AM-001: applied at");

    expect(readTicket(root, "t-held").state, "still held: the plan does not yet say what the pack does").toBe("READY");
    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(pendingOf(outcome.summary, "t-held")).toMatch(/applied to the pack at [0-9a-f]{12}: run `detent init` to re-validate the pack and re-plan/u);
  });

  it("a decision the referee refuses is said, and the amendment offered again", { timeout: 120_000 }, async () => {
    const root = await packRun();
    const seen: EscalationInput[] = [];
    const announced: string[] = [];
    const escalate = answering(
      [
        /* D-9 is no decision of the log: the checker finds the amended pack red. */
        { kind: "amend", by: "op", decision: { kind: "edit", edits: [{ id: "CHK-F-002", old: "(D-1)", new: "(D-9)" }] } },
        { kind: "amend", by: "op", decision: { kind: "reject", reason: "the pack is right" } },
      ],
      seen,
    );

    await run({ root, backend: backendFor({ note: "EUR gets through", amendment: PROPOSAL }), prompts: PROMPTS, runId: "again", escalate, announce: (t) => announced.push(t) });

    expect(seen.filter((s) => s.amendment !== undefined)).toHaveLength(2);
    expect(announced.join("\n")).toMatch(/AM-001 was not applied: the checker finds the amended pack red, so the pack was left as it was \(C-2⁷\)/u);
    expect(readFileSync(path.join(root, CHECKOUT), "utf8")).toContain(OLD);
    expect(readAmendment(root, "AM-001")?.status).toBe("rejected");
  });

  it("a skipped amendment stays open and is not offered again in the run, which ends naming it", { timeout: 60_000 }, async () => {
    const root = await packRun();
    const seen: EscalationInput[] = [];

    const outcome = await run({ root, backend: backendFor({ note: "EUR gets through", amendment: PROPOSAL }), prompts: PROMPTS, runId: "skip", escalate: answering([], seen) });

    expect(seen.map((s) => s.amendment?.id)).toEqual(["AM-001"]);
    expect(readAmendment(root, "AM-001")?.status).toBe("open");
    expect(notes(root, "t-chk").at(-1), "a skip writes no note, so the pending reason still names it").toMatch(/^amendment AM-001 filed/u);
    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
  });

  it("a decided amendment is not offered again when its ticket escalates later", { timeout: 60_000 }, async () => {
    const root = await packRun();
    writeTree(root, {
      ".detent/amendments/AM-001.json": JSON.stringify({
        schema_version: SCHEMA_VERSION,
        id: "AM-001",
        ticket: "t-chk",
        filed_at: "2026-09-27T00:00:00.000Z",
        proposal: PROPOSAL,
        status: "rejected",
        decision: { kind: "rejected", by: "op", at: "2026-09-27T01:00:00.000Z", reason: "the pack is right" },
      }),
    });
    const seen: EscalationInput[] = [];

    await run({ root, backend: backendFor({ note: "still wrong, I say" }), prompts: PROMPTS, runId: "later", escalate: answering([], seen) });

    expect(seen.map((s) => [s.ticket.id, s.amendment?.id ?? null])).toEqual([["t-chk", null]]);
  });

  it("an amendment no escalation offered is offered before the run ends", { timeout: 120_000 }, async () => {
    const root = await packRun();
    /* Filed by a ticket that went on (a bug's false premise returns it to diagnosis), or by an earlier run. */
    writeTree(root, {
      ".detent/amendments/AM-001.json": JSON.stringify({ schema_version: SCHEMA_VERSION, id: "AM-001", ticket: "t-chk", filed_at: "2026-09-27T00:00:00.000Z", proposal: PROPOSAL, status: "open" }),
    });
    const seen: EscalationInput[] = [];
    const escalate = answering([{ kind: "amend", by: "op", decision: { kind: "reject", reason: "the pack is right" } }], seen);

    const outcome = await run({ root, backend: new MockBackend({ implement: implementGreen, review: reviewApprove }), prompts: PROMPTS, runId: "late", escalate });

    expect(seen.map((s) => s.amendment?.id)).toEqual(["AM-001"]);
    expect(seen[0]?.summary).toContain("amendment AM-001 (open), filed by t-chk: a wrong in CHK-F-002");
    expect(["t-chk", "t-held", "t-other"].map((id) => readTicket(root, id).state)).toEqual(["DONE", "DONE", "DONE"]);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(existsSync(path.join(root, ".detent/amendments/AM-001.json"))).toBe(true);
  });
});
