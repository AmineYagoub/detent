import { parseArgs } from "node:util";
import { buildPipeline, pendingPhases } from "../init/pipeline.js";
import { checkRoot, runInit } from "../init/machine.js";
import { loadConfig } from "../kernel/worstcase.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { CEILINGS } from "../schemas/budgets.js";
import type { Budgets } from "../schemas/budgets.js";
import { MockBackend } from "../sessions/mock.js";
import { loadPromptSet } from "../sessions/prompts.js";

/**
 * T-060 — `detent init`, the first porcelain verb (C-1, C-5, C-8).
 *
 * Thin: check the root (C-1), assemble the pipeline, run it, render whatever
 * interrupt came back. The five C-5 interrupts are the only things this verb
 * can ask a human, and it asks by printing and exiting 2 — a resumed `init`
 * picks up at the same phase from its checkpoints (C-8).
 */

export const EXIT_OK = 0;
export const EXIT_NOT_READY = 2;

export async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { replan: { type: "boolean", default: false } },
  });
  const root = positionals[0] ?? process.cwd();

  // C-1: root-only, with the root path hinted — and no `.detent/` created.
  const where = checkRoot(root);
  if (where.kind === "subdirectory") {
    process.stderr.write(`\`detent init\` runs only at the git root — run it from ${where.root}\n`);
    return EXIT_NOT_READY;
  }
  if (where.kind === "no-repo") {
    // C-1/C-6: a non-repo directory with planning docs may be offered `git
    // init` under setup-consent rules. That offer is T-065's; until it lands,
    // saying so is more useful than a bare refusal.
    process.stderr.write(
      "not a git repository — `detent init` needs one. Consented `git init` lands with the setup-consent engine (T-065); run `git init` yourself meanwhile.\n",
    );
    return EXIT_NOT_READY;
  }

  const handlers = buildPipeline({
    root,
    backend: new MockBackend(),
    prompts: loadPromptSet(),
    budgets: budgetsFor(root),
    note: (text) => process.stdout.write(`  ${text}\n`),
  });

  const result = await runInit(root, handlers, { replan: values.replan });

  for (const message of result.messages) process.stdout.write(`${message}\n`);
  if (result.reused.length > 0) process.stdout.write(`reused: ${result.reused.join(", ")}\n`);
  if (result.executed.length > 0) process.stdout.write(`ran: ${result.executed.join(", ")}\n`);

  if (result.interrupt !== undefined) {
    process.stdout.write(`\n[${result.interrupt.interrupt}]\n${result.interrupt.message}\n`);
    return EXIT_NOT_READY;
  }

  // Honest about the pipeline's own gaps rather than claiming READY.
  const pending = pendingPhases(handlers);
  if (pending.length > 0) {
    process.stdout.write(
      `\ninit stopped after ${result.reachedPhase}: ${pending.join(", ")} are not built yet (T-064…T-068).\n`,
    );
    return EXIT_NOT_READY;
  }
  process.stdout.write("\ninit complete — plan ready for approval.\n");
  return EXIT_OK;
}

/** Config budgets when one exists; X-1's defaults when init is bootstrapping. */
function budgetsFor(root: string): Budgets {
  const file = path.join(stateDir(root), "config.json");
  if (existsSync(file)) {
    try {
      return loadConfig(JSON.parse(readFileSync(file, "utf8"))).config.budgets;
    } catch {
      /* a config init has not written yet is not an error here */
    }
  }
  return Object.fromEntries(
    Object.entries(CEILINGS).map(([key, spec]) => [key, "default" in spec ? (spec as { default: number }).default : 25]),
  ) as Budgets;
}
