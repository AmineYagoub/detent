import { z } from "zod";
import { SCHEMA_VERSION, nonEmptyString, sha256Hex } from "./common.js";
import { GATE_SLOTS } from "./gates.js";

/**
 * C-2⁷ (PRDR-279) — the pack: a document set in a fixed schema, with a
 * committed record that says whether it was validated.
 *
 * Nothing defined the difference between a raw PRD and a set that had been
 * specified and validated, so `init` treated both alike and nothing recorded
 * that a validation had happened. The schema is the ksarjs pack's shape made
 * uniform: where ksarjs wrote criteria three ways, this admits one.
 *
 * `schema_version` versions every shape here and the grammar with them: a
 * change to what a pack must say is an F-3 event, exactly as a change to what
 * a record holds is (release-checklist item 8).
 *
 * What the schema does not decide is left to the checker and to review: that
 * an id is defined once, that a reference resolves, that a requirement has a
 * criterion, that a criterion's values are exact rather than merely present.
 */

/* ---------------------------------------------------------------------------
 * Layout and precedence
 */

export const DECISION_LOG_PATH = "docs/founder-decisions.md";
export const FACTS_PATH = "docs/research/verified-facts.md";
export const PRD_INDEX_PATH = "docs/prd/index.md";
export const CATALOGUES_PATH = "docs/design/catalogues.md";
/** Committed beside the pack, and never one of its documents: it cannot hash itself. */
export const CONFORMANCE_RECORD_PATH = "docs/conformance.json";
/** The originals the pack was written from. Only the root's; discovery never enters it. */
export const ARCHIVE_DIR = "archive";

/**
 * Highest first. A disagreement between two documents is a defect in the
 * lower one, and the fix lands there.
 */
export const PACK_PRECEDENCE = ["decisions", "facts", "design", "adr", "prd"] as const;
export type PackKind = (typeof PACK_PRECEDENCE)[number];

const MODULE_PRD_FILE = /^docs\/prd\/\d{2,}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u;
const ADR_FILE = /^docs\/adr\/(ADR-\d{3})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u;
const DESIGN_FILE = /^docs\/design\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u;

/**
 * C-2⁹: what a discovered document is to the pack. `null` is a name the
 * layout does not hold inside one of the pack's own directories, which never
 * conforms.
 *
 * `context` is everything else discovery finds: a README, a runbook, a guide.
 * It is hashed with the pack, so an edit to it is a change `init` names, but
 * it is never parsed for requirements and has no precedence. The alternative,
 * archiving every document that is not the pack, would move a repository's
 * README out of its root.
 */
export function packKindOf(rel: string): PackKind | "context" | null {
  if (rel === DECISION_LOG_PATH) return "decisions";
  if (rel === FACTS_PATH) return "facts";
  if (rel.startsWith("docs/research/")) return null;
  if (rel.startsWith("docs/design/")) return DESIGN_FILE.test(rel) ? "design" : null;
  if (rel.startsWith("docs/adr/")) return ADR_FILE.test(rel) ? "adr" : null;
  if (rel.startsWith("docs/prd/")) return rel === PRD_INDEX_PATH || MODULE_PRD_FILE.test(rel) ? "prd" : null;
  return "context";
}

export const isModulePrd = (rel: string): boolean => MODULE_PRD_FILE.test(rel);
export const adrIdOf = (rel: string): string | null => ADR_FILE.exec(rel)?.[1] ?? null;

/* ---------------------------------------------------------------------------
 * The id grammar
 */

const CODE = "[A-Z][A-Z0-9]{1,5}";
export const MODULE_CODE = new RegExp(`^${CODE}$`, "u");
/** `<CODE>-F-<nnn>` is functional and `<CODE>-N-<nnn>` non-functional. */
export const REQUIREMENT_ID = new RegExp(`^(${CODE})-([FN])-(\\d{3})$`, "u");
/**
 * The requirements a criterion names, anywhere in its text: one id, or a range
 * `CHK-F-001–CHK-F-004` (an en dash, one code and kind) standing for every id
 * between. Groups 1-3 are the first id, 4-6 the range's end. Not global: a
 * shared `g` regex carries `lastIndex` from one caller to the next, so a
 * scanner builds its own with `new RegExp(REQUIREMENT_REFS.source, "gu")`.
 */
export const REQUIREMENT_REFS = new RegExp(
  `\\b(${CODE})-([FN])-(\\d{3})\\b(?:\\s*[–—]\\s*(${CODE})-([FN])-(\\d{3})\\b)?`,
  "u",
);
export const CRITERION_ID = new RegExp(`^(${CODE})-AC-(\\d{2,3})$`, "u");
/** A criterion id anywhere in text; not global, for the reason `REQUIREMENT_REFS` gives. */
export const CRITERION_REF = new RegExp(`\\b(${CODE})-AC-(\\d{2,3})\\b`, "u");
export const DECISION_ID = /^D-\d+$/u;
export const DEFAULT_ID = /^X-\d+$/u;
export const FACT_ID = /^\d+\.\d+$/u;
/** Milestones order by their number: `[M2]` precedes `[M10]`. */
export const MILESTONE_ID = /^M(\d+)$/u;

/**
 * MUST outranks SHOULD, so a requirement stating both is a MUST. Lower case is
 * prose, not a keyword; a requirement stating neither is not a requirement.
 */
export function levelOf(text: string): "MUST" | "SHOULD" | null {
  if (/\bMUST\b/u.test(text)) return "MUST";
  if (/\bSHOULD\b/u.test(text)) return "SHOULD";
  return null;
}

/* ---------------------------------------------------------------------------
 * The parse: what a pack says, entry by entry, each with its place
 */

const place = { file: nonEmptyString, line: z.number().int().positive() };
const milestone = z.number().int().nonnegative();
const cell = (what: string) => z.string().min(1, `has no ${what}`);
const gates = z.partialRecord(z.enum(GATE_SLOTS), nonEmptyString);

export const requirementSchema = z
  .strictObject({
    id: z.string().regex(REQUIREMENT_ID),
    code: nonEmptyString,
    kind: z.enum(["F", "N"]),
    milestone: milestone.nullable(),
    withdrawn: z.boolean(),
    level: z.enum(["MUST", "SHOULD"]).nullable(),
    text: cell("text"),
    tags: z.array(nonEmptyString),
    ...place,
  })
  .superRefine((r, ctx) => {
    if (r.withdrawn) return;
    if (r.milestone === null) {
      ctx.addIssue({ code: "custom", path: ["milestone"], message: "has no milestone tag ([M0], [M1], …) and is not [withdrawn]" });
    }
    if (r.level === null) ctx.addIssue({ code: "custom", path: ["level"], message: "does not state MUST or SHOULD" });
  });

export const criterionSchema = z
  .strictObject({
    id: z.string().regex(CRITERION_ID),
    code: nonEmptyString,
    milestone: milestone.nullable(),
    given: z.string(),
    when: z.string(),
    then: z.string(),
    requirements: z.array(z.string().regex(REQUIREMENT_ID)).min(1, "names no requirement it tests"),
    tags: z.array(nonEmptyString),
    ...place,
  })
  .superRefine((c, ctx) => {
    if (c.given === "" || c.when === "" || c.then === "") {
      ctx.addIssue({ code: "custom", path: ["then"], message: "does not state Given, When and Then" });
    }
  });

export const decisionSchema = z.strictObject({
  id: z.string().regex(DECISION_ID),
  question: cell("question"),
  answer: cell("answer"),
  reason: cell("reason"),
  ...place,
});

export const defaultSchema = z.strictObject({ id: z.string().regex(DEFAULT_ID), value: cell("value"), reason: cell("reason"), ...place });

export const FACT_TAGS = ["source-read", "doc", "unverified"] as const;

export const factSchema = z.strictObject({
  id: z.string().regex(FACT_ID),
  fact: cell("fact"),
  source: cell("source"),
  tag: z.enum(FACT_TAGS, { error: "has a tag that is not source-read, doc or unverified" }),
  ...place,
});

export const codeSchema = z.strictObject({
  code: z.string().regex(MODULE_CODE),
  area: cell("area"),
  prd: z.string().regex(/^\d{2,}-[a-z0-9-]+\.md$/u, "names no module PRD file (NN-name.md)"),
  milestones: z.array(milestone).min(1, "names no milestone"),
  ...place,
});

export const milestoneSchema = z.strictObject({ id: z.string().regex(MILESTONE_ID), order: milestone, title: cell("title"), ...place });

/**
 * D-10′: in greenfield the stack is a decision, recorded as one structured
 * entry. `gates` are the root package's declared commands, the same rows
 * `packages` holds for `.`, so the entry is whole where a binder reads it.
 */
export const stackSchema = z.strictObject({
  decision: z.string().regex(/^[DX]-\d+$/u, "names no decision or default (D-n, X-n) that settled it"),
  language: cell("language"),
  toolchain: cell("toolchain"),
  scaffold_files: z.array(nonEmptyString),
  gates,
});

/** V-5′: a declared package, `.` for the root, with the gate command for each slot it declares. */
export const packageSchema = z.strictObject({ path: nonEmptyString, gates });

const catalogueEntry = z.strictObject({ id: nonEmptyString, line: z.number().int().positive() });
export const CATALOGUE_KINDS = ["error_codes", "events", "settings", "jobs", "routes"] as const;
export type CatalogueKind = (typeof CATALOGUE_KINDS)[number];

/** The `##` section of `docs/design/catalogues.md` each kind lives under, by lower-cased title. */
export const CATALOGUE_SECTIONS: Readonly<Record<string, CatalogueKind>> = {
  "error codes": "error_codes",
  events: "events",
  settings: "settings",
  jobs: "jobs",
  routes: "routes",
};

export const packSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  /** Every document discovery found, with its numbered sections, for `§` references. */
  documents: z.array(
    z.strictObject({ path: nonEmptyString, kind: z.enum([...PACK_PRECEDENCE, "context"]), sections: z.array(nonEmptyString) }),
  ),
  codes: z.array(codeSchema),
  milestones: z.array(milestoneSchema),
  requirements: z.array(requirementSchema),
  criteria: z.array(criterionSchema),
  decisions: z.array(decisionSchema),
  defaults: z.array(defaultSchema),
  facts: z.array(factSchema),
  adrs: z.array(z.strictObject({ id: nonEmptyString, file: nonEmptyString })),
  stack: stackSchema.nullable(),
  packages: z.array(packageSchema),
  /** Optional: an absent catalogue is empty, and the checker skips its rules. */
  catalogues: z.strictObject({
    error_codes: z.array(catalogueEntry),
    events: z.array(catalogueEntry),
    settings: z.array(catalogueEntry),
    jobs: z.array(catalogueEntry),
    routes: z.array(catalogueEntry),
  }),
});
export type Pack = z.infer<typeof packSchema>;
export type Requirement = z.infer<typeof requirementSchema>;
export type Criterion = z.infer<typeof criterionSchema>;

/** One way a document breaks the schema, at its place. Line 0 is the whole file. */
export const packFindingSchema = z.strictObject({
  rule: nonEmptyString,
  file: nonEmptyString,
  line: z.number().int().nonnegative(),
  text: z.string(),
  message: nonEmptyString,
});
export type PackFinding = z.infer<typeof packFindingSchema>;

/* ---------------------------------------------------------------------------
 * The conformance record
 */

export const SEVERITIES = ["blocker", "major", "minor"] as const;

export const conformanceRecordSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  /** sha256 over the sorted `path NUL sha256 LF` lines of `documents`. */
  hash: sha256Hex,
  /** Every document of the pack, record excluded, with the sha256 of its bytes: what names a change. */
  documents: z.record(z.string(), sha256Hex),
  /** The checker's last result; `blocks: false` is a heuristic's report. */
  checker: z.strictObject({
    green: z.boolean(),
    findings: z.array(packFindingSchema.extend({ blocks: z.boolean() })).default([]),
  }),
  rounds: z
    .array(
      z.strictObject({
        round: z.number().int().positive(),
        counts: z.strictObject({ blocker: z.number().int().nonnegative(), major: z.number().int().nonnegative(), minor: z.number().int().nonnegative() }),
        /** What the round left unfixed, as each finding was written: severity, place, quote and fix. */
        open: z
          .array(
            z.strictObject({
              severity: z.enum(SEVERITIES),
              file: nonEmptyString,
              line: z.number().int().nonnegative(),
              quote: z.string(),
              fix: z.string(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
  date: z.iso.date(),
});
export type ConformanceRecord = z.infer<typeof conformanceRecordSchema>;

/* ---------------------------------------------------------------------------
 * DISCOVER's classification, persisted in its checkpoint
 */

/**
 * `changed` also covers unchanged documents a record no longer vouches for: a
 * red checker, or a break the schema finds now. `reasons` says which, and the
 * three lists say what moved. A changed pack is still a pack, never raw.
 */
export const packStatusSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("raw") }),
  z.strictObject({ kind: z.literal("conforming"), date: z.iso.date(), hash: sha256Hex }),
  z.strictObject({
    kind: z.literal("changed"),
    date: z.iso.date(),
    added: z.array(nonEmptyString),
    removed: z.array(nonEmptyString),
    modified: z.array(nonEmptyString),
    reasons: z.array(nonEmptyString),
  }),
]);
export type PackStatus = z.infer<typeof packStatusSchema>;
