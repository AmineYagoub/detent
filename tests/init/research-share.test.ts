import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { planResearch, planningBriefPath, questionHash } from "../../src/init/plan-research.js";
import { removeTree, tmpTree } from "../helpers.js";

/**
 * D-16 (PRDR-262) — `planning_research_tool_calls` is a POOL this module
 * divides, not a queue the first question drains.
 *
 * A live init raised three open questions against a pool of sixteen calls.
 * Question one was handed all sixteen, spent them, and returned a brief X-6a
 * refused; the other two never got a session at all. Which questions were
 * researched was decided by where ANALYZE happened to list them.
 *
 * `planResearch` takes its session launcher by injection, so every case here
 * drives the real allocator and records the share each question was OFFERED —
 * the number the defect is about.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

function root(): string {
  const r = tmpTree({});
  roots.push(r);
  return r;
}

/** Parses against `planningBriefSchema`: source/claim evidence, and a local_search that is non-empty because the source is a URL (X-6a). */
function validBrief(question: string): object {
  return {
    schema_version: 1,
    question,
    question_hash: questionHash(question),
    answer: { claim: "the ladder is published", confidence: "high" },
    evidence: [{ source: "https://docs.example.com/pricing", claim: "the ladder is published" }],
    sources_consulted: [{ tier: 1, ref: "PRD.md" }],
    local_search: { docs_checked: ["PRD.md"], code_checked: [] },
    what_would_falsify: "the page stops listing prices",
  };
}

interface Spent {
  readonly offered: number[];
  readonly notes: string[];
}

/**
 * Drives `planResearch` recording what each question was offered. `spend` says
 * how many calls each successive session actually reports, defaulting to the
 * whole share, and `brief` decides what it returns.
 */
async function drive(
  r: string,
  questions: readonly string[],
  budget: number,
  opts: { readonly spend?: readonly number[]; readonly brief?: (q: string, i: number) => unknown } = {},
): Promise<{ readonly result: Awaited<ReturnType<typeof planResearch>>; readonly seen: Spent }> {
  const seen: Spent = { offered: [], notes: [] };
  let i = 0;
  const result = await planResearch(questions, {
    root: r,
    budget,
    note: (text) => seen.notes.push(text),
    researchOne: (question, share) => {
      const n = i;
      i += 1;
      seen.offered.push(share);
      const toolCalls = opts.spend?.[n] ?? share;
      const brief = opts.brief === undefined ? validBrief(question) : opts.brief(question, n);
      return Promise.resolve({ brief, toolCalls });
    },
  });
  return { result, seen };
}

const THREE = ["which accounts are payable?", "what is the price ladder?", "what retention applies?"];

describe("D-16 (PRDR-262) the pool is divided, not drained", () => {
  /**
   * The live shape exactly: sixteen calls, three questions, and the first
   * session returns something X-6a refuses. On HEAD the first is offered 16 and
   * the other two are never launched.
   */
  it("offers 5, 5 and 6 on the live shape, and launches a session for every question", async () => {
    const { result, seen } = await drive(root(), THREE, 16, { brief: () => ({ malformed: true }) });
    expect(seen.offered, "each question gets an even cut of what is left, not everything that is left").toEqual([5, 5, 6]);
    expect(result.sessionsLaunched, "all three questions were researched").toBe(3);
    expect(result.neverResearched, "no question may be starved by where ANALYZE listed it").toEqual([]);
    expect(result.toolCallsUsed, "the pool is spent to its ceiling and not past it").toBe(16);
  });

  it("flows an under-spending question's leftover forward instead of stranding it", async () => {
    const { seen } = await drive(root(), THREE, 16, { spend: [1, 1] });
    expect(seen.offered[0], "16 over 3 questions").toBe(5);
    expect(seen.offered[1], "15 left over 2 questions").toBe(7);
    expect(seen.offered[2], "the last question inherits the whole remainder").toBe(14);
  });

  it("gives a lone question the entire pool", async () => {
    const { seen } = await drive(root(), ["only one?"], 16);
    expect(seen.offered, "dividing by one is not a reason to withhold anything").toEqual([16]);
  });

  /**
   * C-3a's acceptance — a re-run answers a repeated question with zero web
   * calls — survives the division, and a cached question between two uncached
   * ones must not shrink their shares by sitting in the denominator.
   */
  it("does not let a cached answer spend a call or claim a share", async () => {
    const r = root();
    const cached = THREE[1] as string;
    const file = planningBriefPath(r, questionHash(cached));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(validBrief(cached)), "utf8");

    const { result, seen } = await drive(r, THREE, 16);
    expect(result.cacheHits, "the middle question is answered from cache").toBe(1);
    expect(result.sessionsLaunched, "only the two uncached questions cost a session").toBe(2);
    expect(seen.offered, "the cached question is not in the denominator: 16 over 2, then the remainder").toEqual([8, 8]);
  });

  /**
   * The exhausted arm still exists and must still be reachable — but only on a
   * genuine shortage, which is what makes its advice ("raise the ceiling or ask
   * fewer") correct rather than a guess about document order.
   */
  it("buys a session each until a pool too small for one call apiece runs out", async () => {
    const { result, seen } = await drive(root(), THREE, 2);
    expect(seen.offered, "a share never divides to zero — that would spend money and debit nothing").toEqual([1, 1]);
    expect(result.neverResearched, "only the question the pool genuinely could not fund").toEqual([THREE[2]]);
    expect(result.toolCallsUsed, "and the ceiling still holds").toBe(2);
  });

  it("never overruns the ceiling, including a fractional one", async () => {
    const { result, seen } = await drive(root(), THREE, 2.5);
    expect(result.toolCallsUsed, "X-1's .positive() carries no .int(), so a fractional pool loads").toBeLessThanOrEqual(2.5);
    for (const offered of seen.offered) expect(offered, "no share may exceed what is left").toBeLessThanOrEqual(2.5);
  });

  /**
   * Clamping to the share is inherited from HEAD and is right. Clamping
   * SILENTLY is not: `toolCallsUsed` would read as "calls spent" while meaning
   * "calls allocated", and the excess is real money this ceiling cannot see.
   */
  it("charges an overrunning session its share, and says the rest is spend it cannot see", async () => {
    const { result, seen } = await drive(root(), THREE, 16, { spend: [99] });
    expect(result.toolCallsUsed, "a session that ignores its budget cannot consume another question's share").toBeLessThanOrEqual(16);
    expect(seen.offered[1], "the second question's share is unharmed by the first's overrun").toBe(5);
    expect(seen.notes.join(" "), "the overrun is reported, not dropped on the floor").toContain("OVERRAN");
  });

  /**
   * Two ways to come back empty-handed, needing opposite acts from the
   * operator: one may have been cut short, the other had room it did not want.
   */
  it("says whether an empty-handed session used its whole share or stopped early", async () => {
    const exhausted = await drive(root(), ["q?"], 8, { brief: () => ({ malformed: true }) });
    expect(exhausted.seen.notes.join(" "), "used everything it was given — a ceiling to raise").toContain("used all");

    const early = await drive(root(), ["q?"], 8, { spend: [2], brief: () => ({ malformed: true }) });
    expect(early.seen.notes.join(" "), "stopped early — more budget is not the lever").toContain("stopped at");
  });

  /**
   * The share's denominator reads the cache for questions the loop has NOT
   * reached, so an unreadable file HEAD would only have met at its own turn can
   * now be met early. It must mean "the cache cannot answer this", never a
   * crash at a question nobody had got to.
   */
  it("treats an unreadable cached brief for a LATER question as a cache miss, not a crash", async () => {
    const r = root();
    const later = THREE[2] as string;
    const file = planningBriefPath(r, questionHash(later));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "{ this is not json", "utf8");

    const { result, seen } = await drive(r, THREE, 16);
    expect(result.sessionsLaunched, "the corrupt entry is researched rather than trusted or thrown on").toBe(3);
    expect(seen.offered, "and it still counts as a question needing a session").toEqual([5, 5, 6]);
  });
});
