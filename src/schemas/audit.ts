import { z } from "zod";
import { SCHEMA_VERSION, nonEmptyString, sha256Hex } from "./common.js";
import { EXTERNAL_TIER, requireLocalSearchBeforeWeb } from "./init.js";

/**
 * C-2⁶, C-2¹¹ (PRDR-281) — what AUDIT's two sessions write.
 *
 * The survey reads the documents, and the code in an existing project, and
 * writes what it found without checking any of it: contradictions, gaps, drift
 * and the external claims. Each claim then gets a session of its own, which
 * writes a brief in C-3a's format with a verdict in place of an answer. Every
 * finding is anchored to a passage, and code checks each one (C-2¹¹).
 */

/** A quote, verbatim apart from whitespace, from the line it starts on. */
export const passageSchema = z.strictObject({
  file: nonEmptyString,
  line: z.number().int().min(1),
  quote: nonEmptyString,
});
export type Passage = z.infer<typeof passageSchema>;

export const contradictionSchema = z.strictObject({
  topic: nonEmptyString,
  /** Both sides, each where it is said: a contradiction with one passage is an opinion. */
  passages: z.array(passageSchema).min(2),
  why: nonEmptyString,
});

export const gapSchema = z.strictObject({
  topic: nonEmptyString,
  detail: nonEmptyString,
  /** What the documents say around the gap, when anything; a gap is often a silence. */
  passages: z.array(passageSchema).default([]),
});

/** C-2⁶: a document that states as built what the code does not do. Existing projects only. */
export const driftSchema = z.strictObject({
  passage: passageSchema,
  code_checked: z.array(nonEmptyString).min(1),
  finding: nonEmptyString,
});

/**
 * An external claim, unchecked. `subject` names what the claim is about, a
 * dependency at its pinned version where there is one, and joins the claim in
 * its cache key, so a version bump checks the claim again (C-2¹¹).
 */
export const claimSchema = z.strictObject({
  claim: nonEmptyString,
  subject: nonEmptyString,
  passage: passageSchema,
});
export type Claim = z.infer<typeof claimSchema>;

export const auditSurveySchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  /** Every document the survey was given; code refuses a survey that names fewer (C-2¹¹). */
  documents_read: z.array(nonEmptyString),
  contradictions: z.array(contradictionSchema).default([]),
  gaps: z.array(gapSchema).default([]),
  drift: z.array(driftSchema).default([]),
  claims: z.array(claimSchema).default([]),
});
export type AuditSurvey = z.infer<typeof auditSurveySchema>;

export const CLAIM_VERDICTS = ["confirmed", "wrong", "unverified"] as const;
export type ClaimVerdict = (typeof CLAIM_VERDICTS)[number];

/**
 * The verdict's arms. A confirmed or wrong claim names the source that settles
 * it, a link or a dependency path at its pinned version, and a wrong one says
 * what is true instead. An unverified claim carries neither, so nothing can
 * read it as a fact (C-2⁶).
 */
export function requireVerdictArm(
  brief: { readonly verdict: ClaimVerdict; readonly source?: string | undefined; readonly correction?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  const settled = brief.verdict !== "unverified";
  if (settled && brief.source === undefined) {
    ctx.addIssue({ code: "custom", path: ["source"], message: `C-2⁶: a \`${brief.verdict}\` verdict names its source, a link or a dependency path at its pinned version` });
  }
  if (!settled && brief.source !== undefined) {
    ctx.addIssue({ code: "custom", path: ["source"], message: "C-2⁶: an `unverified` verdict names no source, since nothing settled the claim" });
  }
  if ((brief.verdict === "wrong") !== (brief.correction !== undefined)) {
    ctx.addIssue({
      code: "custom",
      path: ["correction"],
      message: "C-2⁶: a `wrong` verdict says what is true instead in `correction`, and no other verdict carries one",
    });
  }
}

/**
 * PRDR-266's ascent, for AUDIT: `unverified` says no primary source settles
 * the claim, which is a statement about the world outside this project, and
 * tiers 1-2 are the project's own documents and code. So it needs a tier 3+
 * consultation, with no exemption: an external claim is never about this
 * project's own state, which is what `decision_not_made` covers for a
 * planning brief.
 */
export function requireEscalationBeforeUnverified(
  brief: { readonly verdict: ClaimVerdict; readonly sources_consulted: readonly { readonly tier: number }[] },
  ctx: z.RefinementCtx,
): void {
  if (brief.verdict !== "unverified" || brief.sources_consulted.some((s) => s.tier >= EXTERNAL_TIER)) return;
  ctx.addIssue({
    code: "custom",
    path: ["sources_consulted"],
    message:
      "X-6a (PRDR-266): `unverified` says no primary source settles the claim, and tiers 1-2 are this project's own " +
      `docs and code. Consult the outside world and record a tier ${String(EXTERNAL_TIER)}+ source before concluding that`,
  });
}

/** C-3a's brief format with a verdict in place of an answer, keyed by the claim and its subject (C-2¹¹). */
export const claimBriefSchema = z
  .strictObject({
    schema_version: z.literal(SCHEMA_VERSION),
    claim: nonEmptyString,
    claim_hash: sha256Hex,
    verdict: z.enum(CLAIM_VERDICTS),
    source: nonEmptyString.optional(),
    correction: nonEmptyString.optional(),
    evidence: z.array(z.strictObject({ source: nonEmptyString, claim: nonEmptyString })).min(1),
    sources_consulted: z
      .array(z.strictObject({ tier: z.number().int().min(1).max(6), ref: nonEmptyString }))
      .default([]),
    local_search: z.strictObject({
      docs_checked: z.array(z.string()).default([]),
      code_checked: z.array(z.string()).default([]),
    }),
    what_would_falsify: z.string().default(""),
  })
  .superRefine(requireLocalSearchBeforeWeb)
  .superRefine(requireVerdictArm)
  .superRefine(requireEscalationBeforeUnverified);
export type ClaimBrief = z.infer<typeof claimBriefSchema>;
