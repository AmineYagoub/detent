import type { LedgerRow } from "../schemas/records.js";
import { INIT_TICKET } from "./session.js";

/**
 * N-5⁗ (PRDR-325) — what a costly step of `init` will cost and how long it
 * will take, worked out before it spends.
 *
 * Tabachir's test run spent $534 and 9.6 hours in AUDIT before DECIDE asked
 * anything, and nothing said beforehand how many claims would be checked or
 * what that would cost. A step's units are known before it starts: AUDIT's
 * claims to check, a round's areas to review, its writer's batches, PLAN's
 * slices to plan. Its estimate is the units times a unit's figure, and its
 * wall clock is the units a batch of `atOnce` at a time, each batch as long as
 * a unit.
 *
 * A session's figure is the median of this project's own ledger rows of the
 * same role and task, on the same model at the same effort, once there are
 * `OWN_FIGURE_MIN` of them with a length and no crash; a slice's is the median
 * of the slices this project planned on the same routes. Otherwise it is
 * Detent's measured figure, from `MEASURED`, which names the run and build
 * that measured it. A kind with neither has no estimate, and the note says so.
 * An estimate informs: nothing stops, asks or waits for one (PRDR-191,
 * PRDR-265).
 */

/** A unit of a step: a session of a role's task, or a slice PLAN plans. */
export type Unit = { readonly role: string; readonly task: string } | "slice";

/** Where a role's sessions go: the model, empty for the runtime's own, and the effort. */
export interface Route {
  readonly model: string;
  readonly effort: string;
}

/** What one unit costs and how long it runs, and whose figure that is. */
export interface Figure {
  readonly usd: number;
  readonly ms: number;
  readonly from: string;
}

/** A slice PLAN planned: what its planning spent and how long it took, on the routes named. */
export interface SliceFigure {
  readonly route: string;
  readonly usd: number;
  readonly ms: number;
}

interface Measured extends Route {
  readonly role: string;
  readonly task: string;
  readonly usd: number;
  readonly minutes: number;
  readonly by: string;
}

/**
 * Detent's measured figures: the median cost of the kind's ledger rows and the
 * median length of its transcripts, on the run and build named.
 */
export const MEASURED: readonly Measured[] = [
  {
    role: "audit",
    task: "verify_claims",
    model: "claude-opus-5-5",
    effort: "max",
    usd: 2.86,
    minutes: 7.8,
    by: "tabachir's test run at build 34585b8, 171 ledger rows and 153 transcripts",
  },
  {
    role: "spec_review",
    task: "review",
    model: "claude-opus-5-5",
    effort: "max",
    usd: 9.64,
    minutes: 31.5,
    by: "tabachir's test run at build 34585b8, 26 ledger rows and 35 transcripts",
  },
];

/** How many of this project's own a figure needs: fewer is noise. */
export const OWN_FIGURE_MIN = 5;

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

const NAMES: Readonly<Record<string, readonly [string, string]>> = {
  "audit/verify_claims": ["claim check", "claim checks"],
  "spec_review/review": ["review", "reviews"],
  "spec_review/verify": ["verifying review", "verifying reviews"],
  "spec_write/fix": ["writer batch", "writer batches"],
};

/** A unit's name in a note, one and many. */
export function nameOf(unit: Unit): readonly [string, string] {
  if (unit === "slice") return ["slice", "slices"];
  return NAMES[`${unit.role}/${unit.task}`] ?? [`${unit.role} ${unit.task} session`, `${unit.role} ${unit.task} sessions`];
}

/** A length in a note: minutes to a tenth under an hour, then hours and whole minutes. */
export function span(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 1) return "under a minute";
  if (minutes < 59.95) return `${minutes.toFixed(1).replace(/\.0$/u, "")} min`;
  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

const onRoute = (route: Route): string => `${route.model === "" ? "the runtime's own model" : route.model} at ${route.effort}`;
const costAndLength = (usd: number, ms: number): string => `$${usd.toFixed(2)} and ${span(ms)}`;

/** A session's figure: this project's median once it has enough rows of the kind, else Detent's measured one, else none. */
export function sessionFigure(rows: readonly LedgerRow[], unit: { readonly role: string; readonly task: string }, route: Route): Figure | null {
  const [one] = nameOf(unit);
  const own = rows.filter(
    (r) =>
      r.ticket === INIT_TICKET &&
      r.role === unit.role &&
      r.task === unit.task &&
      r.effort === route.effort &&
      r.models.includes(route.model) &&
      r.partial === undefined &&
      r.duration_ms !== undefined,
  );
  if (own.length >= OWN_FIGURE_MIN) {
    const usd = median(own.map((r) => r.cost_estimate_usd));
    const ms = median(own.map((r) => r.duration_ms ?? 0));
    return { usd, ms, from: `this project's own figure for a ${one}, ${costAndLength(usd, ms)} on ${onRoute(route)}, the medians of its ${String(own.length)} ledger rows` };
  }
  const measured = MEASURED.find((m) => m.role === unit.role && m.task === unit.task && m.model === route.model && m.effort === route.effort);
  if (measured === undefined) return null;
  const ms = measured.minutes * 60_000;
  return { usd: measured.usd, ms, from: `Detent's measured figure for a ${one}, ${costAndLength(measured.usd, ms)} on ${onRoute(route)}, the medians of ${measured.by}` };
}

/** A slice's figure: this project's median once it has planned enough slices on the same routes; Detent has measured none. */
export function sliceFigure(slices: readonly SliceFigure[], route: string): Figure | null {
  const own = slices.filter((s) => s.route === route);
  if (own.length < OWN_FIGURE_MIN) return null;
  const usd = median(own.map((s) => s.usd));
  const ms = median(own.map((s) => s.ms));
  return { usd, ms, from: `this project's own figure for a slice, ${costAndLength(usd, ms)} with ${route}, the medians of the ${String(own.length)} it planned` };
}

export interface StepEstimate {
  readonly usd: number;
  readonly ms: number;
  /** How many units have a figure, and each kind without one. */
  readonly figured: number;
  readonly unfigured: readonly { readonly name: string; readonly count: number }[];
  readonly from: readonly string[];
  /** A figured unit's length and cost, on average, which `detent status` counts the units left in. */
  readonly unitMs: number | null;
}

/** The units times their figures, and the wall clock: the figured units a batch of `atOnce` at a time, each as long as a unit on average. */
export function estimateStep(units: readonly Unit[], atOnce: number, figureOf: (unit: Unit) => Figure | null): StepEstimate {
  const kinds = new Map<string, { unit: Unit; count: number }>();
  for (const unit of units) {
    const key = unit === "slice" ? unit : `${unit.role}/${unit.task}`;
    kinds.set(key, { unit, count: (kinds.get(key)?.count ?? 0) + 1 });
  }
  let usd = 0;
  let ms = 0;
  let count = 0;
  const from: string[] = [];
  const unfigured: { name: string; count: number }[] = [];
  for (const kind of kinds.values()) {
    const figure = figureOf(kind.unit);
    const [one, many] = nameOf(kind.unit);
    if (figure === null) {
      unfigured.push({ name: kind.count === 1 ? one : many, count: kind.count });
      continue;
    }
    usd += kind.count * figure.usd;
    ms += kind.count * figure.ms;
    count += kind.count;
    from.push(figure.from);
  }
  const unitMs = count === 0 ? null : ms / count;
  return { usd, ms: unitMs === null ? 0 : Math.ceil(count / Math.max(1, atOnce)) * unitMs, figured: count, unfigured, from, unitMs };
}

/** What the note before a step says of its estimate. */
export function estimateText(estimate: StepEstimate): string {
  const none = estimate.unfigured.map((u) => `${String(u.count)} ${u.name}`).join(" and ");
  if (estimate.figured === 0) {
    return `no estimate: neither this project's ledger nor Detent's measurements has a figure yet for the ${none} on the routes they run on (N-5⁗)`;
  }
  const part = estimate.unfigured.length === 0 ? "" : ` for the ${String(estimate.figured)} with a figure, and none yet for the ${none}`;
  return `about ${costAndLength(estimate.usd, estimate.ms)}${part}, by ${estimate.from.join("; and ")}. An estimate, which nothing stops for (N-5⁗)`;
}
