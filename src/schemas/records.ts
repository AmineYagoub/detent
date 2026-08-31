import { z } from "zod";
import { EVENTS, STATES } from "./states.js";
import { SCHEMA_VERSION, isoTimestamp, nonEmptyString, sha256Hex } from "./common.js";
import { countersSchema, reviewTags } from "./ticket.js";
import { GATE_SLOTS } from "./gates.js";
import { requireLocalSearchBeforeWeb } from "./init.js";

/** A-3 Hypothesis (X-4). A root cause is inadmissible as prose. */
export const hypothesisSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  claim: nonEmptyString,
  evidence: z
    .array(z.strictObject({ file: nonEmptyString, line: z.number().int().positive(), what: nonEmptyString }))
    .min(1),
  repro_test: nonEmptyString,
  predicted_failure: nonEmptyString,
  status: z.enum(["proposed", "confirmed", "falsified"]),
});
export type Hypothesis = z.infer<typeof hypothesisSchema>;

/**
 * A-4 Research brief (X-6, X-6a). A brief citing any URL must carry a
 * non-empty `local_search` record — tiers 1-2 consulted before the web.
 */
export const researchBriefSchema = z
  .strictObject({
    schema_version: z.literal(SCHEMA_VERSION),
    failure_signature: nonEmptyString,
    cache_key: sha256Hex,
    root_cause: z.strictObject({ claim: nonEmptyString, confidence: z.enum(["low", "medium", "high"]) }),
    evidence: z.array(z.strictObject({ source: nonEmptyString, claim: nonEmptyString })).min(1),
    version_facts: z.record(z.string(), z.string()).default({}),
    recommended_fix: z.strictObject({ strategy: nonEmptyString }),
    alternative: z.string().optional(),
    what_would_falsify: nonEmptyString,
    upstream_bug: z.string().optional(),
    sources_consulted: z
      .array(z.strictObject({ tier: z.number().int().min(1).max(6), ref: nonEmptyString }))
      .default([]),
    local_search: z.strictObject({
      docs_checked: z.array(z.string()).default([]),
      code_checked: z.array(z.string()).default([]),
    }),
  })
  /*
   * T-063: one X-6a validator, shared with the planning-brief schema, so the
   * two research kinds cannot drift apart on the rule that binds both.
   */
  .superRefine(requireLocalSearchBeforeWeb);
export type ResearchBrief = z.infer<typeof researchBriefSchema>;

/** A-5 Review. Style is not a finding — the tag set is closed. */
export const reviewSchema = z
  .strictObject({
    schema_version: z.literal(SCHEMA_VERSION),
    verdict: z.enum(["approve", "changes"]),
    changes: z
      .array(
        z.strictObject({
          tag: z.enum(reviewTags),
          finding: nonEmptyString,
          file: z.string().optional(),
        }),
      )
      .default([]),
  })
  .superRefine((review, ctx) => {
    if (review.verdict === "changes" && review.changes.length === 0) {
      ctx.addIssue({ code: "custom", path: ["changes"], message: "verdict 'changes' requires at least one finding" });
    }
  });
export type Review = z.infer<typeof reviewSchema>;

/** A-6 Binding record (V-2). */
export const bindingSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  slot: z.enum(GATE_SLOTS),
  adapter: nonEmptyString,
  ref: nonEmptyString,
  resolved: nonEmptyString,
  pm: z.string().optional(),
  config_hash: sha256Hex,
  executed_at: isoTimestamp,
  approved_by: nonEmptyString,
  status: z.enum(["provisional", "approved"]),
});
export type Binding = z.infer<typeof bindingSchema>;

/** A-7 Checkpoint (F-4). */
export const checkpointSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  phase: nonEmptyString,
  inputs_hash: sha256Hex,
  outputs: z.record(z.string(), z.unknown()),
  at: isoTimestamp,
});
export type Checkpoint = z.infer<typeof checkpointSchema>;

/** A-8 Dossier (C-10). Cumulative across generations (X-8). */
export const dossierSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  ticket: nonEmptyString,
  reason: nonEmptyString,
  generations: z.array(z.strictObject({ index: z.number().int().nonnegative(), counters: countersSchema })),
  last_signatures: z.array(nonEmptyString).default([]),
  artifact_index: z.array(nonEmptyString).default([]),
  suggested_resolutions: z.array(nonEmptyString).default([]),
});
export type Dossier = z.infer<typeof dossierSchema>;

/** F-1 `transitions.jsonl` line. Local set — not schema_version stamped. */
export const transitionLineSchema = z.strictObject({
  at: isoTimestamp,
  ticket: nonEmptyString,
  generation: z.number().int().nonnegative(),
  from: z.enum(STATES),
  event: z.enum(EVENTS),
  to: z.enum(STATES),
  evidence: z.string(),
  counters: countersSchema,
});
export type TransitionLine = z.infer<typeof transitionLineSchema>;

/**
 * F-1 `ledger.jsonl` row (S-4). Cost is recorded as an estimate because the
 * backend computes it client-side from a bundled price table (PRDR-052).
 * `partial` marks a row reconstructed after a crash, where the backend zeroes
 * its telemetry rather than omitting it (PRDR-053).
 */
export const ledgerRowSchema = z.strictObject({
  at: isoTimestamp,
  ticket: nonEmptyString,
  generation: z.number().int().nonnegative(),
  role: nonEmptyString,
  cost_estimate_usd: z.number().nonnegative(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_read_input_tokens: z.number().int().nonnegative().default(0),
  cache_creation_input_tokens: z.number().int().nonnegative().default(0),
  turns: z.number().int().nonnegative(),
  /**
   * PRDR-095: the model(s) that actually served the session, from the SDK's
   * per-model breakdown. Additive with a default, so rows written before this
   * field read back as `[]` rather than failing (the `cache_*` precedent).
   * Without it a green N-7 gate cannot be audited for what produced it.
   */
  models: z.array(nonEmptyString).default([]),
  /**
   * PRDR-097: `turns_breach` is separated from `crash`. Both zero their
   * telemetry, but one is the operator's ceiling and one is the backend, and
   * an audit that cannot tell them apart cannot explain a $0 row that did work.
   */
  partial: z.enum(["crash", "turns_breach"]).optional(),
});
export type LedgerRow = z.infer<typeof ledgerRowSchema>;

/**
 * A-2 Plan. Ordered ticket refs, dependency edges, per-ticket agent
 * assignment, and the hashes of the documents the plan was derived from —
 * C-8 replays from the first checkpoint whose inputs drifted, so the plan
 * records what it read.
 */
export const planSchema = z
  .strictObject({
    schema_version: z.literal(SCHEMA_VERSION),
    tickets: z.array(nonEmptyString).min(1),
    edges: z
      .array(z.strictObject({ from: nonEmptyString, to: nonEmptyString }))
      .default([]),
    assignments: z.record(z.string(), nonEmptyString).default({}),
    input_doc_hashes: z.record(z.string(), sha256Hex).default({}),
  })
  .superRefine((plan, ctx) => {
    const known = new Set(plan.tickets);
    if (known.size !== plan.tickets.length) {
      ctx.addIssue({ code: "custom", path: ["tickets"], message: "duplicate ticket ref" });
    }
    for (const [i, e] of plan.edges.entries()) {
      for (const side of ["from", "to"] as const) {
        if (!known.has(e[side])) {
          ctx.addIssue({
            code: "custom",
            path: ["edges", i, side],
            message: `dependency edge references unknown ticket '${e[side]}'`,
          });
        }
      }
    }
    for (const ref of Object.keys(plan.assignments)) {
      if (!known.has(ref)) {
        ctx.addIssue({
          code: "custom",
          path: ["assignments", ref],
          message: `assignment references unknown ticket '${ref}'`,
        });
      }
    }
  });
export type Plan = z.infer<typeof planSchema>;

/** C-7: approval is recorded with who, when, and the hash of what was approved. */
export const approvalSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  approved_by: nonEmptyString,
  at: isoTimestamp,
  plan_hash: sha256Hex,
});
export type Approval = z.infer<typeof approvalSchema>;

/**
 * F-1's `bindings.json`: the committed collection of A-6 records. One file, so
 * V-3 can re-resolve every slot in one read before a gate runs.
 */
export const bindingsFileSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  bindings: z.array(bindingSchema).default([]),
  /** V-1: slots deliberately left unbound, with who acknowledged it and when. */
  skips: z
    .array(
      z.strictObject({
        slot: bindingSchema.shape.slot,
        acknowledged_by: nonEmptyString,
        at: isoTimestamp,
      }),
    )
    .default([]),
});
export type BindingsFile = z.infer<typeof bindingsFileSchema>;

/**
 * F-1 `agents/assignments.json` (S-7): per-ticket role references, pinned as
 * `role@hash` against the vendored prompt manifest. Resolution fails closed on
 * an unknown role or hash — that check lives in `sessions/prompts.ts`, since
 * the schema cannot see the manifest.
 */
const assignmentRef = z.string().regex(/^[a-z_]+@[0-9a-f]{64}$/, "expected role@sha256");

export const assignmentsFileSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  assignments: z.record(nonEmptyString, assignmentRef).default({}),
});
