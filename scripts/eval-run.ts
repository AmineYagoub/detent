import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { defaultBackend } from "../src/cli/init.js";
import { exitFor, report } from "../src/eval/report.js";
import { writeResults } from "../src/eval/results.js";
import { runEvaluation } from "../src/eval/run.js";
import { EvalRefused } from "../src/eval/sets.js";
import { loadPromptSet } from "../src/sessions/prompts.js";
import { bundledRuntime } from "../src/sessions/runtime.js";
import { runDirectly } from "./plan-corpus.js";

/**
 * N-8 (PRDR-326) — runs one evaluation: a set's claims checked, or its areas
 * reviewed, on the model and effort named, on a disposable copy, within a
 * budget (docs/evaluation.md):
 *
 *   npx tsx scripts/eval-run.ts --set ~/detent-evals/tabachir/claims --copy ~/tabachir-detent-ab2 \
 *     --model claude-opus-5-5 --effort high --budget-usd 150
 *
 * It launches real sessions and spends real money, only within
 * `--budget-usd`, which it requires. `--stage` commits the set's tree to a
 * branch of a copy whose files differ; `--at-once` is how many sessions run
 * at once, four by default; `--only wrong` checks only the claims arm A found
 * wrong, as today's setup is re-run. `--foundations given` hands a reviews
 * set's reviewers the foundations as their system prompt (S-6‴). It writes its
 * results beside the set, or under `--results`, and prints the score.
 */

const USAGE =
  "usage: npx tsx scripts/eval-run.ts --set <set dir> --copy <a disposable copy> --model <model> --effort <effort> --budget-usd <dollars> " +
  "[--at-once 4] [--stage] [--only wrong] [--foundations given] [--results <dir>]\n";

const home = (p: string): string => p.replace(/^~(?=$|\/)/u, os.homedir());

export async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      set: { type: "string" },
      copy: { type: "string" },
      model: { type: "string" },
      effort: { type: "string" },
      "budget-usd": { type: "string" },
      "at-once": { type: "string", default: "4" },
      stage: { type: "boolean", default: false },
      results: { type: "string" },
      only: { type: "string" },
      foundations: { type: "string" },
    },
  });
  const budgetUsd = Number(values["budget-usd"]);
  const atOnce = Number(values["at-once"]);
  if (
    values.set === undefined ||
    values.copy === undefined ||
    values.model === undefined ||
    values.effort === undefined ||
    !(budgetUsd > 0) ||
    !Number.isInteger(atOnce) ||
    atOnce < 1 ||
    atOnce > 16 ||
    (values.only !== undefined && values.only !== "wrong") ||
    (values.foundations !== undefined && values.foundations !== "given")
  ) {
    process.stderr.write(USAGE);
    return 2;
  }
  const setDir = path.resolve(home(values.set));
  try {
    const results = await runEvaluation({
      setDir,
      copy: home(values.copy),
      route: { model: values.model, effort: values.effort },
      budgetUsd,
      atOnce,
      stage: values.stage,
      backend: defaultBackend,
      prompts: loadPromptSet(),
      runtime: bundledRuntime(),
      note: (text) => process.stdout.write(`  ${text}\n`),
      ...(values.only === "wrong" ? { only: "wrong" as const } : {}),
      ...(values.foundations === "given" ? { foundations: "given" as const } : {}),
    });
    const file = writeResults(values.results === undefined ? path.join(path.dirname(setDir), "results") : path.resolve(home(values.results)), results);
    const scored = report(results, {});
    process.stdout.write(`${scored.text}results: ${file}\n`);
    if (scored.verdict === "pending") process.stdout.write(`settle each claim listed, then: npx tsx scripts/eval-score.ts --results ${file} --settled <file>\n`);
    return exitFor(scored.verdict);
  } catch (err) {
    if (!(err instanceof EvalRefused)) throw err;
    process.stderr.write(`${err.message}\n`);
    return 2;
  }
}

if (runDirectly(import.meta.url)) process.exit(await main(process.argv.slice(2)));
