import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import type { SliceSpec } from "../schemas/init.js";
import { CATALOGUES_PATH, type Pack } from "../schemas/pack.js";
import { PRODUCTION_BASELINE } from "./baseline.js";
import { contentsDigest } from "./machine.js";
import { catalogueEntriesUsed, DECISION_REF, FACT_REF } from "./pack-check-refs.js";
import { readLines } from "./pack-markdown.js";
import type { PlanDeps } from "./plan.js";
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
 * session budget; and the prompt. The model's words are in none of it.
 *
 * On a pack, what the ids say is each requirement's record from the checker's
 * parse: its text, milestone and level, its criteria, and the decisions,
 * defaults, facts and catalogue entries it and its criteria cite. So an edit
 * to one requirement re-plans its own slice, and a veto the slices whose
 * requirements cite what it edits (C-3⁗). Until PLAN drafts from those records
 * alone (C-4⁵), its session still reads whole documents, and an edit to text
 * no record holds re-plans nothing. Without a parse, what the ids say is the
 * contents of the documents the slice plans from, as C-8‴ keyed it.
 *
 * The earlier index matters only where this slice reached into it, and that
 * is checked separately as `external_deps`, precisely and without cascading.
 */
export function sliceKey(deps: PlanDeps, slice: SliceSpec): string {
  const ids = [...slice.requirement_ids].sort();
  const items = [...slice.baseline_items].sort();
  const read =
    deps.pack === undefined || deps.pack === null
      ? contentsDigest(deps.root, slice.docs.length > 0 ? slice.docs : deps.docs)
      : recordsOf(deps.root, deps.pack, ids);
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

/**
 * Each requirement's record, as arrays so no key order can move the hash,
 * and without its place: a requirement moved down a line says the same.
 */
function recordsOf(root: string, pack: Pack, ids: readonly string[]): unknown[] {
  const rows = catalogueRows(root);
  return ids.map((id) => {
    const r = pack.requirements.find((x) => x.id === id && !x.withdrawn);
    if (r === undefined) return [id, null];
    const criteria = pack.criteria.filter((c) => c.requirements.includes(id)).sort((a, b) => a.id.localeCompare(b.id));
    const text = [r.text, ...criteria.map((c) => `${c.given} ${c.when} ${c.then}`)].join("\n");
    const cited = new Set([...text.matchAll(new RegExp(DECISION_REF.source, "gu"))].map((m) => m[0]));
    return [
      [r.id, r.kind, r.milestone, r.level, r.text, r.tags],
      criteria.map((c) => [c.id, c.milestone, c.given, c.when, c.then, c.requirements, c.tags]),
      pack.decisions.filter((d) => cited.has(d.id)).map((d) => [d.id, d.question, d.answer, d.reason]),
      pack.defaults.filter((d) => cited.has(d.id)).map((d) => [d.id, d.value, d.reason]),
      citedFacts(pack, text).map((f) => [f.id, f.fact, f.source, f.tag]),
      catalogueEntriesUsed(pack, text).map((e) => [e.kind, e.id, rows().get(e.line) ?? ""]),
    ];
  });
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
