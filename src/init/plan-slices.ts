import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PlanQuestion, PlanReview, SliceSpec } from "../schemas/init.js";
import { contentsDigest, sliceCacheDir } from "./machine.js";
import { draftPlan, readValidatedDraft, type PlanDeps } from "./plan.js";
import { PLAN_REVISIONS, reviewPlan } from "./plan-review.js";
import type { DraftedTicket } from "./plan-write.js";

/**
 * C-2‴ (PRDR-117) — PLAN, one slice at a time, to the end of the product.
 *
 * Each slice is drafted with the earlier slices' ticket index in view, reviewed
 * as its own plan (PRDR-084), revised once, and cached under
 * `.detent/state/plan/<slice>.json` keyed by everything it read — so an edit
 * to one slice's documents re-plans that slice and reuses the rest (C-8).
 * Nothing here stops for a human: questions accumulate for PRESENT.
 */

export interface SlicePlan {
  readonly tickets: DraftedTicket[];
  readonly questions: PlanQuestion[];
  /** Findings a slice's second review still held; shown at PRESENT. */
  readonly remaining: { readonly slice: string; readonly findings: PlanReview["findings"] }[];
}

interface SliceCache {
  readonly key: string;
  readonly tickets: DraftedTicket[];
  readonly questions: PlanQuestion[];
  readonly remaining: PlanReview["findings"];
}

function cachePath(root: string, sliceId: string): string {
  return path.join(sliceCacheDir(root), `${sliceId}.json`);
}

function readCache(root: string, sliceId: string): SliceCache | null {
  const file = cachePath(root, sliceId);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as SliceCache;
  } catch {
    return null;
  }
}

/** Everything a slice's draft read; a change in any of it re-plans the slice and nothing else. */
function sliceKey(deps: PlanDeps, slice: SliceSpec, index: readonly DraftedTicket[]): string {
  const docs = slice.docs.length > 0 ? slice.docs : deps.docs;
  return createHash("sha256")
    .update(
      JSON.stringify([
        slice,
        contentsDigest(deps.root, docs),
        deps.analysis,
        deps.boundSlots,
        deps.budgets,
        deps.promptHash ?? "",
        index.map((t) => t.id),
      ]),
    )
    .digest("hex");
}

export const tagSlice = (tickets: readonly Omit<DraftedTicket, "slice">[], slice: string): DraftedTicket[] =>
  tickets.map((t) => ({ ...t, slice }));

/**
 * The draft as the planner wrote it is not trusted for its ids or its edges.
 * An id that collides with another slice's (or repeats inside this one) is
 * renamed and the slice's own references follow; a `depends_on` that names
 * nothing planned is dropped and kept as a `dependency` finding for PRESENT.
 * Neither stops the run: a plan with one doubtful edge is a finding for the
 * human, not a failure of the machine (C-2‴, D-24).
 */
export function normaliseDraft(
  slice: SliceSpec,
  tickets: readonly DraftedTicket[],
  earlier: readonly DraftedTicket[],
  note: ((text: string) => void) | undefined,
  reserved: readonly DraftedTicket[] = earlier,
): { readonly tickets: DraftedTicket[]; readonly findings: PlanReview["findings"] } {
  const taken = new Set(reserved.map((t) => t.id));
  const own = new Set<string>();
  const renamed = new Map<string, string>();
  let next = 1;
  const fresh = (): string => {
    let id = "";
    do {
      id = `t-${slice.id}-${String(next).padStart(3, "0")}`;
      next += 1;
    } while (taken.has(id) || own.has(id) || tickets.some((t) => t.id === id));
    return id;
  };
  const retagged = tickets.map((t) => {
    let id = t.id;
    if (taken.has(id) || own.has(id)) {
      id = fresh();
      renamed.set(t.id, id);
      note?.(`${slice.id}: ticket id ${t.id} collides with a planned ticket — renamed ${id}`);
    }
    own.add(id);
    return { ...t, id };
  });
  const known = new Set([...earlier.map((t) => t.id), ...own]);
  const findings: PlanReview["findings"] = [];
  const result = retagged.map((t) => {
    const deps = [...new Set(t.depends_on.map((d) => renamed.get(d) ?? d))].filter((d) => d !== t.id);
    const unknown = deps.filter((d) => !known.has(d));
    if (unknown.length === 0) return { ...t, depends_on: deps };
    findings.push({
      tag: "dependency",
      ticket: t.id,
      finding: `depends on ${unknown.join(", ")}, which no slice planned — the edge was dropped; the need it named may be real`,
    });
    note?.(`${slice.id}: ${t.id} depends on unknown ${unknown.join(", ")} — edge dropped (C-2‴)`);
    return { ...t, depends_on: deps.filter((d) => known.has(d)) };
  });
  return { tickets: result, findings };
}

export async function planSlices(deps: PlanDeps, slices: readonly SliceSpec[]): Promise<SlicePlan> {
  const index: DraftedTicket[] = [];
  const questions: PlanQuestion[] = [];
  const remaining: SlicePlan["remaining"] = [];
  mkdirSync(sliceCacheDir(deps.root), { recursive: true });

  for (const slice of slices) {
    const key = sliceKey(deps, slice, index);
    const cached = readCache(deps.root, slice.id);
    if (cached !== null && cached.key === key) {
      deps.note?.(`${slice.id} ${slice.title}: reused — nothing it read has changed (C-8)`);
      index.push(...cached.tickets);
      questions.push(...cached.questions);
      if (cached.remaining.length > 0) remaining.push({ slice: slice.id, findings: cached.remaining });
      continue;
    }

    deps.note?.(`planning ${slice.id} ${slice.title} (${index.length} ticket(s) planned before it)`);
    await draftPlan(deps, { slice, planIndex: index });
    let drafted = readValidatedDraft(deps.root);
    let normalised = normaliseDraft(slice, tagSlice(drafted.tickets, slice.id), index, deps.note);

    let leftover: PlanReview["findings"] = [];
    const review = await reviewPlan(deps, normalised.tickets, { kind: "slice", slice, planIndex: index });
    if (review !== null && review.verdict === "changes" && review.findings.length > 0) {
      deps.note?.(`${slice.id} review: ${review.findings.length} finding(s) — ${review.findings.map((f) => f.tag).join(", ")}`);
      for (let round = 0; round < PLAN_REVISIONS; round += 1) {
        await draftPlan(deps, { slice, planIndex: index, findings: review.findings });
        drafted = readValidatedDraft(deps.root);
        normalised = normaliseDraft(slice, tagSlice(drafted.tickets, slice.id), index, deps.note);
      }
      const second = await reviewPlan(deps, normalised.tickets, { kind: "slice", slice, planIndex: index });
      leftover = second !== null && second.verdict === "changes" ? second.findings : [];
      deps.note?.(
        leftover.length === 0
          ? `${slice.id} review: revision accepted`
          : `${slice.id} review after revision: ${leftover.length} finding(s) remain — ${leftover.map((f) => f.tag).join(", ")}`,
      );
    } else if (review !== null) {
      deps.note?.(`${slice.id} review: approve`);
    }

    const held = [...normalised.findings, ...leftover];
    const cache: SliceCache = { key, tickets: normalised.tickets, questions: drafted.questions, remaining: held };
    writeFileSync(cachePath(deps.root, slice.id), `${JSON.stringify(cache, null, 2)}\n`);
    index.push(...normalised.tickets);
    questions.push(...drafted.questions);
    if (held.length > 0) remaining.push({ slice: slice.id, findings: held });
  }
  return { tickets: index, questions, remaining };
}
