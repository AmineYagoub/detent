import type { ReviewArtifact, ReviewFinding, FixArtifact } from "../schemas/validate.js";
import type { SEVERITIES } from "../schemas/pack.js";
import { lineOf, moveOf } from "./audit-passages.js";

/**
 * C-2¹⁴ (PRDR-284) — what code checks of VALIDATE's sessions: that each
 * finding stands on passages that are where it says, and that the writer
 * accounted for every finding it was given.
 *
 * A finding costs a fix, and a fix can introduce the next round's defects,
 * so one that quotes a sentence the pack does not hold is refused before it
 * costs anything. Each check returns the session's issues, in words a
 * relaunch can act on.
 */

export type Severity = (typeof SEVERITIES)[number];

/** A finding as a round holds it: numbered, and kept with the area whose reviewer reported it. */
export interface Finding extends ReviewFinding {
  /** `R<round>-<n>`, in the order the round's reviewers reported them. */
  readonly id: string;
  readonly area: number;
}

export interface ReviewCheck {
  readonly issues: readonly string[];
  /** The findings that stand, every place where it says. */
  readonly kept: readonly ReviewFinding[];
  /** Each finding refused, as `file:line` and why, for the operator. */
  readonly dropped: readonly string[];
  /** The documents the reviewer was given to review and does not list as read. */
  readonly unread: readonly string[];
  /** Each place of a kept finding that stands on another line than it named, as `file:from → to` (C-2²⁵). */
  readonly moved: readonly string[];
}

const where = (p: { readonly file: string; readonly line: number }): string => `${p.file}:${String(p.line)}`;

/**
 * Check a review against what its reviewer was given: every place in one of
 * the pack's documents, its quote at its line, whitespace aside; every
 * document it was asked to review read; and, in a verification, `previous`
 * naming one of the findings it was given. A quote on one other line of its
 * document stands there, the finding kept with that line (C-2²⁵).
 */
export function checkReview(
  root: string,
  review: ReviewArtifact,
  given: { readonly pack: readonly string[]; readonly documents: readonly string[]; readonly previous: readonly string[] },
): ReviewCheck {
  const issues: string[] = [];
  const dropped: string[] = [];
  const moved: string[] = [];
  const unread = given.documents.filter((d) => !review.documents_read.includes(d));
  if (unread.length > 0) issues.push(`the review did not read every document it was given: ${unread.join(", ")}`);
  const kept: ReviewFinding[] = [];
  for (const f of review.findings) {
    const wrong: string[] = [];
    const shifts: string[] = [];
    const places = f.places.map((p) => {
      if (!given.pack.includes(p.file)) {
        wrong.push(`${where(p)} is not in one of the pack's documents`);
        return p;
      }
      const line = lineOf(root, p);
      if (line === null) wrong.push(`${where(p)} does not hold ${JSON.stringify(p.quote)}, whitespace aside`);
      else if (line !== p.line) shifts.push(moveOf(p, line));
      return line === null ? p : { ...p, line };
    });
    if (f.previous !== null && !given.previous.includes(f.previous)) wrong.push(`\`previous\` names ${f.previous}, which is not a finding you were given`);
    if (wrong.length === 0) {
      kept.push({ ...f, places });
      moved.push(...shifts);
      continue;
    }
    issues.push(...wrong);
    dropped.push(`${f.places.map(where).join(", ")}: ${wrong.join("; ")}`);
  }
  return { issues, kept, dropped, unread, moved };
}

const RANK: Readonly<Record<Severity, number>> = { blocker: 0, major: 1, minor: 2 };

/**
 * One round's findings, numbered. Two that name the same places for the same
 * kind of defect are one, however each reviewer worded it, and the more severe
 * stands; findings that differ in either are kept apart, since merging two
 * defects loses one.
 */
export function mergeFindings(round: number, reported: readonly { readonly area: number; readonly findings: readonly ReviewFinding[] }[]): Finding[] {
  const byPlace = new Map<string, Omit<Finding, "id">>();
  for (const { area, findings } of reported) {
    for (const f of findings) {
      const key = JSON.stringify([f.category, f.places.map(where).sort()]);
      const was = byPlace.get(key);
      if (was === undefined || RANK[f.severity] < RANK[was.severity]) byPlace.set(key, { ...f, area });
    }
  }
  return [...byPlace.values()].map((f, n) => ({ ...f, id: `R${String(round)}-${String(n + 1)}` }));
}

export const countsOf = (findings: readonly { readonly severity: Severity }[]): Record<Severity, number> => ({
  blocker: findings.filter((f) => f.severity === "blocker").length,
  major: findings.filter((f) => f.severity === "major").length,
  minor: findings.filter((f) => f.severity === "minor").length,
});

/** The writer's account against the findings it was given: each id once, in `applied` or `declined`. */
export function fixIssues(artifact: FixArtifact, ids: readonly string[]): string[] {
  const listed = [...artifact.applied, ...artifact.declined.map((d) => d.id)];
  const issues: string[] = [];
  for (const id of new Set(listed)) {
    if (!ids.includes(id)) issues.push(`${id} is not one of the findings you were given`);
    else if (listed.filter((l) => l === id).length > 1) issues.push(`${id} is listed twice`);
  }
  for (const id of ids) if (!listed.includes(id)) issues.push(`${id} is listed in neither applied nor declined`);
  return issues;
}

export interface Outcome {
  readonly left: "applied" | "declined" | "undone";
  readonly reason: string;
}

/**
 * What became of each finding, as the writer's account says. Where the account
 * is wrong, code decides: a finding it applied, among others, counts applied,
 * since its fix is in the pack for the next round to judge; one it did not
 * account for counts declined, and is left open. A writer that changed no
 * document applied nothing, whatever it says, and each finding stays open.
 */
export function outcomes(artifact: FixArtifact, ids: readonly string[], changedAny: boolean): Map<string, Outcome> {
  const out = new Map<string, Outcome>();
  for (const id of ids) {
    const declined = artifact.declined.find((d) => d.id === id);
    if (!artifact.applied.includes(id)) out.set(id, { left: "declined", reason: declined?.reason ?? "its writer did not say whether it applied it" });
    else if (changedAny) out.set(id, { left: "applied", reason: "" });
    else out.set(id, { left: "declined", reason: "its writer listed it as applied and changed no document" });
  }
  return out;
}
