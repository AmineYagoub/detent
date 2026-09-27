import type { CheckFailure } from "../schemas/init.js";
import type { Ticket } from "../schemas/ticket.js";
import type { Gates } from "./plan-check-gates.js";
import { checkPlan, failureLine, type PlanContext } from "./plan-checks.js";
import type { DraftedTicket } from "./plan-write.js";
import type { PhaseOutcome } from "./machine.js";

/**
 * A-1⁷ (PRDR-293) — what still fails holds approval.
 *
 * PLAN sent every failing slice one redraft with its failures; what survived
 * is the operator's (planning decision 6). PRESENT runs the checks again, on
 * the tickets as they stand under `.detent/plan/`, because the operator may
 * answer a failure by editing a ticket rather than the pack, and a check read
 * from PLAN's record would hold a plan the edit had fixed. Each failure is
 * named, and approval is refused on both exits while any remains: here, and
 * at `run`'s deferred approval, which reads the count this records (C-7).
 */

/** What the checks read at PRESENT besides the tickets and the gates, from what the planning phases left. */
export type PresentChecks = Omit<PlanContext, "gates" | "done">;

/**
 * The tickets as the checks read them: a ticket's blockers are its edges, its
 * slice is the one the plan lists it in, and the bootstrap, in none, is
 * checked for its gates and its graph. DONE work provides its names.
 */
export function presentFailures(
  tickets: readonly Ticket[],
  planned: readonly { readonly id: string; readonly tickets: readonly string[] }[],
  checks: PresentChecks | undefined,
  gates: Gates,
): CheckFailure[] {
  const sliceOf = new Map(planned.flatMap((s) => s.tickets.map((id) => [id, s.id] as const)));
  const drafted: DraftedTicket[] = tickets
    .filter((t) => sliceOf.has(t.id) || t.state !== "DONE")
    .map((t) => ({
      id: t.id,
      type: t.type,
      title: t.title,
      description: t.description,
      acceptance_criteria: t.acceptance_criteria,
      non_goals: t.non_goals,
      surface: t.surface,
      depends_on: t.blockers,
      provides: t.provides,
      consumes: t.consumes,
      requirement_ids: t.requirement_ids,
      baseline_ids: t.baseline_ids,
      criterion_ids: t.criterion_ids,
      risk_label: t.risk_label,
      slice: sliceOf.get(t.id) ?? "",
    }));
  const context: PlanContext = {
    slices: checks?.slices ?? [],
    pack: checks?.pack ?? null,
    scaffold: checks?.scaffold,
    gates,
    done: tickets.filter((t) => t.state === "DONE"),
  };
  return checkPlan(context, drafted).failures;
}

/** What the presentation says, where anything fails. */
export function failureLines(failures: readonly CheckFailure[]): string[] {
  if (failures.length === 0) return [];
  return [
    "",
    `Checks that still fail (${String(failures.length)}) — proved by code from the tickets as they stand; while one fails, the plan cannot be approved (A-1⁷):`,
    ...failures.map((f) => `  ${failureLine(f)}`),
  ];
}

/** The AWAIT_INFO a failure raises, or null where none does. */
export function failureInterrupt(presentation: string, failures: readonly CheckFailure[]): PhaseOutcome | null {
  if (failures.length === 0) return null;
  const instruction =
    `${String(failures.length)} check(s) still fail, so this plan cannot be approved (A-1⁷). Planning redrafted each failing slice ` +
    "once, with its failures. Amend the pack where a failure lies and re-run `detent init`, which plans again the slices whose " +
    "records changed, or edit the tickets under `.detent/plan/` and re-run it. A path no gate can fail is answered by declaring " +
    "its package's gates under `## Packages` in the pack's decision log, by giving the package a `test`, `lint` or `typecheck` " +
    "command of its own, or by narrowing the surface that reaches it.";
  return { kind: "interrupt", interrupt: "AWAIT_INFO", message: [presentation, "", instruction].join("\n"), items: failures.map(failureLine) };
}
