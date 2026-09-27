import type { PlanDraftTicket, SpecDefect } from "../schemas/init.js";
import { CATALOGUE_KINDS, CATALOGUES_PATH, type Pack } from "../schemas/pack.js";
import { readLines } from "./pack-markdown.js";
import { criterionText } from "./plan-records.js";

/**
 * C-4⁵ (PRDR-292) — what code checks in a draft before it is kept.
 *
 * Two things a drafter writes are claims about the pack, and both are cheap
 * for code to check and impossible to check by reading the draft. A ticket
 * that carries a pack criterion copies its words, so the run tests what the
 * pack says rather than a paraphrase of it. A spec defect quotes the pack, and
 * each quote must be in the record whose id it gives, because an open defect
 * holds approval of the whole plan. A draft failing either is refused, and its
 * relaunch is told each failure.
 */

/** Whitespace, bold markers and backticks aside: what a quote must hold word for word. */
const words = (text: string): string => text.replaceAll("**", "").replaceAll("`", "").replace(/\s+/gu, " ").trim();

/** Each reason the draft is refused, or none. Without a pack, no criterion and no spec defect can be checked, so any is refused. */
export function draftIssues(
  root: string,
  pack: Pack | null,
  draft: { readonly tickets: readonly PlanDraftTicket[]; readonly spec_defects: readonly SpecDefect[] },
): string[] {
  const issues: string[] = [];
  for (const t of draft.tickets) {
    for (const id of t.criterion_ids) {
      const criterion = pack?.criteria.find((c) => c.id === id);
      if (criterion === undefined) {
        issues.push(`${t.id} carries criterion ${id}, which ${pack === null ? "no pack defines: there is no pack, so a ticket carries no criterion id" : "the pack does not define"}`);
        continue;
      }
      const text = criterionText(criterion);
      if (!t.acceptance_criteria.some((a) => words(a) === words(text))) {
        issues.push(`${t.id} carries criterion ${id} without its words: one of its acceptance_criteria must be, word for word, "${text}"`);
      }
    }
  }
  draft.spec_defects.forEach((defect, i) => {
    if (pack === null) {
      issues.push(`spec defect ${String(i + 1)} quotes a pack, and there is none: plan on what the documents say, and record what you decided in the ticket's description`);
      return;
    }
    for (const p of defect.passages) {
      const issue = passageIssue(root, pack, p);
      if (issue !== null) issues.push(`spec defect ${String(i + 1)}: ${issue}`);
    }
  });
  return issues;
}

/** Whether every passage `defect` quotes is still, word for word, in the record its id gives. */
export function stillQuoted(root: string, pack: Pack, defect: SpecDefect): boolean {
  return defect.passages.every((p) => passageIssue(root, pack, p) === null);
}

/**
 * PLAN's spec defects as PRESENT lists them: one for each slice and set of
 * passages, and each passage with the line its record is written on, which is
 * where the pack is amended.
 */
export function openDefects<T extends SpecDefect & { readonly slice: string }>(pack: Pack | null, defects: readonly T[]): T[] {
  const seen = new Set<string>();
  return defects.flatMap((d) => {
    const key = `${d.slice} ${JSON.stringify(d.passages)}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const where = (id: string): { where?: string } => {
      const at = pack === null ? null : recordAt(pack, id);
      return at === null ? {} : { where: `${at.file}:${String(at.line)}` };
    };
    return [{ ...d, passages: d.passages.map((p) => ({ ...p, ...where(p.id) })) }];
  });
}

function passageIssue(root: string, pack: Pack, passage: SpecDefect["passages"][number]): string | null {
  const at = recordAt(pack, passage.id);
  if (at === null) return `it quotes ${passage.id}, which is no requirement, criterion, decision, default, fact or catalogue entry of the pack`;
  const quote = words(passage.quote);
  const texts = [...at.parsed, ...source(root, at.file, at.line)];
  return texts.some((t) => words(t).includes(quote)) ? null : `it quotes "${passage.quote}" as ${passage.id}, and ${passage.id} does not hold those words`;
}

/** The record `id`: where its document writes it, and what the parse holds of it; null when the pack holds no such record. */
function recordAt(pack: Pack, id: string): { readonly file: string; readonly line: number; readonly parsed: readonly string[] } | null {
  const bare = id.replace(/^§\s*/u, "");
  const r = pack.requirements.find((x) => x.id === bare);
  if (r !== undefined) return { file: r.file, line: r.line, parsed: [r.text] };
  const c = pack.criteria.find((x) => x.id === bare);
  if (c !== undefined) return { file: c.file, line: c.line, parsed: [criterionText(c), `Given ${c.given}, when ${c.when}, then ${c.then}`] };
  const d = pack.decisions.find((x) => x.id === bare);
  if (d !== undefined) return { file: d.file, line: d.line, parsed: [d.question, d.answer, d.reason] };
  const x = pack.defaults.find((y) => y.id === bare);
  if (x !== undefined) return { file: x.file, line: x.line, parsed: [x.value, x.reason] };
  const f = pack.facts.find((y) => y.id === bare);
  if (f !== undefined) return { file: f.file, line: f.line, parsed: [f.fact, f.source] };
  for (const kind of CATALOGUE_KINDS) {
    const e = pack.catalogues[kind].find((y) => y.id === bare);
    if (e !== undefined) return { file: CATALOGUES_PATH, line: e.line, parsed: [] };
  }
  return null;
}

/** The lines a record's document writes it on: its own, and the ones that continue it up to a blank line or the next entry. */
function source(root: string, file: string, line: number): string[] {
  let lines: readonly { readonly n: number; readonly text: string }[];
  try {
    lines = readLines(root, file);
  } catch {
    return [];
  }
  const at = lines.findIndex((l) => l.n === line);
  if (at === -1) return [];
  const out = [lines[at]?.text ?? ""];
  for (const l of lines.slice(at + 1)) {
    if (l.text.trim() === "" || /^\s*(?:[-*|#]|\d+\.)/u.test(l.text)) break;
    out.push(l.text);
  }
  return [out.join(" ")];
}
