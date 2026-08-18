import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { parseArtifact } from "../schemas/common.js";
import { approvalSchema } from "../schemas/records.js";
import type { State } from "../schemas/states.js";
import type { Ticket } from "../schemas/ticket.js";
import type { PromptSet, SessionBackend } from "../sessions/backend.js";
import { callTool, isToolError, type RefereeToolError } from "../referee/registry.js";
import { ensureRunBranch, installTrailerHook } from "./git.js";
import { RunJournal } from "./journal.js";
import { RefereeCore, type PendingEntry } from "./referee.js";
import { readTicket } from "./tickets/readers.js";
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

export type { PendingEntry };

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

/** The two structured-error routes a driver handles; everything else is a defect. */
class DriverBreach extends Error {}
class DriverDriftHalt extends Error {}

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

const TERMINAL: readonly string[] = ["DONE", "NEEDS_HUMAN", "BLOCKED"];

class Driver {
  private readonly now: () => number;
  private processed = 0;
  private quitting = false;

  constructor(
    private readonly opts: RunOptions,
    private readonly loaded: LoadedConfig,
    private readonly core: RefereeCore,
  ) {
    this.now = opts.now ?? (() => Date.now());
  }

  /** One registry call; structured errors become the driver's two routes. */
  private async tool<T = Record<string, unknown>>(name: string, input: unknown): Promise<T> {
    const result = await callTool(this.core, name, input);
    if (isToolError(result)) {
      const { code, message } = (result as RefereeToolError).error;
      if (code === "BREACH") throw new DriverBreach(message);
      if (code === "DRIFT_HALT") throw new DriverDriftHalt(message);
      // ILLEGAL_TRANSITION / BAD_EVIDENCE / INVALID_INPUT / UNKNOWN_TOOL from
      // the deterministic driver are driver defects, not run outcomes.
      throw new Error(`referee refused ${name}: ${code}: ${message}`);
    }
    return result as T;
  }

  private async transition(id: string, ref: string): Promise<State> {
    const result = await this.tool<{ to: State }>("transition", { ticket_id: id, ref });
    return result.to;
  }

  // ------------------------------------------------------------- the loop

  async loop(): Promise<RunOutcome> {
    for (;;) {
      if (this.quitting) return await this.finish();
      const { pool } = await this.tool<{ pool: { id: string; state: State }[] }>("next", {});
      if (pool.length === 0) return await this.finish();

      const id = (pool[0] as { id: string }).id;
      const acquired = await this.tool<{
        ok: boolean;
        claimed_ref?: string;
        resume?: { state: State; reset: string[] };
      }>("claim", { op: "acquire", ticket_id: id });
      if (!acquired.ok) continue;

      try {
        await this.processTicket(id, acquired);
      } catch (err) {
        if (err instanceof DriverDriftHalt) {
          const { reason } = await this.tool<{ reason: string }>("record", { kind: "drift_halt" });
          return {
            exitCode: EXIT_NOT_READY,
            summary: { schema_version: 1, exit: EXIT_NOT_READY, pending: [], reason },
          };
        }
        throw err;
      } finally {
        await this.tool("claim", { op: "release", ticket_id: id });
      }

      this.processed += 1;
      if (this.opts.maxTickets !== undefined && this.processed >= this.opts.maxTickets) return await this.finish();
    }
  }

  private async finish(): Promise<RunOutcome> {
    const { pending } = await this.tool<{ pending: PendingEntry[] }>("status", {});
    if (pending.length > 0) {
      return { exitCode: EXIT_HUMAN_GATED, summary: { schema_version: 1, exit: EXIT_HUMAN_GATED, pending } };
    }
    return { exitCode: EXIT_OK, summary: { schema_version: 1, exit: EXIT_OK, pending: [] } };
  }

  // ------------------------------------------------------ ticket driving

  private async processTicket(
    id: string,
    acquired: { claimed_ref?: string; resume?: { state: State; reset: string[] } },
  ): Promise<void> {
    const startedAt = this.now();
    let state: State;
    if (acquired.claimed_ref !== undefined) {
      state = await this.transition(id, acquired.claimed_ref);
    } else {
      state = acquired.resume?.state ?? "IN_PROGRESS";
      // C-13: resume always announces itself, in the five-label vocabulary —
      // the caller renders it; internal state names never reach a terminal.
      this.opts.announce?.(this.resumeAnnouncement(id, state));
    }

    while (!TERMINAL.includes(state)) {
      if (this.now() - startedAt > this.loaded.config.budgets.ticket_wall_clock_ms) {
        state = await this.breach(id, "ticket wall clock ceiling (X-1)");
        break;
      }
      try {
        state = await this.stage(id, state);
      } catch (err) {
        if (err instanceof DriverBreach) {
          state = await this.breach(id, err.message);
          break;
        }
        throw err;
      }
    }

    if (state === "NEEDS_HUMAN") {
      const reason = await this.pendingReason(id);
      const { summary } = await this.tool<{ summary: string }>("record", { kind: "dossier", ticket_id: id, reason });
      await this.tool("record", { kind: "close_generation", ticket_id: id, outcome: "needs_human" });
      await this.offerEscalation(id, reason, summary);
    } else if (state === "BLOCKED") {
      await this.tool("record", { kind: "close_generation", ticket_id: id, outcome: "blocked" });
    } else if (state === "DONE") {
      await this.tool("record", { kind: "finalize", ticket_id: id });
      await this.tool("record", { kind: "close_generation", ticket_id: id, outcome: "done" });
    }
  }

  private async stage(id: string, state: State): Promise<State> {
    switch (state) {
      case "IN_PROGRESS": {
        const result = await this.tool<{ falsified_ref?: string }>("attempt", { ticket_id: id, state });
        if (result.falsified_ref !== undefined) return await this.transition(id, result.falsified_ref);
        return await this.gateTo(id);
      }
      case "BLIND_FIX":
      case "REVIEW_FIX":
        await this.tool("attempt", { ticket_id: id, state });
        return await this.gateTo(id);
      case "INFORMED_FIX":
        await this.tool("attempt", { ticket_id: id, state });
        return await this.gateTo(id, { escalate_reason: "informed fix failed — the ladder cannot reopen (D-13)" });
      case "RESEARCH":
        return await this.stageRecord(id, "research");
      case "IN_REVIEW":
        return await this.stageRecord(id, "review");
      case "DIAGNOSED":
        return await this.stageRecord(id, "diagnose");
      case "APPROVED":
        return await this.gateTo(id, { close_check: true });
      default:
        throw new Error(`driver has no handler for state ${state}`);
    }
  }

  private async gateTo(id: string, opts: { close_check?: boolean; escalate_reason?: string } = {}): Promise<State> {
    const { ref } = await this.tool<{ ref: string }>("gate", { ticket_id: id, ...opts });
    return await this.transition(id, ref);
  }

  private async stageRecord(id: string, stage: "diagnose" | "review" | "research"): Promise<State> {
    const { ref } = await this.tool<{ ref: string }>("record", { kind: "stage", ticket_id: id, stage });
    return await this.transition(id, ref);
  }

  private async breach(id: string, reason: string): Promise<State> {
    const { ref } = await this.tool<{ ref: string }>("record", { kind: "breach", ticket_id: id, reason });
    return await this.transition(id, ref);
  }

  private async pendingReason(id: string): Promise<string> {
    const { pending } = await this.tool<{ pending: PendingEntry[] }>("status", {});
    const reason = pending.find((p) => p.id === id)?.reason;
    return reason === undefined || reason === "" ? "escalated" : reason;
  }

  // ---- escalation (C-10, T-049) -------------------------------------------

  /**
   * The in-run escalation flow. Approve applies HUMAN_APPROVED (the referee
   * re-verifies from APPROVED — never a direct DONE); requeue opens a fresh
   * generation carrying the guidance (X-8); skip leaves the ticket pending;
   * quit stops the run. The human act is the answer itself.
   */
  private async offerEscalation(id: string, reason: string, summary: string): Promise<void> {
    if (this.opts.escalate === undefined || this.quitting) return;
    const action = await this.opts.escalate({ ticket: readTicket(this.opts.root, id), reason, summary });

    if (action.kind === "quit") {
      this.quitting = true;
      return;
    }
    if (action.kind === "skip") {
      await this.tool("record", { kind: "note", ticket_id: id, author: action.by, text: `skipped at escalation (C-10)` });
      return;
    }
    if (action.kind === "approve") {
      const { ref } = await this.tool<{ ref: string }>("record", {
        kind: "human",
        ticket_id: id,
        action: { kind: "approve", by: action.by },
      });
      await this.transition(id, ref);
      await this.tool("record", { kind: "reopen_generation", ticket_id: id });
      // The referee re-verifies: drive the ticket onward from APPROVED now.
      await this.driveOn(id, "APPROVED");
      return;
    }
    // requeue with guidance
    const { ref } = await this.tool<{ ref: string }>("record", {
      kind: "human",
      ticket_id: id,
      action: { kind: "requeue", by: action.by, guidance: action.guidance },
    });
    await this.transition(id, ref);
    await this.tool("record", { kind: "open_generation", ticket_id: id, reason: action.guidance });
  }

  private async driveOn(id: string, from: State): Promise<void> {
    let state = from;
    while (!TERMINAL.includes(state)) {
      try {
        state = await this.stage(id, state);
      } catch (err) {
        if (err instanceof DriverBreach) {
          state = await this.breach(id, err.message);
          break;
        }
        throw err;
      }
    }
    if (state === "DONE") {
      await this.tool("record", { kind: "finalize", ticket_id: id });
      await this.tool("record", { kind: "close_generation", ticket_id: id, outcome: "done" });
    } else if (state === "NEEDS_HUMAN") {
      const reason = await this.pendingReason(id);
      await this.tool("record", { kind: "dossier", ticket_id: id, reason });
      await this.tool("record", { kind: "close_generation", ticket_id: id, outcome: "needs_human" });
    } else {
      await this.tool("record", { kind: "close_generation", ticket_id: id, outcome: "blocked" });
    }
  }

  /** C-13: the five-label vocabulary; full state names live only in the journal. */
  private resumeAnnouncement(id: string, state: State): string {
    const labels: Record<string, string> = {
      DIAGNOSED: "diagnosing",
      IN_PROGRESS: "implementing",
      BLIND_FIX: "fixing",
      RESEARCH: "researching the failure",
      INFORMED_FIX: "fixing, research applied",
      REVIEW_FIX: "addressing review findings",
      IN_REVIEW: "in review",
      APPROVED: "verifying",
    };
    return `resuming ${id} — ${labels[state] ?? "working"}`;
  }
}
