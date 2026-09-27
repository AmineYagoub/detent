import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { checkPack } from "../init/pack-check.js";
import { at as place } from "../init/pack-check-rules.js";
import type { AmendmentEdit, AmendmentRecord } from "../schemas/amendment.js";
import { currentPack, editIssue } from "./amendment-file.js";
import { readAmendment, writeAmendment } from "./amendment-store.js";
import { commitPaths } from "./git.js";
import { recordSpan } from "../init/plan-draft-checks.js";
import { appendNote } from "./tickets/mutations.js";

/**
 * X-4⁸ (PRDR-286) — the operator's decision on an amendment. No ticket moves
 * here: the filing ticket stays in NEEDS_HUMAN whatever is decided, and the
 * tickets the amendment held are held or freed by its status alone.
 *
 * A rejection records why, and frees the tickets. An approval, or an edit in
 * the operator's own words, changes the pack: the edits are made, the checker
 * must still find it green (C-2⁷), and the changed documents are committed,
 * so neither B-5's reset at a resume nor a finalize's sweep can take the
 * change. The amendment then holds its tickets until `detent init` has
 * re-validated the pack (C-2¹⁴) and re-planned the slices it changed (C-8⁵).
 */

export type AmendDecision =
  | { readonly kind: "approve" }
  | { readonly kind: "edit"; readonly edits: readonly AmendmentEdit[] }
  | { readonly kind: "reject"; readonly reason: string };

export interface AmendOutcome {
  readonly ok: boolean;
  readonly message: string;
}

export function decideAmendment(root: string, id: string, by: string, decision: AmendDecision, at: string): AmendOutcome {
  const record = readAmendment(root, id);
  if (record === null) return { ok: false, message: `no such amendment: ${id}` };
  if (record.status !== "open") return { ok: false, message: `${id} is ${record.status}: only an open amendment is decided` };
  if (decision.kind === "reject") {
    writeAmendment(root, { ...record, status: "rejected", decision: { kind: "rejected", by, at, reason: decision.reason } });
    appendNote(root, record.ticket, {
      author: by,
      text: `amendment ${id} rejected by ${by}: ${decision.reason} — the pack stands, the tickets it held return to the pool, and this ticket stays with you (X-4⁸)`,
    });
    return { ok: true, message: `${id}: rejected. The tickets it held return to the pool; ${record.ticket} stays NEEDS_HUMAN with the rejection as its note.` };
  }
  const edits = decision.kind === "edit" ? decision.edits : record.proposal.edits;
  const applied = applyEdits(root, edits, `${id}: amend the pack (X-4⁸)\n\n${decision.kind === "edit" ? "Edited" : "Approved"} by ${by}; filed by ${record.ticket}.`);
  if (typeof applied !== "string") return { ok: false, message: `${id} was not applied: ${applied.refusal}` };
  const done: AmendmentRecord = {
    ...record,
    status: "applied",
    decision: { kind: decision.kind === "edit" ? "edited" : "approved", by, at, edits: [...edits] },
    commit: applied,
  };
  writeAmendment(root, done);
  appendNote(root, record.ticket, {
    author: by,
    text: `amendment ${id} applied by ${by} at ${applied.slice(0, 12)}: run \`detent init\` to re-validate the pack and re-plan the slices it changed; this ticket returns to the queue then (X-4⁸)`,
  });
  return { ok: true, message: `${id}: applied at ${applied.slice(0, 12)}. Run \`detent init\`: VALIDATE re-validates the change and PLAN re-plans the slices it changed.` };
}

/**
 * Make `edits` to the pack, or say why not and leave it as it was. Each is
 * checked against the pack as it stands, then made in order, each replacing
 * text its document holds exactly once at that point; the checker must find
 * the result green, or every document is written back.
 */
function applyEdits(root: string, edits: readonly AmendmentEdit[], message: string): string | { readonly refusal: string } {
  const { pack, greenfield } = currentPack(root);
  const issues = edits.flatMap((e) => editIssue(root, pack, e) ?? []);
  if (issues.length > 0) return { refusal: issues.join("; ") };
  const original = new Map<string, string>();
  const changed = new Map<string, string>();
  for (const e of edits) {
    const file = (recordSpan(root, pack, e.id) as { readonly file: string }).file;
    const abs = path.join(root, ...file.split("/"));
    if (!original.has(file)) original.set(file, readFileSync(abs, "utf8"));
    const text = changed.get(file) ?? (original.get(file) as string);
    const found = text.split(e.old).length - 1;
    if (found !== 1) return { refusal: `after the edits before it, the edit to ${e.id} finds "${e.old}" ${String(found)} times in ${file}, not once` };
    changed.set(file, text.replace(e.old, () => e.new));
  }
  const restore = (): void => {
    for (const [file, text] of original) writeFileSync(path.join(root, ...file.split("/")), text);
  };
  for (const [file, text] of changed) writeFileSync(path.join(root, ...file.split("/")), text);
  const check = checkPack(root, currentPack(root).documents, { greenfield });
  if (!check.green) {
    restore();
    const blocking = check.findings.filter((f) => f.blocks).map((f) => `${place(f)} [${f.rule}] ${f.message}`);
    return { refusal: `the checker finds the amended pack red, so the pack was left as it was (C-2⁷): ${blocking.join("; ")}` };
  }
  try {
    return commitPaths(root, [...changed.keys()], message);
  } catch (err) {
    restore();
    return { refusal: `the amended documents could not be committed, so the pack was left as it was: ${(err as Error).message}` };
  }
}
