import { parseArgs } from "node:util";
import { buildPipeline, pendingPhases } from "../init/pipeline.js";
import { checkRoot, runInit } from "../init/machine.js";
import { loadConfig } from "../kernel/worstcase.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { CEILINGS } from "../schemas/budgets.js";
import type { Budgets } from "../schemas/budgets.js";
import { ClaudeCodeBackend } from "../sessions/sdk.js";
import { loadPromptSet } from "../sessions/prompts.js";
import { ensureConfig } from "../init/config.js";
import { LIVE_AUTH_HINT, hasLiveBackendAuth } from "../sessions/live.js";
import { makeFlagApproval, makeTtyApproval, type ApprovalFlag } from "./approve.js";

/**
 * T-060 — `detent init`, the first porcelain verb (C-1, C-5, C-8).
 *
 * Thin: check the root (C-1), assemble the pipeline, run it, render whatever
 * interrupt came back. The five C-5 interrupts are the only things this verb
 * can ask a human, and it asks by printing and exiting 2 — a resumed `init`
 * picks up at the same phase from its checkpoints (C-8).
 */

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_NOT_READY = 2;

export async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      replan: { type: "boolean", default: false },
      approve: { type: "boolean", default: false },
      decline: { type: "boolean", default: false },
      defer: { type: "boolean", default: false },
      by: { type: "string" },
      "spend-cap-usd": { type: "string" },
    },
  });
  const root = positionals[0] ?? process.cwd();

  /** T-131: at most one relayed answer to the AWAIT_APPROVAL decision. */
  const flags = (["approve", "decline", "defer"] as const).filter((f) => values[f] === true);
  if (flags.length > 1) {
    process.stderr.write("pass at most one of --approve / --decline / --defer\n");
    return EXIT_ERROR;
  }
  const approvalFlag: ApprovalFlag | undefined = flags[0];

  /** C-1: root-only, with the root path hinted — and no `.detent/` created. */
  const where = checkRoot(root);
  if (where.kind === "subdirectory") {
    process.stderr.write(`\`detent init\` runs only at the git root — run it from ${where.root}\n`);
    return EXIT_NOT_READY;
  }
  if (where.kind === "no-repo") {
    /* C-1/C-6: a non-repo directory with planning docs may be offered `git */
    /*
     * init` under setup-consent rules. That offer is T-065's; until it lands,
     * saying so is more useful than a bare refusal.
     */
    process.stderr.write(
      "not a git repository — `detent init` needs one. Consented `git init` lands with the setup-consent engine (T-065); run `git init` yourself meanwhile.\n",
    );
    return EXIT_NOT_READY;
  }

  /**
   * `init` cannot run against the mock: ANALYZE and PLAN are session outputs,
   * and a mock that writes nothing produces no analysis. Unlike `run`, which
   * has a genuine fixture path, init needs a live backend — so say so plainly
   * rather than failing three phases later with a confusing artifact error.
   * T-140 broadened the transports: a subscription login or an OAuth token is
   * as live as an API key.
   */
  if (!hasLiveBackendAuth()) {
    process.stderr.write(
      "`detent init` needs a live backend: ANALYZE and PLAN are session outputs.\n" +
        `To fix, ${LIVE_AUTH_HINT}\n(\`detent run\` has a mock path for fixtures; init does not.)\n`,
    );
    return EXIT_NOT_READY;
  }

  /**
   * T-140/X-1: a first init must write config, and `run_spend_usd` has no
   * defensible universal default — the ceiling is the user's own number.
   */
  const capRaw = values["spend-cap-usd"];
  const cap = capRaw === undefined ? undefined : Number(capRaw);
  if (cap !== undefined && (!Number.isFinite(cap) || cap <= 0)) {
    process.stderr.write("--spend-cap-usd must be a positive number\n");
    return EXIT_ERROR;
  }
  const ensured = ensureConfig(root, cap);
  if (ensured === "missing-cap") {
    process.stderr.write(
      "first `detent init` needs `--spend-cap-usd <usd>`: X-1 declines a universal spend default — the run ceiling is yours to set.\n",
    );
    return EXIT_NOT_READY;
  }
  if (ensured === "exists" && cap !== undefined) {
    process.stdout.write("config exists — --spend-cap-usd ignored; edit .detent/config.json to change the ceiling\n");
  }

  const interactive = process.stdout.isTTY === true && process.stdin.isTTY === true;
  const handlers = buildPipeline({
    root,
    backend: new ClaudeCodeBackend({
      /**
       * PRDR-067: init sessions write analysis, plan drafts, and research
       * briefs — `.detent/state/**` and `.detent/research/**` — and nothing
       * else; config, tickets, and approval stay kernel-written. The old
       * policy protected `.detent/**` wholesale, forbidding the very artifact
       * the pipeline commands the session to write.
       */
      policy: { surface: [".detent/state/**", ".detent/research/**"], protectedGlobs: [], workRoot: root },
    }),
    prompts: loadPromptSet(),
    budgets: budgetsFor(root),
    note: (text) => process.stdout.write(`  ${text}\n`),
    print: (text) => process.stdout.write(`${text}\n`),
    /*
     * C-7: a relayed flag answer wins (T-131 — the plugin path, where the
     * model presented and the human answered in chat); otherwise approval is
     * offered inline on a TTY and deferred to `run` everywhere else.
     */
    ...(approvalFlag !== undefined
      ? { askApproval: makeFlagApproval(approvalFlag, values.by ?? process.env["USER"] ?? "operator") }
      : interactive
        ? { askApproval: makeTtyApproval(process.env["USER"] ?? "operator") }
        : {}),
  });

  let result;
  try {
    result = await runInit(root, handlers, { replan: values.replan });
  } catch (err) {
    /*
     * A phase that could not complete is an error (C-11's `1`), not an
     * interrupt — there is nothing for the user to answer.
     */
    process.stderr.write(`init failed: ${(err as Error).message}\n`);
    return EXIT_ERROR;
  }

  for (const message of result.messages) process.stdout.write(`${message}\n`);
  if (result.reused.length > 0) process.stdout.write(`reused: ${result.reused.join(", ")}\n`);
  if (result.executed.length > 0) process.stdout.write(`ran: ${result.executed.join(", ")}\n`);

  if (result.interrupt !== undefined) {
    process.stdout.write(`\n[${result.interrupt.interrupt}]\n${result.interrupt.message}\n`);
    return EXIT_NOT_READY;
  }

  /** Honest about the pipeline's own gaps rather than claiming READY. */
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
