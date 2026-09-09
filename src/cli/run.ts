import { parseArgs } from "node:util";
import { EXIT_ERROR, run } from "../kernel/run.js";
import { buildLiveBackend } from "../sessions/live.js";
import { MockBackend } from "../sessions/mock.js";
import { loadPromptSet } from "../sessions/prompts.js";
import { makeTtyEscalation } from "./escalate.js";
import type { SessionBackend } from "../sessions/backend.js";
import { noteRunPhase } from "../kernel/run-lock.js";
import { setInFlight } from "./exit-record.js";

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
/**
 * X-1 (PRDR-174): the live-backend builder is a seam.
 *
 * `run`'s live-by-default (C-14″) is correct, and it meant the only thing
 * keeping `tests/cli/run-backend.test.ts` from launching real billed sessions
 * was a fixture property: `makeRunRepo()` happens to seed zero tickets. Adding
 * one ticket to that shared fixture makes the identical `main([root])` call
 * reach `ClaudeCodeBackend.run` three times, with no `DETENT_NO_LIVE`
 * enforcement anywhere in the suite to stop it. `doctor` was given this seam by
 * PRDR-158/162 for exactly the same reason; `run` had none, so the same
 * structural hardening was impossible without a source change first.
 */
export interface RunMainDeps {
  readonly buildBackend?: (root: string) => SessionBackend;
}

export async function main(argv: readonly string[], mainDeps: RunMainDeps = {}): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      "max-tickets": { type: "string" },
      /**
       * C-14″ (PRDR-129): LIVE by default. This defaulted to "mock" while
       * `referee` defaulted to "claude" and `init` refused the fixture outright,
       * so the README's two-command golden path — test-locked to exactly
       * `detent init` and `detent run`, with no flag — executed a fake whose
       * result shape is indistinguishable from a real session.
       */
      backend: { type: "string", default: "claude" },
      worker: { type: "string", default: "w1" },
      /**
       * B-2″ (PRDR-145b): per-ticket worktrees are the DEFAULT, `--no-worktree`
       * the escape. `workDir` was the operator's own checkout unless a flag
       * said otherwise, which turned three behaviours that are correct for a
       * tree Detent owns into destructive ones: `resetDirtyTracked` ran
       * `git checkout HEAD --` on uncommitted work, `parkForeignUntracked`
       * relocated untracked files on every claim, and `finalizeDone`'s
       * `git add -A` staged whatever else was in the tree under the ticket's
       * name. One posture — Detent owns the working tree during a run — applied
       * where it was false.
       */
      worktree: { type: "boolean", default: true },
      "no-worktree": { type: "boolean", default: false },
    },
  });

  if (values.backend !== "mock" && values.backend !== "claude") {
    process.stderr.write(`unknown backend '${values.backend}' — pass mock (fixtures) or claude (live)\n`);
    return EXIT_ERROR;
  }

  const root = positionals[0] ?? process.cwd();
  const maxTickets = values["max-tickets"] === undefined ? undefined : Number(values["max-tickets"]);
  /**
   * PRDR-142: a bound that cannot be read is refused, not dropped.
   * `--max-tickets tenn` yielded `NaN`, the option was silently omitted below,
   * and the FULL pool ran against the full spend ceiling — having been asked
   * for a limit. `cli/init.ts` validates `--spend-cap-usd` and exits 1; the
   * same care simply was not applied here.
   */
  if (maxTickets !== undefined && (!Number.isInteger(maxTickets) || maxTickets <= 0)) {
    process.stderr.write("--max-tickets must be a positive whole number\n");
    return EXIT_ERROR;
  }
  const backend = values.backend === "mock" ? new MockBackend() : (mainDeps.buildBackend ?? buildLiveBackend)(root);
  /**
   * C-14″ (PRDR-179): the banner follows the BACKEND, not the flag.
   *
   * PRDR-174 added an injectable builder and left the banner keyed on
   * `values.backend`, so an injected fixture ran silently while the flag said
   * live — and the test asserting the journal reads "mock" with no banner
   * printed codified that divergence. C-14″ exists so a fixture run can never
   * be mistaken for a real one; the name the journal records is the same name
   * the operator is warned about.
   */
  const isFixture = backend.name === "mock";
  /**
   * C-14″: a fixture run writes real ledger rows and real journal events against
   * real ticket state, so it must never be mistaken for a real one. Said once,
   * before anything is spent.
   */
  if (isFixture) {
    process.stderr.write(
      "running against the FIXTURE backend (--backend mock): no model session will run, and the ledger and journal " +
        "below are fabricated. Pass --backend claude for a real run.\n",
    );
  }

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
    worktree: values.worktree === true && values["no-worktree"] !== true,
    announce: (message) => process.stdout.write(`${message}\n`),
    /* PRDR-190: the recorder lives here; the kernel only declares the seam. */
    phase: (text) => {
      setInFlight(text);
      noteRunPhase(root, text);
    },
    ...(interactive ? { escalate: makeTtyEscalation(process.env["USER"] ?? "operator") } : {}),
    ...(maxTickets === undefined ? {} : { maxTickets }),
  });

  if (outcome.exitCode === 10 || outcome.exitCode === 2 || outcome.exitCode === 1) {
    process.stdout.write(`${JSON.stringify(outcome.summary, null, 2)}\n`);
  }
  return outcome.exitCode;
}
