import type { PlanFinding, SliceSpec } from "../schemas/init.js";
import { isSafeTicketId } from "../schemas/common.js";
import { BOOTSTRAP_TICKET_ID, type DraftedTicket } from "./plan-write.js";

/**
 * A-1″ — the repairs code makes to a draft before any check reads it.
 *
 * Moved out of `plan-slices.ts` by PRDR-293, which reads a slice's draft in
 * three places: after it is drafted, after its revision, and after a redraft
 * the checks send it (`plan-redraft.ts`, `plan-cross.ts`). Each is normalised
 * the same way, and A-1⁷'s checks run on what this returns.
 */

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
): { readonly tickets: DraftedTicket[]; readonly findings: PlanFinding[] } {
  /**
   * The bootstrap id is Detent's own construction (C-4) and is created after
   * planning, so it collides with nothing here — a planner that drafts it
   * would be cached and would then fail every later run identically. Reserving
   * it renames the offender instead of poisoning the cache.
   */
  const taken = new Set([...reserved.map((t) => t.id), BOOTSTRAP_TICKET_ID]);
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
  const findings: PlanFinding[] = [];
  const retagged = tickets.map((t) => {
    let id = t.id;
    /**
     * A duplicate INSIDE this slice is a different thing from a collision with
     * an earlier one, and it is the ambiguous case: two tickets claimed one
     * name, so every edge naming it has two possible meanings.
     */
    const duplicate = own.has(id);
    if (taken.has(id) || duplicate || !isSafeTicketId(id)) {
      id = fresh();
      renamed.set(t.id, id);
      note?.(`${slice.id}: ticket id ${JSON.stringify(t.id)} is unusable or already planned — renamed ${id}`);
      if (duplicate) {
        findings.push({
          tag: "coherence",
          ticket: id,
          finding: `was drafted as \`${t.id}\`, an id another ticket in this slice already holds — renamed ${id}. Edges naming \`${t.id}\` were read as the ticket that KEPT the id, so check none of them meant this one`,
        });
      }
      /**
       * C-4 reserves the bootstrap ticket for Detent, so a draft carrying its
       * id has probably drafted the scaffolding it was told not to. The
       * content is kept — it may be a real ticket that merely picked the wrong
       * name — but the human is told, because the alternative reading is that
       * the plan now contains the bootstrap's work twice.
       */
      if (t.id === BOOTSTRAP_TICKET_ID) {
        findings.push({
          tag: "traceability",
          ticket: id,
          finding: `drafted with ${BOOTSTRAP_TICKET_ID}, the id C-4 reserves for the bootstrap ticket Detent writes itself — renamed ${id}; check it does not duplicate the scaffolding work`,
        });
      }
    }
    own.add(id);
    return { ...t, id };
  });
  const earlierIds = new Set(earlier.map((t) => t.id));
  const known = new Set([...earlierIds, ...own]);
  const result = retagged.map((t) => {
    /**
     * A reference is rewritten ONLY when the name it uses no longer belongs to
     * anything. Two cases must survive untouched, and each was a real defect:
     *
     * - an id that ALSO names a real earlier ticket means that earlier ticket.
     *   Rewriting it to this slice's renamed local destroyed the only
     *   cross-slice edge the draft declared, and silently.
     * - an id another ticket in THIS slice kept means that ticket. When the
     *   planner drafted one id twice, the rename map pointed at the SECOND,
     *   renamed copy, so every edge naming it was redirected away from the
     *   ticket still holding the name — a silently rewired plan.
     *
     * `renamed` is therefore the last resort, for names nothing answers to.
     */
    const survives = (d: string): boolean => earlierIds.has(d) || own.has(d);
    const deps = [...new Set(t.depends_on.map((d) => (survives(d) ? d : renamed.get(d) ?? d)))].filter((d) => d !== t.id);
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
  return { tickets: breakCycles(slice, result, findings, note), findings };
}

/**
 * A dependency cycle is a permanent, silent deadlock: `ready()` simply never
 * offers those tickets and nothing anywhere reports why. Nothing downstream
 * looks for one — not the draft validator, not `planSchema` — and two tickets
 * naming each other is an ordinary thing for a model to write. Cross-slice
 * edges only point backwards, so any cycle is inside this slice; each one is
 * broken at the edge that closes it, and the human is told which.
 */
function breakCycles(
  slice: SliceSpec,
  tickets: readonly DraftedTicket[],
  findings: PlanFinding[],
  note: ((text: string) => void) | undefined,
): DraftedTicket[] {
  const own = new Set(tickets.map((t) => t.id));
  const edges = new Map(tickets.map((t) => [t.id, t.depends_on.filter((d) => own.has(d))]));
  const state = new Map<string, "open" | "closed">();
  const dropped = new Map<string, Set<string>>();

  const walk = (id: string, stack: string[]): void => {
    state.set(id, "open");
    for (const dep of edges.get(id) ?? []) {
      if (dropped.get(id)?.has(dep) === true) continue;
      if (state.get(dep) === "open") {
        dropped.set(id, new Set([...(dropped.get(id) ?? []), dep]));
        const loop = [...stack.slice(stack.indexOf(dep)), id].join(" → ");
        findings.push({ tag: "dependency", ticket: id, finding: `is part of a dependency cycle (${loop} → ${dep}); the edge to ${dep} was dropped so the plan can run` });
        note?.(`${slice.id}: dependency cycle ${loop} → ${dep} — edge ${id} → ${dep} dropped (C-2‴)`);
        continue;
      }
      if (state.get(dep) !== "closed") walk(dep, [...stack, dep]);
    }
    state.set(id, "closed");
  };
  for (const t of tickets) if (state.get(t.id) === undefined) walk(t.id, [t.id]);

  if (dropped.size === 0) return [...tickets];
  return tickets.map((t) => {
    const drop = dropped.get(t.id);
    return drop === undefined ? t : { ...t, depends_on: t.depends_on.filter((d) => !drop.has(d)) };
  });
}
