import { parseArgs } from "node:util";
import { buildPipeline, pendingPhases } from "../init/pipeline.js";
import { checkRoot, runInit } from "../init/machine.js";
import { setInFlight } from "./exit-record.js";
import { loadConfig } from "../kernel/worstcase.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { CEILINGS } from "../schemas/budgets.js";
import type { Budgets } from "../schemas/budgets.js";
import { ClaudeCodeBackend } from "../sessions/sdk.js";
import type { SessionBackend } from "../sessions/backend.js";
import { loadPromptSet } from "../sessions/prompts.js";
import { ensureConfig, decideSymbols, type SymbolsDecision } from "../init/config.js";
import { LIVE_AUTH_HINT, hasLiveBackendAuth } from "../sessions/live.js";
import { makeFlagApproval, makeTtyApproval, type ApprovalFlag } from "./approve.js";
import { acquireRunLock, lockPhaseSuffix, noteRunPhase, runLockRefusal } from "../kernel/run-lock.js";
import { STRUCTURAL_PROTECTED } from "../schemas/common.js";

/**
 * T-060 — `detent init`, the first porcelain verb (C-1, C-5, C-8).
 *
 * Thin: check the root (C-1), assemble the pipeline, run it, render whatever
 * interrupt came back. The five C-5 interrupts are the only things this verb
 * can ask a human, and it asks by printing and exiting 2 — a resumed `init`
 * picks up at the same phase from its checkpoints (C-8).
 */

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_NOT_READY = 2;

export interface InitMainDeps {
  readonly buildBackend?: (root: string) => SessionBackend;
}

export async function main(argv: readonly string[], mainDeps: InitMainDeps = {}): Promise<number> {
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
      /** S-3⁗ (PRDR-208): the symbol-intelligence decision, as a flag. */
      symbols: { type: "boolean", default: false },
      "no-symbols": { type: "boolean", default: false },
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
  if (values.symbols && values["no-symbols"]) {
    process.stderr.write("pass at most one of --symbols / --no-symbols\n");
    return EXIT_ERROR;
  }
  const symbolsDecision: SymbolsDecision | undefined = values.symbols ? "on" : values["no-symbols"] ? "off" : undefined;

  /**
   * C-1: root-only, with the root path hinted — and no `.detent/` created.
   *
   * PRDR-179: that second half is why the lock is taken BELOW this block and
   * not above it. `acquireRunLock` mkdirs `state/` and `release()` removes only
   * the lock file, so a refusal here would leave a `.detent/` behind on a
   * directory Detent had declined to work on. The existing test for this rule
   * exercises the no-repo path, which returns before the lock either way — a
   * guarantee kept true by a coincidental fixture until it was asserted.
   */
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
   * X-1‴ (PRDR-168): one pipeline per root, on the terms `run` already uses.
   *
   * `acquireRunLock` was built for PRDR-147 — "two runs on one root each
   * enforce the full ceiling and jointly spend past it" — and wired to `run`
   * alone. `init` is the FIRST command an operator runs and the one whose
   * sessions cannot use the fixture backend, so its sessions are the first
   * genuinely billed ones in a project's life. Two of them raced a shared root
   * to $16 against a $10 ceiling, and neither one ever refused a launch.
   *
   * Taken ABOVE the live-auth probe deliberately. `hasLiveBackendAuth()` spawns
   * the `claude` CLI with a 10s timeout, so a second invocation should refuse
   * without paying for that — and a test of this refusal must not depend on
   * whether the machine running it happens to be logged in, which is the trap
   * PRDR-158 was filed for. Everything above is parsing and repo validation,
   * and none of it spends or writes.
   */
  /**
   * PRDR-190: the run's phase reaches the entry point's exit recorder through
   * `setInFlight`, and the disk through `noteRunPhase` — the first covers a
   * catchable signal, the second a SIGKILL.
   */
  const lock = acquireRunLock(root);
  if (!lock.ok) {
    process.stderr.write(`${runLockRefusal(lock.heldBy)}\n`);
    return EXIT_NOT_READY;
  }
  if (lock.brokeStale !== null) {
    process.stdout.write(
      `broke a stale run lock left by pid ${lock.brokeStale.pid} on this host${lockPhaseSuffix(lock.brokeStale)} (X-1‴)\n`,
    );
  }

  try {
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
    if (ensured === "written-default") {
      process.stdout.write(
        `run spend ceiling defaulted to $${CEILINGS.run_spend_usd.default} (X-1′) — ` +
          "pass --spend-cap-usd on a first init, or edit .detent/config.json, to change it\n",
      );
    }
    if (ensured !== "exists") {
      process.stdout.write(
        "model routing defaulted (PRDR-114, S-5″): planner, review, diagnose, informed_fix → claude-opus-5; " +
          "implement, blind_fix, review_fix, research → claude-sonnet-5. A routed model this runtime cannot serve falls back " +
          "to the runtime default, noted per session. Edit model_routing in .detent/config.json to change it.\n",
      );
      process.stdout.write(
        "effort routing defaulted (PRDR-263): planner → max; review, diagnose, informed_fix, implement, blind_fix, " +
          "review_fix, research → xhigh. A level the routed model cannot serve is downgraded silently by the SDK and " +
          "noted per session. Edit effort_routing in .detent/config.json to change it.\n",
      );
    }
    if (ensured === "exists" && cap !== undefined) {
      process.stdout.write("config exists — --spend-cap-usd ignored; edit .detent/config.json to change the ceiling\n");
    }

    const interactive = process.stdout.isTTY === true && process.stdin.isTTY === true;
    let config: ReturnType<typeof configFor>;
    try {
      config = configFor(root);
    } catch (err) {
      process.stderr.write(`${(err as Error).message}\nFix it (or delete it to start over) — init will not plan against a config it cannot read (R-9′).\n`);
      return EXIT_ERROR;
    }
    /**
     * S-3⁗ (PRDR-208): a decision, not a ceiling — so unlike the cap it is
     * honoured on an existing config too. On is refused, with the install
     * named, when the tool cannot run; nothing is written in that case. After
     * the config has loaded (audit: a config init cannot read gets R-9′'s
     * refusal above, not a thrown stack from here), and the config is reloaded
     * so the pipeline plans with the decision, not the tri-state it replaced.
     */
    if (symbolsDecision !== undefined) {
      const decided = decideSymbols(root, symbolsDecision);
      if (!decided.ok) {
        process.stderr.write(`${decided.message}\n`);
        return EXIT_NOT_READY;
      }
      process.stdout.write(
        decided.enabled
          ? `symbol intelligence enabled — \`${decided.command}\` is ready; sessions get its read tools (S-3′)\n`
          : "symbol intelligence declined — recorded in .detent/config.json, never mentioned again (S-3″)\n",
      );
      config = configFor(root);
    }
    const backend = (mainDeps.buildBackend ?? defaultBackend)(root);
    /**
     * S-5 (PRDR-251): the pinned CLI version is checked on THIS path too.
     *
     * PRDR-181 wrote "the pinned CLI version is CHECKED, on the path that
     * runs" and wired the check into `kernel/run.ts` alone. `init` is the
     * expensive path — it cannot use the fixture backend at all, so its
     * sessions are the first genuinely billed ones in a project's life — and it
     * planned against whatever `claude` happened to be on PATH. Before the
     * pipeline, so a refusal spends nothing.
     *
     * `config` is non-null here: `ensureConfig` above wrote one if it was
     * missing. The guard answers the type, not a policy — there is no path on
     * which init plans without a config, and a skipped check is not one of the
     * outcomes this refusal has.
     */
    if (config !== null) {
      try {
        await backend.checkVersion(config.pinned.claude_code);
      } catch (err) {
        process.stderr.write(`${(err as Error).message}\n`);
        return EXIT_NOT_READY;
      }
    }
    const handlers = buildPipeline({
      root,
      backend,
      prompts: loadPromptSet(),
      budgets: budgetsFor(config),
      modelRouting: config?.model_routing ?? {},
      /* PRDR-197: routed effort reaches init's sessions too — the loop read it from config directly and this path did not. */
      effortRouting: config?.effort_routing ?? {},
      planBaseline: config?.plan_baseline ?? "production",
      ...(config?.slice_size === undefined ? {} : { sliceSize: config.slice_size }),
      ...(config?.symbols === undefined ? {} : { symbols: config.symbols }),
      planDocs: config?.plan_docs ?? [],
      note: (text) => process.stdout.write(`  ${text}\n`),
      /**
       * PRDR-194: the marker is fed from PROGRESS, not from `note`.
       *
       * PRDR-190 wired it to `note` on the reasoning that "what the operator is
       * last told is by definition what was in flight". It is not: `note` also
       * carries verdicts, reuse status and warnings, and a live SIGTERM
       * recorded X-1⁵'s spend announcement as the run's activity. `setInFlight`
       * covers a catchable signal; `noteRunPhase` puts it on the lock, which is
       * what survives a SIGKILL.
       */
      progress: (text) => {
        setInFlight(text);
        noteRunPhase(root, text);
      },
      print: (text) => process.stdout.write(`${text}\n`),
      /*
       * C-7: a relayed flag answer wins (T-131 — the plugin path, where the
       * model presented and the human answered in chat); otherwise approval is
       * offered inline on a TTY and deferred to `run` everywhere else — where
       * PRDR-255 built the exit that clause had been naming since T-068. The
       * name is sourced the same way at both exits, so one plan records the
       * same `approved_by` whichever one takes the answer.
       */
      ...(approvalFlag !== undefined
        ? { askApproval: makeFlagApproval(approvalFlag, values.by ?? process.env["USER"] ?? "operator") }
        : interactive
          ? { askApproval: makeTtyApproval(process.env["USER"] ?? "operator") }
          : {}),
    });

    let result;
    try {
      result = await runInit(root, handlers, {
        replan: values.replan,
        /* PRDR-194: phase boundaries, so a run killed between slices still names where it was. */
        progress: (text) => {
          setInFlight(text);
          noteRunPhase(root, text);
        },
      });
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
  } finally {
    /* Seven return paths above; one release. */
    lock.release();
  }
}

/**
 * X-1 (PRDR-251): the live-backend builder is a seam, on PRDR-174's terms.
 *
 * `run` and `doctor` were each given an injectable builder so a test could
 * reach their preconditions without launching real billed sessions. `init`,
 * the one verb with no fixture path at all, constructed its backend inline —
 * so the S-5 refusal below could not be tested without a source change first,
 * which is exactly the argument PRDR-174 made for the other two.
 */
function defaultBackend(root: string): SessionBackend {
  return new ClaudeCodeBackend({
    /**
     * PRDR-067 (amended by T-140's sixth firing): the D-21 guard applies to
     * every path'd tool — READS included — so a write-area-only surface
     * blinded the analyst to the very documents it must analyze; it could
     * only echo stale `.detent/state/` leftovers. Reads-open,
     * writes-guarded: the surface admits the repo, the SEC-3 floor protects
     * what sessions may never touch, and write-narrowing is the allowlist's
     * job — an init session carries exactly one write rule, its artifact.
     */
    policy: {
      surface: ["**"],
      /**
       * SEC-3 (PRDR-178): the STRUCTURAL floor, not three of its fourteen.
       *
       * This listed the plan, config and bindings and omitted `.git/**`,
       * `.git`, `node_modules/**`, `.detent/ledger.jsonl`,
       * `.detent/state/**` and the rest — while the surface here is `**`.
       * Inert only because the per-session spec policy wins at
       * `sdk.ts`, which is exactly the reasoning PRDR-172 used to fix the
       * structurally identical site in `referee-context.ts`, and then did
       * not apply here. Writing into `.git` is executing: `.gitattributes`
       * plus a clean filter runs a command on `git add`.
       */
      protectedGlobs: [...STRUCTURAL_PROTECTED],
      workRoot: root,
    },
  });
}

/**
 * R-9′ (PRDR-118): the config loads or nothing runs. Each of these readers
 * used to catch its own parse failure and return a default, so a merge
 * conflict in `.detent/config.json` silently widened planning scope to the
 * whole repository, reset the spend ceiling to the default, and dropped the
 * model routing — at full model cost, against a scope nobody asked for, with
 * nothing printed. `run` already refuses a config it cannot read; `init`, which
 * is the expensive one, did not.
 */
function configFor(root: string): ReturnType<typeof loadConfig>["config"] | null {
  const file = path.join(stateDir(root), "config.json");
  if (!existsSync(file)) return null;
  try {
    return loadConfig(JSON.parse(readFileSync(file, "utf8"))).config;
  } catch (err) {
    throw new Error(`.detent/config.json cannot be read: ${(err as Error).message}`);
  }
}

/** Config budgets when one exists; X-1's defaults when init is bootstrapping. */
function budgetsFor(config: ReturnType<typeof configFor>): Budgets {
  /* X-1′: every ceiling has a default now, including the spend cap. */
  return config?.budgets ?? (Object.fromEntries(Object.entries(CEILINGS).map(([key, spec]) => [key, spec.default])) as Budgets);
}
/**
 * PRDR-086: the increment's planning scope. Read straight from config so a
 * replan plans the slice the project currently declares, not everything the
 * repository has ever specified.
 */


/** PRDR-114: the routing init sessions run on — from the config `init` itself just wrote. */

/** C-2‴ (PRDR-117): the production baseline the plan is held to — "none" only when the config says so. */
