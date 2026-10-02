import { currentInFlight, installExitRecorder } from "./exit-record.js";
import { main as initMain } from "./init.js";
import { main as refereeMain } from "./referee.js";
import { main as verifyMain } from "./verify.js";
import { main as runMain } from "./run.js";
import { main as statusMain } from "./status.js";
import { main as reportMain } from "./report.js";
import { main as doctorMain } from "./doctor.js";
import { amendMain, approveMain, requeueMain, unclaimMain } from "./plumbing.js";

/**
 * The `detent` entry point (C-3, C-14).
 *
 * Two porcelain verbs — `init` and `run` — and the documented plumbing
 * (`status`, `report`, `doctor`, `approve`, `requeue`, `unclaim`, `amend`,
 * `verify sync`, `verify lifecycle`). `init` is the M3 pipeline (T-060…);
 * until then it reports that it is not yet built, rather than pretending.
 * Dispatch only: each verb's logic lives in its own module, so this file is a
 * table, not a place decisions are made.
 */

type Verb = (argv: readonly string[]) => number | Promise<number>;

const VERBS: Record<string, Verb> = {
  run: runMain,
  status: statusMain,
  report: reportMain,
  doctor: doctorMain,
  approve: approveMain,
  requeue: requeueMain,
  unclaim: unclaimMain,
  /** X-4⁸ (PRDR-286): an amendment a session filed against the pack, decided off a run. */
  amend: amendMain,
  init: initMain,
  referee: refereeMain,
  /** V-3 (PRDR-141): the sanctioned drift recovery, which `drift.ts` has always named and the table never routed. */
  verify: verifyMain,
};

const USAGE = `detent <command>

  init [root]          prepare a project: discover, audit, decide, write, validate, plan, approve
  run [root]           execute the approved plan
  status [root]        show ticket status (C-13 vocabulary)
  report [root]        emit the §14 metrics
  doctor [root] [--smoke]  check pins and config; --smoke also runs one live session
  approve <id>         re-enter APPROVED for kernel re-verification (plumbing)
  requeue <id>         open a fresh attempt generation (plumbing)
  unclaim <id>|--stale release a dead owner claim lock (plumbing)
  amend <AM-id>        show an amendment to the pack; --approve, --edit <file> or --reject <reason> decides it (plumbing, X-4⁸)
  verify sync [root]   re-baseline drifted verification bindings (plumbing, V-3)
  verify lifecycle [root]  show the project's lifecycle scripts; --approve <script> lets a run execute one (plumbing, V-1⁷)
  referee --root <p>   serve the R-1 tool set over MCP stdio (plumbing, MP1's plugin entry)
`;

export async function main(argv: readonly string[]): Promise<number> {
  const [verb, ...rest] = argv;
  if (verb === undefined || verb === "--help" || verb === "-h") {
    process.stdout.write(USAGE);
    return verb === undefined ? 2 : 0;
  }
  const handler = VERBS[verb];
  if (handler === undefined) {
    process.stderr.write(`unknown command: ${verb}\n\n${USAGE}`);
    return 2;
  }
  /* PRDR-307: every verb's options are strict, so `--help` after one was refused as unknown. */
  if (rest.some((arg) => arg === "--help" || arg === "-h")) {
    process.stdout.write(USAGE);
    return 0;
  }
  return await handler(rest);
}

/** Executed as the CLI entry point (distinguished from an import). */
const invoked = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (invoked) {
  /**
   * PRDR-190: every exit path says so.
   *
   * The `.catch` branch always spoke. The `.then` branch was silent on every
   * code it was handed, so a normal return and an abnormal one were
   * indistinguishable in the log — and a signal reached neither, which is how
   * six deaths across three days left no record at all. A line that always
   * appears at the end is what makes its absence mean something.
   */
  const recordExit = installExitRecorder({
    write: (text) => process.stderr.write(text),
    on: (signal, handler) => {
      process.on(signal as NodeJS.Signals, handler);
    },
    exit: (code) => process.exit(code),
    phase: currentInFlight,
    label: `detent${process.argv[2] === undefined || process.argv[2].startsWith("-") ? "" : ` ${process.argv[2]}`}`,
  });
  main(process.argv.slice(2))
    .then((code) => {
      recordExit(code);
      process.exit(code);
    })
    .catch((err: unknown) => {
      process.stderr.write(`${(err as Error).message}\n`);
      recordExit(1);
      process.exit(1);
    });
}
