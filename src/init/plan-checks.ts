import { contractKey, type CheckFailure, type ContractProvide, type SliceSpec } from "../schemas/init.js";
import type { Pack } from "../schemas/pack.js";
import { applyContracts, catalogueFindings } from "./contracts.js";
import { ungatedFinding, ungatedPaths, type Gates } from "./plan-check-gates.js";
import type { DraftedTicket } from "./plan-write.js";

/**
 * A-1⁷ (PRDR-293) — what code can prove about a plan, checked.
 *
 * A-1‴ and A-1⁵ made contracts and coverage set operations and then only
 * reported what they proved. ksar-cloud's approved plan kept 34 such defects,
 * 28 names consumed that no ticket provides and 6 names with two providers,
 * because the whole-plan review was handed them and told to treat them as
 * handled. Here each is a failure, in five families:
 *
 *   coverage    each requirement id and baseline item a slice was assigned is
 *               named by one of its tickets, each criterion that tests a
 *               slice's requirements is carried by a ticket, and no ticket
 *               names an id from outside its slice
 *   contracts   each consumed name has a provider in the same slice or an
 *               earlier one, no name has two, and a kind the pack catalogues
 *               is named by its catalogue id (`contracts.ts`)
 *   milestones  no ticket delivering an [Mk] requirement depends, directly or
 *               through others, on one delivering an [Mj] with j > k
 *   gates       every path of every ticket's surface lies in a package with a
 *               gate a ticket runs (V-5′, `plan-check-gates.ts`)
 *   graph       no cycle remains, and an edge the contracts imply but refuse,
 *               because it would close one, fails
 *
 * Pure and ordered, so the same plan fails the same way every time (C-8).
 * PLAN runs it after a slice's draft and its revision, where a failure buys the
 * slice one redraft (`plan-redraft.ts`), and across the plan after every slice
 * (`plan-cross.ts`). PRESENT runs it on the tickets as they stand, which an
 * operator may have edited, and holds approval while any fails
 * (`present-checks.ts`).
 */

/** What a plan is checked against, besides its tickets. */
export interface PlanContext {
  /** What SLICE assigned each slice, earliest first; empty where no slice was cut, and then no coverage is decidable. */
  readonly slices: readonly SliceSpec[];
  readonly pack: Pack | null;
  /** A-1⁶: the files the bootstrap's scaffold creates, which no ticket needs to provide. */
  readonly scaffold?: { readonly owner: string; readonly files: readonly string[] } | undefined;
  /** V-5′: the packages and what each binds. Absent, no gate is checked. */
  readonly gates?: Gates | undefined;
  /** Work already DONE: it provides its names, runs no gate again and is sent no redraft, so it is no failure's subject. */
  readonly done: readonly { readonly id: string; readonly provides: readonly ContractProvide[] }[];
}

export interface CheckResult {
  readonly failures: CheckFailure[];
  /** The tickets, with the edges their contracts imply (A-1‴). */
  readonly tickets: DraftedTicket[];
  readonly derived: readonly { readonly consumer: string; readonly provider: string; readonly contract: string }[];
}

export function checkPlan(context: PlanContext, tickets: readonly DraftedTicket[]): CheckResult {
  const planned = new Set(tickets.map((t) => t.id));
  const done = new Set(context.done.map((t) => t.id));
  /* Names DONE work owns that this plan no longer drafts: the work exists, so they are provided. */
  const settled = context.done.filter((t) => !planned.has(t.id)).flatMap((t) => t.provides.map((p) => contractKey(p)));
  const contracts = applyContracts(tickets, context.slices.map((s) => s.id), settled, context.slices, context.scaffold);
  const failures = [
    ...contracts.findings,
    ...catalogueFindings(contracts.tickets, context.pack),
    ...criterionFailures(contracts.tickets, context.slices, context.pack),
    ...foreignFailures(contracts.tickets, context.slices, context.pack),
    ...milestoneFailures(contracts.tickets, context.pack),
    ...(context.gates === undefined ? [] : gateFailures(contracts.tickets, context.gates)),
    ...cycleFailures(contracts.tickets),
  ];
  /* A name two tickets provide is the name's failure, not the ticket's: the other owner still has to yield. */
  const live = failures.filter((f) => f.ticket === undefined || !done.has(f.ticket) || f.key.startsWith("contracts:two-providers:"));
  return { failures: live, tickets: contracts.tickets, derived: contracts.derived };
}

/** The failures a slice's own redraft is sent: those that lie in it. */
export function sliceFailures(context: PlanContext, tickets: readonly DraftedTicket[], slice: string): CheckFailure[] {
  return checkPlan(context, tickets).failures.filter((f) => f.slice === slice);
}

/** What a failure is, on one line: its family, the ticket it names, and its words. */
export function failureLine(f: CheckFailure): string {
  return `${f.check}${f.ticket === undefined ? "" : ` (${f.ticket})`}: ${f.finding}`;
}

/** The live requirement ids of a pack, each with its milestone. */
function milestones(pack: Pack): ReadonlyMap<string, number> {
  return new Map(pack.requirements.flatMap((r) => (r.withdrawn || r.milestone === null ? [] : [[r.id, r.milestone] as const])));
}

/**
 * Each criterion that tests a live requirement is carried by some ticket. It
 * falls to the last slice holding one of its requirements, since it cannot be
 * verified before that slice's work exists, and until that slice is planned it
 * is not due.
 */
function criterionFailures(tickets: readonly DraftedTicket[], slices: readonly SliceSpec[], pack: Pack | null): CheckFailure[] {
  if (pack === null) return [];
  const live = milestones(pack);
  const planned = new Set(tickets.map((t) => t.slice));
  const carried = new Set(tickets.flatMap((t) => t.criterion_ids));
  const out: CheckFailure[] = [];
  for (const c of pack.criteria) {
    if (carried.has(c.id)) continue;
    const tested = c.requirements.filter((id) => live.has(id));
    const last = slices.filter((s) => s.requirement_ids.some((id) => tested.includes(id))).at(-1);
    if (last === undefined || !planned.has(last.id)) continue;
    out.push({
      tag: "coverage",
      finding: `${last.id} holds ${tested.filter((id) => last.requirement_ids.includes(id)).join(", ")}, and no ticket carries criterion ${c.id}, which tests it: the ticket that delivers it names ${c.id} in its \`criterion_ids\` and carries its words among its acceptance criteria`,
      check: "coverage",
      slice: last.id,
      key: `coverage:${last.id}:${c.id}`,
    });
  }
  return out;
}

/** No ticket names a requirement, baseline item or criterion its own slice was not assigned. */
function foreignFailures(tickets: readonly DraftedTicket[], slices: readonly SliceSpec[], pack: Pack | null): CheckFailure[] {
  const out: CheckFailure[] = [];
  for (const t of tickets) {
    const slice = slices.find((s) => s.id === t.slice);
    if (slice === undefined) continue;
    const criteria = pack === null ? null : new Set(pack.criteria.filter((c) => c.requirements.some((id) => slice.requirement_ids.includes(id))).map((c) => c.id));
    const foreign = [
      ...t.requirement_ids.filter((id) => !slice.requirement_ids.includes(id)).map((id) => ({ id, what: "requirement", field: "requirement_ids" })),
      ...t.baseline_ids.filter((id) => !slice.baseline_items.includes(id)).map((id) => ({ id, what: "baseline item", field: "baseline_ids" })),
      ...(criteria === null ? [] : t.criterion_ids.filter((id) => !criteria.has(id)).map((id) => ({ id, what: "criterion", field: "criterion_ids" }))),
    ];
    for (const f of foreign) {
      out.push({
        tag: "traceability",
        ticket: t.id,
        finding: `names ${f.what} ${f.id} in its \`${f.field}\`, and ${slice.id} was not assigned it: a ticket delivers only what its own slice holds`,
        check: "coverage",
        slice: t.slice,
        key: `coverage:foreign:${t.slice}:${f.id}`,
      });
    }
  }
  return out;
}

/**
 * No ticket waits on a later milestone's work. A ticket's own milestone is
 * the earliest of the requirements it delivers, and what it waits on is every
 * ticket its edges reach, so a chain through a ticket delivering nothing is
 * still a wait. The nearest offender is named, with the chain to it.
 */
function milestoneFailures(tickets: readonly DraftedTicket[], pack: Pack | null): CheckFailure[] {
  if (pack === null) return [];
  const live = milestones(pack);
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const delivered = (t: DraftedTicket): (readonly [string, number])[] =>
    t.requirement_ids.flatMap((id) => (live.has(id) ? [[id, live.get(id) as number] as const] : []));
  const out: CheckFailure[] = [];
  for (const a of tickets) {
    const own = delivered(a).sort((x, y) => x[1] - y[1])[0];
    if (own === undefined) continue;
    const seen = new Set([a.id]);
    const queue: { readonly id: string; readonly via: readonly string[] }[] = a.depends_on.map((id) => ({ id, via: [] }));
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      if (seen.has(next.id)) continue;
      seen.add(next.id);
      const b = byId.get(next.id);
      if (b === undefined) continue;
      const later = delivered(b).filter(([, m]) => m > own[1]).sort((x, y) => y[1] - x[1])[0];
      if (later !== undefined) {
        const through = next.via.length === 0 ? "" : ` through ${next.via.join(", ")}`;
        out.push({
          tag: "dependency",
          ticket: a.id,
          finding: `delivers ${own[0]}, of milestone M${String(own[1])}, and depends on ${b.id}${through}, which delivers ${later[0]}, of M${String(later[1])}: a milestone's work cannot wait on a later milestone's`,
          check: "milestones",
          slice: a.slice,
          key: `milestones:${a.slice}:${a.id}:${b.id}`,
        });
        break;
      }
      for (const id of b.depends_on) queue.push({ id, via: [...next.via, b.id] });
    }
  }
  return out;
}

function gateFailures(tickets: readonly DraftedTicket[], gates: Gates): CheckFailure[] {
  const sliceOf = new Map(tickets.map((t) => [t.id, t.slice]));
  return ungatedPaths(tickets, gates).map((u) => {
    const slice = sliceOf.get(u.ticket) ?? "";
    return { tag: "testability", ticket: u.ticket, finding: ungatedFinding(u), check: "gates", slice, key: `gates:${u.starts ? "starts:" : ""}${u.package}:${slice}` };
  });
}

/**
 * A cycle that remains is a deadlock: no ticket in it can start. A drafted
 * cycle is broken before the checks run (A-1″) and a derived edge that would
 * close one is refused, so this finds what an operator's edit of the tickets
 * made; each cycle is named once, at the edge that closes it.
 */
function cycleFailures(tickets: readonly DraftedTicket[]): CheckFailure[] {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const state = new Map<string, "open" | "closed">();
  const out: CheckFailure[] = [];
  const walk = (id: string, stack: readonly string[]): void => {
    state.set(id, "open");
    for (const dep of byId.get(id)?.depends_on ?? []) {
      if (!byId.has(dep)) continue;
      if (state.get(dep) === "open") {
        const loop = [...stack.slice(stack.indexOf(dep)), dep];
        const slice = byId.get(id)?.slice ?? "";
        out.push({
          tag: "dependency",
          ticket: id,
          finding: `is part of a dependency cycle (${loop.join(" → ")}): no ticket in it can start`,
          check: "graph",
          slice,
          key: `graph:cycle:${slice}:${[...new Set(loop)].sort().join(",")}`,
        });
        continue;
      }
      if (state.get(dep) !== "closed") walk(dep, [...stack, dep]);
    }
    state.set(id, "closed");
  };
  for (const t of tickets) if (state.get(t.id) === undefined) walk(t.id, [t.id]);
  return out;
}
