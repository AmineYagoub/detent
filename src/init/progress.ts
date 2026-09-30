import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { stateDir } from "../fs/layout.js";
import { readLedgerRows } from "../kernel/ledger-rows.js";
import { SCHEMA_VERSION } from "../schemas/common.js";
import { estimateStep, estimateText, sessionFigure, sliceFigure, span, type Route, type SliceFigure, type Unit } from "./estimate.js";
import { INIT_TICKET } from "./session.js";

/**
 * N-5⁗ (PRDR-325) — a costly step of `init`, said before it spends and kept
 * while it runs, for `detent status`.
 *
 * `begin` notes the step's units with their estimate (`estimate.ts`) and
 * writes `state/init-progress.json`: the phase, the step, its units and how
 * many are done, how many run at once, when it began, and the figures its
 * estimate used. Each unit's `done` counts it there, and `end` removes the
 * file once the step has finished. So the file names the step of the `init`
 * that holds the run lock, or the step an `init` stopped in. A slice's `done`
 * also keeps what its planning spent, from the ledger, and how long it took,
 * which is the figure a later slice is estimated from.
 *
 * Nothing here stops a step: a figure that cannot be read is no estimate, and
 * a file that cannot be written leaves `detent status` without progress
 * (PRDR-191, PRDR-265).
 */

const progressSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  pid: z.number().int(),
  phase: z.string(),
  step: z.string(),
  units: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  at_once: z.number().int().positive(),
  began: z.string(),
  unit_ms: z.number().nonnegative().nullable(),
  usd: z.number().nonnegative().nullable(),
  from: z.string().nullable(),
});
export type Progress = z.infer<typeof progressSchema>;

const slicesSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  slices: z.array(z.strictObject({ route: z.string(), usd: z.number().nonnegative(), ms: z.number().nonnegative(), at: z.string() })),
});

export function progressPath(root: string): string {
  return path.join(stateDir(root), "state", "init-progress.json");
}

export function sliceFiguresPath(root: string): string {
  return path.join(stateDir(root), "state", "slice-figures.json");
}

function readJson<T>(file: string, schema: z.ZodType<T>): T | null {
  if (!existsSync(file)) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  } catch {
    /* Progress informs; a step does not fail because its record could not be written. */
  }
}

export function readProgress(root: string): Progress | null {
  return readJson(progressPath(root), progressSchema);
}

/** A step no `init` is in: the one a stopped `init` left, cleared when the next one starts. */
export function clearProgress(root: string): void {
  rmSync(progressPath(root), { force: true });
}

function readSliceFigures(root: string): SliceFigure[] {
  return readJson(sliceFiguresPath(root), slicesSchema)?.slices ?? [];
}

function keepSliceFigure(root: string, figure: SliceFigure & { readonly at: string }): void {
  const slices = readJson(sliceFiguresPath(root), slicesSchema)?.slices ?? [];
  writeJson(sliceFiguresPath(root), { schema_version: SCHEMA_VERSION, slices: [...slices, figure] });
}

/** What `init` has spent on this root, by its ledger rows. */
function initSpent(root: string): number {
  return readLedgerRows(root)
    .filter((r) => r.ticket === INIT_TICKET)
    .reduce((usd, r) => usd + r.cost_estimate_usd, 0);
}

export interface StepSpec {
  /** The `init` phase whose ledger rows are the step's spend. */
  readonly phase: string;
  /** The step, as `detent status` names it. */
  readonly step: string;
  /** The note's opening, before its estimate: what the step will run. */
  readonly said: string;
  readonly units: readonly Unit[];
  readonly atOnce: number;
}

export interface UnitRun {
  done(): void;
}

export interface Step {
  /** A unit starts. */
  start(): UnitRun;
  /** The step has finished, and its progress goes. */
  end(): void;
}

export interface Estimator {
  begin(spec: StepSpec): Step;
}

export interface EstimatorDeps {
  readonly root: string;
  readonly modelRouting?: Readonly<Record<string, string>> | undefined;
  readonly effortRouting?: Readonly<Record<string, string>> | undefined;
  readonly note?: ((text: string) => void) | undefined;
  readonly now?: (() => Date) | undefined;
}

const NOTHING: Step = { start: () => ({ done: () => undefined }), end: () => undefined };

export function estimator(deps: EstimatorDeps): Estimator {
  const now = deps.now ?? ((): Date => new Date());
  const route = (role: string): Route => ({ model: deps.modelRouting?.[role] ?? "", effort: deps.effortRouting?.[role] ?? "default" });
  const on = (role: string): string => `${role} on ${route(role).model === "" ? "the runtime's own model" : route(role).model} at ${route(role).effort}`;
  const sliceRoute = `${on("planner")} and ${on("plan_review")}`;
  return {
    begin(spec: StepSpec): Step {
      if (spec.units.length === 0) return NOTHING;
      let estimate: ReturnType<typeof estimateStep>;
      try {
        const rows = readLedgerRows(deps.root);
        const slices = readSliceFigures(deps.root);
        estimate = estimateStep(spec.units, spec.atOnce, (unit) => (unit === "slice" ? sliceFigure(slices, sliceRoute) : sessionFigure(rows, unit, route(unit.role))));
      } catch (err) {
        deps.note?.(`${spec.said} — no estimate, since the figures could not be read: ${(err as Error).message} (N-5⁗)`);
        return NOTHING;
      }
      deps.note?.(`${spec.said} — ${estimateText(estimate)}`);
      const began = now().toISOString();
      let done = 0;
      const record = (): void => {
        writeJson(progressPath(deps.root), {
          schema_version: SCHEMA_VERSION,
          pid: process.pid,
          phase: spec.phase,
          step: spec.step,
          units: spec.units.length,
          done,
          at_once: spec.atOnce,
          began,
          unit_ms: estimate.unitMs,
          usd: estimate.figured === 0 ? null : estimate.usd,
          from: estimate.from.length === 0 ? null : estimate.from.join("; and "),
        });
      };
      record();
      const slices = spec.units.every((unit) => unit === "slice");
      return {
        start(): UnitRun {
          const at = now().getTime();
          const spent = slices ? initSpent(deps.root) : 0;
          return {
            done(): void {
              done += 1;
              record();
              if (slices) keepSliceFigure(deps.root, { route: sliceRoute, usd: Math.max(0, initSpent(deps.root) - spent), ms: now().getTime() - at, at: now().toISOString() });
            },
          };
        },
        end(): void {
          clearProgress(deps.root);
        },
      };
    },
  };
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** A local clock time, with its date where it is not today's. */
function clockTime(at: Date, now: Date): string {
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return at.toDateString() === now.toDateString() ? time : `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${time}`;
}

/**
 * `detent status`'s lines for the step: the phase and step, the units done and
 * left, what they have spent, and, while the `init` that holds the run lock is
 * in it, an estimated finish from the figures its note gave.
 */
export function progressLines(root: string, now: Date, running: (pid: number) => boolean): string[] {
  const progress = readProgress(root);
  if (progress === null) return [];
  const spent = readLedgerRows(root)
    .filter((r) => r.ticket === INIT_TICKET && r.phase === progress.phase && r.at >= progress.began)
    .reduce((usd, r) => usd + r.cost_estimate_usd, 0);
  const left = Math.max(0, progress.units - progress.done);
  const pace = progress.at_once === 1 ? "one at a time" : `${String(progress.at_once)} at once`;
  const where = `${progress.step}: ${String(progress.done)} of ${String(progress.units)} done, ${String(left)} left, ${pace}; $${spent.toFixed(2)} spent on them so far`;
  if (!running(progress.pid)) return ["", `\`init\` stopped in ${where}. Re-run \`detent init\` to carry on (C-8).`];
  const finish =
    progress.unit_ms === null || progress.from === null
      ? "no estimated finish: nothing has measured these units yet"
      : `estimated to finish in about ${span(Math.ceil(left / progress.at_once) * progress.unit_ms)}, around ${clockTime(new Date(now.getTime() + Math.ceil(left / progress.at_once) * progress.unit_ms), now)}, by ${progress.from}`;
  return ["", `\`init\` is running (N-5⁗) — an estimate, which nothing stops for:`, `  ${where}`, `  ${finish}`];
}
