import { contractKey, type ContractConsume, type PlanReview } from "../schemas/init.js";
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
 */

export interface ContractResult {
  /** The tickets, with derived edges applied. */
  readonly tickets: DraftedTicket[];
  readonly findings: PlanReview["findings"];
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

export function applyContracts(input: readonly DraftedTicket[]): ContractResult {
  const findings: PlanReview["findings"] = [];
  const derived: { consumer: string; provider: string; contract: string }[] = [];

  /** ---- the provider index, and what two owners of one name means ---------- */
  const owners = new Map<string, string[]>();
  for (const t of input) {
    for (const p of t.provides) owners.set(contractKey(p), [...(owners.get(contractKey(p)) ?? []), t.id]);
  }
  for (const [key, ids] of [...owners].sort(([a], [b]) => a.localeCompare(b))) {
    if (ids.length < 2) continue;
    const kind = key.slice(0, key.indexOf(":"));
    const name = key.slice(key.indexOf(":") + 1);
    findings.push({
      tag: "coherence",
      ticket: ids[0] as string,
      finding:
        kind === "file"
          ? `${ids.join(" and ")} each claim to own the ${NOUN[kind] ?? kind} \`${name}\`; a file two tickets both create is a conflict at run time, so one must own it and the others consume it`
          : `${ids.join(" and ")} both provide the ${NOUN[kind] ?? kind} \`${name}\` — two definitions of one name, and nothing says which the consumers get`,
    });
  }

  /** ---- what each ticket leans on, and whether the plan guarantees it ------ */
  const edges = new Map<string, Set<string>>(input.map((t) => [t.id, new Set(t.depends_on)]));

  /* Deterministic order: the same plan derives the same edges, every time (C-8). */
  for (const t of input) {
    for (const c of t.consumes) {
      const key = contractKey(c);
      const providers = owners.get(key) ?? [];
      if (providers.length === 0) {
        findings.push({ tag: "dependency", ticket: t.id, finding: unownedMessage(t.id, c) });
        continue;
      }
      const provider = providers.find((p) => p !== t.id);
      if (provider === undefined) continue;
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
        });
        continue;
      }
      edges.get(t.id)?.add(provider);
      derived.push({ consumer: t.id, provider, contract: key });
    }
  }

  const tickets = input.map((t) => ({ ...t, depends_on: [...(edges.get(t.id) ?? new Set(t.depends_on))] }));
  return { tickets, findings, derived };
}

function unownedMessage(id: string, c: ContractConsume): string {
  const noun = NOUN[c.kind] ?? c.kind;
  return c.kind === "file"
    ? `consumes the ${noun} \`${c.id}\`, which no ticket creates — either a ticket must own it or this one does`
    : `consumes the ${noun} \`${c.id}\`, and no ticket in the plan provides it — the work it depends on is either missing or unowned`;
}
