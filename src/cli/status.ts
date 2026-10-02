import { allTickets } from "../kernel/tickets/readers.js";
import { holdOf, readAmendments } from "../kernel/amendment-store.js";
import type { State } from "../schemas/states.js";
import type { Ticket } from "../schemas/ticket.js";
import { stateVersionRefusal } from "../kernel/migrate.js";
import { planQuality } from "../kernel/plan-quality.js";
import type { Totals } from "../kernel/outcomes.js";
import { phaseSpend, spendLines } from "../init/phase-spend.js";
import { progressLines } from "../init/progress.js";
import { liveRunLock } from "../kernel/run-lock.js";
import { effortTally } from "../kernel/effort-route.js";
import { readLedgerRows } from "../kernel/ledger-rows.js";
import { EFFORT_REASONS, type EffortReason } from "../schemas/roles.js";

/**
 * T-053 — `detent status` and the C-13 vocabulary.
 *
 * Every internal state maps to one of five labels — planning / implementing /
 * verifying / reviewing / waiting on you — with full state names living only
 * in `transitions.jsonl`. The snapshot test holds the line: terminal output
 * contains no internal state name, ever.
 */

export type UserLabel = "planning" | "implementing" | "verifying" | "reviewing" | "waiting on you" | "done";

/** Total over the state vocabulary, so a new state cannot dodge the mapping. */
export const LABEL_FOR_STATE: Record<State, UserLabel> = {
  READY: "planning",
  DIAGNOSED: "implementing",
  IN_PROGRESS: "implementing",
  BLIND_FIX: "implementing",
  RESEARCH: "implementing",
  INFORMED_FIX: "implementing",
  REVIEW_FIX: "implementing",
  IN_REVIEW: "reviewing",
  APPROVED: "verifying",
  DONE: "done",
  BLOCKED: "waiting on you",
  NEEDS_HUMAN: "waiting on you",
};

function labelOf(state: State): UserLabel {
  return LABEL_FOR_STATE[state];
}

interface StatusLine {
  readonly id: string;
  readonly title: string;
  readonly label: UserLabel;
  readonly generations: number;
  readonly sessions: number;
}

function statusLines(tickets: readonly Ticket[]): StatusLine[] {
  return tickets.map((t) => ({
    id: t.id,
    title: t.title,
    label: labelOf(t.state),
    generations: t.generations.length,
    sessions: t.generations.reduce((a, g) => a + g.counters.sessions, 0),
  }));
}

/**
 * The terminal rendering. C-13's AC snapshots this: no internal state names.
 * N-5⁗ (PRDR-325): during `init`, the costly step it is in, with an estimated
 * finish; `running` says whether the pid that began the step holds the root.
 */
export function renderStatus(root: string, now: Date = new Date(), running: (pid: number) => boolean = (pid) => liveRunLock(root)?.pid === pid): string {
  return `${[...ticketLines(root), ...amendmentLines(root), ...initLines(root, now, running), ...outcomeLines(root)].join("\n")}\n`;
}

function initLines(root: string, now: Date, running: (pid: number) => boolean): string[] {
  try {
    return progressLines(root, now, running);
  } catch (err) {
    return ["", `\`init\`'s progress is not shown: ${(err as Error).message}`];
  }
}

/** X-4⁸ (PRDR-286): each amendment still holding tickets, what it waits on, and the tickets it holds. */
function amendmentLines(root: string): string[] {
  try {
    const holding = readAmendments(root).filter((a) => a.status === "open" || a.status === "applied");
    if (holding.length === 0) return [];
    const tickets = allTickets(root);
    return [
      "",
      "Amendments to the pack (X-4⁸):",
      ...holding.flatMap((a) => {
        const held = tickets.filter((t) => t.state === "READY" && holdOf([a], t) !== null).map((t) => t.id);
        const next = a.status === "open" ? `waiting on you: \`detent amend ${a.id}\` shows it and decides it` : "applied: `detent init` re-validates the pack and re-plans what it changed";
        return [`  ${a.id} on ${a.proposal.requirement_ids.join(", ")}, filed by ${a.ticket} — ${next}`, `    holds ${held.length === 0 ? "no ticket" : held.join(", ")}`];
      }),
    ];
  } catch (err) {
    return ["", `Amendments are not shown: ${(err as Error).message}`];
  }
}

function ticketLines(root: string): string[] {
  const lines = statusLines(allTickets(root));
  if (lines.length === 0) return ["no tickets"];
  const byLabel = new Map<UserLabel, StatusLine[]>();
  for (const line of lines) {
    byLabel.set(line.label, [...(byLabel.get(line.label) ?? []), line]);
  }
  const order: UserLabel[] = ["waiting on you", "reviewing", "verifying", "implementing", "planning", "done"];
  const out: string[] = [];
  for (const label of order) {
    const group = byLabel.get(label);
    if (group === undefined) continue;
    out.push(`${label} (${group.length})`);
    for (const line of group) {
      const extra = line.generations > 1 ? ` · generation ${line.generations}` : "";
      out.push(`  ${line.id} — ${line.title} (${line.sessions} sessions${extra})`);
    }
  }
  return out;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${String(n)} ${n === 1 ? one : many}`;

function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (ms < 60_000) return `${String(Math.round(ms / 1000))}s`;
  return minutes < 60 ? `${String(minutes)}m` : `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}

function figures(t: Totals): string {
  return [
    `${plural(t.tickets, "ticket")}: ${String(t.done)} done, ${String(t.first_generation)} in their first generation`,
    `${String(t.escalations)} escalated to you`,
    `falsified: ${String(t.falsified.premise)} premise, ${String(t.falsified.oversized)} oversized, ${String(t.falsified.dependency)} dependency`,
    plural(t.budget_breaches, "budget breach", "budget breaches"),
    plural(t.review_rounds, "review round"),
    `$${t.cost_usd.toFixed(4)}`,
    `${duration(t.work_ms)} at work`,
  ].join(" · ");
}

/**
 * N-5″ (PRDR-297): how the plan is running, per plan and per slice, with the
 * builds that made it and its pack; then what `init` spent by phase (C-7‴).
 * Reported, and nothing stops for either (D-33, specification decision 16).
 */
function outcomeLines(root: string): string[] {
  try {
    const quality = planQuality(root);
    const out: string[] = [];
    if (quality !== null) {
      const made =
        quality.made === null || quality.made.builds.length === 0
          ? "the builds that made it are not recorded"
          : `made by ${quality.made.builds.join(", ")}, ${quality.made.pack_hash === null ? "without a pack" : `from pack ${quality.made.pack_hash.slice(0, 12)}`}`;
      out.push("", "Run-time outcomes (N-5″) — reported, and nothing stops for them:", `  plan  ${figures(quality.plan)}`, `        ${made}`);
      for (const s of quality.slices) out.push(`  ${s.id}  ${s.title} — ${figures(s)}`);
      if (quality.outside !== null) out.push(`  outside any slice — ${figures(quality.outside)}`);
      if (quality.unreadable > 0) out.push(`  ${plural(quality.unreadable, "line")} of transitions.jsonl could not be read, and ${quality.unreadable === 1 ? "is" : "are"} not counted.`);
    }
    return [...out, ...spendLines(phaseSpend(root)), ...effortLines(root)];
  } catch (err) {
    return ["", `Run-time outcomes and spend are not shown: ${(err as Error).message}`];
  }
}

const BECAUSE: Readonly<Record<EffortReason, string>> = {
  role: "at their role's level",
  risk: "raised for their ticket's risk",
  evidence: "raised by evidence",
};

/** S-5⁸ (PRDR-328): the run's sessions and their cost by why each ran at its level; nothing where no row names a reason. */
function effortLines(root: string): string[] {
  const tally = effortTally(readLedgerRows(root));
  const said = EFFORT_REASONS.flatMap((r) => {
    const t = tally.get(r);
    return t === undefined ? [] : [`${plural(t.sessions, "session")} ${BECAUSE[r]}, $${t.cost_usd.toFixed(4)}`];
  });
  return said.length === 0 ? [] : ["", `Effort (S-5⁸): ${said.join(" · ")}`];
}

export function main(argv: readonly string[]): number {
  const root = argv[0] ?? process.cwd();
  /** F-3″ (PRDR-300): this verb does not migrate, so an older or newer state is refused before anything reads it. */
  const refused = stateVersionRefusal(root);
  if (refused !== null) {
    process.stderr.write(`${refused}\n`);
    return 2;
  }
  process.stdout.write(renderStatus(root));
  return 0;
}
