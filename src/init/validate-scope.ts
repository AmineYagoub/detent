import { readFileSync } from "node:fs";
import path from "node:path";
import { CRITERION_REF, DECISION_LOG_PATH, FACTS_PATH, REQUIREMENT_REFS, adrIdOf, isModulePrd, packKindOf, type Pack } from "../schemas/pack.js";
import { DECISION_REF, FACT_REF, LINK, SECTION_REF, resolve, safeDecode, stemOf } from "./pack-check-refs.js";
import { namedRequirements } from "./pack-parse.js";

/**
 * C-2⁶, C-2¹⁴ (PRDR-284) — what a review round reads: the pack's areas, and
 * the documents a change reaches.
 *
 * An area is the index's own: the `Area` of each `## Codes` row holds the
 * module PRDs its codes name, and a module PRD no row names is an area of its
 * own. ksarjs's five areas were ksarjs's, so none is fixed here. The pack's
 * foundations, the decision log, the facts, design, the ADRs and the index,
 * are one area more, and the first: every reviewer reads them before its own
 * documents, since a disagreement with them is a defect in the lower document.
 */

export const FOUNDATIONS = "foundations";

export interface Area {
  readonly name: string;
  readonly documents: readonly string[];
}

/** A document the pack's layout holds, which a round reviews. A context document is not the pack's to fix, and one at no path the layout holds is the checker's. */
export const reviewable = (rel: string): boolean => {
  const kind = packKindOf(rel);
  return kind !== null && kind !== "context";
};

/** The foundations, then each area the index names, in its order, then each module PRD it does not register. */
export function areasOf(pack: Pack, docs: readonly string[]): Area[] {
  const typed = docs.filter(reviewable);
  const byName = new Map<string, string[]>();
  const placed = new Set<string>();
  const place = (name: string, rel: string): void => {
    if (placed.has(rel)) return;
    placed.add(rel);
    byName.set(name, [...(byName.get(name) ?? []), rel]);
  };
  for (const code of pack.codes) {
    const rel = `docs/prd/${code.prd}`;
    if (typed.includes(rel)) place(code.area, rel);
  }
  for (const rel of typed.filter(isModulePrd)) place(stemOf(rel), rel);
  return [{ name: FOUNDATIONS, documents: typed.filter((rel) => !isModulePrd(rel)) }, ...[...byName].map(([name, documents]) => ({ name, documents }))].filter(
    (a) => a.documents.length > 0,
  );
}

/** The index of the area that holds `rel`, or -1. */
export const areaOf = (areas: readonly Area[], rel: string): number => areas.findIndex((a) => a.documents.includes(rel));

const matches = (text: string, pattern: RegExp): RegExpExecArray[] => [...text.matchAll(new RegExp(pattern.source, "gu"))];

/**
 * The documents that cite what `changed` holds: a requirement or criterion
 * one of them defines, a section of one by its name, or the file itself by a
 * link. The decision log and the facts are cited by their entries' ids, and
 * a record keeps no earlier copy to say which entries moved, so an edit to
 * either reaches every document that cites any entry of it.
 */
export function citing(root: string, pack: Pack, docs: readonly string[], changed: readonly string[]): string[] {
  const moved = new Set(changed);
  const ids = new Set([...pack.requirements, ...pack.criteria].filter((e) => moved.has(e.file)).map((e) => e.id));
  const names = new Set(changed.flatMap((rel) => [stemOf(rel), adrIdOf(rel)].filter((n): n is string => n !== null)));
  const log = moved.has(DECISION_LOG_PATH);
  const facts = moved.has(FACTS_PATH);
  const cites = (rel: string, text: string): boolean =>
    matches(text, REQUIREMENT_REFS).some((m) => namedRequirements(m[0]).some((id) => ids.has(id))) ||
    matches(text, CRITERION_REF).some((m) => ids.has(m[0])) ||
    (log && DECISION_REF.test(text)) ||
    (facts && FACT_REF.test(text)) ||
    matches(text, SECTION_REF).some((m) => names.has(m[1] ?? "")) ||
    matches(text, LINK).some((m) => {
      const to = resolve(rel, safeDecode(m[1] ?? ""));
      return to !== null && moved.has(to);
    });
  return docs.filter((rel) => reviewable(rel) && !moved.has(rel) && cites(rel, readFileSync(path.join(root, ...rel.split("/")), "utf8")));
}

/** A round's scope: the pack's documents among `changed`, and whatever cites them (C-2⁷). */
export function scopeOf(root: string, pack: Pack, docs: readonly string[], changed: Iterable<string>): string[] {
  const within = [...new Set(changed)].filter((rel) => docs.includes(rel) && reviewable(rel));
  return [...new Set([...within, ...citing(root, pack, docs, within)])].sort();
}
