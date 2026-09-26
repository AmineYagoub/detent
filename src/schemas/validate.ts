import { z } from "zod";
import { SCHEMA_VERSION, nonEmptyString } from "./common.js";
import { SEVERITIES } from "./pack.js";

/**
 * C-2⁶, C-2¹⁴ (PRDR-284) — what VALIDATE's sessions write: a reviewer's
 * findings, and the writer's account of the findings it was given.
 */

/**
 * What a finding says is wrong: the nine kinds of defect the ksarjs review
 * brief named, stated for any pack. A category is what the finding is about,
 * and the severity is what it costs; neither decides the other.
 */
export const FINDING_CATEGORIES = [
  "contradiction",
  "fact",
  "invariant",
  "unsafe",
  "milestone",
  "untestable",
  "gap",
  "name-drift",
  "present-indicative",
] as const;

/** A passage a finding stands on, quoted from the line it starts on. Code checks that it is there. */
export const findingPlaceSchema = z.strictObject({ file: nonEmptyString, line: z.number().int().positive(), quote: nonEmptyString });
export type FindingPlace = z.infer<typeof findingPlaceSchema>;

export const reviewFindingSchema = z.strictObject({
  severity: z.enum(SEVERITIES),
  category: z.enum(FINDING_CATEGORIES),
  places: z.array(findingPlaceSchema).min(1, "names no place"),
  why: nonEmptyString,
  /** The smallest correct fix: which document changes, and to what. */
  fix: nonEmptyString,
  /** A verification's: the id of the finding it is what remains of, or null for a new one. */
  previous: nonEmptyString.nullable(),
});
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;

export const reviewArtifactSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  documents_read: z.array(nonEmptyString),
  findings: z.array(reviewFindingSchema),
});
export type ReviewArtifact = z.infer<typeof reviewArtifactSchema>;

/**
 * The writer's account: each finding it was given, by id, applied or declined
 * with its reason. A declined finding is left open, and the next round judges
 * the reason; the pack itself is what code checks.
 */
export const fixArtifactSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  applied: z.array(nonEmptyString),
  declined: z.array(z.strictObject({ id: nonEmptyString, reason: nonEmptyString })),
});
export type FixArtifact = z.infer<typeof fixArtifactSchema>;
