import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { stateDir, writeArtifact } from "../fs/layout.js";
import { parseArtifact } from "../schemas/common.js";
import { planningBriefSchema, type PlanningBrief } from "../schemas/init.js";
import { scrubJson } from "../kernel/scrub.js";
import { withOneRelaunch } from "./retry.js";

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
 * PRDR-264 (D-19): where the SESSION writes, before anything has validated it.
 *
 * Keyed by question, and cleared before each launch. Every question used to
 * write the one fixed `state/planning-brief.json`, which was never deleted
 * between sessions — so a session that wrote nothing left its predecessor's
 * file to be read as its own answer, and cached under its own hash. That was
 * unreachable only while nothing parsed at all.
 */
export function planningArtifactPath(root: string, hash: string): string {
  return path.join(stateDir(root), "state", `planning-brief-${hash.slice(0, 12)}.json`);
}

/**
 * PRDR-264: the contract the session is handed — `expected_output`.
 *
 * This caller passed none, so the session followed the only shape
 * `prompts/research.md` names, the A-4 failure brief, and `planningBriefSchema`
 * refused it every time. Every other init stage passes a skeleton
 * (`analyze.ts`, `slice.ts`, `plan.ts`, `plan-review.ts`) and so does the
 * LOOP's own research call (`referee-stage.ts`); this was the one that did not.
 *
 * `question` and `question_hash` are filled in rather than left as
 * placeholders: the session ECHOES them, and the hash is what binds the brief
 * to the question it answers (D-19). Asking a model to derive a sha256 would
 * be asking it to compute; asking it to copy one back is not.
 */
export function planningBriefSkeleton(question: string, hash: string): Record<string, unknown> {
  return {
    schema_version: 1,
    outcome: "answered",
    question,
    question_hash: hash,
    answer: { claim: "<the answer — required when outcome is `answered`>", confidence: "medium" },
    evidence: [{ source: "<doc/page consulted>", claim: "<what it establishes>" }],
    sources_consulted: [{ tier: 1, ref: "<what was consulted>" }],
    local_search: { docs_checked: ["<paths searched>"], code_checked: ["<paths searched>"] },
    what_would_falsify: "<an observation that would falsify the answer — required>",
  };
}

/**
 * PRDR-264: the other arm, shown to the session so it knows the outcome exists.
 *
 * Research can SETTLE a question without answering it, and on the live run both
 * questions were of that kind. A session with no shape for that result has only
 * one way to report it — produce nothing — which is indistinguishable from a
 * session that failed.
 */
export function undecidableBriefSkeleton(question: string, hash: string): Record<string, unknown> {
  const base = planningBriefSkeleton(question, hash);
  delete base["answer"];
  return {
    ...base,
    outcome: "undecidable",
    /*
     * The same `evidence.min(1)` the answered arm carries, with placeholders
     * that say what it is FOR here: the searches that came back empty. Without
     * them this arm is a cheap exit — "undecidable" costs a session nothing to
     * write and cannot be told apart from one that did not look.
     */
    evidence: [{ source: "<where you looked — required, even here>", claim: "<what it did NOT establish, e.g. `names no price ladder`>" }],
    undecidable: {
      reason: "<decision_not_made | needs_specialist | no_public_source>",
      detail: "<why no source can answer this — required>",
      who_decides: "<who can settle it: the founder, counsel, a named owner — required>",
    },
  };
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

/**
 * PRDR-264: what a relaunched session is told about the attempt before it.
 * Mirrors `init/retry`'s shape so `previousAttemptInput` consumes it directly.
 */
export interface PreviousAttempt {
  readonly issue: string;
}

interface ResearchOneResult {
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
   *
   * PRDR-264: the session WRITES to `artifactOut` and this module reads it
   * back. The launcher no longer returns a brief, because the file and the
   * validation belong together: the path is keyed per question and cleared
   * before every launch, so "the session produced nothing" cannot be answered
   * with the previous question's artifact (D-19). `previous` is non-null on the
   * single reshape relaunch, carrying what the validator refused.
   */
  readonly researchOne: (
    question: string,
    share: number,
    artifactOut: string,
    previous: PreviousAttempt | null,
  ) => Promise<ResearchOneResult>;
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
  /**
   * PRDR-264: questions research SETTLED as unanswerable — a founder decision
   * not yet made, a question only counsel can answer, a fact with no public
   * source. Disjoint from `unanswered`: these produced a valid brief and are
   * cached, so a re-run does not pay to rediscover them.
   *
   * They ride to PRESENT in the same batch (C-3′) and read the same way to the
   * plan — the assumption carries — but they are the opposite operator signal.
   * `unanswered` says the question is still open to research; this says it is
   * not, and names the human it is waiting on. Reported as one number they were
   * indistinguishable, and the advice attached to the pair ("raise the ceiling
   * or ask fewer") was wrong for every member of this set.
   */
  readonly undecidable: readonly string[];
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
  const undecidable: string[] = [];
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
      /*
       * PRDR-264: the cache carries BOTH arms, so it must route by the same
       * rule the fresh path does. Pushing every cached brief into `briefs`
       * reported a settled question as an answered one on the second run and
       * dropped it out of the batch a human sees — the verdict survived on
       * disk and stopped being told to anyone.
       */
      if (cached.outcome === "undecidable") undecidable.push(question);
      else briefs.push(cached);
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

    const artifactOut = planningArtifactPath(deps.root, hash);
    let spentHere = 0;
    let observed = 0;
    const attempt = await withOneRelaunch<PlanningBrief>(
      { stage: "planning research", ...(deps.note === undefined ? {} : { note: deps.note }) },
      async (previous) => {
        /* D-19: the session's own file, cleared first, so only what THIS launch wrote can be read back. */
        rmSync(artifactOut, { force: true });
        const result = await deps.researchOne(question, share, artifactOut, previous);
        sessionsLaunched += 1;
        spentHere += result.toolCalls;
        observed = Math.max(observed, result.toolCalls);
        return readBrief(artifactOut, hash);
      },
    );

    /**
     * D-16, extended by PRDR-264's relaunch: both attempts are charged against
     * the ONE question's share and the sum is clamped to it, so a reshape can
     * never spend a later question's budget. The clamp is what keeps
     * `toolCallsUsed <= budget` true with a retry in the loop.
     */
    const charged = Math.min(spentHere, share);
    toolCallsUsed += charged;
    if (observed > share) {
      /*
       * D-16: the honest half of clamping to the share. Without this line
       * `toolCallsUsed` would quietly become "calls allocated" while reading
       * like "calls spent"; the excess was real money that this ceiling does
       * not see, and `run_spend_usd` is what bounds it (X-1).
       */
      deps.note?.(
        `planning research for "${question}" OVERRAN its share: ${observed} calls against a budget of ${share}; charged ${charged}, and the rest is real spend this ceiling does not see (X-1, D-16)`,
      );
    }

    if (attempt.value === null) {
      /*
       * D-16: the two ways a session comes back empty need opposite acts from
       * the operator, so the note says which one happened. One that used its
       * whole share may have been cut short — that is a ceiling to raise or a
       * question to drop. One that stopped early had room it did not want, and
       * more budget is not the lever.
       *
       * PRDR-264 adds the third: the note now carries what the VALIDATOR said,
       * because "no valid brief" cited X-6a for a year while the real refusal
       * was that the session had written a different artifact entirely.
       */
      const spent = charged >= share ? `it used all ${share} of its ${share}-call share` : `it stopped at ${charged} of its ${share}-call share`;
      deps.note?.(`planning research produced no valid brief for "${question}" — ${spent}: ${attempt.issue ?? "unusable"}`);
      unanswered.push(question);
      continue;
    }

    if (attempt.value.outcome === "undecidable") {
      const verdict = attempt.value.undecidable;
      deps.note?.(
        `planning research SETTLED "${question}" as unanswerable (${verdict === undefined ? "no reason given" : verdict.reason}): ` +
          `${verdict === undefined ? "" : verdict.detail} — ${verdict === undefined ? "a human" : verdict.who_decides} decides it. ` +
          `The plan proceeds on its assumption (C-3′); no ceiling will change this (PRDR-264).`,
      );
      undecidable.push(question);
    } else {
      briefs.push(attempt.value);
    }
    /** SEC-4 (PRDR-252): the F-1 seam, which scrubs — `research/planning` is a COMMITTED path carrying a model's own prose. */
    writeArtifact(deps.root, path.posix.join("research", "planning", `${hash}.json`), planningBriefSchema.parse(scrubJson(attempt.value)));
  }

  return { briefs, unanswered, neverResearched, undecidable, toolCallsUsed, cacheHits, sessionsLaunched };
}

/**
 * PRDR-264: read back what the session wrote, and refuse anything that is not
 * an answer to THIS question.
 *
 * Three ways to come back with nothing, and the caller needs them apart: the
 * session wrote no file, it wrote something the validator refuses, or it wrote
 * a brief about a different question (D-19). The last is the one HEAD could
 * not see — it never compared — and it is the one that would have cached
 * another question's research under this question's hash, answering it for
 * free on every future run.
 */
function readBrief(artifactOut: string, hash: string): { value: PlanningBrief | null; issue: string | null } {
  if (!existsSync(artifactOut)) return { value: null, issue: "the session wrote no artifact" };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(artifactOut, "utf8"));
  } catch {
    return { value: null, issue: "the artifact is not JSON" };
  }
  const parsed = parseArtifact(planningBriefSchema, raw);
  if (!parsed.ok) {
    return { value: null, issue: parsed.reason === "invalid" ? parsed.issues.join("; ") : parsed.reason };
  }
  if (parsed.value.question_hash !== hash) {
    return { value: null, issue: "the brief does not answer the question it was asked — its question_hash is another question's" };
  }
  return { value: parsed.value, issue: null };
}
