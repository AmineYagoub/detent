import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import type { HeldFinding, HeldKind } from "../schemas/init.js";
/**
 * D-24′ (PRDR-209) — advice a human can act on.
 *
 * D-24 is right that what the review could not settle is the human's call at
 * approval. gate-313's PRESENT rendered 144 of those calls as one flat list,
 * twice; buried in it were the twenty-six tickets some read called too big for
 * a session — the most actionable thing the review found — and which findings
 * had survived a paid revision against which were seen once and never again.
 * A list that long is not read, so the judgement was not made.
 *
 * Structure, not suppression. Up to this many render inline, each with its
 * kind; above it the screen gets the totals and the tickets drawing the most,
 * and the whole list goes to `.detent/state/advice.md`. Named beside PRDR-119's
 * noise rules, not a knob.
 */
export const ADVICE_INLINE_MAX = 12;
export const ADVICE_TOP_TICKETS = 10;

const KIND_LABEL: Readonly<Record<HeldKind, string>> = { "seen-once": "seen once", "after-revision": "held after revision" };
const kindOf = (f: HeldFinding): HeldKind | undefined => (f.held === "seen-once" || f.held === "after-revision" ? f.held : undefined);
const PLAN_WIDE = "the plan as a whole";

function counted(items: readonly string[]): [string, number][] {
  const n = new Map<string, number>();
  for (const i of items) n.set(i, (n.get(i) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Tickets ordered by how many distinct tags they drew, then by count, then by id. */
function byTicket(findings: readonly HeldFinding[]): [string, HeldFinding[]][] {
  const groups = new Map<string, HeldFinding[]>();
  for (const f of findings) {
    const key = f.ticket ?? PLAN_WIDE;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const distinct = (fs: HeldFinding[]): number => new Set(fs.map((f) => f.tag)).size;
  return [...groups].sort(([a, fa], [b, fb]) => distinct(fb) - distinct(fa) || fb.length - fa.length || a.localeCompare(b));
}

export function renderHeldFindings(findings: readonly HeldFinding[], adviceFile: string | undefined): string[] {
  const lines = ["", `Review findings held after revision (${String(findings.length)}) — judgement calls for you, not defects the machine kept grinding on (D-24):`];
  if (findings.length <= ADVICE_INLINE_MAX) {
    for (const f of findings) {
      const kind = kindOf(f);
      lines.push(`  ${f.tag}${f.ticket === undefined ? "" : ` (${f.ticket})`}: ${f.finding}${kind === undefined ? "" : ` — ${KIND_LABEL[kind]}`}`);
    }
    return lines;
  }
  lines.push(`  by tag: ${counted(findings.map((f) => f.tag)).map(([tag, n]) => `${tag} ${String(n)}`).join(" · ")}`);
  const kinds = findings.map(kindOf);
  const once = kinds.filter((k) => k === "seen-once").length;
  const after = kinds.filter((k) => k === "after-revision").length;
  const unmarked = kinds.length - once - after;
  lines.push(
    `  seen in one read and never again: ${String(once)} · held after a paid revision: ${String(after)}${unmarked === 0 ? "" : ` · unmarked: ${String(unmarked)}`}`,
  );
  const groups = byTicket(findings).filter(([id]) => id !== PLAN_WIDE);
  lines.push(`  tickets drawing the most, by distinct tags then count (top ${String(Math.min(ADVICE_TOP_TICKETS, groups.length))} of ${String(groups.length)}):`);
  for (const [id, fs] of groups.slice(0, ADVICE_TOP_TICKETS)) {
    const tags = counted(fs.map((f) => f.tag)).map(([tag, n]) => (n === 1 ? tag : `${tag} ×${String(n)}`));
    lines.push(`    ${id}  ${tags.join(", ")} (${String(fs.length)})`);
  }
  const planWide = findings.filter((f) => f.ticket === undefined).length;
  if (planWide > 0) lines.push(`  plan-wide, naming no ticket: ${String(planWide)}`);
  if (adviceFile !== undefined) lines.push(`  full list: ${adviceFile}`);
  return lines;
}

/** The whole list, grouped as the screen groups it, every finding in full. */
export function renderAdviceMarkdown(findings: readonly HeldFinding[]): string {
  const lines = [
    `# Review findings held after revision (${String(findings.length)})`,
    "",
    "Judgement calls for the human at approval, not defects the machine kept grinding on (D-24).",
    "`seen once` is one read of three that no other read reproduced; `held after revision` survived a revision paid to remove it.",
    "",
  ];
  for (const [id, fs] of byTicket(findings)) {
    lines.push(`## ${id} (${String(fs.length)})`, "");
    for (const f of fs) {
      const kind = kindOf(f);
      lines.push(`- **${f.tag}**${kind === undefined ? "" : ` — ${KIND_LABEL[kind]}`}: ${f.finding}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function writeAdvice(root: string, findings: readonly HeldFinding[]): string {
  const file = path.join(stateDir(root), "state", "advice.md");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, renderAdviceMarkdown(findings));
  return file;
}

/** Mark why a set of findings is still in front of the human (D-24′). */
export function heldAs(findings: readonly HeldFinding[], kind: HeldKind): HeldFinding[] {
  return findings.map((f) => ({ ...f, held: kind }));
}
