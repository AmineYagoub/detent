import { createHash } from "node:crypto";
import type { DecideArtifact, DecideDefault, DecideQuestion } from "../schemas/decide.js";
import type { LogView } from "./decide-log.js";

/**
 * C-2¹² (PRDR-282) — what DECIDE sorts, and the checks code makes of the
 * sorting.
 *
 * An item is what AUDIT left open: a contradiction, a gap, a drift from the
 * code, or an external claim that is wrong or unverified, all places of one
 * claim being one item since they share one verdict. In greenfield with no
 * stack in the decision log, the stack is an item too (D-10′). A confirmed
 * claim is not open.
 *
 * Each item has an id for the session (`C1`, `G1`, `R1`, `K1`, `stack`), which
 * only this run's inputs define, and a content key, which names it across runs:
 * DECIDE's record maps the key to the entry that settled the item.
 */

type Json = Record<string, unknown>;

/**
 * C-3‴ (PRDR-207) — one question, asked once.
 *
 * gate-313 asked the founder which npm identity publishes Detent at ANALYZE,
 * and again, in s14's own words, at PLAN: two paid assumptions, two answers.
 * Two questions whose vocabularies overlap past a threshold are one question.
 * No planning stage asks now (C-3⁗), so DECIDE is the one reader: it refuses a
 * question the decision log already answers in other words. It moved here
 * from `questions.ts`, which held nothing else once PRESENT's merge was gone
 * (C-7‴, C-3⁵).
 *
 * Tokens are lowercase runs of letters and digits at least four long — long
 * enough to drop "the", "and", "for", "npm", short enough to keep "identity",
 * "publishes", "marketplace", "credential", and "which" too, so two questions
 * that share only their first word share one token. Jaccard over the sets.
 * gate-313's pair scores well above the threshold; its two other founder
 * questions, both beginning "Which …", score well below it.
 */
export const QUESTION_SIMILARITY = 0.5;

const questionTokens = (question: string): Set<string> => new Set(question.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);

export function similarQuestions(a: string, b: string): boolean {
  const ta = questionTokens(a);
  const tb = questionTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared) >= QUESTION_SIMILARITY;
}

export interface Item {
  readonly id: string;
  readonly key: string;
  readonly kind: "contradiction" | "gap" | "drift" | "claim" | "stack";
  /** What the session is shown, id and kind included. */
  readonly shown: Json;
  /** One line for a note. */
  readonly summary: string;
}

const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const squash = (text: string): string => text.replace(/\s+/gu, " ").trim();
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter((v): v is Json => typeof v === "object" && v !== null) : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const quoteOf = (p: unknown): string => {
  const passage = (p ?? {}) as Json;
  return `${text(passage["file"])}\0${squash(text(passage["quote"]))}`;
};

/**
 * The key of each kind reads what stays when the survey is run again over the
 * same documents: quotes, which code checked against the documents, rather than
 * line numbers or the survey's own words, except for a gap, which is often a
 * silence and has only its topic.
 */
export function openItems(audit: Json | undefined, opts: { readonly stackOpen: boolean }): Item[] {
  const items: Item[] = [];
  const add = (prefix: string, kind: Item["kind"], key: unknown[], shown: Json, summary: string): void => {
    const id = `${prefix}${String(items.filter((i) => i.kind === kind).length + 1)}`;
    items.push({ id, key: hash([kind, ...key]), kind, shown: { id, kind, ...shown }, summary });
  };
  for (const c of list(audit?.["contradictions"])) {
    add("C", "contradiction", list(c["passages"]).map(quoteOf).sort(), c, text(c["topic"]));
  }
  for (const g of list(audit?.["gaps"])) add("G", "gap", [squash(text(g["topic"])).toLowerCase()], g, text(g["topic"]));
  for (const d of list(audit?.["drift"])) {
    const code = Array.isArray(d["code_checked"]) ? [...(d["code_checked"] as unknown[])].map(text).sort() : [];
    add("R", "drift", [quoteOf(d["passage"]), code], d, text(d["finding"]));
  }
  const claims = new Map<string, Json[]>();
  for (const c of list(audit?.["claims"])) {
    if (c["verdict"] === "confirmed") continue;
    const places = claims.get(text(c["claim_hash"])) ?? [];
    places.push(c);
    claims.set(text(c["claim_hash"]), places);
  }
  for (const [claimHash, places] of claims) {
    const first = places[0] ?? {};
    /* One item for every place the documents rely on the claim; the places travel with it. */
    const shown = Object.fromEntries(Object.entries(first).filter(([field]) => field !== "passage"));
    add(
      "K",
      "claim",
      [claimHash, first["verdict"], first["correction"] ?? null],
      { ...shown, places: places.map((p) => p["passage"]) },
      `${text(first["claim"])} (${text(first["verdict"])})`,
    );
  }
  if (opts.stackOpen) items.push({ id: "stack", key: hash(["stack"]), kind: "stack", shown: { id: "stack", kind: "stack" }, summary: "the stack" });
  return items;
}

export interface DecideCheck {
  /** Empty when the artifact sorts every item once and cites only what exists. */
  readonly issues: readonly string[];
  /** The artifact with what could not stand taken out. */
  readonly kept: DecideArtifact;
  /** Items that no question, default or cited entry settles. */
  readonly unsorted: readonly Item[];
}

const stackIn = (q: DecideQuestion): number => q.options.filter((o) => o.stack !== undefined).length;

/**
 * Check a DECIDE artifact against the items it was given and the log. Every
 * item is settled once, by a question, a default or an entry the log holds;
 * every id it names is one of the items; only the stack's settler carries a
 * stack, whole; and no question is one the log already answers, in the words
 * C-3‴ can compare. What fails is named in `issues` and taken out of `kept`,
 * and an item left with no settler is `unsorted`.
 */
export function checkDecide(artifact: DecideArtifact, items: readonly Item[], log: LogView): DecideCheck {
  const issues: string[] = [];
  const known = new Map(items.map((i) => [i.id, i]));
  const owner = new Map<string, string>();
  /** Claim each id for `who`; the ids that are unknown or already claimed are refused. */
  const claim = (ids: readonly string[], who: string): string[] =>
    ids.filter((id) => {
      if (!known.has(id)) {
        issues.push(`${who} names ${id}, which is not an item in your inputs`);
        return false;
      }
      const first = owner.get(id);
      if (first !== undefined) {
        issues.push(`${id} is settled twice, by ${first} and by ${who}; each item is settled once`);
        return false;
      }
      owner.set(id, who);
      return true;
    });
  const stackOpen = known.has("stack");

  const settled = artifact.settled.filter((s) => {
    if (!log.ids.has(s.entry)) {
      issues.push(`settled cites ${s.entry} for ${s.item}, and the decision log has no entry ${s.entry}`);
      return false;
    }
    return claim([s.item], `the log's ${s.entry}`).length === 1;
  });
  const answeredBy = (question: string): LogView["decisions"][number] | undefined =>
    log.decisions.find((d) => similarQuestions(d.question, question));

  const questions: DecideQuestion[] = [];
  artifact.questions.forEach((q, n) => {
    const who = `question ${String(n + 1)}`;
    const answered = answeredBy(q.question);
    if (answered !== undefined) {
      /* Kept as what it is: its items are the log's to settle, since the log answers it. */
      issues.push(`${who} ("${q.question}") is one the decision log already answers, as ${answered.id}; cite it in settled instead (C-3‴)`);
      for (const item of claim(q.settles.filter((id) => id !== "stack"), `the log's ${answered.id}`)) settled.push({ item, entry: answered.id });
      return;
    }
    const stacks = stackIn(q);
    if (stacks !== 0 && (stacks !== q.options.length || !q.settles.includes("stack") || !stackOpen)) {
      issues.push(`${who} carries a stack, which only the question that settles the open stack does, on every option (D-10′)`);
      return;
    }
    if (stacks === 0 && q.settles.includes("stack")) {
      issues.push(`${who} settles the stack without a stack on each option (D-10′)`);
      return;
    }
    const ids = claim(q.settles, who);
    if (ids.length > 0) questions.push({ ...q, settles: ids });
  });

  const defaults: DecideDefault[] = [];
  artifact.defaults.forEach((d, n) => {
    const who = `default ${String(n + 1)}`;
    const carries = d.stack !== undefined;
    if (carries !== d.settles.includes("stack") || (carries && !stackOpen)) {
      issues.push(`${who} ${carries ? "carries a stack but does not settle the open stack" : "settles the stack without carrying one"} (D-10′)`);
      return;
    }
    const ids = claim(d.settles, who);
    if (ids.length > 0) defaults.push({ ...d, settles: ids });
  });

  const unsorted = items.filter((i) => !owner.has(i.id));
  if (unsorted.length > 0) {
    issues.push(`${String(unsorted.length)} item(s) settled by nothing: ${unsorted.map((i) => i.id).join(", ")}; every item is asked, defaulted or cited as settled`);
  }
  return { issues, kept: { ...artifact, questions, defaults, settled }, unsorted };
}
