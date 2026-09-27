import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { SCHEMA_VERSION } from "../schemas/common.js";
import { type CheckFailure, type PlanReview, type SliceSpec, specDefectSchema, type SpecDefect } from "../schemas/init.js";
import { cachedTicketSchema } from "./plan-cache.js";
import { checkPlan, failureLine, type PlanContext } from "./plan-checks.js";
import { redraftRecordPath } from "./machine.js";
import { draftAndRead, type PlanDeps } from "./plan.js";
import { normaliseDraft, tagSlice } from "./plan-normalise.js";
import { dependencyIndex } from "./plan-records.js";
import { failureInputs } from "./plan-inputs.js";
import type { PlannedSpecDefect } from "./plan-slices.js";
import type { DraftedTicket } from "./plan-write.js";
import { sliceKey } from "./slice-key.js";

/**
 * A-1⁷ (PRDR-293) — after every slice, the checks across the whole plan.
 *
 * A slice's own checks read it against the slices before it, and send it its
 * own failures. What they cannot send is a failure that lies in another slice:
 * a name the new slice provides that an earlier one provides too, or a name an
 * earlier slice consumed and a later redraft stopped providing. So after every
 * slice the same checks run over the plan so far, and each failure no redraft
 * has been sent goes to a slice: a name nobody provides to the earliest slice
 * that consumes it, a name with two providers to each owner's slice, and the
 * rest to the slice they lie in. A slice redrafted here keeps every id a later
 * slice depends on, or the redraft is discarded and the slice stands.
 *
 * This replaces the whole-plan model review (C-2‴). Its prompt carried every
 * ticket in full, and ksar-cloud's 547 tickets took it to 1.55M tokens against
 * a 1M limit, so that plan was never reviewed as one thing. The checks grow
 * with the plan's size; no model reads the contracts between slices (planning
 * decision 10).
 */

/**
 * Rounds of redrafts per pass. Each failure buys one redraft of the slice it
 * is sent to, and a redraft may break what another slice relied on, which the
 * next round sends on. A chain longer than this is a plan the operator reads.
 */
export const CROSS_ROUNDS = 3;

/** Validated on read like every other checkpoint (C-8‴): a shape this does not recognise is a miss. */
const redraftsSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  redrafts: z.array(
    z.strictObject({
      key: z.string(),
      slice: z.string(),
      tickets: z.array(cachedTicketSchema),
      spec_defects: z.array(specDefectSchema),
      findings: z.array(z.looseObject({ tag: z.string(), finding: z.string() })),
    }),
  ),
});

export interface Redraft {
  readonly key: string;
  readonly slice: string;
  readonly tickets: DraftedTicket[];
  readonly spec_defects: SpecDefect[];
  readonly findings: PlanReview["findings"];
}

export function readRedrafts(root: string): Redraft[] {
  const file = redraftRecordPath(root);
  if (!existsSync(file)) return [];
  try {
    const parsed = redraftsSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? (parsed.data.redrafts as unknown as Redraft[]) : [];
  } catch {
    return [];
  }
}

export function writeRedrafts(root: string, redrafts: readonly Redraft[]): void {
  mkdirSync(path.dirname(redraftRecordPath(root)), { recursive: true });
  writeFileSync(redraftRecordPath(root), `${JSON.stringify({ schema_version: SCHEMA_VERSION, redrafts }, null, 2)}\n`);
}

/**
 * `JSON.stringify` with object keys in sorted order. A key must survive a
 * round trip through a checkpoint, and the same ticket parsed by two schemas
 * carries its fields in a different order.
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

/** What a redraft read: the slice's own key, its draft, the failures that sent it, the ids it keeps and the tickets it builds on (C-8⁗). */
function redraftKey(deps: PlanDeps, slice: SliceSpec, draft: readonly DraftedTicket[], failures: readonly CheckFailure[], keep: readonly string[], index: readonly DraftedTicket[]): string {
  const builds = dependencyIndex(slice, deps.slices ?? [], index);
  return createHash("sha256").update(stableJson([sliceKey(deps, slice), draft, failureInputs(failures), keep, builds])).digest("hex");
}

/** Each slice's failures no redraft has been sent, in slice order; a name nobody provides goes only to the earliest slice consuming it. */
function route(failures: readonly CheckFailure[], order: readonly string[], sent: ReadonlyMap<string, ReadonlySet<string>>): Map<string, CheckFailure[]> {
  const rank = (slice: string): number => (order.includes(slice) ? order.indexOf(slice) : Number.MAX_SAFE_INTEGER);
  const earliest = new Map<string, string>();
  for (const f of failures) {
    if (f.unowned === undefined) continue;
    const held = earliest.get(f.unowned);
    if (held === undefined || rank(f.slice) < rank(held)) earliest.set(f.unowned, f.slice);
  }
  const out = new Map<string, CheckFailure[]>();
  for (const slice of order) {
    const due = failures.filter(
      (f) => f.slice === slice && (f.unowned === undefined || earliest.get(f.unowned) === slice) && sent.get(slice)?.has(f.key) !== true,
    );
    if (due.length > 0) out.set(slice, due);
  }
  return out;
}

export interface CrossPass {
  readonly tickets: DraftedTicket[];
  readonly spec_defects: PlannedSpecDefect[];
  /** A-1″'s repairs of each redraft, by slice. */
  readonly findings: { readonly slice: string; readonly findings: PlanReview["findings"] }[];
}

export async function crossSlicePass(
  deps: PlanDeps,
  context: PlanContext,
  slices: readonly SliceSpec[],
  planned: readonly DraftedTicket[],
  /** The failure keys each slice has been sent a redraft for; the pass adds what it sends. */
  sent: Map<string, Set<string>>,
  /** Every redraft this run has used, reused or new; a new one is written down before the next begins. */
  used: Redraft[],
): Promise<CrossPass> {
  const order = slices.map((s) => s.id);
  const rank = (slice: string): number => order.indexOf(slice);
  let index = [...planned];
  const defects: PlannedSpecDefect[] = [];
  const findings: CrossPass["findings"] = [];
  const previous = readRedrafts(deps.root);
  for (let round = 0; round < CROSS_ROUNDS; round += 1) {
    let sentAny = false;
    for (const slice of slices) {
      /* Checked again before each slice: a redraft of an earlier one may have answered, or made, what this one is sent. */
      const failures = route(checkPlan(context, index).failures, order, sent).get(slice.id);
      if (failures === undefined) continue;
      sentAny = true;
      const earlier = index.filter((t) => rank(t.slice) < rank(slice.id));
      const later = index.filter((t) => rank(t.slice) > rank(slice.id));
      const draft = index.filter((t) => t.slice === slice.id);
      /** Ids later slices reach for: the redraft keeps them, or it is discarded. */
      const keep = [...new Set(later.flatMap((t) => t.depends_on).filter((d) => draft.some((t) => t.id === d)))];
      const key = redraftKey(deps, slice, draft, failures, keep, [...earlier, ...later]);
      let redraft = [...used, ...previous].find((r) => r.key === key);
      if (redraft === undefined) {
        deps.progress?.(`redrafting ${slice.id} ${slice.title} for the checks across the plan`);
        deps.note?.(`redrafting ${slice.id} for ${String(failures.length)} failure(s) the checks across the plan found — ${failures.map(failureLine).join("; ")} (A-1⁷)`);
        const drafted = await draftAndRead(deps, { slice, planIndex: [...earlier, ...later], failures, draft, keepIds: keep });
        const normalised = normaliseDraft(slice, tagSlice(drafted.tickets, slice.id), earlier, deps.note, [...earlier, ...later]);
        redraft = { key, slice: slice.id, tickets: normalised.tickets, spec_defects: [...drafted.spec_defects], findings: normalised.findings };
      } else {
        deps.note?.(`${slice.id}: its redraft for the checks across the plan is reused — already written down (C-8⁗)`);
      }
      if (!used.some((r) => r.key === key)) used.push(redraft);
      writeRedrafts(deps.root, [...previous.filter((r) => !used.some((u) => u.key === r.key)), ...used]);
      sent.set(slice.id, new Set([...(sent.get(slice.id) ?? []), ...failures.map((f) => f.key)]));
      const missing = keep.filter((k) => !(redraft as Redraft).tickets.some((t) => t.id === k));
      if (missing.length > 0) {
        deps.note?.(`${slice.id} redraft dropped ${missing.join(", ")}, which later slices depend on — redraft discarded, the slice stands`);
        continue;
      }
      index = [...earlier, ...redraft.tickets, ...later];
      defects.push(...redraft.spec_defects.map((d) => ({ ...d, slice: slice.id })));
      if (redraft.findings.length > 0) findings.push({ slice: slice.id, findings: redraft.findings });
    }
    if (!sentAny) break;
  }
  return { tickets: index, spec_defects: defects, findings };
}
