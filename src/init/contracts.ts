import { contractKey, type CheckFailure, type ContractConsume, type SliceSpec } from "../schemas/init.js";
import type { Pack } from "../schemas/pack.js";
import { catalogueIds } from "./plan-records.js";
import type { DraftedTicket } from "./plan-write.js";

/**
 * A-1‴ (PRDR-120) — the contract checks.
 *
 * Every ticket says what it OWNS (`provides`) and what it LEANS ON
 * (`consumes`). The contract is the union of those declarations, so it cannot
 * drift from the tickets the way a separate artifact would. What follows is
 * the whole point: four checks over that union, performed by code, with no
 * model session and no judgement.
 *
 * Each one corresponds to a real defect a reviewer found by hand in
 * ksar-cloud's first slice, and each cost a revision round to surface:
 *
 *   unowned    five tickets each assumed someone else assigned the port
 *   duplicate  two tickets both defined `run()` in the same file
 *   ordering   a ticket needed a config key another added four edges downstream
 *   contended  four tickets each edited `controlplane/go.mod`
 *
 * `ordering` is the one that changes the product: it does not merely report,
 * it DERIVES the missing dependency edge from the real coupling, so the plan
 * carries an edge the planner never thought to write. X-4′ recovers the same
 * fact at run time, one generation later; this is the plan knowing it first.
 *
 * A-1⁷ (PRDR-293): what they prove is a failure, not a report. Each names the
 * slice it lies in and a key that stays the same across drafts, so a redraft
 * is sent it once (`plan-checks.ts`), and its words cite nothing a drafter
 * cannot read: they reach the redraft as they are.
 */

export interface ContractResult {
  /** The tickets, with derived edges applied. */
  readonly tickets: DraftedTicket[];
  readonly findings: CheckFailure[];
  /** Edges the coupling implied and the planner did not declare. */
  readonly derived: readonly { readonly consumer: string; readonly provider: string; readonly contract: string }[];
}

/** How each kind reads in a finding, so the message names the thing rather than its type. */
const NOUN: Readonly<Record<string, string>> = {
  symbol: "symbol",
  config: "config key",
  file: "file",
  route: "route",
  table: "table",
  event: "event",
  error_code: "error code",
  setting: "setting",
  job: "job",
};

/**
 * Does `from` already reach `to` through the edges the graph holds RIGHT NOW?
 *
 * Deliberately not memoised across derivations. An earlier version computed
 * reachability once, up front, and checked every candidate edge against that
 * snapshot — so `a` consuming from `b` and `b` consuming from `a` both passed,
 * because in the ORIGINAL graph neither reached the other. The plan was written
 * with `a` blocked on `b` and `b` blocked on `a`: a permanent, silent deadlock,
 * with no finding, which is exactly the class PRDR-118 removed for drafted
 * edges. Derived edges have to be judged against the graph as it accumulates.
 */
function reaches(edges: ReadonlyMap<string, ReadonlySet<string>>, from: string, to: string): boolean {
  const stack = [...(edges.get(from) ?? [])];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of edges.get(id) ?? []) stack.push(next);
  }
  return false;
}

/**
 * Which provider a consumer is bound to when a name has more than one owner.
 *
 * Shared with `referee-context`, which tells the session whose definition to
 * implement against. The two used to disagree — this picked the first in draft
 * order, that one the last in ticket-id order — so a consumer could be blocked
 * on one ticket and handed a different, contradicting ticket's note. The
 * ambiguity is a failure of its own, which holds approval (A-1⁷); what must not
 * vary is WHICH answer the two halves of the system give while it stands.
 */
export function resolveOwner(providers: readonly string[], self: string): string | undefined {
  return [...providers].filter((p) => p !== self).sort()[0];
}

export function applyContracts(
  input: readonly DraftedTicket[],
  /**
   * C-2‴ slice order, earliest first. Defaulting this to "no ordering" would
   * be fail-OPEN — a caller that forgot it would silently get backwards edges
   * and the deadlock they cause — so when it is absent the order is derived
   * from the tickets themselves, which `planSlices` emits slice by slice.
   */
  sliceOrder: readonly string[] = [],
  /** Names already provided by DONE work this plan no longer redrafts. */
  external: readonly string[] = [],
  /**
   * A-1⁵ (PRDR-201): what SLICE ASSIGNED, so coverage can be decided.
   *
   * Absent means "not checkable" and is silent, which is not fail-open the way
   * an absent `sliceOrder` would be: there is nothing in the tickets to derive
   * an assignment from, so a caller without the specs genuinely cannot ask this
   * question. `checkPlan`, its one production caller, passes it (A-1⁷).
   */
  assigned: readonly SliceSpec[] = [],
  /**
   * A-1⁶ (PRDR-206): the files the bootstrap's scaffold creates, owned by the
   * bootstrap ticket. Undefined in brownfield — there is no bootstrap.
   */
  scaffold?: { readonly owner: string; readonly files: readonly string[] },
): ContractResult {
  const findings: CheckFailure[] = [];
  const derived: { consumer: string; provider: string; contract: string }[] = [];
  const sliceOf = new Map(input.map((t) => [t.id, t.slice]));

  /** ---- the provider index, and what two owners of one name means ---------- */
  const owners = new Map<string, string[]>();
  for (const t of input) {
    for (const p of t.provides) owners.set(contractKey(p), [...(owners.get(contractKey(p)) ?? []), t.id]);
  }
  for (const [key, ids] of [...owners].sort(([a], [b]) => a.localeCompare(b))) {
    if (ids.length < 2) continue;
    const kind = key.slice(0, key.indexOf(":"));
    const name = key.slice(key.indexOf(":") + 1);
    const finding =
      kind === "file"
        ? `${ids.join(" and ")} each claim to own the ${NOUN[kind] ?? kind} \`${name}\`; a file two tickets both create is a conflict at run time, so one must own it and the others consume it`
        : `${ids.join(" and ")} both provide the ${NOUN[kind] ?? kind} \`${name}\` — two definitions of one name, and nothing says which the consumers get`;
    /* A-1⁷: one failure for each owner's slice, each naming that slice's first owner, since each slice is sent it. */
    const bySlice = new Map<string, string>();
    for (const id of ids) if (!bySlice.has(sliceOf.get(id) ?? "")) bySlice.set(sliceOf.get(id) ?? "", id);
    for (const [slice, owner] of bySlice) {
      findings.push({ tag: "coherence", ticket: owner, finding, check: "contracts", slice, key: `contracts:two-providers:${key}:${slice}` });
    }
  }

  /** ---- what each ticket leans on, and whether the plan guarantees it ------ */
  const edges = new Map<string, Set<string>>(input.map((t) => [t.id, new Set(t.depends_on)]));
  const order = sliceOrder.length > 0 ? sliceOrder : [...new Set(input.map((t) => t.slice))];
  const rank = new Map(order.map((id, i) => [id, i]));
  const settled = new Set(external);
  /** A slice's own order is the plan's; a ticket cannot be pushed behind work that comes after it. */
  const later = (consumer: string, provider: string): boolean => {
    const a = rank.get(sliceOf.get(consumer) ?? "");
    const b = rank.get(sliceOf.get(provider) ?? "");
    return a !== undefined && b !== undefined && b > a;
  };

  /* Deterministic order: the same plan derives the same edges, every time (C-8). */
  const scaffoldFiles = new Set(scaffold?.files ?? []);
  for (const t of input) {
    for (const c of t.consumes) {
      const key = contractKey(c);
      /**
       * A-1⁶ (PRDR-206): a file the bootstrap's scaffold creates is provided
       * by the bootstrap, which every ticket already blocks on (C-4) — so it is
       * neither a finding nor an edge worth deriving. Only files the analysis
       * NAMED; a file that merely sounds like a scaffold's is judged as before.
       */
      if (c.kind === "file" && scaffoldFiles.has(c.id)) continue;
      const providers = owners.get(key) ?? [];
      if (providers.length === 0) {
        /* Work already finished still owns its names, even when this plan no longer redrafts it. */
        if (settled.has(key)) continue;
        findings.push({ tag: "dependency", ticket: t.id, finding: unownedMessage(c), check: "contracts", slice: t.slice, key: `contracts:unowned:${key}:${t.slice}`, unowned: key });
        continue;
      }
      const provider = resolveOwner(providers, t.id);
      if (provider === undefined) continue;

      /**
       * The slices are ordered, and an edge backwards through that order is a
       * plan defect, not an omission to fix silently. Deriving it produced a
       * deadlock in the ordinary case: an early ticket needing a key a later
       * slice defines got blocked on that slice, while `capstoneBlockers`
       * blocked the later slice on the earlier one. Both tickets READY, neither
       * ever claimable, and nothing said so.
       */
      if (later(t.id, provider)) {
        findings.push({
          tag: "dependency",
          ticket: t.id,
          finding: `consumes the ${NOUN[c.kind] ?? c.kind} \`${c.id}\` from ${provider}, which the plan puts in a LATER slice (${sliceOf.get(provider)} after ${sliceOf.get(t.id)}) — either the name belongs earlier or this ticket belongs later; no edge was added, because one backwards would deadlock both slices`,
          check: "contracts",
          slice: t.slice,
          key: `contracts:later:${key}:${t.slice}`,
        });
        continue;
      }
      if (reaches(edges, t.id, provider)) continue;

      /*
       * An edge that closes a loop is a contradiction, not an omission — and
       * this is checked against the accumulated graph, so a pair or a ring of
       * mutually-consuming tickets is caught on the edge that would close it.
       */
      if (reaches(edges, provider, t.id)) {
        findings.push({
          tag: "dependency",
          ticket: t.id,
          finding: `consumes the ${NOUN[c.kind] ?? c.kind} \`${c.id}\` from ${provider}, but ${provider} already depends on ${t.id} — the two tickets need each other, so one of them owns the wrong half`,
          check: "graph",
          slice: t.slice,
          key: `graph:refused:${key}:${t.slice}`,
        });
        continue;
      }
      edges.get(t.id)?.add(provider);
      derived.push({ consumer: t.id, provider, contract: key });
    }
  }

  const tickets = input.map((t) => ({ ...t, depends_on: [...(edges.get(t.id) ?? new Set(t.depends_on))] }));
  /**
   * A-1⁵ (PRDR-201): coverage, decided.
   *
   * Last, because it reads the tickets as they will be written and asks a
   * question nothing above it touches: did what SLICE assigned actually land.
   * Set membership over two declared lists — no session, no judgement, and no
   * reading of prose, which is the whole point. A strict read of the prose
   * convention accused a complete fifteen-slice plan of dropping CI, the
   * runbook, traceability and the golden path; a loose one counted a non-goal
   * naming an item as EXCLUDED as coverage of it.
   *
   * A-1⁷ (PRDR-293): a slice whose tickets declare nothing fails for each item
   * it was assigned. That was reported as "undeclared" instead, to spare a slice
   * cached before the fields existed a false accusation; a failure is now sent
   * to a redraft, which is what the report asked the operator to do, and every
   * slice cached before PLAN's prompt changed misses its key and is planned
   * again.
   */
  for (const slice of assigned) {
    const own = tickets.filter((t) => t.slice === slice.id);
    /* Not planned yet — C-2‴ plans slice by slice, and an unplanned slice is not a gap. */
    if (own.length === 0) continue;
    const wants = [
      ...slice.baseline_items.map((id) => ({ id, kind: "baseline item", field: "baseline_ids" })),
      ...slice.requirement_ids.map((id) => ({ id, kind: "requirement", field: "requirement_ids" })),
    ];
    const sourced = new Set(own.flatMap((t) => [...t.requirement_ids, ...t.baseline_ids]));
    for (const want of wants) {
      if (sourced.has(want.id)) continue;
      findings.push({
        tag: "coverage",
        finding: `${slice.id} was assigned ${want.kind} ${want.id}, and no ticket in it names ${want.id} in its \`${want.field}\``,
        check: "coverage",
        slice: slice.id,
        key: `coverage:${slice.id}:${want.id}`,
      });
    }
  }

  return { tickets, findings, derived };
}

/**
 * C-4⁵ (PRDR-292): where the pack catalogues a kind, its catalogue ids are the
 * names in `provides` and `consumes`, so a contract has one spelling. A name of
 * such a kind that the catalogue does not hold is a contract finding. A kind
 * the pack catalogues nothing of is named freely, and without a pack nothing
 * is catalogued.
 */
export function catalogueFindings(tickets: readonly DraftedTicket[], pack: Pack | null): CheckFailure[] {
  if (pack === null) return [];
  const catalogued = catalogueIds(pack);
  const findings: CheckFailure[] = [];
  for (const t of tickets) {
    for (const [verb, names] of [["provides", t.provides], ["consumes", t.consumes]] as const) {
      for (const c of names) {
        const ids = catalogued[c.kind];
        if (ids === undefined || ids.includes(c.id)) continue;
        const noun = NOUN[c.kind] ?? c.kind;
        findings.push({
          tag: "traceability",
          ticket: t.id,
          finding: `${verb} \`${contractKey(c)}\`, and the pack's catalogue holds no ${noun} \`${c.id}\` — a ${noun} is named by its catalogue id, so the ticket names another or the catalogue lacks one`,
          check: "contracts",
          slice: t.slice,
          key: `contracts:catalogue:${contractKey(c)}:${t.slice}`,
        });
      }
    }
  }
  return findings;
}

function unownedMessage(c: ContractConsume): string {
  const noun = NOUN[c.kind] ?? c.kind;
  return c.kind === "file"
    ? `consumes the ${noun} \`${c.id}\`, which no ticket creates — either a ticket must own it or this one does`
    : `consumes the ${noun} \`${c.id}\`, and no ticket in the plan provides it — the work it depends on is either missing or unowned`;
}
