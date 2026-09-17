import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { stateDir, writeArtifact } from "../fs/layout.js";
import { parseArtifact } from "../schemas/common.js";
import { planningBriefSchema, type PlanningBrief } from "../schemas/init.js";
import { scrubJson } from "../kernel/scrub.js";

/**
 * T-063 — planning research (C-3a, D-11).
 *
 * The second of D-11's two research capabilities: optional, need-driven, and
 * scoped to `init`. It shares X-6a's hierarchy and S-3's network posture with
 * failure research (T-045) but keeps its OWN budget and its own cache key —
 * two counters, two budgets, because a run that spent its failure-research
 * allowance must not arrive at init unable to ask a question.
 *
 * Exhausting the budget without an answer is not a new interrupt class: the
 * unanswered question joins the single AWAIT_INFO batch C-3 already raises
 * (C-5 stays closed at five).
 *
 * D-16: the budget is still one whole-init POOL, but this module DIVIDES it
 * rather than handing it out first-come. Observed 2026-09-17 on a live init —
 * three open questions, a pool of 16; the first was handed all 16, spent them,
 * returned nothing `parseArtifact` would take, and the two questions a web
 * search might plausibly have settled never got a session. Which questions
 * research reaches was decided by the order ANALYZE happened to list them in.
 */

export function questionHash(question: string): string {
  /* Normalized: the same question asked twice is the same cache entry. */
  return createHash("sha256").update(question.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex");
}

/** C-3a: briefs cache at `.detent/research/planning/<question-hash>.json`. */
export function planningBriefPath(root: string, hash: string): string {
  return path.join(stateDir(root), "research", "planning", `${hash}.json`);
}

/**
 * C-3a: the cached brief for a question, or null when the cache cannot answer
 * it. Unreadable JSON and a brief the X-6a validator refuses are one outcome —
 * the cache does not answer this question — and neither may end an init.
 * D-16 forces the guard: the cache is now read to SIZE a share as well as to
 * answer a question, so an unguarded `JSON.parse` would take down a run at a
 * question nobody had reached yet.
 */
function usableBrief(file: string): PlanningBrief | null {
  if (!existsSync(file)) return null;
  try {
    const parsed = parseArtifact(planningBriefSchema, JSON.parse(readFileSync(file, "utf8")));
    return parsed.ok ? parsed.value : null;
  } catch {
    /* A brief that will not parse as JSON is an unusable brief, not a crash (C-3a). */
    return null;
  }
}

/**
 * D-16: how many LATER questions will still need a session — the share's
 * denominator. Counted by hash, so repeats of one question count once, and
 * counted against the cache, so questions a re-run answers for free (C-3a's
 * AC) do not dilute the share of the ones that must actually be researched.
 *
 * A later COPY of the question being shared right now is still counted, even
 * though it will hit the cache if this session succeeds. Excluding it would be
 * exact when the session succeeds and would starve the copy when it does not,
 * which is D-16's own failure mode; over-counting only strands budget, and
 * that is the side to be wrong on.
 */
function pendingAfter(root: string, later: readonly string[]): number {
  const distinct = new Set<string>();
  for (const question of later) {
    const hash = questionHash(question);
    if (usableBrief(planningBriefPath(root, hash)) === null) distinct.add(hash);
  }
  return distinct.size;
}

interface ResearchOneResult {
  /** The brief the session produced, unvalidated. */
  readonly brief: unknown;
  /**
   * Tool calls the session actually spent, as observed — charged against the
   * pool CLAMPED TO THIS QUESTION'S SHARE (D-16), and never refunded when the
   * brief is refused, because the calls were really made.
   *
   * Clamping is not new and has never made this figure spend telemetry: it was
   * already clamped to the whole remaining pool, so an over-reporting backend's
   * excess has always fallen on the floor here. What changes is the bound, and
   * with it the guarantee — no session can consume another question's share, so
   * a session that ignores the budget it was handed can no longer reproduce
   * D-16 by itself. The discarded excess is reported in a note rather than
   * silently dropped, and the money it really cost is bounded by `run_spend_usd`
   * and the no-progress breaker, not by this ceiling.
   */
  readonly toolCalls: number;
}

export interface PlanResearchDeps {
  readonly root: string;
  /**
   * X-1 `planning_research_tool_calls` — the whole init's POOL, which this
   * module divides among the open questions (D-16). It is NOT what any one
   * question may spend; that is `researchOne`'s `share`.
   */
  readonly budget: number;
  /**
   * Launch one research session, told its SHARE of the pool: an even cut of
   * what is LEFT over the questions that still need a session — not everything
   * that remains (D-16). The last question standing is handed the whole
   * remainder, so a lone question still sees the entire pool and a fully spent
   * pool still totals exactly the ceiling.
   *
   * The share is what the session is ASKED for, not a refusal it will hit.
   * `kernel/stages/research` is the precedent (PRDR-106): no per-session turn
   * ceiling exists there, because a hard stop makes an over-budget session
   * indistinguishable from a transport death at the seam that classifies
   * crashes. A session that overruns its share is charged its share, and the
   * overrun is reported — see `ResearchOneResult.toolCalls`.
   */
  readonly researchOne: (question: string, share: number) => Promise<ResearchOneResult>;
  readonly note?: (text: string) => void;
}

export interface PlanResearchResult {
  readonly briefs: readonly PlanningBrief[];
  /** Questions with no valid brief — these join the AWAIT_INFO batch (C-3a). */
  readonly unanswered: readonly string[];
  /**
   * PRDR-260, narrowed by D-16: the SUBSET of `unanswered` that never got a
   * session — the pool was gone before their turn. `unanswered` minus this set
   * is the other outcome, investigated and still unanswerable. Both ride to
   * PRESENT in one batch (C-3′), and they are actionable in opposite
   * directions: the first is a ceiling to raise or questions to trim, the
   * second is a question only the human can settle.
   *
   * D-16 sharpens what the first of those means. Membership used to be
   * reachable by accident — one greedy question earlier in ANALYZE's list could
   * empty the pool — so the set recorded document order as much as budget, and
   * the ceiling advice attached to it was a guess. Every question is now
   * offered an even cut of what is left, and no session can spend another
   * question's share, so this set is non-empty only when the pool could not
   * fund one call for each question that needed one. That is a pure budget
   * fact, and the advice is now the correct advice.
   *
   * A subset rather than a partition, so no existing consumer has a new
   * invariant to learn — `analyze.ts` derives "researched without a usable
   * answer" by subtracting this count from the open questions and would go
   * negative otherwise. It is correct while every other path into `unanswered`
   * means a session ran, and what guarantees that is not locality but the
   * count: this file has exactly TWO `unanswered.push` sites, one in the skip
   * arm which pushes here too, and one after an awaited `researchOne` in the
   * same iteration. PRDR-260 argued it from the two sites sitting "four lines
   * apart", which was already false when it was written — they were sixteen
   * lines apart, with the launch, the charge and the parse between them — and
   * a locality claim drifts every time this loop grows. A count does not.
   */
  readonly neverResearched: readonly string[];
  readonly toolCallsUsed: number;
  readonly cacheHits: number;
  readonly sessionsLaunched: number;
}

export async function planResearch(
  questions: readonly string[],
  deps: PlanResearchDeps,
): Promise<PlanResearchResult> {
  const briefs: PlanningBrief[] = [];
  const unanswered: string[] = [];
  const neverResearched: string[] = [];
  let toolCallsUsed = 0;
  let cacheHits = 0;
  let sessionsLaunched = 0;

  for (const [index, question] of questions.entries()) {
    const hash = questionHash(question);
    const file = planningBriefPath(deps.root, hash);

    /**
     * Cache first: a re-run of `init` answers a repeated question with ZERO
     * web calls (C-3a's AC), which is why the key is the question itself. Read
     * before the pool is touched, so a cached answer neither spends a call nor
     * claims a share, and stays free after the pool is gone (D-16).
     */
    const cached = usableBrief(file);
    if (cached !== null) {
      briefs.push(cached);
      cacheHits += 1;
      deps.note?.(`planning research cache hit: ${hash.slice(0, 12)}…`);
      continue;
    }
    if (existsSync(file)) deps.note?.(`planning brief at ${hash.slice(0, 12)}… is unusable; re-researching`);

    const remaining = deps.budget - toolCallsUsed;
    if (remaining <= 0) {
      /* C-3a: no new interrupt class — the question joins the AWAIT_INFO batch. */
      deps.note?.(
        `planning_research_tool_calls exhausted (${deps.budget}) before "${question}" had a turn: never researched, no session — the pool could not fund one call for every question that needed one, so raise the ceiling or ask fewer (C-3a, D-16)`,
      );
      unanswered.push(question);
      neverResearched.push(question);
      continue;
    }

    /**
     * D-16: an even cut of what is LEFT, over the questions that still need a
     * session — recomputed each turn, so an under-spending question's leftover
     * flows forward instead of stranding in a share nobody used.
     *
     * `floor` so the rounding remainder falls to the LAST question, the one the
     * old greedy pass starved. It is only rounding: `ceil` divides the same
     * pool to the same total, because the final divisor is 1 and whoever is
     * last inherits the exact remainder either way. Neither leaves the pool
     * short of its ceiling, and neither decides who gets a session.
     *
     * `max(1, …)` so a pool smaller than the question count still buys a
     * session each until it runs out, rather than dividing to zero. A zero
     * share is the worse failure: the charge below is `min(toolCalls, share)`,
     * so a session handed zero would spend real money and debit the pool
     * nothing — the refund this design is otherwise careful never to grant.
     * `min(remaining, …)` because X-1's `.positive()` carries no `.int()`, so a
     * fractional ceiling loads and must not be overrun by that floor. The two
     * together give the invariant with no case split: `share <= remaining`,
     * therefore `toolCallsUsed <= budget`.
     *
     * They also bound the skip arm above, which is what lets its note name a
     * cause. Whenever `r >= p + 1`, `r - floor(r / (p + 1)) >= p`, and the
     * charge is at most the share, so every turn leaves at least one call for
     * every question still pending. `remaining <= 0` is therefore reachable
     * only when the POOL could not fund one call apiece — never because of who
     * came first, which is the whole of D-16.
     */
    const pending = pendingAfter(deps.root, questions.slice(index + 1));
    const share = Math.min(remaining, Math.max(1, Math.floor(remaining / (pending + 1))));
    if (share < remaining) {
      deps.note?.(
        `planning research: "${question}" may spend ${share} of the ${remaining} left — the other ${remaining - share} is held for ${pending} later question(s) (D-16)`,
      );
    }

    const result = await deps.researchOne(question, share);
    sessionsLaunched += 1;
    const charged = Math.min(result.toolCalls, share);
    toolCallsUsed += charged;
    if (result.toolCalls > share) {
      /*
       * D-16: the honest half of clamping to the share. Without this line
       * `toolCallsUsed` would quietly become "calls allocated" while reading
       * like "calls spent"; the excess was real money that this ceiling does
       * not see, and `run_spend_usd` is what bounds it (X-1).
       */
      deps.note?.(
        `planning research for "${question}" OVERRAN its share: ${result.toolCalls} calls against a budget of ${share}; charged ${share}, and the rest is real spend this ceiling does not see (X-1, D-16)`,
      );
    }

    const parsed = parseArtifact(planningBriefSchema, result.brief);
    if (!parsed.ok) {
      /*
       * D-16: the two ways a session comes back empty need opposite acts from
       * the operator, so the note says which one happened. One that used its
       * whole share may have been cut short — that is a ceiling to raise or a
       * question to drop. One that stopped early had room it did not want, and
       * more budget is not the lever.
       */
      const spent = charged >= share ? `it used all ${share} of its ${share}-call share` : `it stopped at ${charged} of its ${share}-call share`;
      deps.note?.(`planning research produced no valid brief for "${question}" — ${spent} (X-6a)`);
      unanswered.push(question);
      continue;
    }
    briefs.push(parsed.value);
    /** SEC-4 (PRDR-252): the F-1 seam, which scrubs — `research/planning` is a COMMITTED path carrying a model's own prose. */
    writeArtifact(deps.root, path.posix.join("research", "planning", `${hash}.json`), planningBriefSchema.parse(scrubJson(parsed.value)));
  }

  return { briefs, unanswered, neverResearched, toolCallsUsed, cacheHits, sessionsLaunched };
}
