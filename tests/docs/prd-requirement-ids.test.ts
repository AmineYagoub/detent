import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * PRDR-287 — one mark, one rule (N-6).
 *
 * A requirement mark is how the code, the tests, the tickets and the planner
 * point at a rule, so a mark defined twice names two rules and every citation
 * of it is ambiguous. It still resolves, to whichever definition a reader meets
 * first. `detent-prd-v3.md` defined eight marks twice each, for two different
 * rules, and nothing noticed: a citation checker passes clean on a mark that
 * exists, whichever rule it lands on.
 *
 * A definition is a bold id at the head of a bullet — one id, ids joined by
 * `/`, or a range joined by `…` — or a decision-log row, or a bold id followed
 * at once by its release in parentheses anywhere in a line, which is how the
 * inherited §5 bullet defines F-1′. A bold sentence that merely OPENS with an
 * id cites it: D-29's row opens "**D-22 splits by driver.**" and defines
 * nothing.
 */
const PRD = readFileSync(new URL("../../detent-prd-v3.md", import.meta.url), "utf8");

const MARK = "[′″‴⁗⁰¹²³⁴⁵⁶⁷⁸⁹]*";
const ONE = `(?:[A-Z]{1,4}-\\d+[a-z]?|P\\d+)${MARK}`;
const LEAD = new RegExp(`^(${ONE}(?:\\s*[/…]\\s*${ONE})*)(?=$|[\\s.:(])`, "u");
const INLINE = new RegExp(`^(${ONE}) \\((?:draft\\.\\d+|\\d+\\.\\d+(?:\\.\\d+)?)[,)]`, "u");
const ROW = new RegExp(`^\\|\\s*(D-\\d+${MARK})\\s*\\|`, "u");
const PARTS = new RegExp(`^([A-Z]{1,4}-)(\\d+)(${MARK})$`, "u");

/** `C-9′…C-13′` names five marks, and a reader looking up C-12′ lands on it. */
function expand(part: string): string[] {
  const [from, to] = part.split("…");
  if (from === undefined || to === undefined) return [part];
  const a = PARTS.exec(from.trim());
  const b = PARTS.exec(to.trim());
  if (a === null || b === null || a[1] !== b[1] || a[3] !== b[3]) return [from.trim(), to.trim()];
  const [lo, hi] = [Number(a[2]), Number(b[2])];
  return Array.from({ length: hi - lo + 1 }, (_, i) => `${a[1] ?? ""}${String(lo + i)}${a[3] ?? ""}`);
}

/** Every mark the PRD defines, with the bold head of each definition that names it, in document order. */
function definitions(text: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const add = (id: string, head: string): void => {
    found.set(id, [...(found.get(id) ?? []), head.replace(/[.:]$/u, "").trim()]);
  };
  for (const line of text.split("\n")) {
    const row = ROW.exec(line);
    if (row?.[1] !== undefined) add(row[1], `${row[1]} (decision log)`);
    const bullet = /^\s*[-*]\s+\*\*([^*]+?)\*\*/u.exec(line);
    const lead = bullet?.[1] === undefined ? null : LEAD.exec(bullet[1]);
    if (bullet?.[1] !== undefined && lead?.[1] !== undefined) {
      for (const id of lead[1].split(/\s*\/\s*/u).flatMap(expand)) add(id, bullet[1]);
    }
    for (const span of line.matchAll(/\*\*([^*]+?)\*\*/gu)) {
      if (bullet !== null && span.index === bullet[0].indexOf("**")) continue;
      const inline = INLINE.exec(span[1] ?? "");
      if (inline?.[1] !== undefined) add(inline[1], span[1] ?? "");
    }
  }
  return found;
}

/** The marks defined more than once, each with the heads that define it. */
function duplicated(text: string): Record<string, string[]> {
  return Object.fromEntries([...definitions(text)].filter(([, heads]) => heads.length > 1));
}

/**
 * Recorded in PRDR-287, not fixed. §4's range restates C-9…C-13 for v3
 * (PRDR-065, 2026-08-18), and four days later PRDR-079 and PRDR-078 defined
 * C-9′ and C-12′ as amendments. Whether a range restatement defines its members
 * is the owner's decision. Pinned EXACTLY, heads and all: a new duplicate
 * fails, and so does resolving one of these without taking it off this list.
 */
const KNOWN_OVERLAPS: Record<string, string[]> = {
  "C-9′": ["C-9′…C-13′", "C-9′ (3.0.2, PRDR-079)"],
  "C-12′": ["C-9′…C-13′", "C-12′ (3.0.1, PRDR-078)"],
};

/**
 * One rule stated twice is a restatement, not a collision, and only a reader
 * can tell the two apart: the decision log states D-29, and §8 restates it
 * beside D-22, the decision it amends. Pinned exactly, so a second statement
 * of any other mark still fails.
 */
const RESTATED: Record<string, string[]> = {
  "D-29": ["D-29 (decision log)", "D-22/D-29"],
};

/**
 * The eight moves PRDR-287 made. The definition introduced first keeps the
 * mark; the later one takes its family's next free mark. `moved` is the ticket
 * of the rule that moved, which its new definition names.
 */
const MOVES: readonly { from: string; to: string; moved: string }[] = [
  { from: "C-3″", to: "C-3‴", moved: "PRDR-207" },
  { from: "C-9′", to: "C-9‴", moved: "PRDR-139" },
  { from: "F-1′", to: "F-1‴", moved: "PRDR-118" },
  { from: "P6′", to: "P6″", moved: "PRDR-142" },
  { from: "S-3′", to: "S-3⁸", moved: "PRDR-121" },
  { from: "S-5′", to: "S-5⁗", moved: "PRDR-141" },
  { from: "V-1⁵", to: "V-1⁶", moved: "PRDR-232" },
  { from: "X-1‴", to: "X-1⁷", moved: "PRDR-136" },
];

const names = (head: string, ticket: string): boolean => new RegExp(`${ticket}(?!\\d)`, "u").test(head);

describe("PRDR-287 a requirement mark names one rule", () => {
  it("every mark the PRD defines, it defines once — the range's two overlaps excepted, exactly", () => {
    const found = duplicated(PRD);
    for (const [id, heads] of Object.entries(RESTATED)) expect(found[id], `${id} is restated, not redefined`).toEqual(heads);
    expect(Object.fromEntries(Object.entries(found).filter(([id]) => !(id in RESTATED)))).toEqual(KNOWN_OVERLAPS);
  });

  it("the parser sees every shape a definition takes, and a citation is not one", () => {
    const heads = definitions(PRD);
    expect(heads.get("R-10′"), "a composite head defines each of its marks").toHaveLength(1);
    expect(heads.get("C-11′"), "a range defines the marks between its ends").toEqual(["C-9′…C-13′"]);
    expect(heads.get("D-29"), "a decision-log row, and a restatement head beside it").toEqual(["D-29 (decision log)", "D-22/D-29"]);
    expect(heads.get("D-22"), "a bold sentence opening with a mark cites it").toEqual(["D-22/D-29"]);
    expect(heads.get("F-1′"), "an inline bold mark with its release defines it").toContain("F-1′ (draft.4, PRDR-066/PRDR-064 applied)");
  });

  for (const { from, to, moved } of MOVES) {
    it(`${from}'s later rule, ${moved}'s, is ${to}; the earlier rule keeps ${from}`, () => {
      const heads = definitions(PRD);
      const target = heads.get(to) ?? [];
      expect(target, `${to} is defined once`).toHaveLength(1);
      expect(target.every((h) => names(h, moved)), `${to} is ${moved}'s rule`).toBe(true);
      expect(target.every((h) => h.includes(from)), `${to} says which mark it had`).toBe(true);
      expect((heads.get(from) ?? []).filter((h) => names(h, moved)), `${from} no longer names ${moved}'s rule`).toEqual([]);
      expect(heads.get(from)?.length ?? 0, `${from} is still defined — the earlier rule kept it`).toBeGreaterThan(0);
    });
  }

  it("the dated amendment note names every move", () => {
    const note = PRD.split("\n\n").find((block) => block.startsWith("> ") && block.includes("PRDR-287, 2026-09-26"));
    expect(note, "a dated note beside the reading guide").toBeDefined();
    for (const { from, to, moved } of MOVES) {
      expect(note, `${from} → ${to}`).toMatch(new RegExp(`${from} \\(${moved}[^)]*\\) → ${to}`, "u"));
    }
  });
});
