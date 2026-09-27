import { readFileSync } from "node:fs";
import path from "node:path";
import { discover as discoverStack } from "../adapter/discover/index.js";
import { isGreenfield } from "../init/greenfield.js";
import { packDocuments } from "../init/pack.js";
import { parsePack } from "../init/pack-parse.js";
import { passageIssue, recordSpan } from "../init/plan-draft-checks.js";
import { amendmentProposalSchema, type AmendmentEdit, type AmendmentProposal, type AmendmentRecord } from "../schemas/amendment.js";
import { SCHEMA_VERSION } from "../schemas/common.js";
import type { Pack } from "../schemas/pack.js";
import { nextAmendmentId, writeAmendment } from "./amendment-store.js";
import { containsSecrets, scrub } from "./scrub.js";
import { appendNote } from "./tickets/mutations.js";

/**
 * X-4⁸ (PRDR-286) — filing an amendment: what the referee checks before it
 * holds anything.
 *
 * An amendment holds tickets and asks the operator to change the pack, so it
 * is filed only when it is about the pack as it stands. Every requirement it
 * names is one the pack defines, every passage it quotes is in the record
 * whose id it gives, as a spec defect's must be (C-4⁵), and every edit
 * replaces text its record's document holds exactly once, in the lines that
 * write that record. One that fails any of these is refused with the reasons,
 * and the falsification it came with stands on its own (X-4).
 */

export type Filing = { readonly kind: "filed"; readonly record: AmendmentRecord } | { readonly kind: "refused"; readonly reason: string };

/** The pack at `root` as VALIDATE reads it: every document, greenfield by the stack markers (D-10′). */
export function currentPack(root: string): { readonly pack: Pack; readonly documents: readonly string[]; readonly greenfield: boolean } {
  const documents = packDocuments(root);
  const greenfield = isGreenfield(discoverStack(root).stack.markers);
  return { pack: parsePack(root, documents, { greenfield }).pack, documents, greenfield };
}

const lineOf = (text: string, index: number): number => text.slice(0, index).split("\n").length;

/** Why `edit` cannot be made to the pack as it stands; null when it can. */
export function editIssue(root: string, pack: Pack, edit: AmendmentEdit): string | null {
  const span = recordSpan(root, pack, edit.id);
  if (span === null) return `an edit names ${edit.id}, which is no requirement, criterion, decision, default, fact or catalogue entry of the pack`;
  const text = readFileSync(path.join(root, ...span.file.split("/")), "utf8");
  const at = text.indexOf(edit.old);
  if (at === -1) return `an edit to ${edit.id} replaces "${edit.old}", which ${span.file} does not hold`;
  if (text.indexOf(edit.old, at + 1) !== -1) return `an edit to ${edit.id} replaces "${edit.old}", which ${span.file} holds more than once: quote enough of the record to name one place`;
  const first = lineOf(text, at);
  const last = lineOf(text, at + edit.old.length - 1);
  if (first < span.first || last > span.last) {
    return `an edit to ${edit.id} replaces text on ${span.file}:${String(first)}, outside the lines that write ${edit.id} (${String(span.first)}-${String(span.last)})`;
  }
  return null;
}

/** Each reason the proposal is not about the pack as it stands, or none. */
export function proposalIssues(root: string, pack: Pack, proposal: AmendmentProposal): string[] {
  const issues: string[] = [];
  for (const id of proposal.requirement_ids) {
    if (!pack.requirements.some((r) => r.id === id)) issues.push(`it names requirement ${id}, which the pack does not define`);
  }
  if (proposal.evidence.kind === "passages") {
    for (const p of proposal.evidence.passages) {
      const issue = passageIssue(root, pack, p);
      if (issue !== null) issues.push(issue);
    }
  }
  for (const e of proposal.edits) {
    const issue = editIssue(root, pack, e);
    if (issue !== null) issues.push(issue);
  }
  if (proposal.edits.some((e) => containsSecrets(e.new))) issues.push("an edit's new text looks like it carries a secret, and the pack is committed (SEC-4)");
  return issues;
}

/**
 * File what the session wrote under `amendment` in `falsified.json`, or say
 * why not. SEC-4: the evidence is the session's own free text and is scrubbed
 * before it is written; the passages and each edit's `old` are the pack's
 * words, which a scrub could only stop matching.
 */
export function fileAmendment(root: string, ticket: string, raw: unknown, at: string): Filing {
  const parsed = amendmentProposalSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "refused", reason: parsed.error.issues.map((i) => `${i.path.length > 0 ? i.path.join(".") : "amendment"}: ${i.message}`).join("; ") };
  }
  const evidence = parsed.data.evidence;
  const proposal: AmendmentProposal = {
    ...parsed.data,
    evidence: evidence.kind === "test" ? { kind: "test", test: scrub(evidence.test), output: scrub(evidence.output) } : evidence,
  };
  let issues: string[];
  try {
    issues = proposalIssues(root, currentPack(root).pack, proposal);
  } catch (err) {
    issues = [`the pack could not be read: ${(err as Error).message}`];
  }
  if (issues.length > 0) return { kind: "refused", reason: issues.join("; ") };
  const record: AmendmentRecord = { schema_version: SCHEMA_VERSION, id: nextAmendmentId(root), ticket, filed_at: at, proposal, status: "open" };
  writeAmendment(root, record);
  return { kind: "filed", record };
}

/**
 * File the amendment a falsification carried and say so on the ticket, where
 * the operator reads why it is pending. The id when it was filed, null when
 * the pack refused it.
 */
export function fileSignalled(root: string, ticket: string, raw: unknown, at: string): string | null {
  const filing = fileAmendment(root, ticket, raw, at);
  if (filing.kind === "refused") {
    appendNote(root, ticket, { author: "kernel", text: `amendment refused: ${filing.reason} — the falsification stands without it (X-4⁸)` });
    return null;
  }
  const { id, proposal } = filing.record;
  appendNote(root, ticket, {
    author: "kernel",
    text:
      `amendment ${id} filed (X-4⁸): a ${proposal.defect_class} in ${proposal.requirement_ids.join(", ")}. The tickets on them are held until it is decided: ` +
      `decide it at the escalation or with \`detent amend ${id} --approve | --edit <file> | --reject <reason>\``,
  });
  return id;
}
