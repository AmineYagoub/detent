import { readLedgerRows } from "../kernel/ledger-rows.js";
import { INIT_TICKET } from "./session.js";

/**
 * C-7‴ (PRDR-296) — what `init` has spent on this root, by phase.
 *
 * The specification plan's decision 16: each specification phase's spend is
 * shown beside planning's, and nothing stops for it. PRESENT lists it, and
 * X-1's `run_spend_usd`, which counts the same rows, only announces
 * (PRDR-265).
 *
 * Summed from the ledger's `init` rows, each of which names the phase that
 * launched it. The ledger is cumulative across every `init` on the root, so
 * this is what the plan cost with every planning of it before, as recorded.
 * A row written before rows named their phase is counted apart, as earlier.
 */

export interface PhaseSpend {
  readonly label: string;
  readonly usd: number;
  readonly sessions: number;
}

/** The specification phases, in the order they run. */
const SPEC_PHASES = ["AUDIT", "DECIDE", "WRITE", "VALIDATE"] as const;
/** The phases whose sessions plan, drafts and reviews alike. */
const PLANNING_PHASES: ReadonlySet<string> = new Set(["SLICE", "PLAN"]);
const PLANNING = "planning";
const EARLIER = "earlier";

/**
 * The four specification phases, then planning, each listed whether or not it
 * ran; then any phase a later build named, as it named it; then the rows that
 * name none. A run's rows and `doctor`'s are not `init`'s, and are left out.
 */
export function phaseSpend(root: string): PhaseSpend[] {
  const totals = new Map<string, { usd: number; sessions: number }>([...SPEC_PHASES, PLANNING].map((label) => [label, { usd: 0, sessions: 0 }]));
  for (const row of readLedgerRows(root)) {
    if (row.ticket !== INIT_TICKET) continue;
    const label = row.phase === undefined ? EARLIER : PLANNING_PHASES.has(row.phase) ? PLANNING : row.phase;
    const at = totals.get(label) ?? { usd: 0, sessions: 0 };
    totals.set(label, { usd: at.usd + row.cost_estimate_usd, sessions: at.sessions + 1 });
  }
  const earlier = totals.get(EARLIER);
  totals.delete(EARLIER);
  return [...[...totals].map(([label, t]) => ({ label, ...t })), ...(earlier === undefined ? [] : [{ label: EARLIER, ...earlier }])];
}

const sessions = (n: number): string => `${String(n)} session${n === 1 ? "" : "s"}`;

/** PRESENT's lines for it, or none where the ledger holds no `init` session. */
export function spendLines(spend: readonly PhaseSpend[]): string[] {
  const count = spend.reduce((n, s) => n + s.sessions, 0);
  if (count === 0) return [];
  const row = (label: string, usd: number, n: number): string => `  ${label.padEnd(10)} $${usd.toFixed(4)}  ${sessions(n)}`;
  return [
    "",
    "What `init` has spent on this root, by phase — reported, and nothing stops for it (X-1, C-7‴):",
    ...spend.map((s) => `${row(s.label, s.usd, s.sessions)}${s.label === EARLIER ? "  (recorded before a row named its phase)" : ""}`),
    row(
      "total",
      spend.reduce((usd, s) => usd + s.usd, 0),
      count,
    ),
  ];
}
