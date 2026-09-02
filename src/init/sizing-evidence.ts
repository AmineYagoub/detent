import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { ledgerRowSchema } from "../schemas/records.js";

/**
 * X-4″ (PRDR-102) — what a previous plan of these documents actually cost.
 *
 * PRDR-081 asked the planner to size a ticket against `session_budget` and
 * PRDR-084 asked REVIEW_PLAN to check the estimate; both judged the text, and
 * the text does not encode the work (six breached tickets, 50–74 words each,
 * 106–307 turns). The measurement lives in the ledger and in the sessions
 * that reported themselves oversized. This is the only input either stage
 * has ever had that was measured rather than estimated.
 */

export interface OversizedRecord {
  readonly ticket: string;
  readonly title: string;
  readonly note: string;
  readonly split: readonly string[];
}

export interface SizingEvidence {
  readonly implement_turns: { readonly sessions: number; readonly p50: number; readonly p90: number; readonly max: number };
  readonly oversized: readonly OversizedRecord[];
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx] as number;
}

function implementTurns(root: string): number[] {
  const file = path.join(stateDir(root), "ledger.jsonl");
  if (!existsSync(file)) return [];
  const turns: number[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = ledgerRowSchema.safeParse(JSON.parse(line));
      if (!parsed.success) continue;
      const row = parsed.data;
      if (row.role === "implement" && row.partial === undefined && row.turns > 0) turns.push(row.turns);
    } catch {
      /* a malformed line is not evidence */
    }
  }
  return turns.sort((a, b) => a - b);
}

function titleOf(root: string, ticket: string): string {
  try {
    const parsed = JSON.parse(readFileSync(path.join(stateDir(root), "plan", `${ticket}.json`), "utf8")) as { title?: unknown };
    return typeof parsed.title === "string" ? parsed.title : ticket;
  } catch {
    return ticket;
  }
}

function oversizedRecords(root: string): OversizedRecord[] {
  const runs = path.join(stateDir(root), "runs");
  if (!existsSync(runs)) return [];
  const out: OversizedRecord[] = [];
  for (const ticket of readdirSync(runs).sort()) {
    const file = path.join(runs, ticket, "oversized.json");
    if (!existsSync(file)) continue;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { note?: unknown; split?: unknown };
      out.push({
        ticket,
        title: titleOf(root, ticket),
        note: typeof parsed.note === "string" ? parsed.note : "oversized",
        split: Array.isArray(parsed.split) ? parsed.split.filter((p): p is string => typeof p === "string") : [],
      });
    } catch {
      /* an unreadable proposal is not evidence */
    }
  }
  return out;
}

/** `null` when nothing measured exists yet — a first plan sizes on the estimate alone. */
export function sizingEvidence(root: string): SizingEvidence | null {
  const turns = implementTurns(root);
  const oversized = oversizedRecords(root);
  if (turns.length === 0 && oversized.length === 0) return null;
  return {
    implement_turns: { sessions: turns.length, p50: quantile(turns, 0.5), p90: quantile(turns, 0.9), max: turns.at(-1) ?? 0 },
    oversized,
  };
}
