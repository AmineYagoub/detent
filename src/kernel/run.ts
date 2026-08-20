import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { parseArtifact } from "../schemas/common.js";
import { approvalSchema } from "../schemas/records.js";
import type { Ticket } from "../schemas/ticket.js";
import type { PromptSet, SessionBackend } from "../sessions/backend.js";
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

  let journal: RunJournal;
  try {
    journal = RunJournal.open(root);
  } catch (err) {
    return notReady((err as Error).message);
  }

  try {
    const runBranch = ensureRunBranch(root, opts.runId ?? `${process.pid}-${Date.now().toString(36)}`);
    installTrailerHook(root);
    const core = new RefereeCore(
      {
        root,
        backend: opts.backend,
        prompts: opts.prompts,
        ...(opts.worker !== undefined ? { worker: opts.worker } : {}),
        ...(opts.now !== undefined ? { now: opts.now } : {}),
        ...(opts.worktree !== undefined ? { worktree: opts.worktree } : {}),
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
