import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { parseArtifact } from "../schemas/common.js";
import { approvalSchema } from "../schemas/records.js";
import type { Ticket } from "../schemas/ticket.js";
import type { PromptSet, SessionBackend } from "../sessions/backend.js";
import { readBindings } from "../adapter/drift.js";
import { acquireRunLock, runLockRefusal } from "./run-lock.js";
import { ensureRunBranch, installTrailerHook } from "./git.js";
import { RunJournal } from "./journal.js";
import { Driver } from "./driver.js";
import { RefereeCore, type PendingEntry } from "./referee.js";
import { loadConfig, type LoadedConfig } from "./worstcase.js";

/**
 * T-106 — the HEADLESS DRIVER (C-9, C-10, C-11, D-26/D-27).
 *
 * v2's run loop, re-expressed as a driver over the R-1 tool registry: this
 * module SEQUENCES — which ticket, which stage, when to stop — and holds no
 * legality of its own. Every move goes through `callTool`; the referee
 * validates, meters, journals, and admits. The public surface (`run`,
 * `runWithConfig`, the exit codes, the escalation types) is v2's, unchanged —
 * the entire v2 suite runs through this driver, which is MP0's exit claim.
 *
 * Mechanically load-bearing: this file imports neither the machine nor the
 * event constructors. The only event names it ever sees are strings in
 * transition RESULTS. A driver that wanted to cheat has nothing to cheat
 * with — that is D-27, enforced by the import graph.
 */

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_NOT_READY = 2;
export const EXIT_HUMAN_GATED = 10;

export interface RunOptions {
  readonly root: string;
  readonly backend: SessionBackend;
  readonly worker?: string;
  readonly maxTickets?: number;
  readonly runId?: string;
  /** B-2: per-ticket worktrees, merged `--no-ff` into the run branch on DONE. */
  readonly worktree?: boolean;
  /** Injectable wall clock (ms) for the X-1 `ticket_wall_clock_ms` fixtures. */
  readonly now?: () => number;
  /**
   * The vendored, hash-verified prompt set. Required, not defaulted: loading
   * lives in the sessions layer (`loadPromptSet`), and ARCH-1 forbids the
   * referee reaching past the backend seam to fetch it.
   */
  readonly prompts: PromptSet;
  /**
   * C-10: escalations are handled INSIDE `run` on a TTY. When present, a
   * NEEDS_HUMAN ticket is offered here — approve / requeue-with-guidance /
   * skip / quit — and the loop continues in-process. Absent (non-TTY), the
   * ticket stays pending and the run exits 10 with the JSON summary.
   */
  readonly escalate?: (input: EscalationInput) => Promise<EscalationAction>;
  /** C-13: resume announcements and similar user-facing notices. */
  readonly announce?: (message: string) => void;
  /** PRDR-112: injectable wait for the outage backoff; real time by default. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface EscalationInput {
  readonly ticket: Ticket;
  readonly reason: string;
  readonly summary: string;
}

export type EscalationAction =
  | { readonly kind: "approve"; readonly by: string }
  | { readonly kind: "requeue"; readonly by: string; readonly guidance: string }
  | { readonly kind: "skip"; readonly by: string }
  | { readonly kind: "quit" };


export interface RunOutcome {
  readonly exitCode: 0 | 1 | 2 | 10;
  /** C-10's non-TTY machine-readable summary; schema-stable. */
  readonly summary: {
    readonly schema_version: 1;
    readonly exit: number;
    readonly pending: readonly PendingEntry[];
    readonly reason?: string;
  };
}

/** C-9/C-7: `run` executes only an approved plan; R-9: config loads or nothing runs. */
export async function run(opts: RunOptions): Promise<RunOutcome> {
  const configPath = path.join(stateDir(opts.root), "config.json");
  if (!existsSync(configPath)) {
    return notReady(`no config at ${configPath} — run \`detent init\` first`);
  }
  let loaded: LoadedConfig;
  try {
    loaded = loadConfig(JSON.parse(readFileSync(configPath, "utf8")));
  } catch (err) {
    return notReady(`config rejected: ${(err as Error).message}`);
  }
  return await runWithConfig(opts, loaded);
}

/**
 * Exposed separately for the X-1 backstop fixtures: the net-sessions ceiling
 * is unreachable under any config `loadConfig` accepts, so proving the
 * enforcement fires requires budgets the load path would refuse.
 */
export async function runWithConfig(opts: RunOptions, loaded: LoadedConfig): Promise<RunOutcome> {
  const { root } = opts;
  const approval = readApproval(root);
  if (approval !== "ok") return notReady(approval);
  /**
   * V-1″ (PRDR-135): a run with no bound test gate verifies nothing. Checked
   * beside the config and approval preconditions, so it refuses before
   * spending rather than at the first gate — where it used to mint a GREEN.
   */
  if (!readBindings(root).bindings.some((b) => b.slot === "test")) {
    return notReady(
      "no `test` gate is bound in .detent/bindings.json — a run would verify nothing. " +
        "Run `detent init` to bind the project's verification commands (V-1).",
    );
  }


  /**
   * X-1‴ (PRDR-147): one run per root. Taken before the journal, so a refused
   * second run touches nothing; released on every exit path below.
   */
  const lock = acquireRunLock(root);
  if (!lock.ok) return notReady(runLockRefusal(lock.heldBy));
  if (lock.brokeStale !== null) {
    opts.announce?.(`broke a stale run lock left by pid ${lock.brokeStale.pid} on this host (X-1‴)`);
  }

  let journal: RunJournal;
  try {
    journal = RunJournal.open(root);
  } catch (err) {
    lock.release();
    return notReady((err as Error).message);
  }

  try {
    const runBranch = ensureRunBranch(root, opts.runId ?? `${process.pid}-${Date.now().toString(36)}`);
    const preservedHook = installTrailerHook(root);
    if (preservedHook !== null) {
      /* B-1′ (PRDR-146): a hook we did not write is kept, and the operator is told where. */
      opts.announce?.(`your existing prepare-commit-msg hook was preserved at ${preservedHook} (B-1′)`);
    }
    /**
     * PRDR-092: the run records the configuration it actually loaded. A
     * setting that stops applying between runs — the field report this ticket
     * exists for — is then a diff between two journal lines rather than
     * silence. The config is read ONCE per run, so this is what governed
     * every session below, whatever the file says afterwards.
     */
    journal.appendTicketEvent("run", {
      event: "config",
      at: new Date().toISOString(),
      run_branch: runBranch.branch,
      /**
       * C-14″ (PRDR-129): which backend ran. `SessionBackend.name` existed with
       * zero readers, so a journal could not answer "was this real?" even after
       * the fact — a fixture run and a live run left identical records.
       */
      backend: opts.backend.name,
      budgets: loaded.config.budgets,
      model_routing: loaded.config.model_routing,
      protected: loaded.config.protected,
      risk: loaded.config.risk,
    });

    const core = new RefereeCore(
      {
        root,
        backend: opts.backend,
        prompts: opts.prompts,
        ...(opts.worker !== undefined ? { worker: opts.worker } : {}),
        ...(opts.now !== undefined ? { now: opts.now } : {}),
        ...(opts.worktree !== undefined ? { worktree: opts.worktree } : {}),
        /** PRDR-104: the headless loop has no model session to govern — no hook files. */
        hookFiles: false,
      },
      loaded,
      journal,
      runBranch,
    );
    const driver = new Driver(opts, loaded, core);
    return await driver.loop();
  } catch (err) {
    return {
      exitCode: EXIT_ERROR,
      summary: { schema_version: 1, exit: EXIT_ERROR, pending: [], reason: (err as Error).message },
    };
  } finally {
    journal.close();
    /** X-1‴: released on every exit path, including a throw. */
    lock.release();
  }
}

function notReady(reason: string): RunOutcome {
  return { exitCode: EXIT_NOT_READY, summary: { schema_version: 1, exit: EXIT_NOT_READY, pending: [], reason } };
}

function readApproval(root: string): string {
  const file = path.join(stateDir(root), "plan", "approval.json");
  if (!existsSync(file)) {
    return "no approved plan — `run` executes only an approved plan (C-9); approve it via `init` (C-7)";
  }
  const parsed = parseArtifact(approvalSchema, JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.ok) return `plan approval is invalid — re-approve (C-7)`;
  return "ok";
}
