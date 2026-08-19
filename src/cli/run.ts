import { parseArgs } from "node:util";
import { EXIT_ERROR, run } from "../kernel/run.js";
import { buildLiveBackend } from "../sessions/live.js";
import { MockBackend } from "../sessions/mock.js";
import { loadPromptSet } from "../sessions/prompts.js";
import { makeTtyEscalation } from "./escalate.js";

/**
 * T-041/T-140 — `detent run`, the second porcelain verb (C-9…C-11, D-3).
 *
 * Thin by design: parse arguments (R-6: `node:util.parseArgs`), load the
 * vendored prompts, hand everything to the referee's headless driver, and map
 * the outcome onto C-11's public exit codes. On exit 10 the machine-readable
 * summary goes to stdout — C-10's non-TTY contract.
 *
 * `--backend mock` stays the fixture path; `--backend claude` (the default's
 * counterpart for real work) builds the live backend the N-7 self-build uses.
 */
export async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      "max-tickets": { type: "string" },
      backend: { type: "string", default: "mock" },
      worker: { type: "string", default: "w1" },
      /* B-2: per-ticket worktrees, merged --no-ff into the run branch on DONE. */
      worktree: { type: "boolean", default: false },
    },
  });

  if (values.backend !== "mock" && values.backend !== "claude") {
    process.stderr.write(`unknown backend '${values.backend}' — pass mock (fixtures) or claude (live)\n`);
    return EXIT_ERROR;
  }

  const root = positionals[0] ?? process.cwd();
  const maxTickets = values["max-tickets"] === undefined ? undefined : Number(values["max-tickets"]);
  const backend = values.backend === "mock" ? new MockBackend() : buildLiveBackend(root);

  /**
   * C-10: escalations resolve inside `run` on a TTY; non-TTY exits 10 with
   * the machine-readable summary instead.
   */
  const interactive = process.stdout.isTTY === true && process.stdin.isTTY === true;
  const outcome = await run({
    root,
    backend,
    prompts: loadPromptSet(),
    worker: values.worker,
    worktree: values.worktree,
    announce: (message) => process.stdout.write(`${message}\n`),
    ...(interactive ? { escalate: makeTtyEscalation(process.env["USER"] ?? "operator") } : {}),
    ...(maxTickets === undefined || Number.isNaN(maxTickets) ? {} : { maxTickets }),
  });

  if (outcome.exitCode === 10 || outcome.exitCode === 2 || outcome.exitCode === 1) {
    process.stdout.write(`${JSON.stringify(outcome.summary, null, 2)}\n`);
  }
  return outcome.exitCode;
}
