import { createHash } from "node:crypto";
import type { SliceSpec } from "../schemas/init.js";
import { PRODUCTION_BASELINE } from "./baseline.js";
import { contentsDigest } from "./machine.js";
import type { PlanDeps } from "./plan.js";
import { sliceRecords } from "./plan-records.js";
import { sessionBudget } from "./plan-review.js";

/**
 * Everything a slice's draft read that can meaningfully change it.
 *
 * C-8‴ (PRDR-118): this used to hash the whole ANALYZE artifact and the ids of
 * every ticket planned before it, which made the module's own promise false.
 * ANALYZE re-ran on any document edit and was a model act, so its prose drifted
 * every time — and with it every slice's key, so a typo in slice twelve's
 * document re-planned all twenty. The ids did the same thing transitively:
 * re-planning slice two changed slice three's key, and so on to the end.
 *
 * C-2⁸ (PRDR-291): it hashed the whole slice too, the model's title, goal and
 * rationale with the ids, and SLICE writes new words every time it runs. A
 * slice is its requirement ids now, and its key is those ids, sorted; what
 * they say (below); the baseline items it carries, with what each is
 * verified by; the stack the decision log settles (D-10′); the bindings; the
 * session budget; and the prompts.
 *
 * On a pack, what the ids say is their records from the checker's parse, the
 * ones PLAN drafts from (C-4⁵, PRDR-292): each requirement's text, milestone,
 * level and tags, the criteria that test them, and the decisions, defaults,
 * facts and catalogue entries they cite. So an edit to one requirement
 * re-plans its own slice, and a veto the slices whose records cite what it
 * edits (C-3⁗). Without a parse, what the ids say is the contents of the
 * documents the slice plans from, as C-8‴ keyed it.
 *
 * The earlier index matters only where this slice reached into it, and that
 * is checked separately as `external_deps`, precisely and without cascading.
 * So is a spec defect the slice reported: its quotes are checked against the
 * pack when the cache is read (`plan-slices.ts`).
 */
export function sliceKey(deps: PlanDeps, slice: SliceSpec): string {
  const ids = [...slice.requirement_ids].sort();
  const items = [...slice.baseline_items].sort();
  const read =
    deps.pack === undefined || deps.pack === null
      ? contentsDigest(deps.root, slice.docs.length > 0 ? slice.docs : deps.docs)
      : sliceRecords(deps.root, deps.pack, ids);
  return createHash("sha256")
    .update(
      JSON.stringify([
        ids,
        read,
        PRODUCTION_BASELINE.filter((b) => items.includes(b.id)),
        deps.stack,
        deps.greenfield,
        deps.baseline ?? "production",
        deps.boundSlots,
        /**
         * PRDR-186: what the planner READ, not the whole budgets object.
         *
         * `sessionBudget` derives the only three values a plan can depend on —
         * `turns_per_stage`, `ticket_wall_clock_ms`, `sessions` — and they are
         * what reaches the prompt as `session_budget`. Keying on the whole
         * object put `run_spend_usd` in the key, so raising a spend cap
         * mid-run discarded every slice already planned and re-paid for it.
         * Observed: a live run five slices in, ~$70 of planning thrown away by
         * an operational decision that cannot change what a plan should say.
         * This module's own header calls the key "everything a slice's draft
         * READ"; the cap is not something it read.
         */
        sessionBudget(deps.budgets),
        deps.promptHash ?? "",
      ]),
    )
    .digest("hex");
}
