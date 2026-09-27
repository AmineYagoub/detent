import { z } from "zod";
import { SCHEMA_VERSION, isoTimestamp, nonEmptyString, ticketId } from "./common.js";

/**
 * X-4⁷ (PRDR-286) — an amendment: a falsification that names its fix.
 *
 * A session that proves the pack wrong writes it into `falsified.json` beside
 * its note. It names the requirements it affects and the class of defect,
 * carries its evidence, and proposes the text. Every record it cites is one
 * the pack holds, as a spec defect's are (C-4⁵), so the operator decides on
 * the pack's own words.
 */

/** A passage of the pack, by the record that holds it: a requirement, criterion, decision, default, fact or catalogue entry. */
export const amendmentPassageSchema = z.strictObject({ id: nonEmptyString, quote: nonEmptyString });

/**
 * One change to the pack. `old` is text the record's document holds exactly
 * once, in the lines that write the record, and `new` replaces it there.
 */
export const amendmentEditSchema = z.strictObject({
  id: nonEmptyString,
  old: nonEmptyString,
  new: z.string(),
});
export type AmendmentEdit = z.infer<typeof amendmentEditSchema>;

export const amendmentProposalSchema = z
  .strictObject({
    requirement_ids: z.array(nonEmptyString).min(1),
    /** Two passages that cannot both hold, a rule that holds together and is wrong, or one the pack leaves unsettled. */
    defect_class: z.enum(["contradiction", "wrong", "gap"]),
    evidence: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("test"), test: nonEmptyString, output: nonEmptyString }),
      z.strictObject({ kind: z.literal("passages"), passages: z.array(amendmentPassageSchema).min(2) }),
    ]),
    edits: z.array(amendmentEditSchema).min(1),
  })
  .superRefine((a, ctx) => {
    if (a.defect_class === "contradiction" && a.evidence.kind !== "passages") {
      ctx.addIssue({ code: "custom", path: ["evidence"], message: "a contradiction's evidence is the two passages that contradict each other" });
    }
  });
export type AmendmentProposal = z.infer<typeof amendmentProposalSchema>;

/**
 * `open` holds the tickets on its requirements until the operator decides.
 * `applied` still holds them: the pack says something new, and the plan does
 * not yet. `rejected` and `replanned` hold nothing.
 */
export const AMENDMENT_STATUSES = ["open", "rejected", "applied", "replanned"] as const;
export type AmendmentStatus = (typeof AMENDMENT_STATUSES)[number];

export const amendmentRecordSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  id: z.string().regex(/^AM-\d{3,}$/u),
  ticket: ticketId,
  filed_at: isoTimestamp,
  proposal: amendmentProposalSchema,
  status: z.enum(AMENDMENT_STATUSES),
  decision: z
    .strictObject({
      kind: z.enum(["approved", "edited", "rejected"]),
      by: nonEmptyString,
      at: isoTimestamp,
      reason: z.string().optional(),
      /** The edits applied: the proposal's, or the operator's in their place. */
      edits: z.array(amendmentEditSchema).optional(),
    })
    .optional(),
  /** The commit that carries the edit, so a reset to HEAD keeps it. */
  commit: z.string().optional(),
  /** C-8⁵: the slices the re-plan it ended in planned again. */
  replanned: z.array(nonEmptyString).optional(),
});
export type AmendmentRecord = z.infer<typeof amendmentRecordSchema>;
