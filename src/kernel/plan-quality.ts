import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { approvalPath, readPresentation } from "../init/present.js";
import { parseArtifact } from "../schemas/common.js";
import { approvalSchema, planSchema, transitionLineSchema, type Plan, type TransitionLine } from "../schemas/records.js";
import { detentBuild } from "./build.js";
import type { RunJournal } from "./journal.js";
import { recoverObjects } from "./jsonl-recover.js";
import { readLedgerRows } from "./ledger-rows.js";
import { ticketOutcomes, totals, type TicketOutcome, type Totals } from "./outcomes.js";

/**
 * N-5″ (PRDR-297) — the plan's run-time outcomes, per slice and per plan, with
 * the Detent builds that made it and the pack it was planned from.
 *
 * `detent status` shows them, and a run ends by recording them in its journal,
 * as a `plan_quality` event beside the `config` event it began with (PRDR-092),
 * so each run's figures stay beside what it ran under. Reported, never gated:
 * they are evidence for D-33's decisions, not a stop.
 */

/** What made the plan: its builds, as PRESENT named them, and the hash of its pack, or null without one. */
export interface Made {
  readonly builds: readonly string[];
  readonly pack_hash: string | null;
}

export interface SliceTotals extends Totals {
  readonly id: string;
  readonly title: string;
}

export interface PlanQuality {
  /** As the approval records it, or PRESENT where the plan is not approved; null where neither names it. */
  readonly made: Made | null;
  readonly plan: Totals;
  readonly slices: readonly SliceTotals[];
  /** The tickets no slice holds, in a plan that has slices; null where there are none. */
  readonly outside: Totals | null;
  readonly tickets: readonly TicketOutcome[];
  /** Lines of `transitions.jsonl` that are not a transition, and so are not counted. */
  readonly unreadable: number;
}

function readJson(file: string): unknown {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function readPlan(root: string): Plan | null {
  const raw = readJson(path.join(stateDir(root), "plan", "plan.json"));
  if (raw === undefined) return null;
  const parsed = parseArtifact(planSchema, raw);
  return parsed.ok ? parsed.value : null;
}

function madeBy(root: string): Made | null {
  const raw = readJson(approvalPath(root));
  if (raw !== undefined) {
    const approval = parseArtifact(approvalSchema, raw);
    if (approval.ok) return approval.value.builds === undefined ? null : { builds: approval.value.builds, pack_hash: approval.value.pack_hash ?? null };
  }
  try {
    const shown = readPresentation(root);
    return shown === null ? null : { builds: shown.builds, pack_hash: shown.pack_hash };
  } catch {
    return null;
  }
}

/**
 * Every transition fully written. A torn line gives up the objects written
 * whole in it (PRDR-249), and counts once among the unreadable, as does a line
 * that is JSON but not a transition.
 */
function readTransitions(root: string): { readonly lines: TransitionLine[]; readonly unreadable: number } {
  const file = path.join(stateDir(root), "transitions.jsonl");
  if (!existsSync(file)) return { lines: [], unreadable: 0 };
  const lines: TransitionLine[] = [];
  let unreadable = 0;
  for (const text of readFileSync(file, "utf8").split("\n")) {
    if (text.trim() === "") continue;
    let objects: unknown[];
    try {
      objects = [JSON.parse(text)];
    } catch {
      objects = recoverObjects(text);
      unreadable += 1;
    }
    for (const raw of objects) {
      const parsed = transitionLineSchema.safeParse(raw);
      if (parsed.success) lines.push(parsed.data);
      else unreadable += 1;
    }
  }
  return { lines, unreadable };
}

/** The figures for the plan on disk, or null where there is none. */
export function planQuality(root: string): PlanQuality | null {
  const plan = readPlan(root);
  if (plan === null) return null;
  const { lines, unreadable } = readTransitions(root);
  const tickets = ticketOutcomes(plan.tickets, lines, readLedgerRows(root));
  const within = (ids: readonly string[]): Totals => totals(tickets.filter((t) => ids.includes(t.ticket)));
  const sliced = new Set(plan.slices.flatMap((s) => s.tickets));
  const outside = plan.tickets.filter((id) => !sliced.has(id));
  return {
    made: madeBy(root),
    plan: totals(tickets),
    slices: plan.slices.map((s) => ({ id: s.id, title: s.title, ...within(s.tickets) })),
    outside: plan.slices.length === 0 || outside.length === 0 ? null : within(outside),
    tickets,
    unreadable,
  };
}

/** The record a run ends with, in its journal, with the build that ran it. Nothing where there is no plan. */
export function recordPlanQuality(root: string, journal: RunJournal, at: string): void {
  const quality = planQuality(root);
  if (quality === null) return;
  journal.appendTicketEvent("run", { event: "plan_quality", at, run_build: detentBuild(), ...quality });
}
