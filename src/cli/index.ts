import { main as initMain } from "./init.js";
import { main as refereeMain } from "./referee.js";
import { main as runMain } from "./run.js";
import { main as statusMain } from "./status.js";
import { main as reportMain } from "./report.js";
import { main as doctorMain } from "./doctor.js";
import { approveMain, requeueMain, unclaimMain } from "./plumbing.js";

/**
 * The `detent` entry point (C-3, C-14).
 *
 * Two porcelain verbs — `init` and `run` — and the documented plumbing
 * (`status`, `report`, `doctor`, `approve`, `requeue`, `unclaim`, `verify sync`). `init`
 * is the M3 pipeline (T-060…); until then it reports that it is not yet built,
 * rather than pretending. Dispatch only: each verb's logic lives in its own
 * module, so this file is a table, not a place decisions are made.
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
  init: initMain,
  referee: refereeMain,
};

const USAGE = `detent <command>

  init [root]          prepare a project: discover, analyze, plan, approve
  run [root]           execute the approved plan
  status [root]        show ticket status (C-13 vocabulary)
  report [root]        emit the §14 metrics
  doctor [root]        check pins, config, and one live smoke session
  approve <id>         re-enter APPROVED for kernel re-verification (plumbing)
  requeue <id>         open a fresh attempt generation (plumbing)
  unclaim <id>|--stale release a dead owner claim lock (plumbing)
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
  return await handler(rest);
}

/** Executed as the CLI entry point (distinguished from an import). */
const invoked = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (invoked) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(`${(err as Error).message}\n`);
      process.exit(1);
    });
}
