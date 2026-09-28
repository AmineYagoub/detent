import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { stateDir } from "../fs/layout.js";
import { auditSurveySchema, triageEntrySchema, type TriageEntry } from "../schemas/audit.js";
import { SCHEMA_VERSION, sha256Hex } from "../schemas/common.js";
import type { SurveyCheck } from "./audit-passages.js";

/**
 * C-2¹⁷ (PRDR-305) — the survey AUDIT keeps until it completes.
 *
 * AUDIT's checkpoint is written when the phase completes, and the claim
 * checks after the survey run for hours on a large document set: tabachir's
 * 132 claims take about three and a half hours in batches (C-2¹⁶). A run
 * stopped between the two surveyed again, and a new survey words its claims
 * afresh, so the briefs committed under the old words' hashes answered none
 * of them. The checked survey is kept here under the phase's key, and a
 * re-run whose key has not moved checks its claims from where the stopped
 * run left them. Code writes the file, and the structural floor keeps every
 * session out of `.detent/state/` (SEC-3′). The triage is kept with it
 * (C-2¹⁸, PRDR-306), so a re-run sorts only the claims no run has sorted.
 */

export function keptSurveyPath(root: string): string {
  return path.join(stateDir(root), "state", "audit-survey-kept.json");
}

const keptSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  key: z.string().min(1),
  kept: auditSurveySchema,
  dropped: z.array(z.strictObject({ kind: z.enum(["contradiction", "gap", "drift", "claim"]), passage: z.string(), reason: z.string() })),
  unread: z.array(z.string()),
  /** C-2¹⁸ (PRDR-306): each claim the triage sorted, by its hash. */
  triage: z.record(sha256Hex, triageEntrySchema).optional(),
});
type Kept = z.infer<typeof keptSchema>;

/** Absent, kept under another key, or a shape this build does not read, which is surveyed again rather than trusted: null. */
function readKept(root: string, key: string): Kept | null {
  const file = keptSurveyPath(root);
  if (!existsSync(file)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    /* Not JSON is a shape this build does not read: surveyed again. */
    return null;
  }
  const parsed = keptSchema.safeParse(raw);
  return parsed.success && parsed.data.key === key ? parsed.data : null;
}

const writeKept = (root: string, kept: Kept): void => {
  writeFileSync(keptSurveyPath(root), `${JSON.stringify(kept, null, 2)}\n`);
};

/** The survey kept under `key`, or null. */
export function readKeptSurvey(root: string, key: string): SurveyCheck | null {
  const kept = readKept(root, key);
  return kept === null ? null : { issues: [], kept: kept.kept, dropped: kept.dropped, unread: kept.unread };
}

/** A survey kept anew keeps no triage: its claims are sorted afresh. */
export function keepSurvey(root: string, key: string, survey: SurveyCheck): void {
  writeKept(root, { schema_version: SCHEMA_VERSION, key, kept: survey.kept, dropped: [...survey.dropped], unread: [...survey.unread] });
}

/** C-2¹⁸ (PRDR-306): the triage kept with the survey under `key`, empty where there is none. */
export function readKeptTriage(root: string, key: string): Readonly<Record<string, TriageEntry>> {
  return readKept(root, key)?.triage ?? {};
}

/** C-2¹⁸: `entries` join the kept triage. With no survey kept under `key` there is nothing to keep them with, and a re-run sorts them again. */
export function keepTriage(root: string, key: string, entries: Readonly<Record<string, TriageEntry>>): void {
  const kept = readKept(root, key);
  if (kept !== null) writeKept(root, { ...kept, triage: { ...kept.triage, ...entries } });
}

/** The phase's checkpoint stands for it once AUDIT completes. */
export function dropKeptSurvey(root: string): void {
  rmSync(keptSurveyPath(root), { force: true });
}
