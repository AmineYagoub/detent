import { existsSync } from "node:fs";
import path from "node:path";
import { packKindOf, type ConformanceRecord, type PackFinding } from "../schemas/pack.js";
import { readLines, type Line } from "./pack-markdown.js";
import { parsePack } from "./pack-parse.js";
import { catalogueEntries, catalogueUses, links, references, sectionRefs } from "./pack-check-refs.js";
import { HEURISTIC, at, byPlace, coverage, milestoneOrder, presentIndicative, registry, sequence, unique, type CheckContext } from "./pack-check-rules.js";

/**
 * C-2⁷, C-2¹⁰ (PRDR-280) — the pack checker: whether a pack is consistent
 * with itself, decided without a model.
 *
 * A TypeScript port of ksarjs's `check_pack.py` (plan §5), generalized to the
 * schema: where the script knew ksarjs's file names, its route prefixes and
 * its permission catalogue, this knows the layout C-2⁷ fixes. Its findings
 * are the schema's own breaks, which block, the rules below, which block, and
 * one heuristic, which reports to VALIDATE's reviewers and never blocks.
 *
 * Deterministic: no clock, no network, no environment and no model. The
 * findings are sorted by place and deduplicated, so the same pack gives the
 * same bytes wherever it is checked out; the purity test holds that.
 */

export type PackCheck = ConformanceRecord["checker"];

/**
 * What a green result does not mean, printed with every result, as
 * `scripts/check-tickets.ts` (PRDR-192) prints its own. Each is a property a
 * reader could assume was checked and was not.
 */
export const UNCHECKED: readonly string[] = [
  "whether the pack is right: a pack that is consistent and wrong passes; meaning is for VALIDATE's reviewers",
  "whether a criterion's values are exact, and whether it tests what it names",
  "whether a fact is true, or its source says what the fact says",
  "milestone order between requirements: a requirement that names a later one may be pointing forward, so only a criterion that tests a later milestone's requirement is refused",
  "a catalogue entry used in a phrasing the checker does not read, a route under a first path segment no catalogued route uses, and a catalogue entry nothing uses",
  "a § reference with no document name before it, and a link in reference style",
  "a context document (a README, a runbook) beyond the requirement and criterion ids it names and its links, and any document that is not markdown",
  `the ${HEURISTIC} rule is a heuristic, and reads requirements only: its reports go to VALIDATE's reviewers and never block`,
];

type Rule = (ctx: CheckContext) => PackFinding[];

const RULES: readonly Rule[] = [unique, catalogueEntries, sequence, registry, references, sectionRefs, links, catalogueUses, coverage, milestoneOrder, presentIndicative];

/**
 * Check `documents` (repo-relative, as discovery returns them). `greenfield`
 * is code's, from the stack markers (D-10′), as it is for the schema.
 */
export function checkPack(root: string, documents: readonly string[], opts: { readonly greenfield: boolean }): PackCheck {
  const { pack, problems, refused } = parsePack(root, documents, opts);
  const lines = new Map<string, readonly Line[]>();
  const typed = new Set<string>();
  for (const rel of documents) {
    const kind = packKindOf(rel);
    if (kind === null || !rel.endsWith(".md")) continue;
    lines.set(rel, readLines(root, rel));
    if (kind !== "context") typed.add(rel);
  }
  const ctx: CheckContext = { pack, refused, lines, typed, exists: (rel) => existsSync(path.join(root, ...rel.split("/"))) };
  const findings = settle([...problems, ...RULES.flatMap((rule) => rule(ctx))], lines);
  return { green: findings.every((f) => !f.blocks), findings };
}

const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Each finding quotes its line as written, blocks unless it is the
 * heuristic's, and appears once, in place order: file, line, rule, message.
 */
function settle(found: readonly PackFinding[], lines: ReadonlyMap<string, readonly Line[]>): PackCheck["findings"] {
  const quote = (f: PackFinding) => {
    const doc = lines.get(f.file) ?? [];
    return doc[f.line - (doc[0]?.n ?? 1)]?.text.trim() ?? f.text;
  };
  const unique = new Map<string, PackCheck["findings"][number]>();
  for (const f of found) {
    const settled = { ...f, text: f.line > 0 ? quote(f) : f.text, blocks: f.rule !== HEURISTIC };
    unique.set(JSON.stringify([settled.file, settled.line, settled.rule, settled.message]), settled);
  }
  return [...unique.values()].sort((a, b) => byPlace(a, b) || order(a.rule, b.rule) || order(a.message, b.message));
}

/** The result as `init` and the operator read it: every finding at its place, the verdict, and what was not checked. */
export function renderPackCheck(check: PackCheck): string {
  const blocking = check.findings.filter((f) => f.blocks).length;
  const reports = check.findings.length - blocking;
  const body = check.findings.map((f) => `${at(f)} [${f.rule}] ${f.message}${f.text === "" ? "" : `\n    ${f.text}`}`);
  const verdict = check.green ? "pack: green, no blocking finding" : `pack: red, ${String(blocking)} blocking finding${blocking === 1 ? "" : "s"}`;
  return [
    ...body,
    ...(body.length > 0 ? [""] : []),
    `${verdict}; ${String(reports)} report${reports === 1 ? "" : "s"} from the ${HEURISTIC} heuristic, which never blocks.`,
    `pack: ${String(UNCHECKED.length)} properties are not checked, so a green result is not a review:`,
    ...UNCHECKED.map((u) => `  - ${u}`),
    "",
  ].join("\n");
}
