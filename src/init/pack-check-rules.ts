import { CRITERION_ID, REQUIREMENT_ID, isModulePrd, type Pack, type PackFinding } from "../schemas/pack.js";
import { boldBullets, type Line } from "./pack-markdown.js";
import { namedRequirements } from "./pack-parse.js";

/**
 * C-2⁷, C-2¹⁰ (PRDR-280) — the checker's rules over entries: every id defined
 * once, requirement ids without gaps, the registry obeyed, every requirement
 * tested, milestone order, and the one heuristic. The rules that read text for
 * references live in `pack-check-refs.ts`.
 *
 * A rule reports where the defect is, which is the entry that breaks it: the
 * second definition, the requirement after a gap, the requirement a criterion
 * forgot. `text` is filled in from the line by the checker, so a rule names
 * only the place and what is wrong there.
 */

export interface CheckContext {
  readonly pack: Pack;
  /** The ids of entries the schema refused: defined, though broken, so no rule calls them missing. */
  readonly refused: ReadonlySet<string>;
  /** Every markdown document of the pack, typed and context, as read (fenced lines blank). */
  readonly lines: ReadonlyMap<string, readonly Line[]>;
  /** Paths of the documents the layout types; the rest are context. */
  readonly typed: ReadonlySet<string>;
  /** Whether a repo-relative path exists: the links rule's one look outside the pack. */
  readonly exists: (rel: string) => boolean;
}

interface Place {
  readonly file: string;
  readonly line: number;
}

export const at = (p: Place): string => `${p.file}${p.line > 0 ? `:${String(p.line)}` : ""}`;

export const finding = (rule: string, p: Place, message: string): PackFinding => ({ rule, file: p.file, line: p.line, text: "", message });

/** Code-unit order, never locale order: the output is byte-identical on every machine. */
export const byPlace = (a: Place, b: Place): number => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line);

/* ---------------------------------------------------------------------------
 * Every id is defined exactly once
 */

/**
 * The second and later definitions of each key, each named as written and
 * pointing at the first. The parse keeps entries in document order (its
 * milestone sort is stable), so the first met is the first written.
 */
export function twice<T>(entries: readonly T[], key: (e: T) => string, place: (e: T) => Place, shown: (e: T) => string = key): PackFinding[] {
  const first = new Map<string, Place>();
  const out: PackFinding[] = [];
  for (const entry of entries) {
    const seen = first.get(key(entry));
    if (seen === undefined) first.set(key(entry), place(entry));
    else out.push(finding("unique", place(entry), `\`${shown(entry)}\` is defined twice; first at ${at(seen)}`));
  }
  return out;
}

/** Catalogue entries are the catalogue rule's, which knows that two spellings of a route can be one route. */
export function unique({ pack }: CheckContext): PackFinding[] {
  return [
    ...twice(pack.requirements, (r) => r.id, (r) => r),
    ...twice(pack.criteria, (c) => c.id, (c) => c),
    ...twice(pack.decisions, (d) => d.id, (d) => d),
    ...twice(pack.defaults, (d) => d.id, (d) => d),
    ...twice(pack.facts, (f) => f.id, (f) => f),
    ...twice(pack.codes, (c) => c.code, (c) => c),
    ...twice(pack.milestones, (m) => m.id, (m) => m),
    ...twice(pack.adrs, (a) => a.id, (a) => ({ file: a.file, line: 0 })),
  ];
}

/* ---------------------------------------------------------------------------
 * Requirement ids run from 001 without a gap
 */

const LISTED = 10;

/**
 * A gap is a requirement deleted instead of withdrawn: whatever cited it now
 * cites nothing, and nothing says so. Reported at the first id after the gap.
 * A requirement the schema refused still holds its number.
 */
export function sequence({ pack, refused }: CheckContext): PackFinding[] {
  const numbers = new Map<string, Set<number>>();
  const add = (id: string) => {
    const m = REQUIREMENT_ID.exec(id);
    if (m !== null) numbers.set(`${m[1] ?? ""}-${m[2] ?? ""}`, (numbers.get(`${m[1] ?? ""}-${m[2] ?? ""}`) ?? new Set()).add(Number(m[3])));
  };
  for (const id of [...pack.requirements.map((r) => r.id), ...refused]) add(id);
  const out: PackFinding[] = [];
  for (const [family, held] of numbers) {
    const missing = [...Array(Math.max(...held)).keys()].map((i) => i + 1).filter((n) => !held.has(n));
    const gap = missing[0];
    if (gap === undefined) continue;
    const after = pack.requirements
      .filter((r) => r.id.startsWith(`${family}-`) && Number(r.id.slice(-3)) > gap)
      .sort((a, b) => Number(a.id.slice(-3)) - Number(b.id.slice(-3)))[0];
    if (after === undefined) continue;
    const shown = missing.slice(0, LISTED).map((n) => String(n).padStart(3, "0"));
    const more = missing.length > LISTED ? ` and ${String(missing.length - LISTED)} more` : "";
    out.push(finding("sequence", after, `\`${family}\` ids skip ${shown.join(", ")}${more}; a removed requirement keeps its id, tagged [withdrawn]`));
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * The registry: codes, files and milestones
 */

/**
 * A code's entries live in the PRD the registry names for it, under the
 * milestones it allows. A code whose row the schema refused, or whose PRD
 * does not exist, has its one finding already; its entries are not reported
 * again for it.
 */
export function registry({ pack, refused }: CheckContext): PackFinding[] {
  if (pack.codes.length === 0) return [];
  const codes = new Map<string, Pack["codes"][number]>();
  for (const c of pack.codes) if (!codes.has(c.code)) codes.set(c.code, c);
  const prds = new Set(pack.documents.map((d) => d.path));
  const out: PackFinding[] = [];
  for (const c of codes.values()) {
    if (!prds.has(`docs/prd/${c.prd}`)) out.push(finding("registry", c, `## Codes names ${c.prd} for ${c.code}, and the pack has no docs/prd/${c.prd}`));
  }
  const entries = [
    ...pack.requirements.map((r) => ({ ...r, milestone: r.withdrawn ? null : r.milestone })),
    ...pack.criteria,
  ];
  for (const e of entries) {
    const c = codes.get(e.code);
    if (c === undefined) {
      if (!refused.has(e.code)) out.push(finding("registry", e, `\`${e.id}\`: its code ${e.code} is not registered in docs/prd/index.md ## Codes`));
    } else if (!prds.has(`docs/prd/${c.prd}`)) {
      continue;
    } else if (e.file !== `docs/prd/${c.prd}`) {
      out.push(finding("registry", e, `\`${e.id}\` belongs in docs/prd/${c.prd}, where ## Codes registers ${e.code}`));
    } else if (e.milestone !== null && !c.milestones.includes(e.milestone)) {
      const allowed = c.milestones.map((m) => `M${String(m)}`).join(", ");
      out.push(finding("registry", e, `\`${e.id}\` is tagged [M${String(e.milestone)}]; ## Codes registers ${e.code} for ${allowed}`));
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Every requirement has a criterion
 */

/**
 * Every live requirement is tested. A criterion the schema refused still
 * tests what it names: its own finding says what is wrong with it, and its
 * requirements are not reported a second time as untested.
 */
export function coverage({ pack, refused, lines }: CheckContext): PackFinding[] {
  const broken = pack.documents
    .filter((d) => isModulePrd(d.path))
    .flatMap((d) => boldBullets(lines.get(d.path) ?? []))
    .filter((b) => CRITERION_ID.test(b.head) && refused.has(b.head));
  const tested = new Set([...pack.criteria.flatMap((c) => c.requirements), ...broken.flatMap((b) => namedRequirements(b.rest))]);
  return pack.requirements
    .filter((r) => !r.withdrawn && !tested.has(r.id))
    .map((r) => finding("coverage", r, `\`${r.id}\` is tested by no acceptance criterion`));
}

/* ---------------------------------------------------------------------------
 * Milestone order
 */

/**
 * A criterion never tests what a later milestone delivers: it could not pass
 * at its own. That is the dependency the schema states. Between requirements
 * it states none: a requirement may name a later one to point forward, as to
 * the requirement that will use a hook it provides. PRDR-280's parity run
 * found 47 requirements in ksarjs naming a later milestone's, 65 times, and a
 * blocking rule reading each as a dependency would have refused them all. So
 * the order of requirements is among what the checker does not check.
 */
export function milestoneOrder({ pack }: CheckContext): PackFinding[] {
  const byId = new Map(pack.requirements.filter((r) => !r.withdrawn).map((r) => [r.id, r]));
  const out: PackFinding[] = [];
  for (const c of pack.criteria) {
    for (const id of c.requirements) {
      const q = byId.get(id);
      if (c.milestone === null || q?.milestone == null || q.milestone <= c.milestone) continue;
      out.push(finding("milestone-order", c, `\`${c.id}\` [M${String(c.milestone)}] tests \`${q.id}\` [M${String(q.milestone)}], which a later milestone delivers`));
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * The heuristic: present-indicative claims about unbuilt behaviour
 */

export const HEURISTIC = "present-indicative";

const NORMATIVE = /\b(?:MUST|SHOULD|MAY)\b/u;
/** Parentheses hold citations and asides, never the claim; nested ones go from the inside out. */
const PARENTHETICAL = /\([^()]*\)/gu;
const WORDS = 3;

/**
 * A requirement's sentences as stated: a bold lead-in is a label (a screen's
 * name opening its requirement), and citations and asides are dropped.
 */
function sentences(text: string): string[] {
  let bare = text.replace(/^\*\*[^*]+\*\*\s*/u, "").replaceAll("**", "");
  for (let prev = ""; prev !== bare; ) [prev, bare] = [bare, bare.replace(PARENTHETICAL, "")];
  return bare
    .replace(/\s+(?=[.,;:!?])/gu, "")
    .replace(/\s{2,}/gu, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z])/u)
    .map((s) => s.trim());
}

/**
 * The drift PRDR-263 names, read where C-2⁷ says claims are born: a
 * requirement sentence that states behaviour without MUST, SHOULD or MAY
 * reads as a claim that it is built. A guess about meaning, so it reports and
 * never blocks. Only requirements are read: design documents describe the
 * design in the present tense by nature. PRDR-280's parity run tried reading
 * them for "already", "currently" and "is built" and found 137 in ksarjs: one
 * claim about code, and the rest about the state of a record (one that
 * already exists) or of another system.
 */
export function presentIndicative({ pack }: CheckContext): PackFinding[] {
  const out: PackFinding[] = [];
  for (const r of pack.requirements) {
    if (r.withdrawn) continue;
    for (const sentence of sentences(r.text)) {
      if (NORMATIVE.test(sentence) || sentence.split(/\s+/u).filter((w) => /[a-z]/u.test(w)).length < WORDS) continue;
      out.push(finding(HEURISTIC, r, `\`${r.id}\`: "${sentence}" states behaviour without MUST, SHOULD or MAY, which reads as a claim that it is built`));
    }
  }
  return out;
}
