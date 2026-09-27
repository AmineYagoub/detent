import type { Pack } from "../schemas/pack.js";
import type { Ticket } from "../schemas/ticket.js";
import { requirementMilestones } from "./plan-checks.js";
import type { PresentChecks } from "./present-checks.js";

/**
 * C-7‴ (PRDR-296) — the plan as PRESENT lists it: its slices in order, each
 * with its milestones, then its tickets, each with the milestone of what it
 * delivers.
 *
 * A ticket's milestone is the earliest of its live requirements', as A-1⁷'s
 * milestone check reads it (`plan-checks.ts`). A slice's are those of the
 * requirements SLICE assigned it. Without a pack no requirement has a
 * milestone, and none is shown.
 */

/** A slice as PLAN's plan lists it. */
export interface PlannedSlice {
  readonly id: string;
  readonly title: string;
  readonly tickets: readonly string[];
}

const tag = (milestones: readonly number[]): string => (milestones.length === 0 ? "" : `${milestones.map((m) => `M${String(m)}`).join(",")}  `);

export function planLines(
  tickets: readonly Ticket[],
  slices: readonly PlannedSlice[],
  assignments: Readonly<Record<string, string>>,
  checks: PresentChecks | undefined,
): string[] {
  const pack: Pack | null = checks?.pack ?? null;
  const live = pack === null ? new Map<string, number>() : requirementMilestones(pack);
  const of = (ids: readonly string[]): number[] => [...new Set(ids.flatMap((id) => (live.has(id) ? [live.get(id) as number] : [])))].sort((a, b) => a - b);
  const assigned = new Map((checks?.slices ?? []).map((s) => [s.id, s.requirement_ids] as const));
  const lines: string[] = [];
  if (slices.length > 0) {
    lines.push(`Slices (${String(slices.length)}), in order — a slice cannot start before the ones it thickens are DONE:`);
    for (const s of slices) {
      lines.push(`  ${s.id}  ${tag(of(assigned.get(s.id) ?? []))}${s.title}  — ${String(s.tickets.length)} ticket${s.tickets.length === 1 ? "" : "s"}`);
    }
    lines.push("");
  }
  lines.push(`Tickets (${String(tickets.length)}):`);
  for (const t of tickets) {
    const blocked = t.blockers.length === 0 ? "" : `  ← blocked on ${t.blockers.join(", ")}`;
    const role = assignments[t.id];
    lines.push(`  ${t.id}  ${tag(of(t.requirement_ids).slice(0, 1))}${t.title}${blocked}${role === undefined ? "" : `  [${role.split("@")[0]}]`}`);
  }
  return lines;
}
