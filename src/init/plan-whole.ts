import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { planQuestionSchema, type PlanQuestion, type PlanReview, type SliceSpec } from "../schemas/init.js";
import { SCHEMA_VERSION } from "../schemas/common.js";
import { stateDir } from "../fs/layout.js";
import { draftAndRead, type PlanDeps } from "./plan.js";
import { reviewPlan, sessionBudget } from "./plan-review.js";
import { normaliseDraft, tagSlice } from "./plan-slices.js";
import type { DraftedTicket } from "./plan-write.js";

/**
 * C-8⁗ (PRDR-199): what the redraft loop has done so far.
 *
 * Kept beside `plan-review.json` rather than inside `state/plan/`, whose every
 * entry is a SLICE cache — a reader that walks that directory must not find a
 * different shape in it.
 */
function wholeCachePath(root: string): string {
  return path.join(stateDir(root), "state", "whole-plan.json");
}

const findingsSchema = z.array(z.looseObject({ tag: z.string(), finding: z.string(), ticket: z.string().optional() }));

/** Validated on read like every other artifact (C-8‴). An unrecognised shape is a MISS. */
const wholeCacheSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  key: z.string(),
  findings: findingsSchema,
  plan_wide_unclaimed: findingsSchema,
  redrafted: z.array(
    z.strictObject({
      slice: z.string(),
      tickets: z.array(z.looseObject({ id: z.string(), slice: z.string() })),
      questions: z.array(planQuestionSchema),
    }),
  ),
});

interface WholeCache {
  readonly key: string;
  readonly findings: PlanReview["findings"];
  readonly plan_wide_unclaimed: PlanReview["findings"];
  readonly redrafted: { readonly slice: string; readonly tickets: DraftedTicket[]; readonly questions: PlanQuestion[] }[];
}

function readWholeCache(root: string): WholeCache | null {
  const file = wholeCachePath(root);
  if (!existsSync(file)) return null;
  try {
    const parsed = wholeCacheSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? (parsed.data as unknown as WholeCache) : null;
  } catch {
    return null;
  }
}

function writeWholeCache(root: string, cache: WholeCache): void {
  mkdirSync(path.join(stateDir(root), "state"), { recursive: true });
  writeFileSync(wholeCachePath(root), `${JSON.stringify({ schema_version: SCHEMA_VERSION, ...cache }, null, 2)}\n`);
}

/**
 * Everything the whole-plan review READ, on `sliceKey`'s terms (PRDR-186): the
 * plan it judged, the slices it judged them as, what the contract check had
 * already proved, the budget that reached the prompt, and the prompt itself.
 * A plan that changed gets a new review; one that did not resumes.
 */
function wholeKey(deps: PlanDeps, slices: readonly SliceSpec[], tickets: readonly DraftedTicket[], known: PlanReview["findings"]): string {
  return createHash("sha256")
    .update(stableJson([slices, tickets, known, sessionBudget(deps.budgets), deps.promptHash ?? ""]))
    .digest("hex");
}

/**
 * `JSON.stringify` with object keys in sorted order.
 *
 * The key must survive a round trip through the slice cache, and it did not:
 * the same ticket parsed by `planDraftSchema` on the way in and by
 * `sliceCacheSchema` on the way out carries identical CONTENT in a different
 * key ORDER, so a plain stringify hashed differently and every resume missed —
 * silently, and in the direction that costs money.
 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * C-2‴ (PRDR-117) — the whole-plan review.
 *
 * Each slice was reviewed as its own plan; nothing yet has read the plan as
 * one thing. A fresh planner-role session receives every ticket of every
 * slice and judges the plan for coherence (tickets that contradict, duplicate
 * or disagree about the interface between them — usually across slices),
 * coverage (every requirement id and every baseline item reaches a ticket),
 * and traceability. One targeted revision: only the slices the findings name
 * are redrafted, with the rest of the plan in view; a second whole review
 * says what remains, and that rides to PRESENT for the human.
 */

export interface WholeReview {
  readonly tickets: DraftedTicket[];
  readonly questions: PlanQuestion[];
  readonly remaining: PlanReview["findings"];
}

export async function wholePlanReview(
  deps: PlanDeps,
  slices: readonly SliceSpec[],
  tickets: readonly DraftedTicket[],
  /** PRDR-193: what the mechanical contract check already proved, so this session need not. */
  known: PlanReview["findings"] = [],
): Promise<WholeReview> {
  /* One slice is one plan, and its own review already read all of it. */
  if (slices.length <= 1) return { tickets: [...tickets], questions: [], remaining: [] };

  /**
   * C-8⁗ (PRDR-199): the review is the expensive half, and a resumed run used
   * to re-pay for it — the findings were recomputed from a slice cache the
   * redrafts never reached, so no restart could get further than the one
   * before it except by surviving the whole set in a single life.
   */
  const key = wholeKey(deps, slices, tickets, known);
  const cached = readWholeCache(deps.root);
  const resuming = cached !== null && cached.key === key;
  if (resuming) {
    deps.note?.(
      `whole-plan review: reused — nothing it read has changed (C-8⁗); ` +
        `${String(cached.redrafted.length)} redraft(s) already written down`,
    );
  }

  deps.progress?.("whole-plan coherence review");
  const first = resuming
    ? { verdict: "changes" as const, findings: cached.findings }
    : await reviewPlan(deps, tickets, { kind: "whole", slices, ...(known.length === 0 ? {} : { known }) });
  if (first === null) {
    /**
     * The coherence review is the whole reason this stage exists, and it is the
     * largest session of the run — the one most likely to be refused for size.
     * Its absence used to be one line on stdout and a successful init; the
     * human approving the plan could not know it never ran.
     */
    deps.note?.("whole-plan review: NO VERDICT after the relaunch — the plan was never reviewed as one thing");
    return {
      tickets: [...tickets],
      questions: [],
      remaining: [
        {
          tag: "coherence",
          finding: `the whole-plan review produced no usable verdict, so nothing checked the ${slices.length} slices against each other — each was reviewed only on its own`,
        },
      ],
    };
  }
  if (first.verdict !== "changes" || first.findings.length === 0) {
    deps.note?.(first.verdict === "approve" ? "whole-plan review: approve" : "whole-plan review: changes, but the verdict named no finding — nothing to revise");
    return { tickets: [...tickets], questions: [], remaining: [] };
  }
  deps.note?.(`whole-plan review: ${first.findings.length} finding(s) — ${first.findings.map((f) => f.tag).join(", ")}`);

  const bySlice = new Map<string, PlanReview["findings"]>();
  const planWide: PlanReview["findings"] = [];
  for (const finding of first.findings) {
    const owner = tickets.find((t) => t.id === finding.ticket)?.slice;
    if (owner === undefined) planWide.push(finding);
    else bySlice.set(owner, [...(bySlice.get(owner) ?? []), finding]);
  }
  if (bySlice.size === 0) {
    deps.note?.("whole-plan review: findings name no ticket — presented for the human, nothing redrafted");
    return { tickets: [...tickets], questions: [], remaining: first.findings };
  }

  let done = resuming ? [...cached.redrafted] : [];
  let updated: DraftedTicket[] = [...tickets];
  const questions: PlanQuestion[] = [];
  /* The findings land before the first session that acts on them, not after the last. */
  const persist = (unclaimed: PlanReview["findings"]): void => {
    writeWholeCache(deps.root, { key, findings: first.findings, plan_wide_unclaimed: unclaimed, redrafted: done });
  };
  /**
   * A finding that names no ticket belongs to the plan, not to a slice. Giving
   * it to every redrafted slice told five independent sessions to each satisfy
   * it — which is how a coherence review manufactures the duplication it was
   * convened to find. It goes to the first slice redrafted; the rest are told
   * only what is theirs.
   */
  let planWideUnclaimed = resuming ? [...cached.plan_wide_unclaimed] : [...planWide];
  persist(planWideUnclaimed);
  for (const slice of slices) {
    const findings = bySlice.get(slice.id);
    if (findings === undefined) continue;
    const already = done.find((d) => d.slice === slice.id);
    if (already !== undefined) {
      const at0 = sliceOrder(slices, slice.id);
      updated = [
        ...updated.filter((t) => sliceOrder(slices, t.slice) < at0),
        ...already.tickets,
        ...updated.filter((t) => sliceOrder(slices, t.slice) > at0),
      ];
      questions.push(...already.questions);
      deps.note?.(`${slice.id} ${slice.title}: redraft reused — already written down (C-8⁗)`);
      continue;
    }
    deps.progress?.(`redrafting ${slice.id} ${slice.title}`);
    deps.note?.(`redrafting ${slice.id} ${slice.title} for ${findings.length} whole-plan finding(s)`);
    const at = sliceOrder(slices, slice.id);
    const earlier = updated.filter((t) => sliceOrder(slices, t.slice) < at);
    const later = updated.filter((t) => sliceOrder(slices, t.slice) > at);
    const currentIds = new Set(updated.filter((t) => t.slice === slice.id).map((t) => t.id));
    /** Ids later slices reach for: the redraft keeps them, or it is discarded. */
    const keepIds = [...new Set(later.flatMap((t) => t.depends_on).filter((d) => currentIds.has(d)))];
    const drafted = await draftAndRead(deps, { slice, planIndex: [...earlier, ...later], findings: [...findings, ...planWideUnclaimed], keepIds });
    const fresh = normaliseDraft(slice, tagSlice(drafted.tickets, slice.id), earlier, deps.note, [...earlier, ...later]).tickets;
    const missing = keepIds.filter((id) => !fresh.some((t) => t.id === id));
    if (missing.length > 0) {
      deps.note?.(`${slice.id} redraft dropped ${missing.join(", ")}, which later slices depend on — redraft discarded, the slice stands as reviewed`);
      continue;
    }
    updated = [...earlier, ...fresh, ...later];
    questions.push(...drafted.questions);
    done = [...done, { slice: slice.id, tickets: fresh, questions: [...drafted.questions] }];
    planWideUnclaimed = [];
    persist(planWideUnclaimed);
  }

  /**
   * PRDR-119: every question reaching the human needs a unique id. The slice
   * path numbers its own; these did not, so each redrafted slice's session
   * numbered from one and the human could be shown several different `q1`s —
   * the same defect PRDR-119 removed one level down.
   */
  const numbered = questions.map((q, i) => ({ ...q, id: `whole-q${i + 1}` }));

  const second = await reviewPlan(deps, updated, { kind: "whole", slices });
  /**
   * The same hole the FIRST review's absence had, in the same function: a null
   * verdict here left `remaining` empty and printed "approve", so a plan that
   * was redrafted and then never re-checked reached the human as an approved
   * one. A review that did not run is not a review that passed.
   */
  if (second === null) {
    deps.note?.("whole-plan review after revision: NO VERDICT after the relaunch — the redrafted plan was never re-reviewed as one thing");
    return {
      tickets: updated,
      questions: numbered,
      remaining: [
        {
          tag: "coherence",
          finding: `the plan was redrafted for ${first.findings.length} whole-plan finding(s), but the re-review produced no usable verdict — nothing checked whether the redraft resolved them or broke something else`,
        },
      ],
    };
  }
  const remaining = second.verdict === "changes" ? second.findings : [];
  deps.note?.(
    remaining.length === 0
      ? "whole-plan review after revision: approve"
      : `whole-plan review after revision: ${remaining.length} finding(s) remain — ${remaining.map((f) => `${f.tag}${f.ticket === undefined ? "" : ` (${f.ticket})`}`).join("; ")}`,
  );
  return { tickets: updated, questions: numbered, remaining };
}

function sliceOrder(slices: readonly SliceSpec[], id: string): number {
  const i = slices.findIndex((s) => s.id === id);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
}
