import { span, type Route } from "../init/estimate.js";
import type { PipelineDeps } from "../init/pipeline.js";
import { sessionDeps } from "../init/session-deps.js";
import { INIT_TICKET, withInitJournal } from "../init/session.js";
import { detentBuild } from "../kernel/build.js";
import { readLedgerRows } from "../kernel/ledger-rows.js";
import { acquireRunLock } from "../kernel/run-lock.js";
import { budgetsSchema } from "../schemas/budgets.js";
import { SCHEMA_VERSION } from "../schemas/common.js";
import type { PromptSet, SessionBackend } from "../sessions/backend.js";
import type { Sandbox } from "../sessions/sandbox.js";
import { EvalBudget, evalFigure, spentSince } from "./budget.js";
import { clearAnswers, prepareCopy } from "./copy.js";
import type { EvalResults } from "./results.js";
import { checkSet, claimsToCheck, reviewSet } from "./run-units.js";
import { EvalRefused, readSet } from "./sets.js";

/**
 * N-8 (PRDR-326) — one evaluation: a set's claims checked, or its areas
 * reviewed, on one route, on a disposable copy.
 *
 * It runs what `init` runs: the same backend, prompts and session
 * configuration (`sessionDeps`), one journal for the phase, and every session
 * on the copy's ledger. Only the route moves: the evaluated role runs on the
 * model and effort named. It says its estimate before it starts, holds the
 * copy's run lock throughout, as `init` does, removes from the copy every
 * earlier verdict on a unit of the set (`copy.ts`), and starts no session its
 * budget refuses (`budget.ts`).
 */

export interface EvalDeps {
  readonly setDir: string;
  readonly copy: string;
  readonly route: Route;
  readonly budgetUsd: number;
  /** How many sessions run at once: four, as every measurement so far ran (X-1⁸). */
  readonly atOnce: number;
  /** Whether a copy whose files are not the set's tree may have it committed to a branch (`copy.ts`). */
  readonly stage: boolean;
  readonly backend: (root: string) => SessionBackend;
  readonly prompts: PromptSet;
  /** The Claude Code runtime the sessions run on, recorded with what they found. */
  readonly runtime: string;
  readonly note: (text: string) => void;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly sandbox?: () => Promise<Sandbox>;
  /** A claims set's claims arm A found wrong alone, as today's setup is re-run on them (N-8). */
  readonly only?: "wrong";
  /** S-6‴: a reviews set's reviewers each handed the foundations as their system prompt, as `review_foundations: given` hands them. */
  readonly foundations?: "given";
}

const CHECK = { role: "audit", task: "verify_claims" } as const;
const REVIEW = { role: "spec_review", task: "review" } as const;

export async function runEvaluation(deps: EvalDeps): Promise<EvalResults> {
  if (!(deps.budgetUsd > 0)) throw new EvalRefused("an evaluation runs only within a budget, and none above $0 was given (N-8)");
  const set = readSet(deps.setDir);
  if (deps.only !== undefined && set.kind !== "claims") throw new EvalRefused("only a claims set is run on the claims arm A found wrong alone");
  if (deps.foundations !== undefined && set.kind !== "reviews") throw new EvalRefused("only a reviews set's reviewers are handed the foundations (S-6‴)");
  const root = prepareCopy(deps.copy, set, deps.setDir, deps.stage, deps.note);
  const lock = acquireRunLock(root);
  if (!lock.ok) throw new EvalRefused(`${root} is held by another process, and an evaluation waits for it to end`);
  try {
    const cleared = clearAnswers(root, set);
    if (cleared.length > 0) {
      deps.note(
        `N-8: ${String(cleared.length)} records of a verdict on the set's units are removed from the copy, since no session of AUDIT's or VALIDATE's finds the answer it is asked for: ` +
          `${cleared.slice(0, 3).join(", ")}${cleared.length > 3 ? `, and ${String(cleared.length - 3)} more` : ""}`,
      );
    }
    const unit = set.kind === "claims" ? CHECK : REVIEW;
    const figure = evalFigure(readLedgerRows(root), unit, deps.route);
    const count = set.kind === "claims" ? claimsToCheck(set, deps.only).length : set.areas.length;
    deps.note(
      `N-8: ${String(count)} ${set.kind === "claims" ? "claim checks" : "reviews"} on ${deps.route.model} at ${deps.route.effort}, ${String(deps.atOnce)} at once: ` +
        `about $${(count * figure.usd).toFixed(2)} and ${span(Math.ceil(count / deps.atOnce) * figure.ms)}, by ${figure.from}. ` +
        `The budget is $${deps.budgetUsd.toFixed(2)}, and no session starts that its figure would take past it`,
    );
    const clock = deps.now ?? (() => new Date());
    const started = clock().toISOString();
    const spent = (): number => spentSince(root, started);
    const budget = new EvalBudget(deps.budgetUsd, figure.usd, spent);
    const pipeline: PipelineDeps = {
      root,
      backend: deps.backend(root),
      prompts: deps.prompts,
      budgets: budgetsSchema.parse({ run_spend_usd: deps.budgetUsd }),
      modelRouting: { [unit.role]: deps.route.model },
      effortRouting: { [unit.role]: deps.route.effort },
      note: deps.note,
      ...(deps.now === undefined ? {} : { now: deps.now }),
      ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
    };
    const units = await withInitJournal(root, async (journal) => {
      const unitDeps = { root, budget, atOnce: deps.atOnce, note: deps.note, spent };
      return set.kind === "claims"
        ? {
            kind: "claims" as const,
            ...(deps.only === undefined ? {} : { only: deps.only }),
            ...(await checkSet(set, { ...unitDeps, launch: sessionDeps(pipeline, journal, "AUDIT"), only: deps.only })),
          }
        : {
            kind: "reviews" as const,
            ...(deps.foundations === undefined ? {} : { foundations: deps.foundations }),
            ...(await reviewSet(set, {
              ...unitDeps,
              launch: sessionDeps(pipeline, journal, "VALIDATE"),
              prompts: deps.prompts,
              sandbox: deps.sandbox,
              foundations: deps.foundations ?? "read",
            })),
          };
    });
    const ended = clock().toISOString();
    const rows = readLedgerRows(root).filter((r) => r.ticket === INIT_TICKET && r.at >= started);
    const ran = {
      schema_version: SCHEMA_VERSION as typeof SCHEMA_VERSION,
      set: { dir: deps.setDir, built_at: set.built.at },
      route: { model: deps.route.model, effort: deps.route.effort },
      build: detentBuild(),
      runtime: deps.runtime,
      copy: root,
      started,
      ended,
      wall_ms: Math.max(0, Date.parse(ended) - Date.parse(started)),
      spend_usd: rows.reduce((total, r) => total + r.cost_estimate_usd, 0),
      sessions: rows.length,
      budget_usd: deps.budgetUsd,
    };
    return { ...ran, ...units };
  } finally {
    lock.release();
  }
}
