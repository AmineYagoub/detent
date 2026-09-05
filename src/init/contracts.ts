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

/** Everything reachable from `id` through declared edges — who is already guaranteed to come first. */
function ancestry(tickets: readonly DraftedTicket[]): Map<string, Set<string>> {
  const edges = new Map(tickets.map((t) => [t.id, t.depends_on]));
  const memo = new Map<string, Set<string>>();
  const walk = (id: string, seen: Set<string>): Set<string> => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) return new Set();
    seen.add(id);
    const out = new Set<string>();
    for (const dep of edges.get(id) ?? []) {
      out.add(dep);
      for (const up of walk(dep, seen)) out.add(up);
    }
    memo.set(id, out);
    return out;
  };
  return new Map(tickets.map((t) => [t.id, walk(t.id, new Set())]));
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
  const reachable = ancestry(input);
  const edgesToAdd = new Map<string, Set<string>>();

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
      if (reachable.get(t.id)?.has(provider) === true) continue;

      /* An edge that closes a loop is a contradiction, not an omission. */
      if (reachable.get(provider)?.has(t.id) === true) {
        findings.push({
          tag: "dependency",
          ticket: t.id,
          finding: `consumes the ${NOUN[c.kind] ?? c.kind} \`${c.id}\` from ${provider}, but ${provider} already depends on ${t.id} — the two tickets need each other, so one of them owns the wrong half`,
        });
        continue;
      }
      edgesToAdd.set(t.id, new Set([...(edgesToAdd.get(t.id) ?? []), provider]));
      derived.push({ consumer: t.id, provider, contract: key });
    }
  }

  const tickets = input.map((t) => {
    const add = edgesToAdd.get(t.id);
    return add === undefined ? { ...t } : { ...t, depends_on: [...new Set([...t.depends_on, ...add])] };
  });
  return { tickets, findings, derived };
}

function unownedMessage(id: string, c: ContractConsume): string {
  const noun = NOUN[c.kind] ?? c.kind;
  return c.kind === "file"
    ? `consumes the ${noun} \`${c.id}\`, which no ticket creates — either a ticket must own it or this one does`
    : `consumes the ${noun} \`${c.id}\`, and no ticket in the plan provides it — the work it depends on is either missing or unowned`;
}
