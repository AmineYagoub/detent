import type { z } from "zod";
import { SCHEMA_VERSION } from "../schemas/common.js";
import { GATE_SLOTS, type GateSlot } from "../schemas/gates.js";
import {
  CATALOGUES_PATH,
  CATALOGUE_SECTIONS,
  CRITERION_ID,
  DECISION_ID,
  DECISION_LOG_PATH,
  DEFAULT_ID,
  FACTS_PATH,
  FACT_ID,
  MILESTONE_ID,
  MODULE_CODE,
  PRD_INDEX_PATH,
  REQUIREMENT_ID,
  REQUIREMENT_REFS,
  adrIdOf,
  codeSchema,
  criterionSchema,
  decisionSchema,
  defaultSchema,
  factSchema,
  isModulePrd,
  levelOf,
  milestoneSchema,
  packKindOf,
  requirementSchema,
  stackSchema,
  type Pack,
  type PackFinding,
} from "../schemas/pack.js";
import { boldBullets, numberedSections, readLines, sections, tableRows, unquote, type Line, type Row } from "./pack-markdown.js";

/**
 * C-2⁷ (PRDR-279) — a pack's documents, parsed into the schema's entries.
 *
 * Extraction lives here and the rules live in `schemas/pack.ts`: every entry
 * is built as found and then admitted through its schema, and what the schema
 * refuses becomes a finding at the entry's line. So "a requirement states MUST
 * or SHOULD" has one definition, which the checker (C-2⁷) will report and the
 * phases after VALIDATE will read.
 */

export interface ParsedPack {
  readonly pack: Pack;
  /** Breaks of the schema, each at its place. A pack with any does not conform. */
  readonly problems: readonly PackFinding[];
  /**
   * The id of every entry the schema refused (`## Stack` for the stack, which
   * has none). A refused entry is still defined: the checker (C-2¹⁰) reads a
   * reference to it as resolved, so one defect is reported once.
   */
  readonly refused: ReadonlySet<string>;
}

/** The problems found so far, carrying the ids of the entries refused for them. */
type Problems = PackFinding[] & { readonly refused: Set<string> };

/** One candidate entry through its schema: the entry, or its issues as findings. */
function admit<T>(schema: z.ZodType<T>, candidate: unknown, rule: string, file: string, at: { readonly n: number; readonly text: string }, label: string, problems: Problems): T | null {
  const parsed = schema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  problems.refused.add(label);
  for (const message of new Set(parsed.error.issues.map((i) => i.message))) {
    problems.push({ rule, file, line: at.n, text: at.text, message: `${label}: ${message}` });
  }
  return null;
}

const blank = (): Pack => ({
  schema_version: SCHEMA_VERSION,
  documents: [],
  codes: [],
  milestones: [],
  requirements: [],
  criteria: [],
  decisions: [],
  defaults: [],
  facts: [],
  adrs: [],
  stack: null,
  packages: [],
  catalogues: { error_codes: [], events: [], settings: [], jobs: [], routes: [] },
});

/**
 * Parse `documents` (repo-relative, as discovery returns them) against the
 * schema. `greenfield` is code's, from the stack markers (D-10′): it is what
 * makes the stack entry required.
 */
export function parsePack(root: string, documents: readonly string[], opts: { readonly greenfield: boolean }): ParsedPack {
  const pack = blank();
  const problems: Problems = Object.assign([], { refused: new Set<string>() });
  for (const rel of documents) {
    const kind = packKindOf(rel);
    if (kind === null) {
      problems.push({ rule: "layout", file: rel, line: 0, text: rel, message: `${rel} is not a name the pack's layout holds in its directory` });
      continue;
    }
    const lines = rel.endsWith(".md") ? readLines(root, rel) : [];
    pack.documents.push({ path: rel, kind, sections: numberedSections(lines) });
    if (rel === DECISION_LOG_PATH) parseDecisionLog(rel, lines, pack, problems);
    else if (rel === FACTS_PATH) parseFacts(rel, lines, pack, problems);
    else if (rel === PRD_INDEX_PATH) parseIndex(rel, lines, pack, problems);
    else if (rel === CATALOGUES_PATH) parseCatalogues(rel, lines, pack, problems);
    else if (isModulePrd(rel)) parseModule(rel, lines, pack, problems);
    const adr = adrIdOf(rel);
    if (adr !== null) pack.adrs.push({ id: adr, file: rel });
  }
  requireDocuments(pack, problems);
  if (opts.greenfield && !problems.some((p) => p.rule === "stack")) requireStack(pack, problems);
  pack.milestones.sort((a, b) => a.order - b.order);
  return { pack, problems: [...problems], refused: problems.refused };
}

function requireDocuments(pack: Pack, problems: Problems): void {
  const has = new Set(pack.documents.map((d) => d.path));
  const missing = (file: string, message: string) => problems.push({ rule: "layout", file, line: 0, text: "", message });
  if (!has.has(DECISION_LOG_PATH)) missing(DECISION_LOG_PATH, `the pack has no decision log (${DECISION_LOG_PATH})`);
  if (!has.has(PRD_INDEX_PATH)) missing(PRD_INDEX_PATH, `the pack has no index (${PRD_INDEX_PATH})`);
  if (![...has].some(isModulePrd)) missing("docs/prd/", "the pack has no module PRD (docs/prd/NN-name.md)");
}

/**
 * D-10′: in greenfield the stack is a decision, and a pack without it cannot
 * bind a gate. Skipped when ## Stack itself was refused: that finding already
 * names what the entry lacks, and a second one would say it is missing.
 */
function requireStack(pack: Pack, problems: Problems): void {
  const at = { rule: "stack", file: DECISION_LOG_PATH, line: 0, text: "" };
  if (pack.stack === null) {
    problems.push({
      ...at,
      message: "a greenfield pack records its stack entry under ## Stack (D-10′): the decision that settled it, the language, the toolchain and the scaffold files",
    });
  } else if (Object.keys(pack.stack.gates).length === 0) {
    problems.push({ ...at, message: "a greenfield stack declares a gate command for the root package (`.`) under ## Packages" });
  }
}

/* ---------------------------------------------------------------------------
 * The decision log: decisions, defaults, the stack and the packages
 */

function parseDecisionLog(file: string, lines: readonly Line[], pack: Pack, problems: Problems): void {
  const stackRows: Row[] = [];
  const packageRows: Row[] = [];
  for (const [name, body] of sections(lines)) {
    for (const row of tableRows(body)) {
      const [id = "", a = "", b = "", c = ""] = row.cells;
      if (name === "decisions") {
        if (!DECISION_ID.test(id)) problems.push({ rule: "decision", file, line: row.n, text: row.text, message: `${id}: is not a decision id (D-n)` });
        else push(pack.decisions, admit(decisionSchema, { id, question: a, answer: b, reason: c, file, line: row.n }, "decision", file, row, id, problems));
      } else if (name === "defaults") {
        if (!DEFAULT_ID.test(id)) problems.push({ rule: "default", file, line: row.n, text: row.text, message: `${id}: is not a default id (X-n)` });
        else push(pack.defaults, admit(defaultSchema, { id, value: a, reason: b, file, line: row.n }, "default", file, row, id, problems));
      } else if (name === "stack") stackRows.push(row);
      else if (name === "packages") packageRows.push(row);
      else problems.push({ rule: "decision", file, line: row.n, text: row.text, message: "a table row outside ## Decisions, ## Defaults, ## Stack and ## Packages" });
    }
  }
  pack.packages = parsePackages(file, packageRows, problems);
  if (stackRows.length > 0) pack.stack = parseStack(file, stackRows, pack, problems);
}

const push = <T>(list: T[], entry: T | null): void => {
  if (entry !== null) list.push(entry);
};

const STACK_FIELDS = new Set(["decision", "language", "toolchain", "scaffold"]);

function parseStack(file: string, rows: readonly Row[], pack: Pack, problems: Problems): Pack["stack"] {
  const fields = new Map<string, string>();
  for (const row of rows) {
    const [field = "", value = ""] = row.cells;
    const key = field.toLowerCase();
    if (!STACK_FIELDS.has(key)) problems.push({ rule: "stack", file, line: row.n, text: row.text, message: `${field}: is not a stack field (decision, language, toolchain, scaffold)` });
    else if (fields.has(key)) problems.push({ rule: "stack", file, line: row.n, text: row.text, message: `${field}: is given twice` });
    else fields.set(key, value);
  }
  const candidate = {
    decision: fields.get("decision") ?? "",
    language: fields.get("language") ?? "",
    toolchain: fields.get("toolchain") ?? "",
    scaffold_files: (fields.get("scaffold") ?? "").split(",").map((f) => unquote(f.trim())).filter((f) => f !== ""),
    gates: pack.packages.find((p) => p.path === ".")?.gates ?? {},
  };
  const first = rows[0] ?? { n: 1, text: "" };
  return admit(stackSchema, candidate, "stack", file, first, "## Stack", problems);
}

const SLOTS: ReadonlySet<string> = new Set(GATE_SLOTS);

/** A directory inside the repository, POSIX, never climbing out of it; `.` is the root. */
function isPackagePath(p: string): boolean {
  return p === "." || (!p.startsWith("/") && p.split("/").every((seg) => seg !== "." && seg !== ".." && /^[A-Za-z0-9._@-]+$/u.test(seg)));
}

function parsePackages(file: string, rows: readonly Row[], problems: Problems): Pack["packages"] {
  const packages = new Map<string, Partial<Record<GateSlot, string>>>();
  for (const row of rows) {
    const [rawPath = "", slot = "", rawCommand = ""] = row.cells;
    const at = { rule: "package", file, line: row.n, text: row.text };
    const where = unquote(rawPath);
    const command = unquote(rawCommand);
    const gates = packages.get(where) ?? {};
    if (!isPackagePath(where)) problems.push({ ...at, message: `${where}: is not a directory inside the repository` });
    else if (!SLOTS.has(slot)) problems.push({ ...at, message: `${where}: ${slot} is not a gate slot (${GATE_SLOTS.join(", ")})` });
    else if (gates[slot as GateSlot] !== undefined) problems.push({ ...at, message: `${where}: declares ${slot} twice` });
    else if (command === "") problems.push({ ...at, message: `${where}: declares ${slot} with no command` });
    else packages.set(where, { ...gates, [slot]: command });
  }
  return [...packages].map(([p, gates]) => ({ path: p, gates }));
}

/* ---------------------------------------------------------------------------
 * Facts, the index and the catalogues
 */

function parseFacts(file: string, lines: readonly Line[], pack: Pack, problems: Problems): void {
  for (const row of tableRows(lines)) {
    const [id = "", fact = "", source = "", tag = ""] = row.cells;
    if (!FACT_ID.test(id)) problems.push({ rule: "fact", file, line: row.n, text: row.text, message: `${id}: is not a fact id (N.M)` });
    else push(pack.facts, admit(factSchema, { id, fact, source, tag, file, line: row.n }, "fact", file, row, id, problems));
  }
}

/** A registry cell names its PRD as a link or a bare file name; either way, the file name. */
const prdFile = (cell: string): string => (/\]\(([^)]+)\)/u.exec(cell)?.[1] ?? unquote(cell)).split("/").at(-1) ?? "";

function parseIndex(file: string, lines: readonly Line[], pack: Pack, problems: Problems): void {
  const all = sections(lines);
  for (const row of tableRows(all.get("codes") ?? [])) {
    const [code = "", area = "", prd = "", milestones = ""] = row.cells;
    if (!MODULE_CODE.test(code)) problems.push({ rule: "code", file, line: row.n, text: row.text, message: `${code}: is not a module code (2 to 6 capitals and digits)` });
    else {
      const ms = [...milestones.matchAll(/\bM(\d+)\b/gu)].map((m) => Number(m[1]));
      push(pack.codes, admit(codeSchema, { code, area, prd: prdFile(prd), milestones: [...new Set(ms)], file, line: row.n }, "code", file, row, code, problems));
    }
  }
  for (const row of tableRows(all.get("milestones") ?? [])) {
    const [id = "", title = ""] = row.cells;
    const order = MILESTONE_ID.exec(id)?.[1];
    if (order === undefined) problems.push({ rule: "milestone", file, line: row.n, text: row.text, message: `${id}: is not a milestone id (M0, M1, …)` });
    else push(pack.milestones, admit(milestoneSchema, { id, order: Number(order), title, file, line: row.n }, "milestone", file, row, id, problems));
  }
  if (pack.codes.length === 0) problems.push({ rule: "code", file, line: 0, text: "", message: "the index registers no module code under ## Codes" });
  if (pack.milestones.length === 0) problems.push({ rule: "milestone", file, line: 0, text: "", message: "the index defines no milestone under ## Milestones" });
}

function parseCatalogues(file: string, lines: readonly Line[], pack: Pack, problems: Problems): void {
  for (const [name, body] of sections(lines)) {
    const kind = CATALOGUE_SECTIONS[name];
    if (kind === undefined) continue;
    for (const row of tableRows(body)) {
      const id = /^`([^`]+)`$/u.exec(row.cells[0] ?? "")?.[1];
      if (id === undefined) problems.push({ rule: "catalogue", file, line: row.n, text: row.text, message: `${row.cells[0] ?? ""}: a catalogue entry's first cell is its id, in backticks` });
      else pack.catalogues[kind].push({ id, line: row.n });
    }
  }
}

/* ---------------------------------------------------------------------------
 * Module PRDs: requirements and criteria
 */

/**
 * A head shaped like a requirement or criterion id, `-F-`, `-N-` or `-AC-`
 * and digits, that the grammar refuses: a typo is reported rather than
 * skipped. Another family's ids under bold heads (`**S-1**`, `**OQ-3**`) are
 * prose: ksarjs lists its spikes that way, 17 times in PRDR-280's parity run.
 */
const ID_LIKE = /^(?:[A-Z][A-Z0-9]*-)*(?:F|N|AC)-(?:[A-Z0-9]+-)*\d+$/u;

/** The `[..]` tags that open a bullet's text, and the text after them. */
function leadingTags(rest: string): { readonly tags: string[]; readonly text: string } {
  const tags: string[] = [];
  let text = rest;
  for (let m = /^\s*\[([^\]]+)\]/u.exec(text); m !== null; m = /^\s*\[([^\]]+)\]/u.exec(text)) {
    tags.push(m[1]?.trim() ?? "");
    text = text.slice(m[0].length);
  }
  return { tags, text: text.trim() };
}

function parseModule(file: string, lines: readonly Line[], pack: Pack, problems: Problems): void {
  for (const bullet of boldBullets(lines)) {
    const at = { n: bullet.n, text: bullet.text };
    const { tags, text } = leadingTags(bullet.rest);
    const milestone = tags.map((t) => MILESTONE_ID.exec(t)?.[1]).find((m) => m !== undefined);
    const others = tags.filter((t) => !MILESTONE_ID.test(t) && t !== "withdrawn");
    const req = REQUIREMENT_ID.exec(bullet.head);
    const crit = CRITERION_ID.exec(bullet.head);
    if (req !== null) {
      const withdrawn = tags.includes("withdrawn");
      const candidate = {
        id: bullet.head,
        code: req[1],
        kind: req[2],
        milestone: withdrawn || milestone === undefined ? null : Number(milestone),
        withdrawn,
        level: withdrawn ? null : levelOf(text),
        text,
        tags: others,
        file,
        line: bullet.n,
      };
      push(pack.requirements, admit(requirementSchema, candidate, "requirement", file, at, bullet.head, problems));
    } else if (crit !== null) {
      const candidate = { id: bullet.head, code: crit[1], milestone: milestone === undefined ? null : Number(milestone), ...clauses(text), requirements: namedRequirements(text), tags: others, file, line: bullet.n };
      push(pack.criteria, admit(criterionSchema, candidate, "criterion", file, at, bullet.head, problems));
    } else if (ID_LIKE.test(bullet.head)) {
      problems.push({ rule: "requirement", file, line: bullet.n, text: at.text, message: `${bullet.head}: is neither a requirement id (<CODE>-F-nnn, <CODE>-N-nnn) nor a criterion id (<CODE>-AC-nn)` });
    }
  }
}

/** Given, When and Then, split at the first `when` and the first `then` after it. */
function clauses(text: string): { readonly given: string; readonly when: string; readonly then: string } {
  const m = /^(?:\([^)]*\)\s*)?given\b\s*(.*?)\s*,?\s*\bwhen\b\s*(.*?)\s*,?\s*\bthen\b\s*(.*)$/isu.exec(text.replaceAll("**", ""));
  if (m === null) return { given: "", when: "", then: "" };
  return { given: m[1]?.trim() ?? "", when: m[2]?.trim() ?? "", then: withoutTrailingRefs(m[3] ?? "") };
}

/** `then …, and it answers 409 (CHK-F-001).` loses the parenthetical of ids and the full stop. */
function withoutTrailingRefs(then: string): string {
  const refList = (inner: string) => inner.split(/[,–—]/u).every((part) => REQUIREMENT_ID.test(part.trim()));
  return then
    .trim()
    .replace(/\s*\(([^()]*)\)\s*\.?$/u, (all, inner: string) => (refList(inner) ? "" : all))
    .replace(/\.$/u, "")
    .trim();
}

/** Every requirement id the text names, ranges expanded, in the order they appear. */
export function namedRequirements(text: string): string[] {
  const out: string[] = [];
  const add = (id: string) => {
    if (!out.includes(id)) out.push(id);
  };
  for (const m of text.matchAll(new RegExp(REQUIREMENT_REFS.source, "gu"))) {
    const [, code = "", kind = "", from = "", endCode, endKind, to] = m;
    add(`${code}-${kind}-${from}`);
    if (to === undefined) continue;
    if (endCode !== code || endKind !== kind || Number(to) <= Number(from)) {
      add(`${endCode ?? ""}-${endKind ?? ""}-${to}`);
      continue;
    }
    for (let n = Number(from) + 1; n <= Number(to); n++) add(`${code}-${kind}-${String(n).padStart(3, "0")}`);
  }
  return out;
}

/**
 * The ids of `ids` the pack does not define as a requirement or a criterion,
 * in their order. Traceability (C-2⁷): a ticket's `requirement_ids` must
 * resolve here. No planning stage calls this yet, because SLICE and PLAN do
 * not read the pack (C-2⁸, C-4⁵); it is here so that "resolves in the pack"
 * has one definition before they do.
 */
export function unresolvedIds(pack: Pack, ids: readonly string[]): string[] {
  const known = new Set([...pack.requirements.map((r) => r.id), ...pack.criteria.map((c) => c.id)]);
  return [...new Set(ids)].filter((id) => !known.has(id));
}
