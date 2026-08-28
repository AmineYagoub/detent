import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { readCheckpoint, writeCheckpoint } from "../fs/checkpoints.js";
import { initLayout, stateDir } from "../fs/layout.js";
import { git } from "../kernel/git.js";
import { readTicket, isClaimed } from "../kernel/tickets/readers.js";
import { ticketsDir } from "../kernel/tickets/paths.js";
import { INIT_PHASES, type InitPhase, type Interrupt } from "../schemas/init.js";

/**
 * T-060 — the `init` phase machine (C-4.1, C-5, C-8, C-1).
 *
 * The pipeline is data: a fixed ordered phase list, one handler each. The
 * driver's whole job is deciding what to re-execute, and it decides it the
 * only way P9 permits — by content address. Each phase declares a **digest of
 * what it reads**, that digest folds into its predecessor's, and a checkpoint
 * whose hash still matches is reused (F-4).
 *
 * The distinction that makes C-8's AC true — "editing PRD.md re-executes
 * ANALYZE forward; editing nothing re-executes nothing" — is that DISCOVER
 * reads the *listing* (which files exist) while ANALYZE reads the *contents*.
 * Editing a doc changes what ANALYZE saw without changing what DISCOVER found,
 * so discovery is reused and analysis re-runs. That is a modelling choice the
 * checkpoint layer cannot make for us, which is why the digests live here.
 */

export type PhaseOutcome =
  | { readonly kind: "complete"; readonly outputs: Record<string, unknown> }
  | {
      readonly kind: "interrupt";
      /** C-5: the type is the closed set. There is no "other". */
      readonly interrupt: Interrupt;
      readonly message: string;
      /** AWAIT_INFO batches; AWAIT_DOCS lists what was looked for. */
      readonly items?: readonly string[];
    };

interface InitContext {
  readonly root: string;
  /** Outputs of every completed phase, by phase name — the pipeline's bus. */
  readonly outputs: Readonly<Record<string, Record<string, unknown>>>;
  readonly now: () => number;
}

export interface PhaseHandler {
  readonly phase: InitPhase;
  /**
   * A canonical string naming everything this phase reads. Listing-shaped for
   * phases that care which files exist; content-shaped for phases that care
   * what they say. Never a timestamp — a digest that moves on its own would
   * make every re-init replay the world.
   */
  digest(ctx: InitContext): string;
  run(ctx: InitContext): Promise<PhaseOutcome>;
}

/** The first phase a `--replan` re-derives; INIT_FS and DISCOVER are cheap scans whose own digests already catch new files. */
const REPLAN_FROM: InitPhase = "ANALYZE";

/**
 * PRDR-085: tickets a replan must not pull the ground out from under. Read
 * defensively — an unparseable ticket file is a problem, but it is not
 * evidence of a live session, and this guard must not be the thing that
 * crashes on it.
 */
function inFlightTickets(root: string): string[] {
  const dir = ticketsDir(root);
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json") || file === "plan.json" || file === "approval.json") continue;
    const id = file.slice(0, -".json".length);
    if (isClaimed(root, id)) {
      found.push(`${id} (claimed)`);
      continue;
    }
    try {
      const state = readTicket(root, id).state;
      if (state !== "DONE" && state !== "READY") found.push(`${id} (${state})`);
    } catch {
      /* unparseable: surfaced by the phases that actually consume it */
    }
  }
  return found;
}

export interface InitOptions {
  /** C-8: regenerate an approved plan rather than printing status. */
  readonly replan?: boolean;
  readonly now?: () => number;
}

export interface InitResult {
  readonly exitCode: 0 | 2;
  readonly reachedPhase: InitPhase | "READY";
  readonly interrupt?: { readonly interrupt: Interrupt; readonly message: string; readonly items: readonly string[] };
  /** The first phase that had to re-execute; null when everything was reused. */
  readonly replayedFrom: InitPhase | null;
  readonly executed: readonly InitPhase[];
  readonly reused: readonly InitPhase[];
  readonly messages: readonly string[];
  readonly outputs: Readonly<Record<string, Record<string, unknown>>>;
}

/*
 * ---------------------------------------------------------------------------
 * Digest helpers — the two shapes a phase's inputs can take
 */

/** Which files exist, not what they say. Sorted, POSIX, contents ignored. */
export function listingDigest(paths: readonly string[]): string {
  return `listing:${[...paths].sort().join("\n")}`;
}

/** What the files say. Missing files hash to a marker so creation is drift. */
export function contentsDigest(root: string, rels: readonly string[]): string {
  const h = createHash("sha256");
  for (const rel of [...rels].sort()) {
    const abs = path.join(root, ...rel.split("/"));
    const digest = existsSync(abs) ? createHash("sha256").update(readFileSync(abs)).digest("hex") : "absent";
    h.update(`${rel}\0${digest}\n`);
  }
  return `contents:${h.digest("hex")}`;
}

/** A stable digest over an already-computed value (e.g. a predecessor's output). */
export function valueDigest(value: unknown): string {
  return `value:${createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex")}`;
}

/*
 * ---------------------------------------------------------------------------
 * C-1 — root-only
 */

/**
 * C-1: init runs only at the git root; elsewhere it errors with the root path
 * hinted and creates no `.detent/`. A non-repo directory is NOT an error here
 * — C-6's consent path may offer `git init` — so this reports which case it is
 * rather than deciding.
 */
export function checkRoot(cwd: string): { readonly kind: "root" } | { readonly kind: "subdirectory"; readonly root: string } | { readonly kind: "no-repo" } {
  let top: string;
  try {
    top = git(cwd, "rev-parse", "--show-toplevel").trim();
  } catch {
    return { kind: "no-repo" };
  }
  /** realpath both sides: macOS temp dirs are symlinked (/var -> /private/var). */
  const same = statSync(top).ino === statSync(cwd).ino;
  return same ? { kind: "root" } : { kind: "subdirectory", root: top };
}

/*
 * ---------------------------------------------------------------------------
 * C-8 — approval state
 */

export interface ApprovalState {
  readonly approved: boolean;
  /** True when tickets were hand-edited after approval (C-8). */
  readonly stale: boolean;
  readonly planHash: string | null;
}

/** The hash an approval covers: every ticket file's content, order-independent. */
export function planHash(root: string): string {
  const dir = path.join(stateDir(root), "plan");
  if (!existsSync(dir)) return createHash("sha256").update("").digest("hex");
  const h = createHash("sha256");
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json") || name === "approval.json") continue;
    h.update(`${name}\0`).update(createHash("sha256").update(readFileSync(path.join(dir, name))).digest("hex")).update("\n");
  }
  return h.digest("hex");
}

export function approvalState(root: string): ApprovalState {
  const file = path.join(stateDir(root), "plan", "approval.json");
  if (!existsSync(file)) return { approved: false, stale: false, planHash: null };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { plan_hash?: string };
    const recorded = parsed.plan_hash ?? null;
    return { approved: true, stale: recorded !== planHash(root), planHash: recorded };
  } catch {
    return { approved: false, stale: false, planHash: null };
  }
}

/*
 * ---------------------------------------------------------------------------
 * The driver
 */

/**
 * Run the pipeline from the first phase whose inputs drifted (C-8). Phases
 * before it are reused from their checkpoints; the interrupted phase is NOT
 * checkpointed, so re-running `init` resumes exactly there.
 */
export async function runInit(
  root: string,
  handlers: readonly PhaseHandler[],
  opts: InitOptions = {},
): Promise<InitResult> {
  const messages: string[] = [];
  const now = opts.now ?? (() => Date.now());

  /** C-8: an approved plan prints status and requires --replan to regenerate. */
  const approval = approvalState(root);
  if (approval.approved && !approval.stale && opts.replan !== true) {
    return {
      exitCode: 0,
      reachedPhase: "READY",
      replayedFrom: null,
      executed: [],
      reused: [],
      messages: [`plan approved (hash ${approval.planHash?.slice(0, 12)}…) — pass --replan to regenerate it (C-8)`],
      outputs: {},
    };
  }
  /**
   * PRDR-085: `--replan` means a fresh planning session. Re-deriving under a
   * ticket that is mid-ladder or claimed would pull the ground out from a
   * running session, so the refusal comes BEFORE any model spend.
   */
  if (opts.replan === true) {
    const inFlight = inFlightTickets(root);
    if (inFlight.length > 0) {
      return {
        exitCode: 2,
        reachedPhase: "PLAN",
        replayedFrom: null,
        executed: [],
        reused: [],
        messages: [
          `--replan refused: ${inFlight.join(", ")} still in flight. ` +
            "Let the run finish or resolve them (detent status), then replan.",
        ],
        outputs: {},
      };
    }
  }
  if (approval.approved && approval.stale) {
    /* Hand-edited tickets invalidate the approval; PRESENT re-presents the diff. */
    messages.push("tickets were edited after approval — approval invalidated, re-presenting (C-8)");
  }

  initLayout(root);

  const outputs: Record<string, Record<string, unknown>> = {};
  const executed: InitPhase[] = [];
  const reused: InitPhase[] = [];
  let replayedFrom: InitPhase | null = null;
  let carried = "";
  let replaying = approval.approved && approval.stale;

  for (const phase of INIT_PHASES) {
    const handler = handlers.find((h) => h.phase === phase);
    if (handler === undefined) continue;

    const ctx: InitContext = { root, outputs, now };
    const hash = createHash("sha256").update(`${carried}\0${phase}\0${handler.digest(ctx)}`).digest("hex");
    carried = hash;

    /* PRDR-085: a replan re-derives every planning phase, digests notwithstanding. */
    if (!replaying && opts.replan === true && phase === REPLAN_FROM) {
      replaying = true;
      replayedFrom = phase;
    }

    if (!replaying) {
      const read = readCheckpoint(root, phase, hash);
      if (read.status === "fresh") {
        outputs[phase] = { ...read.checkpoint.outputs };
        reused.push(phase);
        continue;
      }
      replaying = true;
      replayedFrom = phase;
    }

    const outcome = await handler.run(ctx);
    if (outcome.kind === "interrupt") {
      /* Not checkpointed: the phase did not complete, so a re-run resumes here. */
      return {
        exitCode: 2,
        reachedPhase: phase,
        interrupt: { interrupt: outcome.interrupt, message: outcome.message, items: outcome.items ?? [] },
        replayedFrom,
        executed,
        reused,
        messages: [...messages, outcome.message],
        outputs,
      };
    }

    outputs[phase] = outcome.outputs;
    writeCheckpoint(root, phase, hash, outcome.outputs, { at: new Date(now()).toISOString() });
    executed.push(phase);
  }

  return {
    exitCode: 0,
    reachedPhase: "READY",
    replayedFrom,
    executed,
    reused,
    messages,
    outputs,
  };
}
