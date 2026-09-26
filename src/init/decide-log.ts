import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { StackEntry } from "../schemas/decide.js";
import { DECISION_LOG_PATH } from "../schemas/pack.js";
import { readLines, sections, tableRows } from "./pack-markdown.js";
import { parsePack } from "./pack-parse.js";

/**
 * C-2¹² (PRDR-282) — the decision log, read and extended in the pack's own
 * grammar (C-2⁷), so every row DECIDE adds is one the checker reads.
 *
 * DECIDE never rewrites a row. It appends its own under a `###` heading of its
 * own in each section, which is how a long log groups its entries, and leaves
 * everything else in the file as it was: the log is the founder's record, and
 * an answer or a veto is an edit a person makes to it.
 */

export interface DecidedStack extends StackEntry {
  /** The D-n or X-n that settled it. */
  readonly decision: string;
}

export interface LogView {
  readonly exists: boolean;
  /**
   * Every id in the first column of a `## Decisions` or `## Defaults` table, as
   * written: an entry is citable as settling an item even where the grammar
   * refuses its id, since a founder's log is read as its founder wrote it:
   * making it a pack is WRITE's (C-2⁶), which is not built.
   */
  readonly ids: ReadonlySet<string>;
  readonly decisions: readonly { readonly id: string; readonly question: string; readonly answer: string; readonly reason: string }[];
  readonly defaults: readonly { readonly id: string; readonly value: string; readonly reason: string }[];
  readonly stack: DecidedStack | null;
  /** A `## Stack` section, whether the grammar takes it or not: DECIDE never writes a second one. */
  readonly hasStack: boolean;
  /** The gate slots `## Packages` already declares for the root package. */
  readonly rootSlots: ReadonlySet<string>;
}

export function decisionLogFile(root: string): string {
  return path.join(root, ...DECISION_LOG_PATH.split("/"));
}

const EMPTY: LogView = { exists: false, ids: new Set(), decisions: [], defaults: [], stack: null, hasStack: false, rootSlots: new Set() };

export function readDecisionLog(root: string): LogView {
  if (!existsSync(decisionLogFile(root))) return EMPTY;
  const parts = sections(readLines(root, DECISION_LOG_PATH));
  const ids = new Set(
    ["decisions", "defaults"].flatMap((name) => tableRows(parts.get(name) ?? []).map((row) => row.cells[0] ?? "").filter((id) => id !== "")),
  );
  const { pack } = parsePack(root, [DECISION_LOG_PATH], { greenfield: false });
  return {
    exists: true,
    ids,
    decisions: pack.decisions.map((d) => ({ id: d.id, question: d.question, answer: d.answer, reason: d.reason })),
    defaults: pack.defaults.map((d) => ({ id: d.id, value: d.value, reason: d.reason })),
    stack: pack.stack === null ? null : { ...pack.stack, gates: { ...pack.stack.gates } },
    hasStack: parts.has("stack"),
    rootSlots: new Set(Object.keys(pack.packages.find((p) => p.path === ".")?.gates ?? {})),
  };
}

/** The next free `D-n` or `X-n`, counting every id the log already holds. */
export function nextId(ids: Iterable<string>, prefix: "D" | "X"): (offset: number) => string {
  let top = 0;
  for (const id of ids) {
    const n = new RegExp(`^${prefix}-(\\d+)$`, "u").exec(id)?.[1];
    if (n !== undefined) top = Math.max(top, Number(n));
  }
  return (offset) => `${prefix}-${String(top + 1 + offset)}`;
}

/** A table cell: one line, and a bar in it escaped, as the grammar reads it back (`\|`). */
const cell = (text: string): string => text.replace(/\s+/gu, " ").trim().replaceAll("|", "\\|");
const row = (cells: readonly string[]): string => `| ${cells.map(cell).join(" | ")} |`;
const table = (header: readonly string[], rows: readonly (readonly string[])[]): string[] => [
  row(header),
  `|${header.map(() => "---").join("|")}|`,
  ...rows.map(row),
];

const HEADING = /^##\s+(?:\d+(?:\.\d+)*\.?\s+)?(.+?)\s*$/u;

/** Lines inside a fenced block, which the grammar reads as blank: never a heading, never a table. */
function fencedMask(lines: readonly string[]): boolean[] {
  let fence: string | null = null;
  return lines.map((text) => {
    if (fence === null) {
      fence = /^\s*(`{3,}|~{3,})/u.exec(text)?.[1] ?? null;
      return fence !== null;
    }
    const close = /^\s*(`{3,}|~{3,})\s*$/u.exec(text)?.[1];
    if (close !== undefined && close[0] === fence[0] && close.length >= fence.length) fence = null;
    return true;
  });
}

/**
 * Put `rows` under `### sub` in `## title`: after the rows already there when
 * DECIDE wrote that heading before, as a new subsection at the end of the
 * section when it did not, and as a new section at the end of the file when the
 * log has no such section.
 */
function insertRows(lines: string[], title: string, sub: string, header: readonly string[], rows: readonly (readonly string[])[]): void {
  if (rows.length === 0) return;
  const fenced = fencedMask(lines);
  const isHeading = (i: number): boolean => !fenced[i] && HEADING.test(lines[i] ?? "");
  const start = lines.findIndex((text, i) => isHeading(i) && HEADING.exec(text)?.[1]?.toLowerCase() === title.toLowerCase());
  if (start === -1) {
    while (lines.length > 0 && lines.at(-1)?.trim() === "") lines.pop();
    lines.push("", `## ${title}`, "", `### ${sub}`, "", ...table(header, rows), "");
    return;
  }
  let end = start + 1;
  while (end < lines.length && !isHeading(end)) end += 1;
  const subAt = lines.findIndex((text, i) => i > start && i < end && !fenced[i] && text.trim() === `### ${sub}`);
  if (subAt !== -1) {
    let last = -1;
    for (let i = subAt + 1; i < end && !(/^#{2,}\s/u.test(lines[i] ?? "") && !fenced[i]); i += 1) {
      if (!fenced[i] && (lines[i] ?? "").trim().startsWith("|")) last = i;
    }
    if (last !== -1) {
      lines.splice(last + 1, 0, ...rows.map(row));
      return;
    }
    lines.splice(subAt + 1, 0, "", ...table(header, rows));
    return;
  }
  let at = end;
  while (at > start + 1 && (lines[at - 1] ?? "").trim() === "") at -= 1;
  lines.splice(at, 0, "", `### ${sub}`, "", ...table(header, rows), ...((lines[at] ?? "").trim() === "" ? [] : [""]));
}

const NEW_LOG = [
  "# Founder decisions",
  "",
  "What `detent init` asked the founder, and what it settled without asking. A row here wins over the documents it",
  "settles (C-2⁷). To veto a default, edit its row, and re-run `detent init`.",
];

export interface LogAdditions {
  readonly decisions: readonly { readonly id: string; readonly question: string; readonly answer: string; readonly reason: string }[];
  readonly defaults: readonly { readonly id: string; readonly value: string; readonly reason: string }[];
  readonly stack: DecidedStack | null;
}

/** Append what DECIDE settled; nothing already in the log is changed or moved. */
export function appendToDecisionLog(root: string, log: LogView, add: LogAdditions): void {
  if (add.decisions.length === 0 && add.defaults.length === 0 && add.stack === null) return;
  const file = decisionLogFile(root);
  const text = log.exists ? readFileSync(file, "utf8") : `${NEW_LOG.join("\n")}\n`;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/u);
  insertRows(lines, "Decisions", "Asked at DECIDE", ["Id", "Question", "Answer", "Reason"], add.decisions.map((d) => [d.id, d.question, `**${d.answer}**`, d.reason]));
  insertRows(lines, "Defaults", "Settled at DECIDE", ["Id", "Default", "Reason"], add.defaults.map((d) => [d.id, d.value, d.reason]));
  if (add.stack !== null && !log.hasStack) {
    const s = add.stack;
    const scaffold = s.scaffold_files.map((f) => `\`${f}\``).join(", ");
    insertRows(lines, "Stack", "Settled at DECIDE", ["Field", "Value"], [
      ["decision", s.decision],
      ["language", s.language],
      ["toolchain", s.toolchain],
      ...(scaffold === "" ? [] : [["scaffold", scaffold]]),
    ]);
    const slots = Object.entries(s.gates).filter(([slot]) => !log.rootSlots.has(slot));
    insertRows(lines, "Packages", "Settled at DECIDE", ["Package", "Slot", "Command"], slots.map(([slot, command]) => [".", slot, `\`${command}\``]));
  }
  if (lines.at(-1) !== "") lines.push("");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, lines.join(eol));
}
