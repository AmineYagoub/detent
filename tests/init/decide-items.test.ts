import { describe, expect, it } from "vitest";
import { checkDecide, openItems } from "../../src/init/decide-items.js";
import type { LogView } from "../../src/init/decide-log.js";
import { decideArtifactSchema } from "../../src/schemas/decide.js";
import { decideSkeleton } from "../../src/init/decide.js";
import { DEFAULT_EFFORT_ROUTING, DEFAULT_MODEL_ROUTING, READ_ONLY_ROLES, ROLE_IDS } from "../../src/schemas/roles.js";
import { INIT_PHASES } from "../../src/schemas/init.js";
import { toolsForRole } from "../../src/sessions/guard.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { LATE, PRICE, REFUND, STACK_DEFAULT, SURVEY, artifact, type Json } from "./decide-fixture.js";

/**
 * PRDR-282 — what DECIDE sorts, the checks code makes of the sorting, and the
 * role that sorts it (C-2¹², S-1‴).
 */

const CHECKED_CLAIM = { ...(SURVEY["claims"] as Json[])[0], claim_hash: "a".repeat(64), verdict: "wrong", source: "https://docs.stripe.com/refunds", correction: "Stripe keeps the fee.", checked: true };
const AUDIT: Json = { ...SURVEY, ran: true, claims: [CHECKED_CLAIM] };
const LOG = (over: Partial<LogView> = {}): LogView => ({ exists: true, ids: new Set(), decisions: [], defaults: [], stack: null, hasStack: false, rootSlots: new Set(), packages: [], ...over });
const parse = (value: Json) => decideArtifactSchema.parse(value);

describe("PRDR-282: the items AUDIT leaves open", () => {
  it("names each by kind, and keys each by what a second survey of the same documents would say again", () => {
    const items = openItems(AUDIT, { stackOpen: true });
    expect(items.map((i) => [i.id, i.kind])).toEqual([
      ["C1", "contradiction"],
      ["G1", "gap"],
      ["K1", "claim"],
      ["stack", "stack"],
    ]);
    /* The lines moved and the words around the quotes changed; the quotes, the topic and the claim did not. */
    const shifted = JSON.parse(JSON.stringify(AUDIT).replaceAll('"line":3', '"line":9').replaceAll('"line":4', '"line":12')) as Json;
    const again = { ...shifted, gaps: [{ topic: "  Late   returns ", detail: "reworded", passages: [] }] };
    expect(openItems(again, { stackOpen: true }).map((i) => i.key)).toEqual(items.map((i) => i.key));
  });

  it("makes one item of a claim relied on in several places, and none of a confirmed one", () => {
    const second = { ...CHECKED_CLAIM, passage: { file: "docs/roadmap.md", line: 3, quote: "Launch is in spring." } };
    const both = openItems({ ...AUDIT, claims: [CHECKED_CLAIM, second] }, { stackOpen: false });
    expect(both.filter((i) => i.kind === "claim")).toHaveLength(1);
    expect((both.find((i) => i.kind === "claim")?.shown["places"] as unknown[]).length).toBe(2);
    expect(openItems({ ...AUDIT, claims: [{ ...CHECKED_CLAIM, verdict: "confirmed" }] }, { stackOpen: false }).map((i) => i.id)).toEqual(["C1", "G1"]);
  });
});

describe("PRDR-282: code checks the sorting (C-2¹²)", () => {
  const items = openItems(AUDIT, { stackOpen: false });

  it("takes a sorting that settles every item once", () => {
    const check = checkDecide(parse(artifact({ questions: [PRICE], defaults: [LATE, REFUND] })), items, LOG());
    expect(check.issues).toEqual([]);
    expect(check.unsorted).toEqual([]);
  });

  it("refuses an id that is not an item, an item settled twice, and an entry the log does not hold", () => {
    const check = checkDecide(
      parse(artifact({ questions: [PRICE], defaults: [{ ...LATE, settles: ["G1", "C1", "Q7"] }], settled: [{ item: "K1", entry: "X-40" }] })),
      items,
      LOG({ ids: new Set(["X-1"]) }),
    );
    expect(check.issues).toEqual([
      "settled cites X-40 for K1, and the decision log has no entry X-40",
      "C1 is settled twice, by question 1 and by default 1; each item is settled once",
      "default 1 names Q7, which is not an item in your inputs",
      "1 item(s) settled by nothing: K1; every item is asked, defaulted or cited as settled",
    ]);
    expect(check.kept.defaults).toEqual([{ ...LATE, settles: ["G1"] }]);
    expect(check.unsorted.map((i) => i.id)).toEqual(["K1"]);
  });

  it("refuses a question the log already answers, and gives its items to the entry that answers it (C-3‴)", () => {
    const log = LOG({ ids: new Set(["D-3"]), decisions: [{ id: "D-3", question: "Is borrowing free at launch, or two dollars a day?", answer: "**Free**", reason: "r" }] });
    const check = checkDecide(parse(artifact({ questions: [{ ...PRICE, question: "At launch: free borrowing, or two dollars a day?" }], defaults: [LATE, REFUND] })), items, log);
    expect(check.issues).toEqual([expect.stringContaining("is one the decision log already answers, as D-3; cite it in settled instead (C-3‴)")]);
    expect(check.kept.questions).toEqual([]);
    expect(check.kept.settled).toEqual([{ item: "C1", entry: "D-3" }]);
    expect(check.unsorted).toEqual([]);
  });

  it("lets only the stack's settler carry a stack, whole, and only while the stack is open (D-10′)", () => {
    const open = openItems(AUDIT, { stackOpen: true });
    const ok = checkDecide(parse(artifact({ questions: [PRICE], defaults: [LATE, REFUND, STACK_DEFAULT] })), open, LOG());
    expect(ok.issues).toEqual([]);

    const stray = checkDecide(parse(artifact({ questions: [PRICE], defaults: [{ ...LATE, stack: STACK_DEFAULT.stack }, REFUND, STACK_DEFAULT] })), open, LOG());
    expect(stray.issues).toEqual(["default 1 carries a stack but does not settle the open stack (D-10′)", "1 item(s) settled by nothing: G1; every item is asked, defaulted or cited as settled"]);

    const bare = checkDecide(parse(artifact({ questions: [PRICE], defaults: [LATE, REFUND, { ...STACK_DEFAULT, stack: undefined }] })), open, LOG());
    expect(bare.issues[0]).toBe("default 3 settles the stack without carrying one (D-10′)");

    const half = { ...PRICE, settles: ["stack"], options: [{ ...PRICE.options[0], stack: STACK_DEFAULT.stack }, PRICE.options[1]] };
    const partial = checkDecide(parse(artifact({ questions: [PRICE, half], defaults: [LATE, REFUND] })), open, LOG());
    expect(partial.issues[0]).toBe("question 2 carries a stack, which only the question that settles the open stack does, on every option (D-10′)");

    const closed = checkDecide(parse(artifact({ questions: [PRICE], defaults: [LATE, REFUND, STACK_DEFAULT] })), items, LOG());
    expect(closed.issues[0], "a log with a stack leaves none to settle").toBe("default 3 carries a stack but does not settle the open stack (D-10′)");
  });

  it("hands the session a skeleton its own schema accepts, with the stack's default only while the stack is open", () => {
    expect(decideArtifactSchema.safeParse(decideSkeleton(true)).success).toBe(true);
    expect(decideArtifactSchema.safeParse(decideSkeleton(false)).success).toBe(true);
    expect(JSON.stringify(decideSkeleton(false))).not.toContain('"stack"');
  });
});

describe("PRDR-282: the spec_write role (S-1‴, S-5⁵)", () => {
  const roles = ROLE_IDS as readonly string[];

  it("is a role, routed to claude-opus-5-5 at max (specification decision 14), directly after audit", () => {
    expect(roles.indexOf("spec_write")).toBe(roles.indexOf("audit") + 1);
    expect((DEFAULT_MODEL_ROUTING as Readonly<Record<string, string>>)["spec_write"]).toBe("claude-opus-5-5");
    expect((DEFAULT_EFFORT_ROUTING as Readonly<Record<string, string>>)["spec_write"]).toBe("max");
  });

  it("has the read-only tools as its own, and what it writes is its task's: DECIDE's, its artifact alone, which an init session's rule adds", () => {
    expect((READ_ONLY_ROLES as ReadonlySet<string>).has("spec_write")).toBe(false);
    expect(toolsForRole("spec_write", ["docs.example.com"])).toEqual(["Read", "Grep", "Glob"]);
  });

  it("has a prompt of its own, pinned in the manifest, that names the task and the log", () => {
    const set = loadPromptSet();
    const prompt = (set.prompts as Readonly<Record<string, string>>)["spec_write"] ?? "";
    expect(prompt).toContain("`task: decide`");
    expect(prompt).toContain("counted in money or contracts rather than in code (C-3″)");
    expect((set.hashes as Readonly<Record<string, string>>)["spec_write"]).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("runs as DECIDE, directly after AUDIT (C-2⁶)", () => {
    const phases = INIT_PHASES as readonly string[];
    expect(phases.indexOf("DECIDE")).toBe(phases.indexOf("AUDIT") + 1);
  });
});
