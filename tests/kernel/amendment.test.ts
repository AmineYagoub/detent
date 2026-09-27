import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { amendMain } from "../../src/cli/plumbing.js";
import { renderStatus } from "../../src/cli/status.js";
import { fileAmendment } from "../../src/kernel/amendment-file.js";
import { nextAmendmentId, readAmendment, readAmendments } from "../../src/kernel/amendment-store.js";
import { installTrailerHook, markCurrentTicket } from "../../src/kernel/git.js";
import { amendPlumbing } from "../../src/kernel/plumbing.js";
import { acquireRunLock } from "../../src/kernel/run-lock.js";
import { claimRefusal, readTicket, ready } from "../../src/kernel/tickets/readers.js";
import { writeTicket } from "../../src/kernel/tickets/mutations.js";
import { TOOL_INPUTS } from "../../src/referee/registry.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import type { AmendmentProposal } from "../../src/schemas/amendment.js";
import { git, removeTree, writeTree } from "../helpers.js";
import { CONFORMING_PACK } from "../init/pack-fixture.js";
import { addTicket, makeRunRepo } from "./run-fixture.js";

/**
 * PRDR-286 (X-4⁸) — what the referee checks before an amendment holds
 * anything, and what the operator's decision does to the pack.
 */

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const r of roots.splice(0)) removeTree(r);
});

const CHECKOUT = "docs/prd/02-checkout.md";
const OLD = "Checkout MUST accept DZD only (D-1).";
const NEW = "Checkout MUST accept DZD only, and refuse every other currency (D-1).";
const AT = "2026-09-27T12:00:00.000Z";

const proposal = (over: Partial<AmendmentProposal> = {}): AmendmentProposal => ({
  requirement_ids: ["CHK-F-002"],
  defect_class: "wrong",
  evidence: { kind: "test", test: "tests/checkout.test.ts", output: "expected 409 for a EUR cart, got 200" },
  edits: [{ id: "CHK-F-002", old: OLD, new: NEW }],
  ...over,
});

/** The run fixture holding the pack fixture in place of its PRD, with a NEEDS_HUMAN ticket that filed and one it would hold. */
async function packRoot(): Promise<string> {
  const { root } = await makeRunRepo();
  roots.push(root);
  git(root, "rm", "-q", "PRD.md");
  writeTree(root, CONFORMING_PACK);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "the pack");
  addTicket(root, { id: "t-chk", requirement_ids: ["CHK-F-002"] });
  addTicket(root, { id: "t-held", requirement_ids: ["CHK-F-001", "CHK-F-002"] });
  writeTicket(root, { ...readTicket(root, "t-chk"), state: "NEEDS_HUMAN" });
  return root;
}

const reasonOf = (root: string, raw: unknown): string => {
  const filing = fileAmendment(root, "t-chk", raw, AT);
  return filing.kind === "refused" ? filing.reason : `filed ${filing.record.id}`;
};

describe("filing: an amendment is about the pack as it stands, or it is refused", () => {
  it("files one that is, open, numbered one past the highest, its evidence scrubbed", async () => {
    const root = await packRoot();
    const secret = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz";
    const first = fileAmendment(root, "t-chk", proposal({ evidence: { kind: "test", test: "checkout", output: `EUR accepted; key ${secret}` } }), AT);
    expect(first.kind).toBe("filed");
    const record = readAmendment(root, "AM-001");
    expect(record?.status).toBe("open");
    expect(record?.filed_at).toBe(AT);
    expect(JSON.stringify(record)).not.toContain(secret);
    expect(nextAmendmentId(root)).toBe("AM-002");
    expect(reasonOf(root, proposal({ defect_class: "contradiction", evidence: { kind: "passages", passages: [{ id: "CHK-F-002", quote: "Checkout MUST accept DZD only" }, { id: "D-1", quote: "DZD only in V1" }] } }))).toBe("filed AM-002");
  });

  it("refuses each way it can be about some other pack, and says which", async () => {
    const root = await packRoot();
    const cases: [string, unknown, string][] = [
      ["an unknown requirement", proposal({ requirement_ids: ["CHK-F-009"] }), "it names requirement CHK-F-009, which the pack does not define"],
      [
        "a quote its record does not hold",
        proposal({ defect_class: "contradiction", evidence: { kind: "passages", passages: [{ id: "CHK-F-002", quote: "Checkout accepts EUR" }, { id: "D-1", quote: "DZD only in V1" }] } }),
        'it quotes "Checkout accepts EUR" as CHK-F-002, and CHK-F-002 does not hold those words',
      ],
      ["a record the pack does not hold", proposal({ edits: [{ id: "CHK-F-009", old: OLD, new: NEW }] }), "an edit names CHK-F-009, which is no requirement"],
      ["text its document does not hold", proposal({ edits: [{ id: "CHK-F-002", old: "Checkout MUST accept EUR", new: NEW }] }), `replaces "Checkout MUST accept EUR", which ${CHECKOUT} does not hold`],
      ["text its document holds twice", proposal({ edits: [{ id: "CHK-F-002", old: "MUST", new: "SHALL" }] }), `replaces "MUST", which ${CHECKOUT} holds more than once`],
      ["text outside its record's lines", proposal({ edits: [{ id: "CHK-F-002", old: "a EUR cart answers", new: "a EUR cart is refused" }] }), `outside the lines that write CHK-F-002`],
      ["a secret in the text it proposes", proposal({ edits: [{ id: "CHK-F-002", old: OLD, new: `${OLD} token: sk-ant-api03-abcdefghijklmnop` }] }), "looks like it carries a secret"],
      ["a contradiction without its passages", proposal({ defect_class: "contradiction" }), "evidence: a contradiction's evidence is the two passages"],
      ["one passage", proposal({ evidence: { kind: "passages", passages: [{ id: "D-1", quote: "DZD only in V1" }] } }), "evidence.passages"],
      ["no edit", proposal({ edits: [] }), "edits"],
    ];
    for (const [what, raw, reason] of cases) expect(reasonOf(root, raw), what).toContain(reason);
    expect(readAmendments(root), "nothing refused is filed").toEqual([]);
  });

  it("names a torn amendment file rather than guessing, as a torn ticket is named", async () => {
    const root = await packRoot();
    writeTree(root, { ".detent/amendments/AM-001.json": "{ torn" });
    expect(() => readAmendments(root)).toThrow(/^\.detent\/amendments\/AM-001\.json is not readable JSON/u);
  });
});

describe("the operator's decision, off a run (`detent amend`)", () => {
  it("a rejection records why, frees the tickets it held, and leaves the filing ticket with the human", async () => {
    const root = await packRoot();
    fileAmendment(root, "t-chk", proposal(), AT);
    expect(ready(root).map((t) => t.id), "held while open").toEqual([]);

    const decided = amendPlumbing(root, "AM-001", "op", { kind: "reject", reason: "CHK-AC-02 already refuses a EUR cart" });

    expect(decided.ok).toBe(true);
    expect(readAmendment(root, "AM-001")?.decision).toMatchObject({ kind: "rejected", by: "op", reason: "CHK-AC-02 already refuses a EUR cart" });
    expect(ready(root).map((t) => t.id)).toEqual(["t-held"]);
    expect(readTicket(root, "t-chk").state).toBe("NEEDS_HUMAN");
    expect(readTicket(root, "t-chk").notes.at(-1)?.text).toMatch(/^amendment AM-001 rejected by op: CHK-AC-02 already refuses a EUR cart/u);
    expect(amendPlumbing(root, "AM-001", "op", { kind: "approve" }).message).toBe("AM-001 is rejected: only an open amendment is decided");
  });

  it("an approval edits the pack and commits it alone, as no ticket's work, and keeps holding until the re-plan", async () => {
    const root = await packRoot();
    fileAmendment(root, "t-chk", proposal(), AT);
    writeTree(root, { "src/unrelated.py": "x = 1\n" });
    git(root, "add", "src/unrelated.py");
    /* As inside a run: the hook stamps the claimed ticket's trailer on every commit made while the marker names it. */
    installTrailerHook(root);
    markCurrentTicket(root, "t-chk");

    const decided = amendPlumbing(root, "AM-001", "op", { kind: "approve" });

    expect(decided.ok, decided.message).toBe(true);
    expect(readFileSync(path.join(root, CHECKOUT), "utf8")).toContain(NEW);
    const record = readAmendment(root, "AM-001");
    expect(record?.status).toBe("applied");
    expect(record?.commit).toBe(git(root, "rev-parse", "HEAD").trim());
    expect(git(root, "show", "--name-only", "--format=%B", "HEAD")).not.toContain("Detent-Ticket");
    expect(git(root, "show", "--name-only", "--format=", "HEAD").trim()).toBe(CHECKOUT);
    expect(git(root, "diff", "--cached", "--name-only").trim(), "what else was staged stays staged").toBe("src/unrelated.py");
    expect(readFileSync(path.join(root, ".git", "DETENT_TICKET"), "utf8"), "the claimed ticket's marker is put back").toBe("t-chk");
    expect(claimRefusal(root, "t-held")).toMatch(/applied to the pack at [0-9a-f]{12}: run `detent init`/u);
  });

  it("an edit applies the operator's text in place of the session's", async () => {
    const root = await packRoot();
    fileAmendment(root, "t-chk", proposal(), AT);
    const mine = [{ id: "CHK-F-002", old: OLD, new: "Checkout MUST accept DZD alone (D-1)." }];
    expect(amendPlumbing(root, "AM-001", "op", { kind: "edit", edits: mine }).ok).toBe(true);
    expect(readFileSync(path.join(root, CHECKOUT), "utf8")).toContain("Checkout MUST accept DZD alone (D-1).");
    expect(readAmendment(root, "AM-001")?.decision).toMatchObject({ kind: "edited", edits: mine });
  });

  it("the operator's edits are held to the records they name, as the session's were", async () => {
    const root = await packRoot();
    fileAmendment(root, "t-chk", proposal(), AT);
    const before = readFileSync(path.join(root, CHECKOUT), "utf8");
    const decided = amendPlumbing(root, "AM-001", "op", { kind: "edit", edits: [{ id: "CHK-F-002", old: "a EUR cart answers", new: "a EUR cart is refused" }] });
    expect(decided.ok).toBe(false);
    expect(decided.message).toContain("outside the lines that write CHK-F-002");
    expect(readFileSync(path.join(root, CHECKOUT), "utf8")).toBe(before);
    expect(readAmendment(root, "AM-001")?.status).toBe("open");
  });

  it("the checker gates the edit: a pack it finds red is written back byte for byte, and nothing is committed", async () => {
    const root = await packRoot();
    fileAmendment(root, "t-chk", proposal({ edits: [{ id: "CHK-F-002", old: "(D-1)", new: "(D-9)" }] }), AT);
    const before = readFileSync(path.join(root, CHECKOUT), "utf8");
    const head = git(root, "rev-parse", "HEAD");

    const decided = amendPlumbing(root, "AM-001", "op", { kind: "approve" });

    expect(decided.ok).toBe(false);
    expect(decided.message).toMatch(/^AM-001 was not applied: the checker finds the amended pack red, so the pack was left as it was \(C-2⁷\): docs\/prd\/02-checkout\.md:\d+ /u);
    expect(readFileSync(path.join(root, CHECKOUT), "utf8")).toBe(before);
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(readAmendment(root, "AM-001")?.status).toBe("open");
  });

  it("is refused while a live run holds the root, which decides it at its own escalation", async () => {
    const root = await packRoot();
    fileAmendment(root, "t-chk", proposal(), AT);
    const lock = acquireRunLock(root);
    try {
      const decided = amendPlumbing(root, "AM-001", "op", { kind: "approve" });
      expect(decided.ok).toBe(false);
      expect(decided.message).toMatch(/^a run holds this root \(pid \d+ on .+\): decide AM-001 at its escalation, or once it ends \(X-4⁸\)$/u);
    } finally {
      if (lock.ok) lock.release();
    }
    expect(readAmendment(root, "AM-001")?.status).toBe("open");
  });

  it("the verb shows an amendment, decides one, and refuses two decisions at once", async () => {
    const root = await packRoot();
    fileAmendment(root, "t-chk", proposal(), AT);
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => (out.push(String(chunk)), true));
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => (out.push(String(chunk)), true));
    expect(amendMain([root, "AM-001"])).toBe(0);
    expect(out.join("")).toContain(`amendment AM-001 (open), filed by t-chk: a wrong in CHK-F-002\nevidence: the test tests/checkout.test.ts fails:\n    expected 409`);
    expect(amendMain([root, "AM-001", "--approve", "--reject", "no"])).toBe(2);
    const edits = path.join(root, "mine.json");
    writeFileSync(edits, JSON.stringify([{ id: "CHK-F-002", old: OLD }]));
    expect(amendMain([root, "AM-001", "--edit", edits])).toBe(2);
    expect(out.join("")).toContain("is not a list of edits: 0.new");
    expect(amendMain([root, "AM-001", "--reject", "the pack is right", "--user", "op"])).toBe(0);
    expect(readAmendment(root, "AM-001")?.decision).toMatchObject({ kind: "rejected", by: "op" });
  });
});

describe("where the operator sees it", () => {
  it("`detent status` lists each amendment still holding, what it waits on and what it holds, with no state name", async () => {
    const root = await packRoot();
    fileAmendment(root, "t-chk", proposal(), AT);
    const text = renderStatus(root);
    expect(text).toContain("Amendments to the pack (X-4⁸):\n  AM-001 on CHK-F-002, filed by t-chk — waiting on you: `detent amend AM-001` shows it and decides it\n    holds t-held\n");
    amendPlumbing(root, "AM-001", "op", { kind: "reject", reason: "no" });
    expect(renderStatus(root)).not.toContain("Amendments to the pack");
  });

  it("the four roles that may file one are told its shape, and the read-only roles are not (decision 12)", () => {
    const prompts = loadPromptSet().prompts;
    for (const role of ["implement", "blind_fix", "informed_fix", "review_fix"] as const) {
      for (const token of ['"amendment"', '"defect_class"', '"evidence"', '"edits"', '"old"', "X-4⁸"]) expect(prompts[role], `${role}: ${token}`).toContain(token);
    }
    for (const role of ["review", "diagnose", "research"] as const) expect(prompts[role], role).not.toContain("amendment");
    const skill = readFileSync(path.join(import.meta.dirname, "../../skills/run/SKILL.md"), "utf8");
    expect(skill).toContain('`record` `{kind: "amendment", amendment_id, by, decision}`');
  });

  it("the `record` tool takes a decision by the amendment's id, and nothing else", () => {
    const record = TOOL_INPUTS.record;
    const ok = { kind: "amendment", amendment_id: "AM-001", by: "op", decision: { kind: "approve" } };
    expect(record.safeParse(ok).success).toBe(true);
    expect(record.safeParse({ ...ok, amendment_id: "AM-1" }).success).toBe(false);
    expect(record.safeParse({ ...ok, decision: { kind: "reject" } }).success, "a rejection says why").toBe(false);
    expect(record.safeParse({ ...ok, decision: { kind: "edit", edits: [] } }).success, "an edit edits").toBe(false);
  });
});
