import { parseArgs } from "node:util";
import { EXIT_ERROR, run } from "../kernel/run.js";
import { MockBackend } from "../sessions/mock.js";
import { loadPromptSet } from "../sessions/prompts.js";

/**
 * T-041 — `detent run`, the second porcelain verb (C-9…C-11, D-3).
 *
 * Thin by design: parse arguments (R-6: `node:util.parseArgs`), load the
 * vendored prompts, hand everything to the kernel, and map the outcome onto
 * C-11's public exit codes. On exit 10 the machine-readable summary goes to
 * stdout — C-10's non-TTY contract; the interactive escalation flow is T-049.
 *
 * The real SDK backend lands at T-046; until then only the mock is
 * constructible here, which keeps this verb runnable in fixtures and demos
 * without pretending a live backend exists.
 */
export async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      "max-tickets": { type: "string" },
      backend: { type: "string", default: "mock" },
      worker: { type: "string", default: "w1" },
    },
  });

  if (values.backend !== "mock") {
    process.stderr.write(`backend '${values.backend}' is not available yet: the SDK backend lands at T-046 (S-1).\n`);
    return EXIT_ERROR;
  }

  const root = positionals[0] ?? process.cwd();
  const maxTickets = values["max-tickets"] === undefined ? undefined : Number(values["max-tickets"]);

  const outcome = await run({
    root,
    backend: new MockBackend(),
    prompts: loadPromptSet(),
    worker: values.worker,
    ...(maxTickets === undefined || Number.isNaN(maxTickets) ? {} : { maxTickets }),
  });

  if (outcome.exitCode === 10 || outcome.exitCode === 2 || outcome.exitCode === 1) {
    process.stdout.write(`${JSON.stringify(outcome.summary, null, 2)}\n`);
  }
  return outcome.exitCode;
}
