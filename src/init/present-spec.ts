import { DECISION_LOG_PATH } from "../schemas/pack.js";
import type { PhaseOutcome } from "./machine.js";

/**
 * C-3⁗, C-2¹⁴ — what the specification phase leaves for the operator to judge
 * at approval: the decision log, every decision and every default the plan
 * follows, and the risks VALIDATE's last round left open.
 *
 * C-7‴ (PRDR-296): the whole log, since a plan rests on the founder's
 * decisions as much as on its defaults. Each entry says where it is
 * overruled: a decision or a default in its row of the log, a risk in the
 * pack. Only a default is the plan's own call, so only a default is marked
 * vetoable.
 *
 * C-4⁵ (PRDR-292): and what planning found the pack leaves unsettled. A spec
 * defect is not a call the plan proceeds on: while one is open, approval is
 * not offered, on either exit.
 */

/** A founder's decision, as the log holds it. */
export interface PresentedDecision {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
}

export interface PresentedDefault {
  readonly id: string;
  readonly value: string;
  readonly reason: string;
}

/** A major the last round left open, as VALIDATE hands it on (PRDR-284). */
export interface PresentedRisk {
  readonly id: string;
  /** `file:line`, its first place. */
  readonly where: string;
  readonly fix: string;
  /** `unverified`, `declined` or `undone`. */
  readonly left: string;
  readonly reason: string;
}

/** C-4⁵: a spec defect as PLAN hands it on, with the slice whose draft reported it and where each passage it quotes is written. */
export interface PresentedDefect {
  readonly slice: string;
  readonly kind: string;
  readonly passages: readonly { readonly id: string; readonly quote: string; readonly where?: string }[];
  readonly defect: string;
}

const isPassage = (p: unknown): boolean =>
  typeof p === "object" && p !== null && typeof (p as { id?: unknown }).id === "string" && typeof (p as { quote?: unknown }).quote === "string";

/** A defect a person can be shown: every field the rendering reads is there, with its type (PRDR-157). */
export function isPresentedDefect(d: unknown): d is PresentedDefect {
  if (typeof d !== "object" || d === null) return false;
  const v = d as { slice?: unknown; kind?: unknown; defect?: unknown; passages?: unknown };
  return typeof v.slice === "string" && typeof v.kind === "string" && typeof v.defect === "string" && Array.isArray(v.passages) && v.passages.every(isPassage);
}

export function defectLines(defects: readonly PresentedDefect[]): string[] {
  if (defects.length === 0) return [];
  const lines = ["", `Spec defects (${String(defects.length)}) — what planning found the pack leaves unsettled; while one is open, this plan cannot be approved (C-4⁵):`];
  for (const d of defects) {
    lines.push(`  [${d.slice}] ${d.kind}: ${d.defect}`);
    for (const p of d.passages) lines.push(`      ${p.id}${p.where === undefined ? "" : ` (${p.where})`}: "${p.quote}"`);
  }
  return lines;
}

/**
 * C-4⁵: the AWAIT_INFO an open defect raises, or null where none is open. It
 * tells the operator what to do in terms of what a re-run does: a slice whose
 * records changed is drafted again, and so is one whose reported defect no
 * longer quotes the pack.
 */
export function defectInterrupt(presentation: string, defects: readonly PresentedDefect[]): PhaseOutcome | null {
  if (defects.length === 0) return null;
  const instruction =
    `${String(defects.length)} spec defect(s) hold approval of this plan. Amend the pack where each one quotes it, so the ` +
    "words say what the product needs, and re-run `detent init`: the slice that reported it is drafted again from the " +
    "amended records. `detent init --replan` drafts every slice again without an amendment (C-8′).";
  return { kind: "interrupt", interrupt: "AWAIT_INFO", message: [presentation, "", instruction].join("\n"), items: defects.map((d) => `[${d.slice}] ${d.kind}: ${d.defect}`) };
}

/** C-7‴: the decision log, the founder's decisions first and then each default, marked vetoable. */
export function decisionLines(decisions: readonly PresentedDecision[], defaults: readonly PresentedDefault[]): string[] {
  const lines: string[] = [];
  if (decisions.length > 0) {
    lines.push("", `Decisions (${String(decisions.length)}) — the founder's; to change one, edit its row in ${DECISION_LOG_PATH} and re-run \`detent init\` (C-3⁗):`);
    for (const d of decisions) lines.push(`  ${d.id}: ${d.question} → ${d.answer}`);
  }
  if (defaults.length > 0) {
    lines.push("", `Defaults (${String(defaults.length)}), each vetoable — the plan follows each; to veto one, edit its row in ${DECISION_LOG_PATH} and re-run \`detent init\` (C-3⁗):`);
    for (const d of defaults) {
      lines.push(`  ${d.id}: ${d.value}`);
      if (d.reason !== "") lines.push(`      because: ${d.reason}`);
    }
  }
  return lines;
}

export function riskLines(risks: readonly PresentedRisk[]): string[] {
  if (risks.length === 0) return [];
  const lines = [
    "",
    `Risks (${String(risks.length)}) — majors VALIDATE's last round left open; the plan proceeds, and to settle one, fix it in the pack and re-run \`detent init\` (C-2¹⁴):`,
  ];
  for (const r of risks) {
    lines.push(`  ${r.id} ${r.where} (${r.left}): ${r.fix}`);
    if (r.reason !== "") lines.push(`      why: ${r.reason}`);
  }
  return lines;
}
