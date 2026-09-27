import { existsSync } from "node:fs";
import path from "node:path";
import { contractKey, type ContractKind, type SliceSpec } from "../schemas/init.js";
import { CATALOGUE_KINDS, CATALOGUES_PATH, type CatalogueKind, type Pack } from "../schemas/pack.js";
import { catalogueEntriesUsed, DECISION_REF, FACT_REF } from "./pack-check-refs.js";
import { readLines } from "./pack-markdown.js";
import type { DraftedTicket } from "./plan-write.js";

/**
 * C-4⁵ (PRDR-292) — what a PLAN session drafts from on a pack.
 *
 * It read whole documents, prose around the requirements included, and
 * re-derived from them what the checker's parse already states as data. It is
 * handed the parse of its slice's records instead: each live requirement of
 * the slice, the criteria that test them, and the decisions, defaults, facts
 * and catalogue entries they cite, read as the checker reads a citation. The
 * slice's cache key hashes the same records (`slice-key.ts`), so what a draft
 * reads and what re-plans it are one thing (C-2⁸).
 */

export interface SliceRecords {
  readonly requirements: readonly { readonly id: string; readonly milestone: number | null; readonly level: string | null; readonly tags: readonly string[]; readonly text: string }[];
  readonly criteria: readonly {
    readonly id: string;
    readonly milestone: number | null;
    readonly requirements: readonly string[];
    readonly tags: readonly string[];
    readonly given: string;
    readonly when: string;
    readonly then: string;
    /** The words a ticket carrying it copies into its acceptance criteria. */
    readonly text: string;
  }[];
  readonly decisions: readonly { readonly id: string; readonly question: string; readonly answer: string; readonly reason: string }[];
  readonly defaults: readonly { readonly id: string; readonly value: string; readonly reason: string }[];
  readonly facts: readonly { readonly id: string; readonly fact: string; readonly source: string; readonly tag: string }[];
  readonly catalogue_entries: readonly { readonly kind: CatalogueKind; readonly id: string; readonly row: string }[];
}

/**
 * A criterion's words, as a ticket carries it: its id, then Given, When and
 * Then as the parse split them. Built from the parse rather than the bullet's
 * text, so a criterion rewrapped in its document carries the same words.
 */
export const criterionText = (c: Pack["criteria"][number]): string => `${c.id}: Given ${c.given}, when ${c.when}, then ${c.then}.`;

/** The records of `ids`: withdrawn ones and ones the pack does not define are not among them. */
export function sliceRecords(root: string, pack: Pack, ids: readonly string[]): SliceRecords {
  const live = ids.flatMap((id) => pack.requirements.filter((r) => r.id === id && !r.withdrawn));
  const own = new Set(live.map((r) => r.id));
  const criteria = pack.criteria.filter((c) => c.requirements.some((id) => own.has(id)));
  const text = [...live.map((r) => r.text), ...criteria.map((c) => `${c.given} ${c.when} ${c.then}`)].join("\n");
  const cited = new Set([...text.matchAll(new RegExp(DECISION_REF.source, "gu"))].map((m) => m[0]));
  const rows = catalogueRows(root);
  return {
    requirements: live.map((r) => ({ id: r.id, milestone: r.milestone, level: r.level, tags: r.tags, text: r.text })),
    criteria: criteria.map((c) => ({ id: c.id, milestone: c.milestone, requirements: c.requirements, tags: c.tags, given: c.given, when: c.when, then: c.then, text: criterionText(c) })),
    decisions: pack.decisions.filter((d) => cited.has(d.id)).map((d) => ({ id: d.id, question: d.question, answer: d.answer, reason: d.reason })),
    defaults: pack.defaults.filter((d) => cited.has(d.id)).map((d) => ({ id: d.id, value: d.value, reason: d.reason })),
    facts: citedFacts(pack, text).map((f) => ({ id: f.id, fact: f.fact, source: f.source, tag: f.tag })),
    catalogue_entries: catalogueEntriesUsed(pack, text).map((e) => ({ kind: e.kind, id: e.id, row: rows().get(e.line) ?? "" })),
  };
}

/** The contract kind that names each kind a catalogue lists (A-1‴). */
export const CATALOGUE_CONTRACTS: Readonly<Record<CatalogueKind, ContractKind>> = {
  error_codes: "error_code",
  events: "event",
  settings: "setting",
  jobs: "job",
  routes: "route",
};

/**
 * Each catalogue's ids, under the contract kind that names them, for every
 * kind the pack catalogues at least one of. A kind it catalogues nothing of is
 * absent, and its names are free.
 */
export function catalogueIds(pack: Pack): Partial<Record<ContractKind, string[]>> {
  const out: Partial<Record<ContractKind, string[]>> = {};
  for (const kind of CATALOGUE_KINDS) {
    const ids = pack.catalogues[kind].map((e) => e.id);
    if (ids.length > 0) out[CATALOGUE_CONTRACTS[kind]] = ids;
  }
  return out;
}

/**
 * The tickets of the slices `slice` builds on: the ones it names in
 * `depends_on`, and the ones those name, each with its id, title, surface and
 * what it provides as `kind:id`. A draft was shown every earlier ticket
 * without what it provides, and 56 of 60 drafting sessions read Detent's state
 * files to find the names.
 */
export function dependencyIndex(
  slice: SliceSpec,
  slices: readonly SliceSpec[],
  planned: readonly DraftedTicket[],
): { readonly id: string; readonly title: string; readonly surface: readonly string[]; readonly provides: readonly string[] }[] {
  const reached = new Set<string>();
  const visit = (id: string): void => {
    for (const dep of slices.find((s) => s.id === id)?.depends_on ?? []) {
      if (reached.has(dep)) continue;
      reached.add(dep);
      visit(dep);
    }
  };
  visit(slice.id);
  return planned.filter((t) => reached.has(t.slice)).map((t) => ({ id: t.id, title: t.title, surface: t.surface, provides: t.provides.map((p) => contractKey(p)) }));
}

/** The catalogue's rows by line, read once and only when an entry is cited: the parse keeps an entry's id and line, not its row. */
function catalogueRows(root: string): () => ReadonlyMap<number, string> {
  let rows: Map<number, string> | null = null;
  return () => {
    rows ??= existsSync(path.join(root, ...CATALOGUES_PATH.split("/"))) ? new Map(readLines(root, CATALOGUES_PATH).map((l) => [l.n, l.text])) : new Map<number, string>();
    return rows;
  };
}

/** `N.M` as a pair, and a bare section `N` as the first (`low`) or the last (`high`) fact under it. */
function factAt(id: string, end: "low" | "high"): readonly [number, number] {
  const [n = "0", m] = id.split(".");
  return [Number(n), m === undefined ? (end === "low" ? 0 : Number.POSITIVE_INFINITY) : Number(m)];
}

const before = (a: readonly [number, number], b: readonly [number, number]): boolean => a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]);

/** The facts `text` cites as the checker reads a citation: `facts §N.M`, a section `§N`, or a range between two. */
function citedFacts(pack: Pack, text: string): Pack["facts"] {
  const out = new Set<Pack["facts"][number]>();
  for (const m of text.matchAll(new RegExp(FACT_REF.source, "gu"))) {
    const from = m[1] ?? "";
    const low = factAt(from, "low");
    const high = factAt(m[2] ?? from, "high");
    for (const f of pack.facts) if (before(low, factAt(f.id, "low")) && before(factAt(f.id, "low"), high)) out.add(f);
  }
  return [...out];
}
