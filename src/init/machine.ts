import { createHash } from "node:crypto";
import type { Ticket } from "../schemas/ticket.js";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { readCheckpoint, writeCheckpoint } from "../fs/checkpoints.js";
import { initLayout, stateDir } from "../fs/layout.js";
import { git } from "../kernel/git.js";
import { NON_TICKET_FILES } from "../kernel/tickets/readers.js";
import { INIT_PHASES, INTERRUPT_PHASE, type InitPhase, type Interrupt } from "../schemas/init.js";
import { approvalSchema } from "../schemas/records.js";
import { parseArtifact } from "../schemas/common.js";
import { inFlightTickets, replanRefusal, replansAt, wouldReplan } from "./replan-guard.js";

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
 *
 * One exception, C-2⁹'s (PRDR-279): where a conformance record exists,
 * DISCOVER also says whether the pack is still the one validated, so it reads
 * the pack's contents, and an edit re-runs it. The phases after it replay
 * from the same edit either way, so the exception costs one scan.
 *
 * Two phases are off the chain (`standalone`). AUDIT, C-2¹¹'s (PRDR-281), is
 * keyed by its own digest alone, so a code edit re-runs it without re-planning.
 * DECIDE, C-2¹²'s (PRDR-282), is too, so a re-run AUDIT re-runs DECIDE without
 * re-planning, and what DECIDE decides reaches planning through the decision
 * log, which the planning phases read in their own digests.
 *
 * DECIDE also writes what its digest reads, the decision log, so its
 * checkpoint is keyed after it runs: its own write does not re-run it, and an
 * edit by anyone else does (`keyedAfterRun`).
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
  /**
   * C-2¹¹ (PRDR-281): the phase stands outside the chain. Its checkpoint is
   * keyed by its own digest alone and looked up even while the phases before it
   * replay, and running it replays nothing after it: a later phase that reads
   * its outputs names them in its own digest.
   *
   * AUDIT and DECIDE are the two. AUDIT's key covers the code, which no phase
   * after it reads, so on the chain an edit to the code would have re-planned
   * the product. DECIDE re-runs whenever the items AUDIT left open move, which
   * a code edit can do, and it reaches the planning phases only through the
   * decision log, which each of them names in its own digest (C-2¹²): a re-run
   * that leaves the log as it was re-plans nothing.
   */
  readonly standalone?: boolean;
  /**
   * C-2¹² (PRDR-282): the phase writes a file its digest reads, so its
   * checkpoint is keyed by the digest taken after it runs, and a phase on the
   * chain passes that key on. Keyed before, the phase's own write would move
   * its digest and re-run it on the next `init`.
   *
   * DECIDE is the one: it writes the decision log, and an edit to the log is
   * what must re-run it. Its digest must not read its own outputs: the lookup
   * takes it before they exist.
   */
  readonly keyedAfterRun?: boolean;
  run(ctx: InitContext): Promise<PhaseOutcome>;
}

/**
 * The first phase a `--replan` re-derives; INIT_FS and DISCOVER are cheap scans
 * whose own digests already catch new files. AUDIT and DECIDE, between DISCOVER
 * and this phase, are not forced either: C-8⁵ keeps `--replan` out of the
 * specification phase, and each one's key covers everything it reads, so it
 * re-runs when that moves and only then (C-2¹¹, C-2¹²).
 */
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

export interface InitOptions {
  /** PRDR-194: called as each phase begins, so a killed run can name the phase. */
  readonly progress?: (text: string) => void;
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
 * C-9‴ (PRDR-139): the fields a human APPROVES. Everything else in a ticket
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
  /**
   * A-1⁵ (PRDR-201): what a ticket DELIVERS is approved content, not run state.
   *
   * A human approving a plan is approving which requirement each ticket
   * carries; rewriting that afterwards changes what was agreed, and no
   * run-time writer touches either field.
   */
  "requirement_ids",
  "baseline_ids",
  /**
   * PRDR-153: `blockers` stays — plan-time only, verified: no run-time writer.
   * `waits_on` and `links` were added by PRDR-152 and are REMOVED again: both
   * are written DURING a run — `dependency.ts` sets `waits_on` on an X-4′
   * discovered dependency, and `linkDiscovered` sets `links` on both sides of
   * an X-6 discovery — so including them refused the next resume of any run
   * that discovered anything. The fix for the graph bypass was right; two of
   * the three fields I reached for were run state.
   */
  "blockers",
  "provides",
  "consumes",
  "risk_label",
  "priority",
] as const;


function approvedProjection(raw: unknown): string {
  const t = (raw ?? {}) as Record<string, unknown>;
  /**
   * PRDR-227: the surface AS PLANNED. A kernel grant (SEC-3's lever) appends to
   * `surface` and records the path in `granted`; the human approved the plan,
   * not the run's later, capped, justified widening of one ticket — so the
   * grant is subtracted here, and the first restart after a grant no longer
   * refuses "a different plan".
   */
  const granted = new Set(Array.isArray(t["granted"]) ? (t["granted"] as unknown[]).filter((p): p is string => typeof p === "string") : []);
  const value = (k: keyof Ticket): unknown =>
    k === "surface" && Array.isArray(t["surface"]) ? (t["surface"] as unknown[]).filter((p) => !granted.has(p as string)) : (t[k] ?? null);
  return JSON.stringify(APPROVED_FIELDS.map((k) => [k, value(k)]));
}

/**
 * PRDR-153: the ids the PLAN names, or null when there is no readable plan.
 *
 * A run creates tickets in the same directory the hash scans — X-5 quarantine
 * and X-6 discovery both call `linkDiscovered`, which writes a new `.json`
 * there — so hashing every file meant Detent's own bookkeeping invalidated the
 * approval and refused the next resume. Anchoring to `plan.json`'s ticket list
 * is exact: it is what the human was shown, and `linkDiscovered` never touches
 * it.
 */
function plannedIds(root: string): ReadonlySet<string> | null {
  try {
    const raw = JSON.parse(readFileSync(path.join(stateDir(root), "plan", "plan.json"), "utf8")) as { tickets?: unknown };
    return Array.isArray(raw.tickets) ? new Set(raw.tickets.filter((t): t is string => typeof t === "string")) : null;
  } catch {
    return null;
  }
}

export function planHash(root: string): string {
  const dir = path.join(stateDir(root), "plan");
  if (!existsSync(dir)) return createHash("sha256").update("").digest("hex");
  const planned = plannedIds(root);
  const h = createHash("sha256");
  for (const name of readdirSync(dir).sort()) {
    /** PRDR-153: ONE definition of "not a ticket" — `readers.ts` already had it. */
    if (!name.endsWith(".json") || NON_TICKET_FILES.has(name)) continue;
    /* Only what the plan named; a ticket the RUN filed is not an edit to what was approved. */
    if (planned !== null && !planned.has(name.replace(/\.json$/, ""))) continue;
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
    /**
     * C-9 (PRDR-181): the SCHEMA, not a cast.
     *
     * This read `as { plan_hash?: string }` and treated any object carrying a
     * matching hash as approved, while `kernel/run.ts` parses the same file
     * through `approvalSchema`. So `{"plan_hash": "…"}` — no approver, no
     * timestamp, no schema version — was refused by the headless path and
     * accepted by the plugin one, for the same file. An approval is a human's
     * signature on a plan; the two drivers must read it identically (ARCH-2).
     */
    const parsed = parseArtifact(approvalSchema, JSON.parse(readFileSync(file, "utf8")));
    if (!parsed.ok) return { approved: false, stale: false, planHash: null };
    const recorded = parsed.value.plan_hash;
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
   * PRDR-085: re-deriving under a ticket that is mid-ladder or claimed pulls
   * the ground out from a running session (`replan-guard.ts`). The refusal
   * comes BEFORE any model spend.
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
    if (inFlight.length > 0) return replanRefusal(inFlight, opts.replan === true);
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

    opts.progress?.(phase);
    const ctx: InitContext = { root, outputs, now };
    /* C-2¹¹: a standalone phase's key is its own digest, and the chain passes it by. */
    const standalone = handler.standalone === true;
    const keyOf = (upstream: string): string =>
      createHash("sha256").update(`${standalone ? "" : upstream}\0${phase}\0${handler.digest(ctx)}`).digest("hex");
    const upstream = carried;
    const hash = keyOf(upstream);
    if (!standalone) carried = hash;

    /* PRDR-085/087: forced re-execution starts exactly here, not at phase one. */
    if (!replaying && phase === forceFrom) {
      replaying = true;
      replayedFrom ??= phase;
    }

    if (!replaying || standalone) {
      const read = readCheckpoint(root, phase, hash);
      if (read.status === "fresh" && handler.outputIntact?.(ctx) !== false) {
        outputs[phase] = { ...read.checkpoint.outputs };
        reused.push(phase);
        continue;
      }
      if (read.status === "fresh") messages.push(`${phase} is re-running: what it wrote is no longer on disk (C-8‴)`);
      replayedFrom ??= phase;
      if (!standalone) replaying = true;
    }

    /* C-8″ (PRDR-282): what a standalone phase wrote this run can re-plan, which the scan above could not see. */
    if (!standalone && replansAt(phase)) {
      const inFlight = inFlightTickets(root);
      if (inFlight.length > 0) return replanRefusal(inFlight, opts.replan === true, { reachedPhase: phase, replayedFrom, executed, reused, outputs });
    }
    const outcome = await handler.run(ctx);
    if (outcome.kind === "interrupt") {
      /* C-3⁗ (PRDR-282): an interrupt is raised only where INTERRUPT_PHASE says; anything else is a defect in this build. */
      if (!(INTERRUPT_PHASE[outcome.interrupt] as readonly InitPhase[]).includes(phase)) {
        throw new Error(`${phase} raised ${outcome.interrupt}, which INTERRUPT_PHASE does not let it raise (C-5)`);
      }
      /**
       * PRDR-166: a repeated question says whether anything new was read.
       *
       * An answer written where DISCOVER does not look is never read, ANALYZE
       * re-derives, and the identical question returns — indistinguishable from
       * an answer the planner judged inadequate, at the cost of a full ANALYZE
       * round per wrong guess. The machine already knows: a reused DISCOVER
       * means the document set did not change. It simply never said so.
       *
       * PRESENT's alone (PRDR-282): DECIDE reads the decision log itself, and
       * DISCOVER no longer lists it, so an answer written there is read whatever
       * DISCOVER did.
       */
      const message =
        outcome.interrupt === "AWAIT_INFO" && phase === "PRESENT" && reused.includes("DISCOVER")
          ? `${outcome.message}\n\nThe document set is unchanged since the last run — no new planning document was read, so if you answered this already, the answer is somewhere DISCOVER does not look.`
          : outcome.message;
      /* Not checkpointed: the phase did not complete, so a re-run resumes here. */
      return {
        exitCode: 2,
        reachedPhase: phase,
        interrupt: { interrupt: outcome.interrupt, message, items: outcome.items ?? [] },
        replayedFrom,
        executed,
        reused,
        messages: [...messages, message],
        outputs,
      };
    }

    /* C-2¹²: what the phase wrote is now what its digest reads, and the chain goes on from there. */
    const key = handler.keyedAfterRun === true ? keyOf(upstream) : hash;
    if (!standalone) carried = key;
    outputs[phase] = outcome.outputs;
    writeCheckpoint(root, phase, key, outcome.outputs, { at: new Date(now()).toISOString() });
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
