import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dossierSchema, type Dossier } from "../schemas/records.js";
import type { Ticket } from "../schemas/ticket.js";
import { cumulativeCounters } from "./generations.js";
import { runsDir } from "./journal.js";
import { findingLine, readPlanFindings } from "./plan-findings.js";
import { SCHEMA_VERSION } from "../schemas/common.js";

/**
 * T-049 — the dossier (A-8, C-10, X-8).
 *
 * What a human sees at an escalation: the reason, every generation's counters
 * (prior generations are immutable history — X-8), the artifacts on disk, and
 * concrete next moves. Displayed totals are CUMULATIVE across generations,
 * because "how much has this ticket really consumed" is the question a
 * requeue decision needs answered.
 */

export function buildDossier(root: string, ticket: Ticket, reason: string): Dossier {
  const dir = runsDir(root, ticket.id);
  const artifacts = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json") || f.endsWith(".jsonl")).sort() : [];
  const failure = readSignature(dir);
  return dossierSchema.parse({
    schema_version: SCHEMA_VERSION,
    ticket: ticket.id,
    reason,
    generations: ticket.generations.map((g) => ({ index: g.index, counters: g.counters })),
    last_signatures: failure === null ? [] : [failure],
    artifact_index: artifacts,
    /**
     * PRDR-271: the ladder's last rung hands the ticket to a human, and what
     * PLAN's review already said about it is the one piece of evidence that
     * predates every session on the trail. Without it a human reads four
     * failed attempts and no account of what was suspect before the first one.
     */
    plan_findings: (readPlanFindings(root, ticket.id) ?? []).map(findingLine),
    suggested_resolutions: [
      "review the dossier and the last failure record",
      "requeue with guidance (`detent requeue <id>`) to open a fresh generation (X-8)",
      "or approve after a manual fix (`detent approve <id>`) — the kernel re-verifies before DONE",
    ],
  });
}

export function writeDossier(root: string, ticket: Ticket, reason: string): Dossier {
  const dossier = buildDossier(root, ticket, reason);
  const dir = runsDir(root, ticket.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "dossier.json"), `${JSON.stringify(dossier, null, 2)}\n`);
  return dossier;
}

/** The one-screen summary C-10 presents before asking for a decision. */
export function dossierSummary(ticket: Ticket, dossier: Dossier): string {
  const totals = cumulativeCounters(ticket);
  const lines = [
    `${ticket.id} — ${ticket.title}`,
    `reason: ${dossier.reason}`,
    `generations: ${ticket.generations.length} (cumulative: ${totals.sessions} sessions, ` +
      `${totals.blind_fix_attempts + totals.informed_fix_attempts + totals.review_fix_attempts} fixes, ` +
      `${totals.research_sessions} research, ${totals.hypotheses} hypotheses)`,
    ...(dossier.last_signatures.length > 0 ? [`last failure signature: ${dossier.last_signatures[0]}`] : []),
    `artifacts: ${dossier.artifact_index.join(", ") || "(none)"}`,
    ...planLines(dossier.plan_findings),
  ];
  return lines.join("\n");
}

/**
 * PRDR-271: C-10 asks for a decision on one screen, so the summary shows the
 * three best-reproduced findings and says how many more the file holds; the
 * dossier itself carries all of them. Truncating in the summary while the
 * artifact stays complete is the same split `artifact_index` already makes.
 */
const SUMMARY_FINDINGS = 3;

function planLines(findings: readonly string[]): readonly string[] {
  if (findings.length === 0) return [];
  const shown = findings.slice(0, SUMMARY_FINDINGS).map((f) => `  - ${f}`);
  const rest = findings.length - shown.length;
  return [`plan review said (${findings.length}):`, ...shown, ...(rest > 0 ? [`  - ...${rest} more in dossier.json`] : [])];
}

function readSignature(dir: string): string | null {
  const file = path.join(dir, "last_failure.json");
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { signature?: string };
    return parsed.signature ?? null;
  } catch {
    return null;
  }
}
