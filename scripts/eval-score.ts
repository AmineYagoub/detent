import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { exitFor, report } from "../src/eval/report.js";
import { readResults, readSettlements } from "../src/eval/results.js";
import { EvalRefused } from "../src/eval/sets.js";
import { runDirectly } from "./plan-corpus.js";

/**
 * N-8 (PRDR-326) — scores an evaluation's results again, with a person's
 * settlements of the confirmed claims it called wrong (docs/evaluation.md):
 *
 *   npx tsx scripts/eval-score.ts --results <results file> [--settled <settlements file>]
 *
 * A settlements file maps each claim's hash to `arm_a_mistaken` or
 * `arm_mistaken`. It launches nothing and spends nothing.
 */

const home = (p: string): string => p.replace(/^~(?=$|\/)/u, os.homedir());

export function main(argv: readonly string[]): number {
  const { values } = parseArgs({ args: [...argv], options: { results: { type: "string" }, settled: { type: "string" } } });
  if (values.results === undefined) {
    process.stderr.write("usage: npx tsx scripts/eval-score.ts --results <results file> [--settled <settlements file>]\n");
    return 2;
  }
  try {
    const results = readResults(path.resolve(home(values.results)));
    const scored = report(results, readSettlements(values.settled === undefined ? undefined : path.resolve(home(values.settled))));
    process.stdout.write(scored.text);
    return exitFor(scored.verdict);
  } catch (err) {
    if (!(err instanceof EvalRefused)) throw err;
    process.stderr.write(`${err.message}\n`);
    return 2;
  }
}

if (runDirectly(import.meta.url)) process.exit(main(process.argv.slice(2)));
