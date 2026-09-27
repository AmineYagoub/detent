import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { stateDir, writeArtifact } from "../fs/layout.js";
import { amendmentRecordSchema, type AmendmentRecord } from "../schemas/amendment.js";
import { parseArtifact } from "../schemas/common.js";
import type { Ticket } from "../schemas/ticket.js";

/**
 * X-4⁸ (PRDR-286) — where amendments are kept, and what they hold.
 *
 * One file per amendment under `.detent/amendments/`, committed beside the
 * pack it would change: the pack is the founder's record, and what was
 * proposed against it and decided belongs to the repository, not to one
 * machine's run state. An amendment holds the tickets on its requirements
 * from the moment it is filed until the re-plan it ends in (`open`, then
 * `applied`); a rejected or re-planned one holds nothing.
 */

export const AMENDMENTS = "amendments";

const amendmentsDir = (root: string): string => path.join(stateDir(root), AMENDMENTS);

/** Every amendment filed at this root, oldest first. A file that will not parse is named, as a torn ticket is (PRDR-137). */
export function readAmendments(root: string): AmendmentRecord[] {
  const dir = amendmentsDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^AM-\d{3,}\.json$/u.test(f))
    .map((f) => {
      const rel = `.detent/${AMENDMENTS}/${f}`;
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
      } catch (err) {
        throw new Error(`${rel} is not readable JSON (${(err as Error).message})`);
      }
      const parsed = parseArtifact(amendmentRecordSchema, raw);
      if (!parsed.ok) {
        throw new Error(`${rel} is invalid: ${parsed.reason === "newer-schema" ? `declares schema_version ${String(parsed.found)}, this build supports ${String(parsed.supported)}` : parsed.issues.join("; ")}`);
      }
      return parsed.value;
    })
    .sort((a, b) => amendmentNumber(a.id) - amendmentNumber(b.id));
}

const amendmentNumber = (id: string): number => Number(id.slice("AM-".length));

export function readAmendment(root: string, id: string): AmendmentRecord | null {
  return readAmendments(root).find((a) => a.id === id) ?? null;
}

export function writeAmendment(root: string, record: AmendmentRecord): void {
  writeArtifact(root, `${AMENDMENTS}/${record.id}.json`, amendmentRecordSchema.parse(record));
}

/** The next id at this root: one past the highest, never a reused number. */
export function nextAmendmentId(root: string): string {
  const top = Math.max(0, ...readAmendments(root).map((a) => amendmentNumber(a.id)));
  return `AM-${String(top + 1).padStart(3, "0")}`;
}

const holding = (a: AmendmentRecord): boolean => a.status === "open" || a.status === "applied";

/** The amendment holding `ticket`, if one does: the first that names one of its requirements. */
export function holdOf(amendments: readonly AmendmentRecord[], ticket: Pick<Ticket, "requirement_ids">): AmendmentRecord | null {
  return amendments.find((a) => holding(a) && a.proposal.requirement_ids.some((r) => ticket.requirement_ids.includes(r))) ?? null;
}

/** What an amendment waits on, as a pending reason says it: the operator's decision, or the re-plan. */
export function holdReason(a: AmendmentRecord): string {
  const on = a.proposal.requirement_ids.join(", ");
  if (a.status === "open") {
    return `held by amendment ${a.id} on ${on}, filed by ${a.ticket} and not yet decided: decide it at the escalation or with \`detent amend ${a.id} --approve | --edit <file> | --reject <reason>\` (X-4⁸)`;
  }
  return `held by amendment ${a.id} on ${on}, applied to the pack${a.commit === undefined ? "" : ` at ${a.commit.slice(0, 12)}`}: run \`detent init\` to re-validate the pack and re-plan the slices it changed (X-4⁸)`;
}

/** Each READY ticket an amendment holds, as a pending entry: work that waits on a human, so a run that leaves only this exits 10. */
export function heldEntries(root: string, tickets: readonly Ticket[]): { readonly id: string; readonly state: Ticket["state"]; readonly reason: string }[] {
  const amendments = readAmendments(root);
  if (amendments.length === 0) return [];
  return tickets.flatMap((t) => {
    const hold = t.state === "READY" ? holdOf(amendments, t) : null;
    return hold === null ? [] : [{ id: t.id, state: t.state, reason: holdReason(hold) }];
  });
}

/** The open amendment `ticket` filed, if any: what its escalation decides. */
export function openAmendmentOf(root: string, ticket: string): AmendmentRecord | null {
  return readAmendments(root).find((a) => a.ticket === ticket && a.status === "open") ?? null;
}

/** The amendment as the operator decides it: what it names, its evidence, and each edit it proposes. */
export function describeAmendment(a: AmendmentRecord): string {
  const p = a.proposal;
  const evidence =
    p.evidence.kind === "test"
      ? [`evidence: the test ${p.evidence.test} fails:`, ...p.evidence.output.split("\n").map((l) => `    ${l}`)]
      : ["evidence, in the pack's own words:", ...p.evidence.passages.map((q) => `  ${q.id}: "${q.quote}"`)];
  return [
    `amendment ${a.id} (${a.status}), filed by ${a.ticket}: a ${p.defect_class} in ${p.requirement_ids.join(", ")}`,
    ...evidence,
    "proposed edits:",
    ...p.edits.flatMap((e) => [`  ${e.id}:`, `    - ${e.old}`, `    + ${e.new}`]),
  ].join("\n");
}
