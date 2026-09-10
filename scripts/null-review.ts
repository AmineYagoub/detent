import { parseArgs } from "node:util";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { loadConfig } from "../src/kernel/worstcase.js";
import { CEILINGS, type Budgets } from "../src/schemas/budgets.js";
import { ClaudeCodeBackend } from "../src/sessions/sdk.js";
import { loadPromptSet } from "../src/sessions/prompts.js";
import { STRUCTURAL_PROTECTED } from "../src/schemas/common.js";
import { launchInitSession, withInitJournal } from "../src/init/session.js";
import type { LaunchBatch } from "../src/init/launch-batch.js";
import { sessionDeps } from "../src/init/session-deps.js";
import { reviewPlan } from "../src/init/plan-review.js";
import { sampleChurn } from "../src/init/plan-signal.js";
import { planDraftPath } from "../src/init/plan.js";
import { stateDir } from "../src/fs/layout.js";
import type { PlanReview } from "../src/schemas/init.js";
import { ledgerSpend, readPlannedRoot, runDirectly, sliceTickets } from "./plan-corpus.js";

/**
 * null-review — what the revision round's numbers look like when the revision
 * does nothing at all.
 *
 * Not part of `detent`: no verb runs it and no gate does, because it launches
 * live sessions and costs money. What IS gated is that it still compiles
 * against the seams it measures (PRDR-202).
 *
 * THE MEASUREMENT. Production computes `revisionOutcome(F1, F2)` where F1
 * reviewed the first draft and F2 reviewed the REDRAFT. This runs the same
 * arithmetic over `k` reviews of the SAME, byte-identical tickets read back
 * from the slice checkpoints, with no redraft between them. Every `resolved`
 * and every `introduced` it reports is critic churn by construction — the null
 * the production numbers have to be read against.
 *
 * Rating Roulette (Findings of EMNLP 2025) is the same design: repeated
 * judgements of one artifact, same prompt, same hyperparameters. Three reads is
 * the default for the same reason — two give one ordered pair per slice, three
 * give six.
 *
 * It calls the PRODUCTION `reviewPlan` and the PRODUCTION `sampleChurn` through
 * the same `launchInitSession` seam PLAN uses. A harness that reimplements
 * either measures the harness.
 *
 *   npx tsx scripts/null-review.ts --root <copy> [--runs 3] [--slices s01,s02]
 *
 * Point it at a COPY: each review deletes and rewrites
 * `.detent/state/plan-review.json` in the root it is given.
 */

type Findings = PlanReview["findings"];

/** `findingKey`'s identity, for DISPLAY only — every number comes from `sampleChurn`. */
const keyed = (fs: Findings): Set<string> =>
  new Set(fs.filter((f) => f.ticket !== undefined && f.ticket !== "").map((f) => `${f.ticket ?? ""}/${f.tag}`));

export interface NullRates {
  readonly c: number;
  readonly g: number;
  readonly introPerResolved: number;
}

/**
 * The two rates, from a churn total and the population it was measured over.
 *
 * `c` is resolutions over the findings that existed before; `g` is
 * introductions over the tickets that carried no finding and could therefore
 * acquire one. Both denominators are stated rather than assumed, because the
 * break-even reading of these numbers turns on the second one.
 */
export function nullRates(
  churn: { readonly resolved: number; readonly survived: number; readonly introduced: number },
  before: number,
  atRisk: number,
): NullRates {
  return {
    c: before === 0 ? Number.NaN : churn.resolved / before,
    g: atRisk === 0 ? Number.NaN : churn.introduced / atRisk,
    introPerResolved: churn.resolved === 0 ? Number.NaN : churn.introduced / churn.resolved,
  };
}

const fmt = (n: number, d = 3): string => (Number.isFinite(n) ? n.toFixed(d) : "—");

function budgetsFor(root: string): Budgets {
  const file = path.join(stateDir(root), "config.json");
  const base: Budgets = existsSync(file)
    ? loadConfig(JSON.parse(readFileSync(file, "utf8")) as unknown).config.budgets
    : (Object.fromEntries(Object.entries(CEILINGS).map(([k, s]) => [k, s.default])) as Budgets);
  return {
    ...base,
    /**
     * X-1⁵'s breaker counts spend that buys no PLAN progress, and this harness
     * makes none by design — every session re-reviews an unchanged artifact. The
     * production ceilings would trip partway and truncate the sample into a
     * biased one. Raised here and nowhere else.
     */
    spend_without_progress_floor_usd: 1_000_000,
    spend_without_progress_multiple: 1_000_000,
    spend_without_progress_sessions: 1_000_000,
  };
}

async function sweep(root: string, runs: number, want: readonly string[] | null): Promise<void> {
  const corpus = readPlannedRoot(root);
  const specs = new Map(corpus.specs.map((s) => [s.id, s]));
  const config = existsSync(path.join(stateDir(root), "config.json"))
    ? loadConfig(JSON.parse(readFileSync(path.join(stateDir(root), "config.json"), "utf8")) as unknown).config
    : null;
  const budgets = budgetsFor(root);

  const pipelineDeps = {
    root,
    backend: new ClaudeCodeBackend({
      policy: { surface: ["**"], protectedGlobs: [...STRUCTURAL_PROTECTED], workRoot: root },
    }),
    prompts: loadPromptSet(),
    budgets,
    /** PRDR-114 / PRDR-197: the same model and effort production routes the review to. */
    modelRouting: config?.model_routing ?? {},
    effortRouting: config?.effort_routing ?? {},
    note: (text: string) => process.stdout.write(`      ${text}\n`),
  };
  const before = ledgerSpend(root);
  const ids = corpus.planned.filter((id) => want === null || want.includes(id));
  process.stdout.write(`null-review — ${String(runs)} review(s) per slice over UNCHANGED tickets\nroot: ${root}\nslices: ${ids.join(" ")}\n\n`);

  let tBefore = 0;
  let tAtRisk = 0;
  const total = { resolved: 0, survived: 0, introduced: 0 };

  /* PRDR-203: one journal for the sweep, as a phase holds one for every launch it makes. */
  await withInitJournal(root, async (journal) => {
    const reviewDeps = {
      root,
      docs: corpus.docs,
      budgets,
      launch: async (inputs: Record<string, unknown>, artifactOut?: string, batch?: LaunchBatch): Promise<void> => {
        await launchInitSession(sessionDeps(pipelineDeps, journal), {
          role: "planner",
          inputs,
          artifactOut: artifactOut ?? planDraftPath(root),
          ...(batch === undefined ? {} : { batch }),
        });
      },
      note: (text: string) => process.stdout.write(`      ${text}\n`),
    };

  for (const id of ids) {
    const spec = specs.get(id);
    const own = sliceTickets(corpus, id);
    if (spec === undefined || own.length === 0) continue;
    const planIndex = corpus.tickets
      .filter((t) => t.slice < id)
      .map((t) => ({ id: t.id, slice: t.slice, title: t.title, surface: t.surface }));

    process.stdout.write(`${id}  ${String(own.length)} ticket(s)\n`);
    const reads: Findings[] = [];
    for (let i = 0; i < runs; i += 1) {
      const review = await reviewPlan(reviewDeps, own, { kind: "slice", slice: spec, planIndex });
      if (review === null) {
        process.stdout.write(`  run ${String(i + 1)}: NO VERDICT — excluded\n`);
        continue;
      }
      const fs = review.verdict === "changes" ? review.findings : [];
      reads.push(fs);
      process.stdout.write(`  run ${String(i + 1)}: ${review.verdict}, ${String(fs.length)} finding(s)\n         ${[...keyed(fs)].join("  ") || "(none)"}\n`);
    }
    if (reads.length < 2) {
      process.stdout.write("  fewer than two usable reads — no pair\n\n");
      continue;
    }
    const churn = sampleChurn(reads);
    total.resolved += churn.resolved;
    total.survived += churn.survived;
    total.introduced += churn.introduced;
    for (const r of reads) {
      const n = keyed(r).size;
      tBefore += n * (reads.length - 1);
      tAtRisk += Math.max(own.length - n, 0) * (reads.length - 1);
    }
    process.stdout.write(`  churn over ${String(reads.length * (reads.length - 1))} ordered pair(s), NOTHING revised: ${String(churn.resolved)} resolved, ${String(churn.survived)} survived, ${String(churn.introduced)} introduced\n\n`);
  }
  });

  const rates = nullRates(total, tBefore, tAtRisk);
  const after = ledgerSpend(root);
  process.stdout.write(
    `${"".padEnd(72, "-")}\nNULL: ${String(total.resolved)} resolved, ${String(total.survived)} survived, ${String(total.introduced)} introduced\n` +
      `      c ${fmt(rates.c)}   g ${fmt(rates.g)}   introduced/resolved ${fmt(rates.introPerResolved, 2)}\n` +
      `${"".padEnd(72, "-")}\nThis is what the same arithmetic returns with NO revision between the reads.\n\n` +
      `sessions: ${String(after.sessions - before.sessions)}   spend: $${fmt(after.usd - before.usd, 2)}\n`,
  );
}

if (runDirectly(import.meta.url)) {
  const { values } = parseArgs({
    options: { root: { type: "string" }, runs: { type: "string", default: "3" }, slices: { type: "string" } },
  });
  if (values.root === undefined) {
    process.stderr.write("usage: null-review --root <copy> [--runs 3] [--slices s01,s02]\n");
    process.exit(1);
  }
  const runs = Number.parseInt(values.runs ?? "3", 10);
  if (!Number.isInteger(runs) || runs < 2) {
    process.stderr.write("--runs must be an integer >= 2 (a null needs at least one ordered pair)\n");
    process.exit(1);
  }
  await sweep(
    path.resolve(values.root),
    runs,
    values.slices === undefined ? null : values.slices.split(",").map((s) => s.trim()),
  );
}
