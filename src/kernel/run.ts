import type { Ecosystem } from "../adapter/install.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { parseArtifact } from "../schemas/common.js";
import { approvalSchema } from "../schemas/records.js";
import type { Ticket } from "../schemas/ticket.js";
import type { PromptSet, SessionBackend } from "../sessions/backend.js";
import { readBindings } from "../adapter/drift.js";
import { acquireRunLock, lockPhaseSuffix, runLockRefusal } from "./run-lock.js";
import { approvalState } from "../init/machine.js";
import { NON_TICKET_FILES } from "./tickets/readers.js";
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
  /** V-1⁗ (PRDR-211): test seam for the ecosystems the referee installs for; production uses the table. */
  readonly ecosystems?: readonly Ecosystem[];
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
  /**
   * PRDR-190 (audit finding 2): what the run is doing, for whatever ends it.
   *
   * Declared here and supplied by `cli/run.ts`, because the recorder lives in
   * `src/cli/**` and ARCH-1 forbids the kernel importing upward. Without it the
   * phase marker existed on `init` alone: a signal during `detent run` recorded
   * no phase and a lock left by a killed run named none — the same
   * one-driver-only shape ARCH-2 exists to prevent, and which PRDR-140,
   * PRDR-181 and PRDR-185 each found separately.
   */
  readonly phase?: (text: string) => void;
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
   * C-9′ (PRDR-139): the approval must be OF THIS PLAN. `run` parsed the file
   * and never compared it, so tickets edited after approval executed
   * unreviewed. Safe to check at run start only because `planHash` now covers
   * the approved fields rather than whole ticket files — the whole-file hash
   * changed on every transition and would have refused every resume.
   *
   * A DAMAGED plan is not a stale one, and conflating them misdiagnoses: an
   * unreadable ticket changes the hash either way, so the check would report
   * "the tickets have changed since you approved" for a file that is merely
   * corrupt. `readTicket` refuses it by name a moment later, which is the error
   * worth surfacing.
   */
  /**
   * PRDR-153: an unreadable plan file REFUSES rather than disabling the check.
   * `planFilesReadable` excluded only `approval.json` while `NON_TICKET_FILES`
   * excludes `plan.json` too — so a conflicted `plan.json`, the most
   * merge-prone file in a committed directory, turned the C-9 comparison off
   * and nothing downstream noticed, because `allTickets` skips it by name. The
   * "readTicket refuses it a moment later" argument held for ticket files and
   * was false for this one.
   */
  if (!planArtifactReadable(root)) {
    return notReady(
      "`.detent/plan/plan.json` is not readable JSON, so the approval cannot be checked against the plan it names. " +
        "Repair or restore it — a merge conflict there is the usual cause, and a run executes only what a human approved (C-9).",
    );
  }
  /*
   * A ticket that will not parse is DAMAGE, not an edit: `readTicket` refuses
   * it by name a moment later, which is the precise error. Skipping the
   * comparison here keeps that diagnosis rather than reporting "the tickets
   * have changed since you approved".
   */
  const approved = ticketFilesReadable(root) ? approvalState(root) : { stale: false };
  if (approved.stale) {
    return notReady(
      "the approval in .detent/plan/approval.json is for a different plan — the tickets have changed since it was " +
        "given. Re-approve with `detent init` (C-9); a run executes only what a human approved.",
    );
  }
  /**
   * V-1″ (PRDR-135): a run with no bound test gate verifies nothing. Checked
   * beside the config and approval preconditions, so it refuses before
   * spending rather than at the first gate — where it used to mint a GREEN.
   */
  let bound: boolean;
  try {
    bound = readBindings(root).bindings.some((b) => b.slot === "test");
  } catch (err) {
    /**
     * PRDR-151: `readBindings` throws on an invalid or newer-schema file, and
     * this sits outside the try below — so it REJECTED the promise instead of
     * returning a `RunOutcome`, and the CLI printed a bare message with no
     * machine-readable summary. Every sibling precondition returns `notReady`.
     */
    return notReady((err as Error).message);
  }
  if (!bound) {
    return notReady(
      "no `test` gate is bound in .detent/bindings.json — a run would verify nothing. " +
        "Run `detent init` to bind the project's verification commands (V-1).",
    );
  }


  /**
   * S-5 (PRDR-181): the pinned CLI version is CHECKED, on the path that runs.
   *
   * `SessionBackend.checkVersion` had one production caller — `doctor`, behind
   * `--smoke` — so `detent run` never verified the pin, while `doctor` without
   * `--smoke` reports the pin as "checked at run time". It was checked nowhere.
   * A refusal belongs beside the other preconditions, before anything spends.
   * The fixture backend answers trivially, so this costs a mock run nothing.
   */
  try {
    await opts.backend.checkVersion(loaded.config.pinned.claude_code);
  } catch (err) {
    return notReady((err as Error).message);
  }

  /**
   * X-1‴ (PRDR-147): one run per root. Taken before the journal, so a refused
   * second run touches nothing; released on every exit path below.
   */
  const lock = acquireRunLock(root);
  if (!lock.ok) return notReady(runLockRefusal(lock.heldBy));
  if (lock.brokeStale !== null) {
    opts.announce?.(`broke a stale run lock left by pid ${lock.brokeStale.pid} on this host${lockPhaseSuffix(lock.brokeStale)} (X-1‴)`);
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
        /** V-1⁗ (PRDR-211): the seam is forwarded, or the install table is the only reachable value. */
        ...(opts.ecosystems !== undefined ? { ecosystems: opts.ecosystems } : {}),
        /** PRDR-104: the headless loop has no model session to govern — no hook files. */
        hookFiles: false,
        /* X-1⁵ (audit finding 1): the advisory total speaks on BOTH drivers. */
        ...(opts.announce === undefined ? {} : { announce: opts.announce }),
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

/**
 * C-9′ (PRDR-153): `plan.json` is what NAMES the approved set, so an unreadable
 * one is a refusal in its own right. It used to fall into the same bucket as a
 * corrupt ticket and silently disable the whole comparison — and nothing
 * downstream noticed, because `allTickets` skips it by name.
 */
function planArtifactReadable(root: string): boolean {
  const file = path.join(stateDir(root), "plan", "plan.json");
  if (!existsSync(file)) return true;
  try {
    JSON.parse(readFileSync(file, "utf8"));
    return true;
  } catch {
    return false;
  }
}

/** Every TICKET parses, so a hash comparison means what it says. */
function ticketFilesReadable(root: string): boolean {
  const dir = path.join(stateDir(root), "plan");
  if (!existsSync(dir)) return true;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json") || NON_TICKET_FILES.has(name)) continue;
    try {
      JSON.parse(readFileSync(path.join(dir, name), "utf8"));
    } catch {
      return false;
    }
  }
  return true;
}
