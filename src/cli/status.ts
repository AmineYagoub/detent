import { allTickets } from "../kernel/tickets/readers.js";
import type { State } from "../schemas/states.js";
import type { Ticket } from "../schemas/ticket.js";

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

/** The terminal rendering. C-13's AC snapshots this: no internal state names. */
export function renderStatus(root: string): string {
  const lines = statusLines(allTickets(root));
  if (lines.length === 0) return "no tickets\n";
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
  return `${out.join("\n")}\n`;
}

export function main(argv: readonly string[]): number {
  const root = argv[0] ?? process.cwd();
  process.stdout.write(renderStatus(root));
  return 0;
}
