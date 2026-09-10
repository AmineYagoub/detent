import path from "node:path";
import { applyContracts } from "../src/init/contracts.js";
import { readPlannedRoot, runDirectly, type PlanCorpus } from "./plan-corpus.js";
import type { PlanReview } from "../src/schemas/init.js";

/**
 * coverage-report — what A-1⁵ says about a plan already on disk.
 *
 * Not part of `detent`: no verb runs it and no gate does. It calls the
 * PRODUCTION `applyContracts` with the same four arguments `plan.ts` passes,
 * over a root that has already been planned. Zero sessions — the whole point
 * of PRDR-201 is that this question is decided rather than asked.
 *
 *   npx tsx scripts/coverage-report.ts <root> [<root> ...]
 */

/** The coverage half of the contract check, over a corpus. Pure; the test drives this. */
export function coverageFindings(corpus: PlanCorpus): PlanReview["findings"] {
  const out = applyContracts(
    corpus.tickets,
    corpus.specs.map((s) => s.id),
    [],
    corpus.specs,
  );
  return out.findings.filter((f) => f.tag === "coverage");
}

function report(root: string): void {
  const corpus = readPlannedRoot(root);
  const coverage = coverageFindings(corpus);
  const declared = corpus.tickets.filter((t) => t.requirement_ids.length > 0 || t.baseline_ids.length > 0).length;

  process.stdout.write(
    `${path.basename(root)}: ${String(corpus.specs.length)} slice(s), ${String(corpus.planned.length)} planned, ` +
      `${String(corpus.tickets.length)} ticket(s), ${String(declared)} declaring coverage\n`,
  );
  for (const f of coverage) process.stdout.write(`  ${f.finding}\n`);
  process.stdout.write(`  → ${String(coverage.length)} coverage finding(s), 0 sessions\n\n`);
}

if (runDirectly(import.meta.url)) {
  const roots = process.argv.slice(2);
  if (roots.length === 0) {
    process.stderr.write("usage: coverage-report <root> [<root> ...]\n");
    process.exit(1);
  }
  for (const r of roots) report(path.resolve(r));
}
