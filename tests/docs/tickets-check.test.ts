import { describe, expect, it } from "vitest";
import { REQUIRED_KEYS, TICKET_STATES, UNCHECKED, checkTickets, citedIds, violationsIn } from "../../scripts/check-tickets.js";

/**
 * PRDR-192 — the gate for `tickets/prd-review/`.
 *
 * Every rule is asserted in BOTH directions: the violation is caught, and the
 * compliant form beside it is not. `check-rules.ts` produced a rule that fired
 * on everything and a rule that fired on nothing, both by accident, and the
 * discipline that caught them is the same one applied here.
 */

const FULL = `---\n${REQUIRED_KEYS.map((k) => (k === "id" ? "id: PRDR-001" : k === "state" ? "state: DONE" : `${k}: x`)).join("\n")}\n---\n\nbody\n`;
const withState = (state: string): string => FULL.replace("state: DONE", `state: ${state}`);
const rulesOf = (file: string, source: string, landed = false): string[] =>
  violationsIn(file, source, landed).map((v) => v.rule);

describe("PRDR-192 the ticket gate catches what it claims", () => {
  it("flags an empty ticket distinctly from an unframed one", () => {
    expect(rulesOf("tickets/prd-review/PRDR-001-x.md", "")).toEqual(["ticket/empty"]);
    expect(rulesOf("tickets/prd-review/PRDR-001-x.md", "   \n\n")).toEqual(["ticket/empty"]);
    /* Content without a header is a different fault and says so. */
    expect(rulesOf("tickets/prd-review/PRDR-001-x.md", "# a ticket\n\nprose\n")).toEqual(["frontmatter/absent"]);
  });

  it("flags a missing required key and accepts a complete header", () => {
    expect(rulesOf("tickets/prd-review/PRDR-001-x.md", FULL.replace("surface: x\n", ""))).toContain("frontmatter/missing-key");
    expect(rulesOf("tickets/prd-review/PRDR-001-x.md", FULL)).toEqual([]);
  });

  it("flags an id that disagrees with its filename, and accepts the suffix form", () => {
    expect(rulesOf("tickets/prd-review/PRDR-001-x.md", FULL.replace("id: PRDR-001", "id: PRDR-999"))).toContain("id/filename-mismatch");
    /* `PRDR-131a` and `PRDR-145b` are real ids: the suffix splits one ticket in two. */
    expect(rulesOf("tickets/prd-review/PRDR-131a-x.md", FULL.replace("id: PRDR-001", "id: PRDR-131a"))).toEqual([]);
  });

  it("flags a state outside the closed set", () => {
    expect(rulesOf("tickets/prd-review/PRDR-001-x.md", withState("CLOSED"))).toContain("state/unknown");
    for (const state of TICKET_STATES) {
      expect(rulesOf("tickets/prd-review/PRDR-001-x.md", withState(state))).toEqual([]);
    }
  });

  /**
   * The rule the gate exists for. `DONE` is reliable and `OPEN` is not, so only
   * the direction that decayed is checked — a ticket the tree contradicts.
   */
  it("flags a non-DONE state the tree contradicts, and never the reverse", () => {
    const open = withState("OPEN");
    expect(rulesOf("tickets/prd-review/PRDR-001-x.md", open, true)).toContain("state/stale-open");
    expect(rulesOf("tickets/prd-review/PRDR-001-x.md", withState("READY"), true)).toContain("state/stale-open");
    /* Uncited: nothing is claimed, because a PRD-only ticket cites nothing. */
    expect(rulesOf("tickets/prd-review/PRDR-001-x.md", open, false)).toEqual([]);
    /* DONE is never second-guessed — the gate cannot know a claim of done is false. */
    expect(rulesOf("tickets/prd-review/PRDR-001-x.md", withState("DONE"), true)).toEqual([]);
  });

  it("gathers cited ids from the shipped tree, suffix ids included", () => {
    const cited = citedIds(process.cwd());
    expect(cited.has("PRDR-192")).toBe(true);
    /**
     * Built at runtime, never written as a literal: the scanner reads THIS file
     * too, so spelling an absent id out loud would put it in the tree and make
     * the assertion prove the opposite of what it claims.
     */
    expect(cited.has(`PRDR-${String(9999)}`)).toBe(false);
  });

  /** The repository must pass the gate it ships. */
  it("the repository has no violations", () => {
    expect(checkTickets().map((v) => `${v.file} ${v.rule}`)).toEqual([]);
  });

  it("states what it does not check", () => {
    expect(UNCHECKED.length).toBeGreaterThan(0);
    expect(UNCHECKED.join(" ")).toContain("acceptance criteria");
  });
});
