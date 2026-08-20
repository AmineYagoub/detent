import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { parseArtifact } from "../schemas/common.js";
import { planningBriefSchema, type PlanningBrief } from "../schemas/init.js";

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
 */

export function questionHash(question: string): string {
  /* Normalized: the same question asked twice is the same cache entry. */
  return createHash("sha256").update(question.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex");
}

/** C-3a: briefs cache at `.detent/research/planning/<question-hash>.json`. */
export function planningBriefPath(root: string, hash: string): string {
  return path.join(stateDir(root), "research", "planning", `${hash}.json`);
}

interface ResearchOneResult {
  /** The brief the session produced, unvalidated. */
  readonly brief: unknown;
  /** Tool calls the session actually spent — charged against the ceiling. */
  readonly toolCalls: number;
}

export interface PlanResearchDeps {
  readonly root: string;
  /** X-1 `planning_research_tool_calls` — the whole init's allowance. */
  readonly budget: number;
  /** Launch one research session, told how many calls remain. */
  readonly researchOne: (question: string, remaining: number) => Promise<ResearchOneResult>;
  readonly note?: (text: string) => void;
}

export interface PlanResearchResult {
  readonly briefs: readonly PlanningBrief[];
  /** Questions with no valid brief — these join the AWAIT_INFO batch (C-3a). */
  readonly unanswered: readonly string[];
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
  let toolCallsUsed = 0;
  let cacheHits = 0;
  let sessionsLaunched = 0;

  for (const question of questions) {
    const hash = questionHash(question);
    const file = planningBriefPath(deps.root, hash);

    /**
     * Cache first: a re-run of `init` answers a repeated question with ZERO
     * web calls (C-3a's AC), which is why the key is the question itself.
     */
    if (existsSync(file)) {
      const parsed = parseArtifact(planningBriefSchema, JSON.parse(readFileSync(file, "utf8")));
      if (parsed.ok) {
        briefs.push(parsed.value);
        cacheHits += 1;
        deps.note?.(`planning research cache hit: ${hash.slice(0, 12)}…`);
        continue;
      }
      deps.note?.(`planning brief at ${hash.slice(0, 12)}… is invalid; re-researching`);
    }

    const remaining = deps.budget - toolCallsUsed;
    if (remaining <= 0) {
      /* C-3a: no new interrupt class — the question joins the AWAIT_INFO batch. */
      deps.note?.(`planning_research_tool_calls exhausted (${deps.budget}); "${question}" joins the AWAIT_INFO batch`);
      unanswered.push(question);
      continue;
    }

    const result = await deps.researchOne(question, remaining);
    sessionsLaunched += 1;
    /*
     * Charge what was spent, clamped: a backend that over-reports must not be
     * able to push the counter past the ceiling and hide the overrun.
     */
    toolCallsUsed += Math.min(result.toolCalls, remaining);

    const parsed = parseArtifact(planningBriefSchema, result.brief);
    if (!parsed.ok) {
      deps.note?.(`planning research produced no valid brief for "${question}" (X-6a)`);
      unanswered.push(question);
      continue;
    }
    briefs.push(parsed.value);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(parsed.value, null, 2)}\n`);
  }

  return { briefs, unanswered, toolCallsUsed, cacheHits, sessionsLaunched };
}
