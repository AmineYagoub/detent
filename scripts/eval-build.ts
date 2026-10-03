import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildClaimsSet } from "../src/eval/claims-set.js";
import { addMajors, buildReviewsSet } from "../src/eval/reviews-set.js";
import { EvalRefused } from "../src/eval/sets.js";
import { loadPromptSet } from "../src/sessions/prompts.js";
import { runDirectly } from "./plan-corpus.js";

/**
 * N-8 (PRDR-326) — builds the evaluation sets from the copy a measured run
 * left, into a directory outside this repository (docs/evaluation.md):
 *
 *   npx tsx scripts/eval-build.ts --from ~/tabachir-detent-test --out ~/detent-evals/tabachir
 *
 * It writes `<out>/claims` and `<out>/reviews`; `--only claims` or
 * `--only reviews` builds one. `--confirmed` is how many of arm A's confirmed
 * claims the claims set samples, 30 by default, and `--prompt-hash` the
 * `spec_review` prompt hash the kept reviews' keys digest, this build's by
 * default. Nothing it builds is ever written inside this repository.
 *
 * N-8′ (PRDR-334): `--majors <reviews set>` adds the majors to a reviews set
 * built before the bar asked for them, from the copy it was read from, and
 * changes nothing else in it.
 */

const USAGE =
  "usage: npx tsx scripts/eval-build.ts --from <the copy the run left> --out <a directory outside this repository> [--only claims|reviews] [--confirmed 30] [--prompt-hash <hex>]\n" +
  "   or: npx tsx scripts/eval-build.ts --majors <a reviews set built before N-8′>\n";

const home = (p: string): string => p.replace(/^~(?=$|\/)/u, os.homedir());

export function main(argv: readonly string[]): number {
  const { values } = parseArgs({
    args: [...argv],
    options: { from: { type: "string" }, out: { type: "string" }, only: { type: "string" }, confirmed: { type: "string", default: "30" }, "prompt-hash": { type: "string" }, majors: { type: "string" } },
  });
  if (values.majors !== undefined) {
    if (values.from !== undefined || values.out !== undefined || values.only !== undefined) {
      process.stderr.write(USAGE);
      return 2;
    }
    try {
      for (const line of addMajors(path.resolve(home(values.majors))).report) process.stdout.write(`${line}\n`);
      return 0;
    } catch (err) {
      if (!(err instanceof EvalRefused)) throw err;
      process.stderr.write(`${err.message}\n`);
      return 2;
    }
  }
  const confirmed = Number(values.confirmed);
  if (values.from === undefined || values.out === undefined || !Number.isInteger(confirmed) || confirmed < 1 || !["claims", "reviews", undefined].includes(values.only)) {
    process.stderr.write(USAGE);
    return 2;
  }
  const from = home(values.from);
  const out = path.resolve(home(values.out));
  try {
    if (values.only !== "reviews") {
      const built = buildClaimsSet(from, path.join(out, "claims"), { confirmed });
      for (const line of built.report) process.stdout.write(`${line}\n`);
    }
    if (values.only !== "claims") {
      const built = buildReviewsSet(from, path.join(out, "reviews"), { promptHash: values["prompt-hash"] ?? loadPromptSet().hashes.spec_review });
      for (const line of built.report) process.stdout.write(`${line}\n`);
    }
  } catch (err) {
    if (!(err instanceof EvalRefused)) throw err;
    process.stderr.write(`${err.message}\n`);
    return 2;
  }
  process.stdout.write(`written under ${out}\n`);
  return 0;
}

if (runDirectly(import.meta.url)) process.exit(main(process.argv.slice(2)));
