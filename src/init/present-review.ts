import type { PlanFinding, PlanRisk, UnreviewedSlice } from "../schemas/init.js";

/**
 * C-4⁸ (PRDR-294) — what the plan's review leaves the operator.
 *
 * Each slice's review read its draft once. A blocker or major bought the
 * slice one revision, which no review read again, so whether the revision
 * answered it is not known: each is listed as a risk with the fix the review
 * asked for, blockers first, and the operator reads the tickets it names. A
 * slice no review read is named, with why. The minors are counted and not
 * listed: each is recorded on its ticket and reaches the sessions that run it
 * (PRDR-271), and none is a decision the operator makes at approval. What code
 * did to a draft is listed, since each is a decision code made on the
 * operator's behalf: an id renamed, an edge dropped, a cycle broken, a DONE
 * ticket kept (A-1″, PRDR-118).
 */

const RANK: Readonly<Record<PlanRisk["severity"], number>> = { blocker: 0, major: 1, minor: 2 };

export function reviewLines(risks: readonly PlanRisk[], unreviewed: readonly UnreviewedSlice[], findings: readonly PlanFinding[]): string[] {
  const lines: string[] = [];
  if (risks.length > 0) {
    lines.push(
      "",
      `Plan review risks (${String(risks.length)}) — blockers and majors a slice's review found. Each bought the slice one revision, ` +
        "which no review read again, so none is known to be answered: check the tickets they name (C-4⁸):",
    );
    for (const r of [...risks].sort((a, b) => RANK[a.severity] - RANK[b.severity])) {
      lines.push(`  ${r.slice} ${r.ticket} [${r.severity} ${r.tag}]: ${r.finding}`, `      fix: ${r.fix}`);
    }
  }
  if (unreviewed.length > 0) {
    lines.push("", `Slices not reviewed (${String(unreviewed.length)}) (C-4⁸):`);
    for (const u of unreviewed) lines.push(`  ${u.slice}: not reviewed — ${u.reason}`);
  }
  const repairs = findings.filter((f) => f.severity === undefined);
  if (repairs.length > 0) {
    lines.push("", `What code did to the drafts (${String(repairs.length)}) — each is recorded on its ticket too (A-1″):`);
    for (const f of repairs) lines.push(`  ${f.tag}${f.ticket === undefined ? "" : ` (${f.ticket})`}: ${f.finding}`);
  }
  const minors = findings.length - repairs.length;
  if (minors > 0) {
    lines.push("", `Minor review findings (${String(minors)}) are recorded on their tickets, and each reaches the sessions that run its ticket (C-4⁸).`);
  }
  return lines;
}
