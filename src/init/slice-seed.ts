import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { SCHEMA_VERSION } from "../schemas/common.js";
import { planQuestionSchema, sliceSchema, type PlanQuestion, type SliceAdditions, type SliceSpec } from "../schemas/init.js";
import type { Pack } from "../schemas/pack.js";
import { slicingRecordPath } from "./machine.js";

/**
 * C-2⁸, C-2¹⁵ (PRDR-291) — SLICE's seed, and what code checks of a cut.
 *
 * On a pack, the structure SLICE once re-derived from prose is data: which
 * requirements are live, the milestone each belongs to, and the module that
 * holds it. Code builds the seed from the checker's parse. A slice session
 * makes the one judgement code cannot, how the product is cut into
 * increments, and code refuses a cut that loses, repeats or invents a
 * requirement, or holds a milestone's requirement after a later one's.
 *
 * A cut is kept on record, so SLICE running again keeps every slice's id and
 * members: a requirement that left the pack leaves its slice, and one that
 * joined is placed by a session that may only add. Only a slice whose
 * requirements moved is planned again (C-8⁵).
 */

/** Each live requirement planning covers, with its milestone: not withdrawn, and in a document planning reads (C-2″). */
export type Placement = ReadonlyMap<string, number>;

export function placement(pack: Pack, docs: readonly string[]): Placement {
  const read = new Set(docs);
  const live = new Map<string, number>();
  for (const r of pack.requirements) if (!r.withdrawn && r.milestone !== null && read.has(r.file)) live.set(r.id, r.milestone);
  return live;
}

export interface SeedGroup {
  readonly code: string;
  readonly area: string;
  readonly requirement_ids: readonly string[];
  /** The criteria that test them: what guides a cut, and never keys it (C-2⁸). */
  readonly criteria: number;
}

export interface SeedMilestone {
  readonly milestone: string;
  readonly title: string;
  readonly groups: readonly SeedGroup[];
}

/**
 * The ids of `ids` grouped by milestone, in order, then by module code, in the
 * order the index registers the codes; each group's ids in document order.
 */
export function seedOf(pack: Pack, ids: Placement): SeedMilestone[] {
  const registry = pack.codes.map((c) => c.code);
  const rank = (code: string): number => (registry.includes(code) ? registry.indexOf(code) : registry.length);
  const grouped = new Map<number, Map<string, string[]>>();
  const seen = new Set<string>();
  for (const r of pack.requirements) {
    const m = ids.get(r.id);
    if (m === undefined || r.withdrawn || seen.has(r.id)) continue;
    seen.add(r.id);
    const codes = grouped.get(m) ?? new Map<string, string[]>();
    codes.set(r.code, [...(codes.get(r.code) ?? []), r.id]);
    grouped.set(m, codes);
  }
  return [...grouped]
    .sort(([a], [b]) => a - b)
    .map(([m, codes]) => ({
      milestone: `M${String(m)}`,
      title: pack.milestones.find((x) => x.order === m)?.title ?? "",
      groups: [...codes]
        .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
        .map(([code, reqs]) => ({
          code,
          area: pack.codes.find((c) => c.code === code)?.area ?? "",
          requirement_ids: reqs,
          criteria: pack.criteria.filter((c) => c.requirements.some((id) => reqs.includes(id))).length,
        })),
    }));
}

type Cut = readonly { readonly id: string; readonly requirement_ids: readonly string[] }[];

/** Why `slices` is refused as a cut of `ids`, or null: every id in exactly one slice, nothing else, and milestones in order. */
export function cutIssue(pack: Pack, ids: Placement, slices: Cut): string | null {
  const issues: string[] = [];
  const where = new Map<string, string[]>();
  for (const s of slices) for (const id of s.requirement_ids) where.set(id, [...(where.get(id) ?? []), s.id]);
  for (const [id, at] of where) {
    if (!ids.has(id)) issues.push(`${id} ${stray(pack, id)}`);
    else if (at.length > 1) issues.push(`${id} is placed in ${at.join(" and ")}: each requirement belongs in exactly one slice`);
  }
  const missing = [...ids.keys()].filter((id) => !where.has(id));
  if (missing.length > 0) issues.push(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} placed in no slice`);
  const order = orderIssue(ids, slices);
  if (order !== null) issues.push(order);
  return issues.length === 0 ? null : issues.join("; ");
}

function stray(pack: Pack, id: string): string {
  const r = pack.requirements.find((x) => x.id === id);
  if (r === undefined) return "is not a requirement the pack defines";
  if (r.withdrawn) return "is withdrawn, and no slice places it";
  return "is in a document planning does not read, and no slice places it";
}

/** A slice never holds a requirement of an earlier milestone than one a slice before it holds. */
function orderIssue(ids: Placement, slices: Cut): string | null {
  let high: { readonly slice: string; readonly id: string; readonly m: number } | null = null;
  for (const s of slices) {
    const own = s.requirement_ids.flatMap((id) => {
      const m = ids.get(id);
      return m === undefined ? [] : [{ id, m }];
    });
    const [first] = own;
    if (first === undefined) continue;
    const low = own.reduce((a, b) => (b.m < a.m ? b : a), first);
    if (high !== null && low.m < high.m) {
      return (
        `${s.id} holds ${low.id} [M${String(low.m)}] after ${high.slice} holds ${high.id} [M${String(high.m)}]: ` +
        "no slice holds a requirement of an earlier milestone than one a slice before it holds"
      );
    }
    const top = own.reduce((a, b) => (b.m > a.m ? b : a), first);
    if (high === null || top.m > high.m) high = { slice: s.id, id: top.id, m: top.m };
  }
  return null;
}

/**
 * `kept` with what a session that may only add placed, or why that is
 * refused. It was shown `added` and places those alone: an id a kept slice
 * holds is a move, and a new slice takes an id no slice holds.
 */
export function withAdditions(
  kept: readonly SliceSpec[],
  additions: SliceAdditions,
  added: ReadonlySet<string>,
): { readonly value: SliceSpec[] | null; readonly issue: string | null } {
  const issues: string[] = [];
  const known = new Set(kept.map((s) => s.id));
  const owner = new Map(kept.flatMap((s) => s.requirement_ids.map((id) => [id, s.id] as const)));
  for (const id of [...additions.placed.map((p) => p.requirement_id), ...additions.new_slices.flatMap((s) => s.requirement_ids)]) {
    const at = owner.get(id);
    if (at !== undefined) issues.push(`${id} is already placed in ${at}, and a session that may only add moves nothing`);
    else if (!added.has(id)) issues.push(`${id} is not among the requirements to place`);
  }
  for (const p of additions.placed) {
    if (!known.has(p.slice)) issues.push(`${p.requirement_id} is placed in ${p.slice}, which is no slice; a new slice goes in new_slices`);
  }
  const opened = new Set<string>();
  for (const s of additions.new_slices) {
    if (known.has(s.id) || opened.has(s.id)) issues.push(`new slice ${s.id} takes an id a slice already has`);
    if (s.after !== null && !known.has(s.after) && !opened.has(s.after)) issues.push(`new slice ${s.id} follows ${s.after}, which is no slice before it`);
    opened.add(s.id);
  }
  if (issues.length > 0) return { value: null, issue: issues.join("; ") };
  const after = (id: string | null): SliceSpec[] =>
    additions.new_slices
      .filter((s) => s.after === id)
      .flatMap((s) => [{ id: s.id, title: s.title, goal: s.goal, requirement_ids: s.requirement_ids, baseline_items: [], docs: [], depends_on: s.depends_on, rationale: s.rationale }, ...after(s.id)]);
  const joined = kept.map((s) => ({ ...s, requirement_ids: [...s.requirement_ids, ...additions.placed.filter((p) => p.slice === s.id).map((p) => p.requirement_id)] }));
  return { value: [...after(null), ...joined.flatMap((s) => [s, ...after(s.id)])], issue: null };
}

/* ---------------------------------------------------------------------------
 * The sessions' artifacts
 */

/** The question entry every slicing skeleton shows. */
export const QUESTION = { id: "q1", question: "<a question ONLY the user can answer — omit entry if none>", blocking: false, assumption: "<what the slicing proceeds on if unanswered>" };

/** C-2⁸: the EXACT artifact SLICE writes on a pack, where each slice's documents are code's. */
export function seededSkeleton(): Record<string, unknown> {
  return {
    schema_version: SCHEMA_VERSION,
    slices: [
      {
        id: "s01",
        title: "<short name — required>",
        goal: "<what works end to end when this slice is DONE — required>",
        requirement_ids: ["<requirement ids from the seed this slice delivers, exactly as written>"],
        baseline_items: ["<PB-### ids from production_baseline this slice delivers — may be empty>"],
        depends_on: [],
        rationale: "<why this slice, here — may be empty>",
      },
    ],
    questions: [QUESTION],
  };
}

/** C-2¹⁵: the EXACT artifact a session that may only add writes. */
export function additionsSkeleton(): Record<string, unknown> {
  return {
    schema_version: SCHEMA_VERSION,
    placed: [{ requirement_id: "<a requirement id from the seed>", slice: "s01" }],
    new_slices: [
      {
        id: "s09",
        after: "s01",
        title: "<short name — required>",
        goal: "<what works end to end when this slice is DONE — required>",
        requirement_ids: ["<requirement ids from the seed>"],
        depends_on: [],
        rationale: "<why a slice of its own — may be empty>",
      },
    ],
  };
}

/* ---------------------------------------------------------------------------
 * The cut on record
 */

const recordSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  /** The baseline, the band and the prompt the cut was made under: SLICE's inputs besides the ids (C-2⁸). */
  basis: z.string(),
  /** Each id the cut places, with the milestone it had then. */
  placement: z.record(z.string(), z.number().int().nonnegative()),
  slices: z.array(sliceSchema).min(1),
  questions: z.array(planQuestionSchema),
});

export interface SlicingRecord {
  readonly basis: string;
  readonly placement: Readonly<Record<string, number>>;
  readonly slices: readonly SliceSpec[];
  readonly questions: readonly PlanQuestion[];
}

/** The cut on record, or null: absent, or a shape this build does not read, which is cut again rather than trusted. */
export function readSlicing(root: string): SlicingRecord | null {
  const file = slicingRecordPath(root);
  if (!existsSync(file)) return null;
  try {
    const parsed = recordSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeSlicing(root: string, record: SlicingRecord): void {
  writeFileSync(slicingRecordPath(root), `${JSON.stringify({ schema_version: SCHEMA_VERSION, ...record }, null, 2)}\n`);
}

/**
 * What moved since the cut on record. An id no longer live, or whose
 * milestone changed, leaves its slice; a slice left with nothing to plan goes,
 * and so do the edges to it. What the kept slices no longer place is to add.
 */
export function sinceRecord(record: SlicingRecord, ids: Placement): { readonly kept: SliceSpec[]; readonly removed: string[]; readonly added: string[] } {
  const stays = (id: string): boolean => ids.has(id) && ids.get(id) === record.placement[id];
  const removed = record.slices.flatMap((s) => s.requirement_ids.filter((id) => !stays(id)));
  const left = record.slices
    .map((s) => ({ ...s, requirement_ids: s.requirement_ids.filter(stays) }))
    .filter((s) => s.requirement_ids.length > 0 || s.baseline_items.length > 0);
  const standing = new Set(left.map((s) => s.id));
  const kept = left.map((s) => ({ ...s, depends_on: s.depends_on.filter((d) => standing.has(d)) }));
  const placed = new Set(kept.flatMap((s) => s.requirement_ids));
  return { kept, removed, added: [...ids.keys()].filter((id) => !placed.has(id)) };
}

/** Each slice's milestones, which a session that may only add must keep in order. */
export const milestonesOf = (ids: Placement, slice: Pick<SliceSpec, "requirement_ids">): string[] =>
  [...new Set(slice.requirement_ids.flatMap((id) => (ids.has(id) ? [ids.get(id) ?? 0] : [])))].sort((a, b) => a - b).map((m) => `M${String(m)}`);
