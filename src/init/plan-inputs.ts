import { SCHEMA_VERSION } from "../schemas/common.js";
import { PRODUCTION_BASELINE } from "./baseline.js";
import type { DraftScope, PlanDeps } from "./plan.js";
import { catalogueIds, dependencyIndex, sliceRecords } from "./plan-records.js";
import { sessionBudget } from "./plan-review.js";
import { previousAttemptInput, refusedAttemptInput } from "./retry.js";
import { sizingEvidence } from "./sizing-evidence.js";

/**
 * C-4⁵ (PRDR-292) — what a PLAN session is handed.
 *
 * On a pack, its slice's records from the checker's parse and nothing a
 * document says around them, with the catalogue's ids and the tickets of the
 * slices it builds on, each with what it provides. Without a parse, the
 * documents the slice plans from, as C-2‴ handed them. Neither names what an
 * earlier stage asked: no planning stage asks (C-3⁗).
 */

/** An earlier attempt at the draft: refused for its shape, or, where `refused` is set, for what it says. */
export interface PreviousDraft {
  readonly issue: string;
  readonly refused?: boolean;
}

/**
 * The EXACT artifact shape PLAN must write (PRDR-067's sibling lesson from
 * T-140: prose contracts drift; `expected_output` plus a strict validator
 * does not). A test parses this skeleton through `planDraftSchema`.
 */
export function planDraftSkeleton(): Record<string, unknown> {
  return {
    schema_version: SCHEMA_VERSION,
    tickets: [
      {
        id: "t-100",
        type: "feature",
        title: "<short imperative title — required>",
        description: "<what and why, and what you decided that the records leave to engineering — may be empty>",
        acceptance_criteria: ["<a pack criterion's text, copied word for word, or a testable criterion of your own — at least one>"],
        non_goals: ["<explicitly out of scope — may be empty list>"],
        surface: ["src/**", "tests/**"],
        depends_on: [],
        /** A-1‴: the names this ticket OWNS, each with the meaning a consumer needs. */
        provides: [{ kind: "symbol", id: "<pkg/path.ExportedName>", note: "<what it means — a consumer session is handed this verbatim>" }],
        /** A-1‴: names another ticket owns. Detent derives the dependency edge from these. */
        consumes: [{ kind: "event", id: "<an id from catalogue_ids, or a name another ticket provides — omit the list if none>" }],
        /** A-1⁵: which of the slice's OWN `requirement_ids` and `baseline_items` this ticket delivers. */
        requirement_ids: ["<requirement id from this slice's requirement_ids — omit if none>"],
        baseline_ids: ["<PB-### from this slice's baseline_items — omit if none>"],
        /** C-4⁵: the pack criteria it delivers, each one's text among its acceptance criteria. */
        criterion_ids: ["<id of a criterion in records this ticket delivers — omit if none>"],
        risk_label: false,
      },
    ],
    /** C-4⁵: omit the entry when the pack settles everything the slice needs — most slices report none. */
    spec_defects: [
      {
        kind: "gap",
        passages: [{ id: "<id of the record quoted: a requirement, a criterion, a D-n or X-n, a fact's section or a catalogue id>", quote: "<its words, copied exactly>" }],
        defect: "<what the pack leaves unsettled, or, for kind contradiction, why the passages cannot all hold>",
      },
    ],
  };
}

/** One drafting launch's inputs: the whole product, or one slice of it (C-2‴). */
export function draftInputs(deps: PlanDeps, scope: DraftScope, previous: PreviousDraft | null): Record<string, unknown> {
  const slice = scope.slice;
  const pack = deps.pack ?? null;
  const index = slice === undefined ? [] : dependencyIndex(slice, deps.slices ?? [], scope.planIndex ?? []);
  const evidence = sizingEvidence(deps.root);
  return {
    stage: "PLAN",
    stack: deps.stack,
    ...(pack !== null && slice !== undefined
      ? { records: sliceRecords(deps.root, pack, slice.requirement_ids), catalogue_ids: catalogueIds(pack) }
      : { docs: slice !== undefined && slice.docs.length > 0 ? slice.docs : deps.docs }),
    greenfield: deps.greenfield,
    bound_slots: deps.boundSlots,
    /**
     * PRDR-081: the planner sizes tickets against the budget that will
     * actually execute them. Without it the plan mirrors its documents'
     * altitude — a PRD in, PRD-sized epics out, each far past what one
     * session can finish or a gate can verify.
     */
    session_budget: sessionBudget(deps.budgets),
    /** X-4″ (PRDR-102): what the previous plan of these documents measured — turns per session, sessions that reported themselves oversized. */
    ...(evidence === null ? {} : { sizing_evidence: evidence }),
    /* The slice by its ids: on a pack its documents are code's, and a draft reads its records instead. */
    ...(slice === undefined ? {} : { slice: { id: slice.id, title: slice.title, goal: slice.goal, requirement_ids: slice.requirement_ids, baseline_items: slice.baseline_items } }),
    /** C-2⁗: the baseline items this slice carries, with what each is verified by — tickets are drafted from them. */
    ...(slice === undefined || deps.baseline === "none" || slice.baseline_items.length === 0 ? {} : { production_baseline: PRODUCTION_BASELINE.filter((b) => slice.baseline_items.includes(b.id)) }),
    ...(index.length === 0 ? {} : { plan_index: index }),
    ...(scope.findings === undefined ? {} : { review_findings: scope.findings }),
    ...(scope.keepIds === undefined || scope.keepIds.length === 0 ? {} : { keep_ids: scope.keepIds }),
    ...(previous?.refused === true ? refusedAttemptInput(previous, "plan draft") : previousAttemptInput(previous, "plan draft")),
    expected_output: planDraftSkeleton(),
    instruction: [
      slice === undefined
        ? "Draft the tickets for the whole product."
        : `Draft slice \`${slice.id}\` (${slice.title}): every requirement of the slice and every item in \`production_baseline\` reaches a ticket, and nothing outside the slice does. Its ticket ids are \`t-${slice.id}-NNN\`.`,
      deps.greenfield ? "This is a new project: Detent writes the bootstrap ticket that scaffolds it and blocks everything on it, so draft no scaffolding or setup ticket." : "",
      scope.findings === undefined ? "" : "A review of an earlier draft raised the `review_findings` in your inputs: answer every one of them in this draft.",
      scope.keepIds === undefined || scope.keepIds.length === 0 ? "" : "Keep every ticket id in `keep_ids` exactly as it is: later slices depend on them.",
      "Write exactly the `expected_output` shape to `artifact_out`.",
    ]
      .filter((s) => s !== "")
      .join(" "),
  };
}
