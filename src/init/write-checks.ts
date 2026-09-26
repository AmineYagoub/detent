import { readFileSync } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { DECISION_LOG_PATH, REQUIREMENT_ID, packKindOf } from "../schemas/pack.js";
import type { WriteArtifact } from "../schemas/write.js";
import type { LogView } from "./decide-log.js";
import { PLANNING_NAMES } from "./discover-docs.js";
import type { PackCheck } from "./pack-check.js";
import { at } from "./pack-check-rules.js";
import { parsePack } from "./pack-parse.js";

/**
 * C-2¹³ (PRDR-283) — what code checks of WRITE's session: that its artifact
 * accounts for every original, that the decision log keeps every row it held,
 * that the pack cites what it relies on, and that the checker is green on it.
 *
 * Each check returns the session's issues, in words a relaunch can act on.
 * The first attempt is refused on any of them; the second keeps what stands,
 * and what code decided in its place is said aloud (`write.ts`).
 */

/** An original the artifact must place: anything not at one of the pack's paths, which is rewritten in place or left as it is. */
const movable = (rel: string): boolean => {
  const kind = packKindOf(rel);
  return kind === "context" || kind === null;
};

/** C-2: a document the discovery families name as planning by its file name, README's excepted. */
export const planningByName = (rel: string): boolean => picomatch.isMatch(path.posix.basename(rel), [...PLANNING_NAMES]);

export interface ListPlan {
  /** Originals code moves to `archive/`. */
  readonly archive: readonly string[];
  /** Originals that stay where they are, as context. */
  readonly context: readonly string[];
  /** Originals at the pack's paths the session rewrote in place: they stay, and code archives their original bytes. */
  readonly rewritten: readonly string[];
  /** What code decided where the artifact did not, for the operator. */
  readonly notes: readonly string[];
}

function listIssues(artifact: WriteArtifact, given: readonly string[], changed: (rel: string) => boolean): string[] {
  const issues: string[] = [];
  const listed = [...artifact.archive, ...artifact.context];
  const times = (rel: string): number => listed.filter((l) => l === rel).length;
  for (const rel of new Set(listed)) {
    if (rel === DECISION_LOG_PATH) issues.push(`${rel} is the decision log, which stays where it is: list it in neither archive nor context`);
    else if (!given.includes(rel)) issues.push(`${rel} is not one of the documents you were given`);
    else if (times(rel) > 1) issues.push(`${rel} is listed twice`);
  }
  for (const rel of new Set(artifact.context)) {
    if (!given.includes(rel) || times(rel) > 1) continue;
    if (!movable(rel)) issues.push(`${rel} is at one of the pack's paths, so it is part of the pack and not context: rewrite it in place or leave it as it is`);
    else if (packKindOf(rel) === null) issues.push(`${rel} is at a path the pack's layout does not hold, so it cannot stay: rewrite what it says into the pack and list it in archive`);
    else if (planningByName(rel)) issues.push(`${rel} is a planning document by its name, so it is rewritten into the pack and listed in archive, never kept as context`);
  }
  for (const rel of new Set(artifact.archive)) {
    if (given.includes(rel) && times(rel) === 1 && !movable(rel) && changed(rel)) {
      issues.push(`${rel} is listed in archive, and you rewrote it in place: list a document at the pack's paths in archive only to drop it from the pack`);
    }
  }
  for (const rel of given) if (movable(rel) && times(rel) === 0) issues.push(`${rel} is listed in neither archive nor context`);
  return issues;
}

/**
 * Where each original goes, and the artifact's issues. Where the artifact is
 * wrong, code decides: a planning document by its name, or one at a path the
 * layout does not hold, is archived, since neither can stay beside the pack;
 * any other document it did not place stays, as context.
 */
export function resolveLists(artifact: WriteArtifact, given: readonly string[], changed: (rel: string) => boolean): { readonly issues: string[]; readonly plan: ListPlan } {
  const archive: string[] = [];
  const context: string[] = [];
  const rewritten: string[] = [];
  const notes: string[] = [];
  for (const rel of given) {
    const inArchive = artifact.archive.includes(rel);
    const said = inArchive ? "" : artifact.context.includes(rel) ? "kept as context" : "did not list";
    if (!movable(rel)) {
      if (changed(rel)) rewritten.push(rel);
      else if (inArchive) archive.push(rel);
    } else if (packKindOf(rel) === null || planningByName(rel)) {
      archive.push(rel);
      if (said !== "") {
        const why = packKindOf(rel) === null ? "the pack's layout does not hold its path" : "a planning document is never context";
        notes.push(`WRITE archived ${rel}, which its session ${said}: ${why}`);
      }
    } else if (inArchive) {
      archive.push(rel);
    } else {
      context.push(rel);
      if (said === "did not list") notes.push(`WRITE left ${rel} where it is, as context: its session did not say whether it rewrote it`);
    }
  }
  return { issues: listIssues(artifact, given, changed), plan: { archive, context, rewritten, notes } };
}

/** Whether every line of `before` is still in `after`, in order: rows are only ever added to the log. */
function keepsEveryLine(before: string, after: string): boolean {
  const kept = after.split(/\r?\n/u);
  let at = 0;
  for (const line of before.split(/\r?\n/u)) {
    while (at < kept.length && kept[at] !== line) at += 1;
    if (at === kept.length) return false;
    at += 1;
  }
  return true;
}

/**
 * C-2¹² keeps the log the founder's record, and WRITE may only add to it:
 * defaults (`X-n`) for what the documents left open that DECIDE was not shown.
 * A decision is the founder's answer, and the stack DECIDE's, so neither is
 * WRITE's to add or change.
 */
export function logIssues(before: { readonly view: LogView; readonly text: string }, after: { readonly view: LogView; readonly text: string }): string[] {
  const issues: string[] = [];
  const rows = (view: LogView) => new Map<string, string>([...view.decisions, ...view.defaults].map((row) => [row.id, JSON.stringify(row)]));
  const was = rows(before.view);
  const now = rows(after.view);
  for (const id of before.view.ids) {
    if (!after.view.ids.has(id)) issues.push(`the decision log's ${id} is gone`);
    else if (was.has(id) && was.get(id) !== now.get(id)) issues.push(`the decision log's ${id} is changed`);
  }
  for (const d of after.view.decisions) {
    if (!before.view.ids.has(d.id)) issues.push(`the decision log gains ${d.id}, but a decision is the founder's answer: settle what it settles as a default (X-n)`);
  }
  if (JSON.stringify(before.view.stack) !== JSON.stringify(after.view.stack)) issues.push("the decision log's stack is not as DECIDE left it, and the stack is DECIDE's (D-10′)");
  if (issues.length === 0 && !keepsEveryLine(before.text, after.text)) issues.push("the decision log lost or changed a line it held: rows are only ever added to it");
  return issues;
}

/** An entry the pack must cite, and why, in the session's words. */
export interface Cited {
  readonly id: string;
  readonly why: string;
}

/** C-2⁶: every entry the pack relies on is cited by id where it is used, in the pack's own documents and not the log. */
export function citeIssues(root: string, docs: readonly string[], required: readonly Cited[]): string[] {
  const text = docs
    .filter((rel) => rel !== DECISION_LOG_PATH && !movable(rel))
    .map((rel) => readFileSync(path.join(root, ...rel.split("/")), "utf8"))
    .join("\n");
  /* A founder's log can hold any id, so it is escaped, and bounded by what is not a word character rather than by `\b`. */
  const cites = (id: string): boolean => new RegExp(`(?<!\\w)${id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?!\\w)`, "u").test(text);
  return required.filter((c) => !cites(c.id)).map((c) => `the pack does not cite ${c.id}, ${c.why}`);
}

/** Whether the pack holds a requirement, one the schema refused included: without one there is nothing to plan. */
export function holdsRequirement(root: string, docs: readonly string[], greenfield: boolean): boolean {
  const { pack, refused } = parsePack(root, docs, { greenfield });
  return pack.requirements.length > 0 || [...refused].some((id) => REQUIREMENT_ID.test(id));
}

const SHOWN = 20;

/** The checker's blocking findings, as the session is told them. */
export function checkerIssues(check: PackCheck): string[] {
  const blocking = check.findings.filter((f) => f.blocks);
  const more = blocking.length > SHOWN ? [`and ${String(blocking.length - SHOWN)} more blocking findings`] : [];
  return [...blocking.slice(0, SHOWN).map((f) => `the pack checker: ${at(f)} [${f.rule}] ${f.message}`), ...more];
}
