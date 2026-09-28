import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { AuditSurvey, Passage } from "../schemas/audit.js";

/**
 * C-2¹¹ (PRDR-281) — what code checks in what AUDIT's sessions write.
 *
 * A finding is only as good as the passage it stands on, and a model can
 * quote a sentence no document contains, or put a real one on the wrong line.
 * C-2⁶ has DECIDE turn every contradiction into a question for the founder,
 * so an invented one costs a person's attention, and an invented source makes
 * an external claim read as settled. Both are cheap to check by code and
 * impossible to check by reading the artifact, so code checks them.
 */

const squash = (text: string): string => text.replace(/\s+/gu, " ").trim();

/** The text of `rel` when it is a file inside the root; symbolic links are followed, as a package manager's are. */
function fileText(root: string, rel: string): string | null {
  const abs = path.resolve(root, rel);
  const back = path.relative(root, abs);
  if (back === "" || back.startsWith("..") || path.isAbsolute(back)) return null;
  try {
    return statSync(abs).isFile() ? readFileSync(abs, "utf8") : null;
  } catch {
    /* Absent or unreadable: not there, which is what the caller asks. */
    return null;
  }
}

const pathThere = (root: string, rel: string): boolean => {
  const abs = path.resolve(root, rel);
  const back = path.relative(root, abs);
  if (back.startsWith("..") || path.isAbsolute(back)) return false;
  try {
    statSync(abs);
    return true;
  } catch {
    /* Absent: not there. */
    return false;
  }
};

/**
 * Whether `quote`, squashed, starts on `line` of `lines`. A quote may run
 * across line breaks, so the lines after it are joined until they are long
 * enough to hold a match that starts on the line itself.
 */
function startsOn(lines: readonly string[], line: number, quote: string): boolean {
  const head = squash(lines[line - 1] ?? "");
  let window = head;
  for (let i = line; i < lines.length && window.length < head.length + quote.length; i += 1) {
    const next = squash(lines[i] ?? "");
    if (next !== "") window = window === "" ? next : `${window} ${next}`;
  }
  const at = window.indexOf(quote);
  return at !== -1 && at < head.length;
}

/** Whether `quote` is in `file`, whitespace aside, starting on `line`. */
export function passageAt(root: string, passage: Passage): boolean {
  const text = fileText(root, passage.file);
  return text !== null && startsOn(text.split(/\r?\n/u), passage.line, squash(passage.quote));
}

/**
 * C-2²⁵ (PRDR-315): the line `passage`'s quote starts on, whitespace aside:
 * the one it names when that holds it, or else the one line of its file that
 * does. Null when none does, or more than one does, since a quote found twice
 * cannot say which it meant. A session that quotes a sentence word for word
 * and misnumbers its line has invented nothing, and code can find the line.
 */
export function lineOf(root: string, passage: Passage): number | null {
  const text = fileText(root, passage.file);
  if (text === null) return null;
  const lines = text.split(/\r?\n/u);
  const quote = squash(passage.quote);
  if (startsOn(lines, passage.line, quote)) return passage.line;
  const found = lines.flatMap((_, i) => (startsOn(lines, i + 1, quote) ? [i + 1] : []));
  return found.length === 1 ? (found[0] ?? null) : null;
}

/** `file:from → to`, for the operator: a passage code found on another line than the one it named. */
export const moveOf = (passage: Passage, line: number): string => `${passage.file}:${String(passage.line)} → ${String(line)}`;

/** The note an artifact's moved passages earn, once per artifact (C-2²⁵). */
export function movedNote(stage: string, moved: readonly string[]): string {
  const one = moved.length === 1;
  return `${stage}: ${String(moved.length)} ${one ? "quote was" : "quotes were"} not on the line ${one ? "it" : "they"} named, and ${one ? "stands" : "stand"} on the one line that holds ${one ? "it" : "each"}: ${moved.join(", ")} (C-2²⁵)`;
}

/**
 * C-2¹¹: why a verdict's `source` cannot settle its claim, or null when it
 * can. A link is taken as given, since checking it would mean fetching it. A
 * repository path, with an optional `:line` or `:line-line`, must be a file
 * that is there and has those lines, and not one of the documents being
 * checked, which cannot settle a claim they make.
 */
export function sourceIssue(root: string, source: string, documents: readonly string[]): string | null {
  if (/^https?:\/\//iu.test(source)) return null;
  const match = /^(.*?)(?::(\d+)(?:-(\d+))?)?$/u.exec(source.trim());
  const rel = match?.[1] ?? source;
  if (documents.includes(rel)) {
    return `the verdict's source, ${source}, is one of the documents being checked, and a document cannot settle a claim it makes`;
  }
  const text = fileText(root, rel);
  if (text === null) return `the verdict's source, ${source}, is neither a link nor a file in this repository`;
  if (match?.[2] === undefined) return null;
  const first = Number(match[2]);
  const last = Number(match[3] ?? match[2]);
  const lines = text === "" ? 0 : text.replace(/\r?\n$/u, "").split(/\r?\n/u).length;
  return first >= 1 && first <= last && last <= lines ? null : `the verdict's source, ${source}, cites a line ${rel} does not have`;
}

export interface Dropped {
  readonly kind: "contradiction" | "gap" | "drift" | "claim";
  /** Each passage that is not there, as `file:line`. */
  readonly passage: string;
  readonly reason: string;
}

export interface SurveyCheck {
  /** Everything a relaunch is told, each naming what to fix; empty when the survey stands as written. */
  readonly issues: readonly string[];
  /** The survey without the findings that stand on nothing (C-2¹¹). */
  readonly kept: AuditSurvey;
  readonly dropped: readonly Dropped[];
  /** Documents the survey was given and says it did not read. */
  readonly unread: readonly string[];
  /** Each passage of what is kept that stands on another line than it named, as `file:from → to` (C-2²⁵). */
  readonly moved: readonly string[];
}

const where = (p: Passage): string => `${p.file}:${String(p.line)}`;

/**
 * C-2¹¹: check a survey against the documents it was given. A passage must be
 * in one of those documents, at its `file:line`, or on one other line of it,
 * where it then stands (C-2²⁵); a drift finding needs code to drift from, so
 * none stands in a greenfield project, and the code it names must be there.
 * What fails is listed for the relaunch and removed from what is kept, so the
 * second attempt's survey is recorded without it.
 */
export function checkSurvey(
  root: string,
  survey: AuditSurvey,
  opts: { readonly documents: readonly string[]; readonly greenfield: boolean },
): SurveyCheck {
  const lineIn = (p: Passage): number | null => (opts.documents.includes(p.file) ? lineOf(root, p) : null);
  const dropped: Dropped[] = [];
  const missing: Passage[] = [];
  const moved: string[] = [];
  /** The items whose every passage is there, each with its passages at the lines that hold them. */
  const keep = <T>(
    kind: Dropped["kind"],
    items: readonly T[],
    passages: (item: T) => readonly Passage[],
    placed: (item: T, at: readonly Passage[]) => T,
    extra?: (item: T) => string | null,
  ): T[] =>
    items.flatMap((item) => {
      const at = passages(item).map((p) => ({ p, line: lineIn(p) }));
      const gone = at.flatMap((a) => (a.line === null ? [a.p] : []));
      const why = gone.length > 0 ? "not at its file:line in the documents" : (extra?.(item) ?? null);
      if (why === null) {
        moved.push(...at.flatMap((a) => (a.line !== null && a.line !== a.p.line ? [moveOf(a.p, a.line)] : [])));
        return [placed(item, at.map((a) => ({ ...a.p, line: a.line ?? a.p.line })))];
      }
      missing.push(...gone);
      dropped.push({ kind, passage: (gone.length > 0 ? gone : passages(item)).map(where).join(", "), reason: why });
      return [];
    });

  const unread = opts.documents.filter((d) => !survey.documents_read.includes(d));
  const contradictions = keep("contradiction", survey.contradictions, (c) => c.passages, (c, at) => ({ ...c, passages: [...at] }));
  const gaps = keep("gap", survey.gaps, (g) => g.passages, (g, at) => ({ ...g, passages: [...at] }));
  const greenfieldDrift = opts.greenfield ? survey.drift.length : 0;
  const absentCode = new Set<string>();
  const drift = keep("drift", survey.drift, (d) => [d.passage], (d, at) => ({ ...d, passage: at[0] ?? d.passage }), (d) => {
    if (opts.greenfield) return "drift in a greenfield project, where there is no code to drift from";
    const absent = d.code_checked.filter((rel) => !pathThere(root, rel));
    for (const rel of absent) absentCode.add(rel);
    return absent.length > 0 ? `the code it names is not there: ${absent.join(", ")}` : null;
  });
  const claims = keep("claim", survey.claims, (c) => [c.passage], (c, at) => ({ ...c, passage: at[0] ?? c.passage }));

  const issues = [
    ...(unread.length > 0 ? [`the survey did not read every document it was given: ${unread.join(", ")}`] : []),
    ...(greenfieldDrift > 0 ? [`${String(greenfieldDrift)} drift finding(s) in a greenfield project, where there is no code to drift from; drift must be empty`] : []),
    ...(missing.length > 0
      ? [
          `${String(missing.length)} passage(s) are not at the file:line they cite, whitespace aside, in the documents you were given: ${missing
            .map((p) => `${where(p)} ${JSON.stringify(p.quote)}`)
            .join(", ")}`,
        ]
      : []),
    ...(absentCode.size > 0 ? [`drift names code that is not there: ${[...absentCode].join(", ")}`] : []),
  ];
  return { issues, kept: { ...survey, contradictions, gaps, drift, claims }, dropped, unread, moved };
}
