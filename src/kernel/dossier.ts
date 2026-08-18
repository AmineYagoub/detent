import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dossierSchema, type Dossier } from "../schemas/records.js";
import type { Ticket } from "../schemas/ticket.js";
import { cumulativeCounters } from "./generations.js";
import { runsDir } from "./journal.js";

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
    schema_version: 1,
    ticket: ticket.id,
    reason,
    generations: ticket.generations.map((g) => ({ index: g.index, counters: g.counters })),
    last_signatures: failure === null ? [] : [failure],
    artifact_index: artifacts,
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
  ];
  return lines.join("\n");
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
