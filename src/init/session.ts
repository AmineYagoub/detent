import { mkdirSync } from "node:fs";
import path from "node:path";
import { type RoleId } from "../schemas/roles.js";
import {
  artifactWriteRule,
  stablePrefix,
  type PromptSet,
  type SessionBackend,
  type SessionResult,
  type SessionSpec,
} from "../sessions/backend.js";
import { toolsForRole } from "../sessions/guard.js";
import { STRUCTURAL_PROTECTED } from "../schemas/common.js";
import { RunJournal } from "../kernel/journal.js";
import { SpendLedger, type ProgressBreaker } from "../kernel/ledger.js";
import { OUTAGE_BACKOFF_MS } from "../kernel/driver.js";
import type { LaunchBatch } from "./launch-batch.js";

/** Init has no ticket; this names the pipeline in the ledger and journal. */
const INIT_TICKET = "init";

/**
 * Session launching for the `init` pipeline.
 *
 * Simpler than the run loop's: init has no ticket and no per-generation
 * counters, so X-1's per-ticket session count — scoped to ticket/generation —
 * has no meaning here, and C-3a's tool-call ceiling budgets research instead.
 * What it keeps is S-1's role discipline (S-1′: the read-only surface plus one
 * scoped rule for its own artifact) and S-6's stable prefix.
 *
 * PRDR-088: what it ALSO keeps is the money. An earlier note here claimed
 * there was "nothing to charge" — false, and the hole it left was real:
 * ANALYZE, PLAN, REVIEW_PLAN and planning research are billable sessions, so
 * leaving them off the ledger meant `run_spend_usd` did not bound them (P6)
 * and a failed phase left nothing to diagnose. Every launch now passes the
 * D-25 gate, records an S-4 row, and journals its start and end.
 */

export interface InitSessionDeps {
  readonly root: string;
  readonly backend: SessionBackend;
  readonly prompts: PromptSet;
  /** PRDR-088: X-1's run ceiling — init spend counts against it like any other. */
  readonly spendCeiling: number;
  /**
   * X-1⁵ (PRDR-191): the no-progress breaker's two ceilings.
   *
   * Optional so existing callers keep compiling, but `pipeline.ts` supplies it:
   * without this the breaker read its schema defaults while the project's
   * config said otherwise — implemented, unit-tested and unreachable, which is
   * PRDR-141's shape and was caught here by three tests staying silent.
   */
  readonly progressBreaker?: ProgressBreaker;
  /** PRDR-114: the config's `model_routing`; the planner and planning research run on their routed models. */
  readonly modelRouting?: Readonly<Record<string, string>>;
  /** PRDR-197: the config's `effort_routing`, resolved per role like the model above. */
  readonly effortRouting?: Readonly<Record<string, string>>;
  readonly rulesText?: string;
  /** PRDR-185: injectable wait for the outage backoff; real time by default. */
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * PRDR-189: the clock the reset is measured against. AGENTS.md requires an
   * injectable seam wherever a decision reads the time, and "how long until the
   * limit resets" is a decision.
   */
  readonly now?: () => Date;
  /** PRDR-185: what an operator is told while init waits out a backend outage. */
  readonly note?: (text: string) => void;
  /** X-6/S-3 docs domains for research-capable init sessions. */
  readonly docsDomains?: readonly string[];
  /**
   * PRDR-203: the run journal, opened ONCE by whoever owns the phase and handed
   * to every launch in it.
   *
   * `launchOnce` used to open its own per launch and close it on the way out.
   * That is the same thing for as long as launches never overlap, and a refusal
   * the moment two do: `RunJournal.open` keeps an in-process set of roots —
   * F-1's single writer — so the second launch in flight threw
   * `JournalContendedError` before any session started. A root's one writer is
   * the PROCESS, which the lock decides; the run loop has opened one journal per
   * run since `kernel/run.ts` existed, and init now matches it (ARCH-2). Required,
   * not defaulted: a launch that could open its own would be the old behaviour
   * with a new name.
   */
  readonly journal: RunJournal;
}

export interface InitSessionRequest {
  readonly role: RoleId;
  readonly inputs: Record<string, unknown>;
  /** Absolute path the session writes its artifact to. */
  readonly artifactOut: string;
  /** C-3a: research capability for planning questions. */
  readonly withWeb?: boolean;
  /**
   * D-28′ (PRDR-203): the batch this launch belongs to, if any. The batch's
   * first launch evaluates the gate; the rest pass on that evaluation.
   */
  readonly batch?: LaunchBatch;
  /** PRDR-205: the artifact path the prompt names, when it is not `artifactOut`. See `SessionSpec.artifactTold`. */
  readonly artifactTold?: string;
}

/**
 * PRDR-203: one journal for a phase — opened before its first launch, closed
 * after its last, handed to every launch between. The shape `kernel/run.ts`
 * has always had for a run.
 */
export async function withInitJournal<T>(root: string, body: (journal: RunJournal) => Promise<T>): Promise<T> {
  const journal = RunJournal.open(root);
  try {
    return await body(journal);
  } finally {
    journal.close();
  }
}

function initSessionSpec(deps: InitSessionDeps, request: InitSessionRequest): SessionSpec {
  const preamble = JSON.stringify(
    { phase: "init", non_negotiables: "Only artifacts count. Write exactly the artifact named below (P2)." },
    null,
    2,
  );
  return {
    role: request.role,
    /* No ticket exists during init; the id names the pipeline for the journal. */
    ticketId: INIT_TICKET,
    promptPrefix: stablePrefix(deps.prompts.prompts[request.role], deps.rulesText ?? "(no rules file)", preamble),
    /* PRDR-205: the told path, so the sessions of one batch share one first turn. */
    promptVariable: JSON.stringify({ inputs: request.inputs, artifact_out: request.artifactTold ?? request.artifactOut }, null, 2),
    cwd: deps.root,
    artifactOut: request.artifactOut,
    /**
     * S-1′ (PRDR-067): the read-only surface plus exactly one write rule —
     * the session's own artifact. Plan mode would deny the write the
     * C-3/A-contract demands; read-only-ness is the allowlist plus the hook.
     */
    allowedTools: [
      ...(request.withWeb === true
        ? toolsForRole("research", deps.docsDomains ?? [])
        : toolsForRole(request.role, deps.docsDomains ?? [])),
      artifactWriteRule(request.artifactOut),
    ],
    permissionMode: "",
    model: deps.modelRouting?.[request.role] ?? "",
    ...(deps.effortRouting?.[request.role] === undefined ? {} : { effort: deps.effortRouting[request.role] }),
    /* C-4⁗‴ (PRDR-204): a batched launch reports its first answer to the batch waiting on it. */
    ...(request.batch === undefined ? {} : { onFirstResponse: request.batch.noteResponse }),
    ...(request.artifactTold === undefined ? {} : { artifactTold: request.artifactTold }),
    /**
     * S-1″ (PRDR-124): the per-session containment policy, so the one write
     * rule above is TRUE rather than merely stated.
     *
     * The allowlist granted exactly `Write(<artifact>)`, but the backend's
     * construction policy — the fallback the hook uses when a spec carries
     * none — was `surface: ["**"]`. A mutating call the guard clears returns
     * `allow`, which is terminal in the SDK's permission order, so the
     * allowlist was never consulted and a planner could write anywhere in the
     * repository. It did: asked for one artifact, it wrote its draft as
     * `state/plan/<slice>-part1.json` and `-part2.json`, and the phase then
     * found no artifact where it was told one would be.
     *
     * Reads are unaffected — non-mutating calls abstain (S-2‴) and `Read` is
     * allowlisted — so the surface here governs writes alone, which is exactly
     * what S-1′ always claimed.
     */
    policy: {
      surface: [path.relative(deps.root, request.artifactOut).split(path.sep).join("/")],
      /** SEC-3′ (PRDR-132): the same structural floor the run loop enforces, `.git/**` included. */
      protectedGlobs: [...STRUCTURAL_PROTECTED],
      workRoot: deps.root,
      /**
       * SEC-3 (PRDR-184): the session's own artifact, exempt from the floor
       * that would otherwise refuse it.
       *
       * `analysisPath` is `.detent/state/analysis.json`, and PRDR-149 added
       * `.detent/state/**` to `STRUCTURAL_PROTECTED` — correctly, it holds the
       * checkpoints and the run lock. Protected globs are consulted before the
       * surface, so from that moment every init session was DENIED the one
       * write it exists to make, and `init` died at ANALYZE with "produced no
       * analysis artifact". Found by a live run, and by nothing else: every
       * init test uses `MockBackend`, which writes artifacts with `fs` and
       * never runs the guard (PRDR-182 says so in as many words).
       *
       * The FILE, not its directory — `path.relative(file, file)` is `""` so
       * the exact path is allowed, while a sibling resolves to `../other.json`
       * and falls through to the floor. `.detent/state/` keeps every other
       * checkpoint immutable to the session.
       */
      artifactRoot: request.artifactOut,
    },
  };
}

/**
 * PRDR-185: a backend outage is waited out, not fatal.
 *
 * A session limit is the most ordinary interruption on a subscription plan, and
 * it is an OUTAGE — nothing about the work was wrong, the transport was briefly
 * unavailable. `kernel/driver.ts` has known that since PRDR-112: it backs off
 * 1, 5, 15 minutes and halts only on consecutive outages with no progress
 * between them. `init` had none of it, so four limit hits across one live
 * planning run each ended the command and needed a human to notice and restart.
 * ARCH-2: a control on one driver belongs on both.
 *
 * The message is matched rather than a typed error because the SDK returns a
 * limit as an error RESULT, not an exception — the same shape S-4 already reads
 * for crashes. Narrow on purpose: a phrase that does not match simply fails as
 * before, which is the harmless direction.
 */
const OUTAGE_MARKERS: readonly RegExp[] = [
  /session limit/i,
  /rate limit/i,
  /overloaded/i,
  /\b429\b/,
  /service unavailable/i,
  /\b50[0-9]\b.*(error|unavailable)/i,
];

export function isOutage(text: string): boolean {
  return OUTAGE_MARKERS.some((re) => re.test(text));
}

/**
 * PRDR-189: a usage limit names its own reset time — wait until THAT.
 *
 * PRDR-185's ladder is 1, 5, 15 minutes, which is right for a transient
 * outage and wrong for a usage window: observed live, the three retries
 * exhausted in 21 minutes against a limit that reset hours later, and the run
 * died having done everything correctly. The message carries the answer —
 * "resets 10:30pm (Africa/Algiers)" — and PRDR-185's own acceptance criteria
 * said the operator should be told "until when" while the code never read it.
 *
 * The ZONE is not decoration. Africa/Algiers is UTC+1 year-round and this
 * machine was on CEST (UTC+2) when the limit hit, so reading "10:30pm" as local
 * time would wait an hour early and fail again — a retry that looks like it
 * honoured the reset and did not. The current time is taken IN the named zone
 * and the delta computed there, which needs no date arithmetic.
 */
export function msUntilReset(message: string, now: Date = new Date()): number | null {
  const m = /resets\s+(\d{1,2}):(\d{2})\s*(am|pm)?(?:\s*\(([A-Za-z]+\/[A-Za-z_]+)\))?/i.exec(message);
  if (m === null) return null;
  const minute = Number(m[2]);
  const meridiem = m[3]?.toLowerCase();
  let hour = Number(m[1]);
  if (meridiem === "pm" && hour !== 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;

  let hereNow: string;
  try {
    hereNow = new Intl.DateTimeFormat("en-GB", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      ...(m[4] === undefined ? {} : { timeZone: m[4] }),
    }).format(now);
  } catch {
    /* An unknown zone is not a parse failure; fall back to this machine's clock. */
    hereNow = new Intl.DateTimeFormat("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit" }).format(now);
  }
  const [nowHour, nowMinute] = hereNow.split(":").map(Number) as [number, number];
  let deltaMinutes = hour * 60 + minute - (nowHour * 60 + nowMinute);
  /* Already past in that zone means the next occurrence is tomorrow. */
  if (deltaMinutes <= 0) deltaMinutes += 24 * 60;
  /* A minute past the stated time, so a clock a few seconds behind does not retry early. */
  return deltaMinutes * 60_000 + 60_000;
}

/**
 * The longest this will wait for a named reset before handing the decision
 * back. A usage window resets within hours; a wait longer than this is more
 * likely a misparse or a clock problem than a real reset, and an operator would
 * rather be told than discover a command that slept until tomorrow.
 */
export const MAX_RESET_WAIT_MS = 6 * 60 * 60_000;

export async function launchInitSession(deps: InitSessionDeps, request: InitSessionRequest): Promise<SessionResult> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await launchOnce(deps, request);
    } catch (err) {
      const message = (err as Error).message;
      const ladder = OUTAGE_BACKOFF_MS[attempt];
      if (!isOutage(message) || ladder === undefined) throw err;
      /**
       * PRDR-189: the stated reset wins over the ladder.
       *
       * A usage limit is not a transient outage — 1/5/15 minutes exhausted
       * against one that reset hours later, and the run died having behaved
       * correctly at every step. When the message says when it comes back, that
       * is the wait; the ladder remains for outages that say nothing.
       */
      const untilReset = msUntilReset(message, deps.now?.());
      if (untilReset !== null && untilReset > MAX_RESET_WAIT_MS) {
        throw new Error(
          `${message} — it resets in ${String(Math.round(untilReset / 60_000))} min, longer than this will wait ` +
            `(${String(MAX_RESET_WAIT_MS / 60_000)} min). Re-run when the window has reset; every finished slice and redraft is checkpointed.`,
        );
      }
      const wait = untilReset ?? ladder;
      const mins = String(Math.round(wait / 60_000));
      deps.note?.(
        untilReset === null
          ? `backend outage during ${request.role} — waiting ${mins} min before retrying ` +
              `(${String(attempt + 1)}/${String(OUTAGE_BACKOFF_MS.length)}): ${message.slice(0, 160)}`
          : `backend limit during ${request.role} — waiting ${mins} min for the stated reset ` +
              `(${String(attempt + 1)}/${String(OUTAGE_BACKOFF_MS.length)}): ${message.slice(0, 160)}`,
      );
      await sleep(wait);
    }
  }
}

async function launchOnce(deps: InitSessionDeps, request: InitSessionRequest): Promise<SessionResult> {
  mkdirSync(path.dirname(request.artifactOut), { recursive: true });

  /* PRDR-203: the phase's journal, never this launch's own — see `InitSessionDeps.journal`. */
  const journal = deps.journal;
  const ledger =
    deps.progressBreaker === undefined
      ? new SpendLedger(deps.root, journal, deps.spendCeiling)
      : new SpendLedger(deps.root, journal, deps.spendCeiling, deps.progressBreaker, deps.note);
  /*
   * D-25: the ceiling is a launch gate, evaluated here and never mid-flight.
   * D-28′ (PRDR-203): a batch is gated once, by the first of its launches the
   * gate lets through; `passed` is set only after the gate did not throw.
   */
  if (request.batch === undefined || !request.batch.passed) {
    ledger.assertLaunchAllowed();
    if (request.batch !== undefined) request.batch.passed = true;
  }
  journal.appendTicketEvent(INIT_TICKET, { stage: request.role, event: "start", at: new Date().toISOString() });
  const result = await deps.backend.run(initSessionSpec(deps, request));
  ledger.record(INIT_TICKET, 0, request.role, result, new Date().toISOString());
  journal.appendTicketEvent(INIT_TICKET, {
    stage: request.role,
    event: "end",
    at: new Date().toISOString(),
    ok: result.ok,
    turns: result.turns,
    cost: result.costEstimateUsd,
    ...(result.crashed === true ? { partial: "crash" } : {}),
    ...(result.rawTail === "" ? {} : { tail: result.rawTail.slice(-500) }),
  });

  if (!result.ok) {
    /*
     * T-140: a failed session must fail its phase WITH the reason — before
     * this, a crashed analyst (PRDR-053 wrap) surfaced as the misleading
     * "produced no analysis artifact".
     */
    throw new Error(
      `${request.role} session failed${result.rawTail === "" ? "" : `: ${result.rawTail.slice(-300)}`}`,
    );
  }
  /**
   * S-4′ (PRDR-118): the same circuit breaker the run loop applies. A stream
   * that ends with no result message parses as `is_error: undefined`, which
   * reads as SUCCESS with no telemetry — so a session killed in transport
   * returned ok, recorded $0 against the ceiling, and its phase then reported
   * "produced no artifact", blaming the model for a death on the wire. The
   * run loop has caught this since T-046; init never looked.
   */
  if (!result.telemetryParsed) {
    throw new Error(
      `${request.role} session ended with no telemetry (S-4 circuit breaker) — the session died in transport rather than producing an artifact. ` +
        "Nothing was charged against the run ceiling, so its cost is unrecorded; re-run `detent init` to resume (C-8).",
    );
  }
  return result;
}
