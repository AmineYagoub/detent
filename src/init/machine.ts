import { createHash } from "node:crypto";
import type { Ticket } from "../schemas/ticket.js";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
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
  /**
   * C-8‴ (PRDR-118): whether what this phase WROTE is still there. Digests
   * cover a phase's inputs and must not move when it succeeds, so a phase
   * whose output can be deleted out from under a fresh checkpoint declares it
   * here instead. Absent means "nothing to check". Deleting `.detent/plan/`
   * used to reuse every checkpoint and report READY over an empty directory.
   */
  outputIntact?(ctx: InitContext): boolean;
  run(ctx: InitContext): Promise<PhaseOutcome>;
}

/** The first phase a `--replan` re-derives; INIT_FS and DISCOVER are cheap scans whose own digests already catch new files. */
const REPLAN_FROM: InitPhase = "ANALYZE";

/**
 * PRDR-087: a stale approval means the PRESENTATION is out of date, not the
 * plan. Re-deriving from phase one would hand the human a plan they never
 * reviewed — the approval gate's whole job is that you approve what you were
 * shown — and would re-run ANALYZE and PLAN, whose digests are fresh, at full
 * model cost. Forcing PRESENT alone re-presents the diff, which is what C-8
 * says and what the old comment claimed to do.
 */
const STALE_APPROVAL_FROM: InitPhase = "PRESENT";

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

/**
 * C-2‴: where PLAN caches each slice's reviewed draft, keyed by what it read.
 * Named here — beside the digests — because `--replan` must wipe it: C-8′
 * promises a fresh planning session, and a cache hit is the opposite.
 */
export function sliceCacheDir(root: string): string {
  return path.join(stateDir(root), "state", "plan");
}

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
/**
 * C-9′ (PRDR-139): the fields a human APPROVES. Everything else in a ticket
 * file is run state.
 *
 * This hashed whole ticket files, and `writeTicket` rewrites them on every
 * transition, counter bump and note — so the hash changed within seconds of a
 * run starting. Checking it at run start would have refused every RESUME, and
 * it already made a re-init after a partial run call an untouched plan stale.
 * An approval is a statement about the PLAN; the plan is not the counters.
 */
/**
 * PRDR-152: this listed `depends_on`, which is a DRAFTED ticket's field name —
 * a `Ticket` on disk carries `blockers` and `waits_on`. So the projection
 * hashed a key that is always absent and IGNORED the two that hold the
 * dependency graph: a ticket's edges could be rewritten after approval and
 * C-9's check would not notice. Third instance in this line of the same
 * mistake — reasoning about a format without reading what writes it — and the
 * one that makes the case for asserting against the schema rather than a
 * remembered field list.
 */
const APPROVED_FIELDS: readonly (keyof Ticket)[] = [
  "id",
  "type",
  "title",
  "description",
  "acceptance_criteria",
  "non_goals",
  "surface",
  "blockers",
  "waits_on",
  "links",
  "provides",
  "consumes",
  "risk_label",
  "priority",
] as const;


function approvedProjection(raw: unknown): string {
  const t = (raw ?? {}) as Record<string, unknown>;
  return JSON.stringify(APPROVED_FIELDS.map((k) => [k, t[k] ?? null]));
}

export function planHash(root: string): string {
  const dir = path.join(stateDir(root), "plan");
  if (!existsSync(dir)) return createHash("sha256").update("").digest("hex");
  const h = createHash("sha256");
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json") || name === "approval.json") continue;
    let projected: string;
    try {
      projected = approvedProjection(JSON.parse(readFileSync(path.join(dir, name), "utf8")));
    } catch {
      /**
       * An unreadable ticket is DAMAGE, not an edit, and the difference matters
       * in the message a human gets. Hashing its bytes made a corrupt file read
       * as "the plan changed since you approved it", which misdiagnoses; and it
       * is safe to skip, because an unparseable ticket cannot be executed —
       * `readTicket` refuses it by name, which is the error worth surfacing.
       */
      continue;
    }
    h.update(`${name}\0`).update(createHash("sha256").update(projected).digest("hex")).update("\n");
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
/**
 * Whether PLAN would re-execute on this invocation — i.e. whether some phase
 * at or before it has drifted. Digests are pure reads, so this costs nothing
 * and spends nothing; it is the same walk the driver does below, stopped at
 * the first miss.
 */
function wouldReplan(root: string, handlers: readonly PhaseHandler[], now: () => number): boolean {
  let carried = "";
  const outputs: Record<string, Record<string, unknown>> = {};
  for (const phase of INIT_PHASES) {
    const handler = handlers.find((h) => h.phase === phase);
    if (handler === undefined) continue;
    let hash: string;
    try {
      hash = createHash("sha256").update(`${carried}\0${phase}\0${handler.digest({ root, outputs, now })}`).digest("hex");
    } catch {
      /* A digest that cannot be computed is drift by definition. */
      return true;
    }
    carried = hash;
    const read = readCheckpoint(root, phase, hash);
    if (read.status !== "fresh") return true;
    if (handler.outputIntact?.({ root, outputs, now }) === false) return true;
    outputs[phase] = { ...read.checkpoint.outputs };
    if (phase === "PLAN") return false;
  }
  return false;
}

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
   * PRDR-085: re-deriving under a ticket that is mid-ladder or claimed pulls
   * the ground out from a running session — `writePlan` resets every drafted
   * ticket to READY with fresh counters and deletes the ones the new plan does
   * not name. The refusal comes BEFORE any model spend.
   *
   * C-8″ (PRDR-118): this guarded `--replan` only, and every other route to a
   * re-plan was unguarded — including the one PRESENT itself recommends.
   * Answer a question in a planning document while a run is executing, re-run
   * `detent init` with no flag, and the content digest replays ANALYZE-forward
   * into PLAN, which resets the claimed ticket a session is working in. The
   * guard belongs to re-planning, not to the flag.
   */
  if (opts.replan === true || wouldReplan(root, handlers, now)) {
    const inFlight = inFlightTickets(root);
    if (inFlight.length > 0) {
      return {
        exitCode: 2,
        reachedPhase: "PLAN",
        replayedFrom: null,
        executed: [],
        reused: [],
        messages: [
          `${opts.replan === true ? "--replan" : "re-planning"} refused: ${inFlight.join(", ")} still in flight. ` +
            "Let the run finish or resolve them (detent status), then plan again.",
        ],
        outputs: {},
      };
    }
  }
  if (approval.approved && approval.stale) {
    /* Hand-edited tickets invalidate the approval; PRESENT re-presents the diff. */
    messages.push("tickets were edited after approval — approval invalidated, re-presenting (C-8)");
  }
  /* C-8′: a replan is a fresh planning session — every slice is drafted again (C-2‴). */
  if (opts.replan === true) rmSync(sliceCacheDir(root), { recursive: true, force: true });

  initLayout(root);

  const outputs: Record<string, Record<string, unknown>> = {};
  const executed: InitPhase[] = [];
  const reused: InitPhase[] = [];
  let replayedFrom: InitPhase | null = null;
  let carried = "";
  /** The phase that must re-execute regardless of its digest, if any. */
  const forceFrom: InitPhase | null =
    opts.replan === true ? REPLAN_FROM : approval.approved && approval.stale ? STALE_APPROVAL_FROM : null;
  let replaying = false;

  for (const phase of INIT_PHASES) {
    const handler = handlers.find((h) => h.phase === phase);
    if (handler === undefined) continue;

    const ctx: InitContext = { root, outputs, now };
    const hash = createHash("sha256").update(`${carried}\0${phase}\0${handler.digest(ctx)}`).digest("hex");
    carried = hash;

    /* PRDR-085/087: forced re-execution starts exactly here, not at phase one. */
    if (!replaying && phase === forceFrom) {
      replaying = true;
      replayedFrom = phase;
    }

    if (!replaying) {
      const read = readCheckpoint(root, phase, hash);
      if (read.status === "fresh" && handler.outputIntact?.(ctx) !== false) {
        outputs[phase] = { ...read.checkpoint.outputs };
        reused.push(phase);
        continue;
      }
      if (read.status === "fresh") messages.push(`${phase} is re-running: what it wrote is no longer on disk (C-8‴)`);
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
