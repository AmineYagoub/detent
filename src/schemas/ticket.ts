import { z } from "zod";
import { STATES } from "./states.js";
import { SCHEMA_VERSION, glob, isoTimestamp, nonEmptyString } from "./common.js";

/**
 * A-1 Ticket, with X-8 attempt generations.
 *
 * `generations[]` is the divergence from the Python oracle recorded in PRD §13:
 * the oracle resets `attempts` on requeue, discarding the record. Here each
 * HUMAN_REQUEUE opens a new generation with zeroed counters while prior ones
 * remain immutable history. The current generation is the last element.
 */

/** Counters are per generation; scope metadata is CEILINGS', not duplicated here. */
export const countersSchema = z.strictObject({
  blind_fix_attempts: z.number().int().nonnegative().default(0),
  informed_fix_attempts: z.number().int().nonnegative().default(0),
  review_fix_attempts: z.number().int().nonnegative().default(0),
  research_sessions: z.number().int().nonnegative().default(0),
  hypotheses: z.number().int().nonnegative().default(0),
  sessions: z.number().int().nonnegative().default(0),
});
export type Counters = z.infer<typeof countersSchema>;

export const generationOutcomes = ["in_flight", "done", "blocked", "needs_human", "requeued"] as const;

export const generationSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  counters: countersSchema,
  outcome: z.enum(generationOutcomes),
  /** Requeue guidance recorded on the generation it opens (C-10, X-8). */
  reason: z.string().optional(),
  started_at: isoTimestamp,
  ended_at: isoTimestamp.optional(),
});
export type Generation = z.infer<typeof generationSchema>;

export const reviewTags = ["correctness", "requirement", "scope", "rules"] as const;

export const ticketSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  id: nonEmptyString,
  type: z.enum(["feature", "bug"]),
  title: nonEmptyString,
  description: z.string(),
  /** A-1: non-empty and testable. Emptiness is checkable; testability is the reviewer's. */
  acceptance_criteria: z.array(nonEmptyString).min(1),
  non_goals: z.array(z.string()).default([]),
  surface: z.array(glob).default([]),
  blockers: z.array(nonEmptyString).default([]),
  links: z
    .array(
      z.strictObject({
        rel: z.enum(["discovered_from", "upstream_bug", "quarantines", "related"]),
        ref: nonEmptyString,
      }),
    )
    .default([]),
  priority: z.number().int().default(0),
  risk_label: z.boolean().default(false),
  state: z.enum(STATES),
  /** X-8: at least one generation always exists; the current one is the last. */
  generations: z.array(generationSchema).min(1),
  /** Append-only. */
  notes: z
    .array(z.strictObject({ at: isoTimestamp, author: nonEmptyString, text: nonEmptyString }))
    .default([]),
});
export type Ticket = z.infer<typeof ticketSchema>;
