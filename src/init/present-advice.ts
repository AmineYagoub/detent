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

/**
 * PRDR-267: tickets ordered by what a REVISION could not remove, first.
 *
 * Distinct tags then count was population-blind, and the two populations are
 * not worth the same. Over byte-identical tickets with nothing revised between
 * the reads, 50-85% of findings appear in one read and never again (mean 61%,
 * n=7) — so `seen-once` carries a majority-noise prior while `after-revision`
 * survived a session paid to remove it. On run 6's corpus the old order gave a
 * top-ten slot to `t-s04-004`, whose two findings were both seen once, and
 * surfaced 12 of 43 revision survivors where this one surfaces 17.
 */
function byTicket(findings: readonly HeldFinding[]): [string, HeldFinding[]][] {
  const groups = new Map<string, HeldFinding[]>();
  for (const f of findings) {
    const key = f.ticket ?? PLAN_WIDE;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const distinct = (fs: HeldFinding[]): number => new Set(fs.map((f) => f.tag)).size;
  const survived = (fs: HeldFinding[]): number => fs.filter((f) => f.held === "after-revision").length;
  return [...groups].sort(
    ([a, fa], [b, fb]) => survived(fb) - survived(fa) || distinct(fb) - distinct(fa) || fb.length - fa.length || a.localeCompare(b),
  );
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
/**
 * PRDR-267: the sections, heaviest evidence first.
 *
 * Marking each entry tells a reader what a finding is once they have reached
 * it; it does not get them to the survivors first. Burial is a property of
 * order, so the order carries it — and each section says what its population
 * is worth where the reader meets it, not once in a preamble 70 sections up.
 */
const SECTIONS: readonly { readonly kind: HeldKind | undefined; readonly title: string; readonly weight: string }[] = [
  {
    kind: "after-revision",
    title: "Held after revision",
    weight: "A revision was paid to remove each of these and did not. Read these first.",
  },
  {
    kind: "seen-once",
    title: "Seen once",
    weight:
      "One read of three; the other two did not reproduce it. Over byte-identical tickets with nothing revised between the reads, 50-85% of findings never recur — so most of this section is noise, and some of it is not.",
  },
  { kind: undefined, title: "Unmarked", weight: "Neither population: no kind was recorded when these were held." },
];

function renderSection(title: string, weight: string, fs: readonly HeldFinding[]): string[] {
  const lines = [`## ${title} (${String(fs.length)})`, "", weight, ""];
  for (const [id, group] of byTicket(fs)) {
    lines.push(`### ${id} (${String(group.length)})`, "");
    for (const f of group) lines.push(`- **${f.tag}**: ${f.finding}`);
    lines.push("");
  }
  return lines;
}

export function renderAdviceMarkdown(findings: readonly HeldFinding[]): string {
  const lines = [
    `# Review findings held after revision (${String(findings.length)})`,
    "",
    "Judgement calls for the human at approval, not defects the machine kept grinding on (D-24).",
    "",
  ];
  for (const section of SECTIONS) {
    const fs = findings.filter((f) => kindOf(f) === section.kind);
    if (fs.length > 0) lines.push(...renderSection(section.title, section.weight, fs));
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
