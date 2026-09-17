import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { ARTIFACT_ONLY_ROLES, READ_ONLY_ROLES, roleForState, type RoleId, type SessionState } from "../schemas/roles.js";
import type { Ticket } from "../schemas/ticket.js";
import { STRUCTURAL_PROTECTED, coversProtected, isConcreteRepoPath, repoPathKey } from "../schemas/common.js";
import { artifactWriteRule, prefixHash, stablePrefix, type SessionSpec } from "../sessions/backend.js";
import { enforceBaseGuard } from "./git.js";
import { runsDir } from "./journal.js";
import { currentCounters, currentGeneration, withCurrentCounters } from "./generations.js";
import { Breach, KernelBoundaryError, SessionRefusal, type RefereeContext } from "./referee-context.js";
import type { FalsifiedSignal } from "./dependency.js";
import { readTicket } from "./tickets/readers.js";
import { appendNote, writeTicket } from "./tickets/mutations.js";
import { assertTicketWallClock } from "./ticket-clock.js";
import { scrub } from "./scrub.js";
import { recordEffort } from "./session-effort.js";
import { attemptInputs } from "./session-inputs.js";

/**
 * T-104 — the session arm (R-4, S-2…S-6, D-25, B-3/P7, SEC-3).
 *
 * The referee's ONLY path to the backend: the spend launch gate, the X-1
 * net-session backstop, the ledger record, the S-6 prefix pin, the P7
 * base-guard sweep, and SEC-3's surface-request lever all live around the one
 * `backend.run` call. Arms above (core, stages) launch through here; nothing
 * else in the tree may construct a `SessionSpec`.
 */
/** PRDR-090: consecutive crashed sessions that mean "outage", not "hard ticket". */
const CRASH_STREAK_HALT = 3;

export class SessionArm {
  private readonly prefixSeen = new Map<string, string>();
  private consecutiveCrashes = 0;
  /** PRDR-112: the sessions of the current streak, so an outage can name its victims. */
  private streak: { readonly id: string; readonly role: string; readonly at: string }[] = [];

  constructor(private readonly ctx: RefereeContext) {}

  /** PRDR-236: assembled in `session-inputs.ts`; this stays the arm's public entry. */
  attemptInputs(ticket: Ticket, state: SessionState, workDir: string): Record<string, unknown> {
    return attemptInputs(this.ctx, ticket, state, workDir);
  }

  async launch(ticket: Ticket, state: SessionState, inputs: Record<string, unknown>, workDir: string): Promise<number> {
    const ctx = this.ctx;
    const role = roleForState(state);
    const id = ticket.id;
    /** B-5′ (PRDR-131): the crash skip belongs to the generation that crashed, not to the ticket. */
    const openGen = currentGeneration(ticket).index;
    if (ctx.journal.unfinished(id, role, openGen)) {
      ctx.journal.appendTicketEvent(id, { stage: role, event: "skipped_after_crash", at: ctx.iso(), generation: openGen });
      /** PRDR-250: no session ran, so it consumed no turns. */
      return 0;
    }

    /*
     * D-25 was "the spend ceiling is a launch gate, evaluated here and never
     * mid-flight". PRDR-265: it is a launch RECORD. The figures are read and
     * announced once; nothing here refuses.
     */
    ctx.spend.recordLaunch();

    /**
     * X-1⁗ (PRDR-140): the wall clock is enforced HERE, at the launch seam,
     * where `sessions` above and `run_spend_usd` already live — so both drivers
     * inherit it. It had exactly one enforcement site, `driver.ts`'s headless
     * loop, while `skills/run/SKILL.md` — the published program the model-driven
     * driver executes — has no time check at all. ARCH-2's parity is proved on
     * an all-green fixture, so the drivers agreeing there said nothing about a
     * ceiling only one of them implemented.
     *
     * The clock is the CLAIM's own timestamp: the generation's `started_at`
     * would date from a requeue that may be days old, and a ticket planned last
     * week must not breach the moment it is first claimed.
     *
     * PRDR-246: the computation moved to `ticket-clock.ts` when `evaluate`
     * turned out to need the same one. A launch is not the only thing a driver
     * asks the referee to start.
     */
    assertTicketWallClock(ctx, id);

    let current = readTicket(ctx.root, id);
    /*
     * PRDR-265: `ctx.budgets.sessions` is COUNTED here, not enforced. Its own
     * message called it "a backstop against a kernel accounting defect", which
     * is a budget and not a sequencer: it ordered nothing, and what bounds a
     * generation is the escalation ladder plus `maxPossibleSessions`'s walk over
     * the transition table. The increment below is untouched — it is the number
     * the dossier, `cli/status` and `cli/report` all live on.
     */
    const counters = currentCounters(current);
    const generation = currentGeneration(current);
    current = {
      ...current,
      generations: withCurrentCounters(current.generations, generation.index, { ...counters, sessions: counters.sessions + 1 }),
    };
    writeTicket(ctx.root, current);

    const artifactOut = path.join(runsDir(ctx.root, id), artifactNameFor(role));
    mkdirSync(path.dirname(artifactOut), { recursive: true });
    /* PRDR-221: a session with a symbol server is told, in the variable part only (S-6). */
    const symbols = ctx.symbolTools();
    const spec: SessionSpec = {
      role,
      ticketId: id,
      promptPrefix: this.prefixFor(role),
      promptVariable: JSON.stringify(
        {
          inputs: symbols.length === 0 ? inputs : { ...inputs, symbol_tools: symbols },
          artifact_out: artifactOut,
          falsified_out: path.join(runsDir(ctx.root, id), "falsified.json"),
          oversized_out: path.join(runsDir(ctx.root, id), "oversized.json"),
          surface_request_out: path.join(runsDir(ctx.root, id), "surface_request.json"),
        },
        null,
        2,
      ),
      cwd: workDir,
      artifactOut,
      /**
       * S-1′ (PRDR-067): a read-only role writes exactly its artifact —
       * default mode plus one scoped rule; plan mode would block the write
       * the A-contract demands.
       */
      allowedTools: READ_ONLY_ROLES.has(role)
        ? [...this.toolsFor(role), ...symbols, artifactWriteRule(artifactOut)]
        : [...this.toolsFor(role), ...symbols],
      /**
       * S-3′ (PRDR-121): the optional symbol server, when one is configured
       * and runnable. Read tools only — its editing tools write from inside
       * the server process, where the D-21 hook below cannot see them.
       */
      ...ctx.symbolServer(workDir),
      permissionMode: "",
      model: ctx.loaded.config.model_routing[role] ?? "",
      /* PRDR-197: ARCH-2 — the loop routes effort exactly as init does, or neither driver has it. */
      ...(ctx.loaded.config.effort_routing[role] === undefined ? {} : { effort: ctx.loaded.config.effort_routing[role] }),
      /**
       * S-2′/D-21: the per-ticket hook policy. Surface = the ticket's declared
       * surface plus ONLY the runs area, where artifact/falsified/surface-
       * request outs live — never `.detent/**` broadly. Protected = the
       * project's globs plus a STRUCTURAL floor (SEC-3): tickets, config,
       * bindings, and the plan are immutable to sessions even if a config
       * under-declares its protected set.
       */
      policy: {
        /**
         * S-1′ (PRDR-170): a read-only role's surface is its ARTIFACT, not the
         * ticket's code.
         *
         * `allowedTools` is narrowed for these roles three lines above and the
         * policy was not — while `sdk.ts`'s own comment records that a hook
         * answering `allow` "ended the evaluation and overrode `allowedTools`",
         * and that hook emits `permissionDecision` for every non-abstain
         * decision. So the guard, the layer this project treats as
         * authoritative, handed review/diagnose/research an unconditional allow
         * to edit the implementation they exist to judge independently.
         * PRDR-124 fixed this shape in `init/session.ts`. PRDR-178 then
         * narrowed the SET: `diagnose` is read-only but its prompt grants a
         * reproduction test inside the ticket surface, so narrowing it denied a
         * write the vendored prompt promises. `review` and `research` grant
         * only their artifact.
         */
        /*
         * PRDR-228: the artifact area is `artifactRoot` below — the ROOT's runs
         * directory for this ticket — and nothing else. `.detent/runs/**` here
         * resolved against the WORK ROOT, which under B-2″ is the worktree, so a
         * session's write to its worktree-relative runs path was admitted,
         * finalize staged it, and t-s01-007's artifact merged into the product.
         */
        surface: ARTIFACT_ONLY_ROLES.has(role) ? [] : [...ticket.surface],
        protectedGlobs: [...ctx.loaded.config.protected, ...STRUCTURAL_PROTECTED],
        workRoot: workDir,
        /**
         * B-2″ (PRDR-180): where this session's artifact goes, which is under
         * the ROOT while `workRoot` is the per-ticket worktree. Without it the
         * guard denied every review, diagnose and research artifact in the
         * default configuration — the write those roles exist to produce.
         */
        artifactRoot: runsDir(ctx.root, id),
      },
    };

    /**
     * T-140 (PRDR-072): a stale artifact from an earlier round must never
     * impersonate this session's output — a refused reviewer replayed the
     * previous verdict live. Freshly launched means freshly derived; the
     * crashed-resume skip above deliberately KEEPS its artifact (B-5 judges
     * what the half-done session left).
     */
    rmSync(artifactOut, { force: true });
    /*
     * PRDR-225: the signals a session writes and the referee consumes are
     * cleared here too, or a stale one impersonates this session — gate-313's
     * t-s01-004 review-fix wrote `falsified.json` (a stage that never consumes
     * one), it survived a requeue, and the next generation's implementer, which
     * wrote nothing, was falsified against it. `oversized.json` is NOT cleared:
     * it is cross-run evidence sizing-evidence reads for a later PLAN (X-4″).
     * The crash-resume skip returns above, so a genuinely in-flight session's
     * signal is kept for B-5, exactly as its artifact is.
     */
    for (const s of ["falsified.json", "surface_request.json"]) rmSync(path.join(runsDir(ctx.root, id), s), { force: true });
    const routedEffort = ctx.loaded.config.effort_routing[role] ?? "default";
    ctx.journal.appendTicketEvent(id, {
      stage: role,
      event: "start",
      at: ctx.iso(),
      /** B-5′: which generation this session belongs to — the fact the skip needs and never had. */
      generation: generation.index,
      /* The audit trail names the prompt that actually ran. */
      prompt: `${role}@${ctx.prompts.hashes[role]}`,
      /**
       * PRDR-235: the effort this session was launched with.
       *
       * PRDR-197 mirrored the SDK's closed set of levels and justified it with
       * "a configured effort is recorded per session rather than assumed to
       * have been honoured" (`src/schemas/roles.ts`) — a mechanism that was
       * never written. The models half is fully observed: `models` on the
       * ledger row, `model_fallback` in this journal, a note on the ticket. So
       * a reader could always answer which MODEL ran and never which effort.
       *
       * `"default"` rather than an omitted key, because the two facts a reader
       * must tell apart are "no level was routed, so the SDK's own default
       * governed" and "this build did not record it" — an absent field says
       * both. What the SDK settled on AFTER any silent downgrade is a further
       * fact, exposed to hooks as `effort.level`, and PRDR-237 reads it below.
       */
      effort: routedEffort,
    });
    const result = await ctx.backend.run(spec);
    /** PRDR-237: what the session RAN at, against what it was asked for. */
    recordEffort(ctx.journal, ctx.root, id, role, generation.index, ctx.iso(), routedEffort, result.effort);
    if (result.modelFallback !== undefined) {
      /* PRDR-114: the routing asked for a model this runtime cannot serve; the ledger's `models` says what ran. */
      const { requested } = result.modelFallback;
      /* SEC-4 (PRDR-169): a runtime string echoed into a committed note and the journal. */
      const reason = scrub(result.modelFallback.reason);
      appendNote(ctx.root, id, {
        author: "kernel",
        text: `model fallback (PRDR-114): ${role} is routed to ${requested}, unavailable on this runtime (${reason}) — ran on the runtime default`,
      });
      ctx.journal.appendTicketEvent(id, { stage: role, event: "model_fallback", at: ctx.iso(), requested, reason });
    }
    if (result.mcpFailures !== undefined && result.mcpFailures.length > 0) {
      /* S-3‴ (PRDR-123): the session ran without tools it was configured to have. */
      const lost = result.mcpFailures.map((s) => `${s.name} (${s.status})`).join(", ");
      appendNote(ctx.root, id, {
        author: "kernel",
        text: `MCP server unavailable to this session (PRDR-123): ${lost} — it ran without those tools; nothing failed, but symbol intelligence was not in play`,
      });
      ctx.journal.appendTicketEvent(id, { stage: role, event: "mcp_unavailable", at: ctx.iso(), servers: lost });
    }
    /**
     * S-4″ (PRDR-138): a stream that ended with no result message parses as
     * `ok: true` with `telemetryParsed: false` and no `crashed` flag — so the
     * ledger took a $0 row with no `partial: "crash"`, the journal recorded a
     * successful end for a session that died on the wire, and the success
     * branch below RESET the outage streak. A repeated backend outage could
     * therefore never reach CRASH_STREAK_HALT. The init path already treats
     * this as a death (S-4′); this brings the kernel to the same rule rather
     * than inventing a second one.
     */
    const outcome = result.telemetryParsed ? result : { ...result, ok: false, crashed: true };
    const generationNow = currentGeneration(readTicket(ctx.root, id));
    ctx.spend.record(id, generationNow.index, role, outcome, ctx.iso());
    ctx.journal.appendTicketEvent(id, {
      stage: role,
      event: "end",
      at: ctx.iso(),
      generation: generationNow.index,
      ok: outcome.ok,
      cost: outcome.costEstimateUsd,
    });
    /**
     * T-140 (PRDR-072): crashed with ZERO turns = the backend refused the
     * session (auth outage, usage limit, spawn failure) — an infrastructure
     * failure, not an attempt. Marching on converts an outage into fake
     * history: gates re-green unchanged trees, ladder slots burn, reviews of
     * never-run work escalate tickets. The ledger keeps its honest $0 row
     * (recorded above); the run halts. A crash WITH turns keeps PRDR-053's
     * behavior — real partial work exists and the tree is judged as-is.
     */
    if (outcome.crashed === true && outcome.turns === 0) {
      throw new SessionRefusal(
        /* SEC-4 (PRDR-169): rawTail is the model's own final message. */
        `backend refused ${role} session for ${id} (crashed, zero turns): ${scrub(result.rawTail.slice(-300))}`,
      );
    }

    /**
     * PRDR-090: an outage that crashes sessions WITH turns slips past the rule
     * above by design — PRDR-053 says partial work exists, judge the tree. One
     * such crash is plausible. A RUN of them is a backend outage wearing the
     * costume of work: observed live, nineteen consecutive crashed sessions at
     * $0.00 raced nine tickets through blind fix and research into NEEDS_HUMAN
     * in minutes, burning ladder slots on failures nobody committed. The
     * distinguishing signal is consecutiveness, so that is what is counted; any
     * session that returns real work resets it.
     */
    if (outcome.crashed === true) {
      this.consecutiveCrashes += 1;
      this.streak.push({ id, role, at: ctx.iso() });
      if (this.consecutiveCrashes >= CRASH_STREAK_HALT) {
        this.markOutage();
        throw new SessionRefusal(
          `backend outage: ${this.consecutiveCrashes} consecutive crashed sessions (last: ${role} for ${id}) — ` +
            `halting rather than burning ladder budget on failures no session produced`,
        );
      }
    } else {
      this.consecutiveCrashes = 0;
      this.streak = [];
    }
    this.rememberPrefix(role, spec);

    /**
     * P7: a session is Detent's act, and Detent never writes the base branch.
     * The S-2 hook prevents; this is the referee's independent line (P2) — any
     * moved non-run ref is restored and the ticket escalates.
     */
    const violations = enforceBaseGuard(ctx.root, ctx.refs, ctx.runBranch.branch);
    if (violations.length > 0) {
      const detail = violations.map((v) => `${v.ref}: ${v.was} -> ${v.became ?? "(deleted)"}`).join("; ");
      appendNote(ctx.root, id, { author: "kernel", text: `base-branch write detected and reverted (B-3/P7): ${detail}` });
      throw new Breach(`base-branch write detected and reverted (B-3/P7): ${detail}`);
    }

    /**
     * SEC-3 (PRDR-178): a read-only role's surface request is REMOVED, not left
     * for someone else to consume.
     *
     * The hook's deny message tells a session to write `surface_request.json`,
     * and this skipped handling it for read-only roles — so the file survived
     * on disk and the NEXT implement session picked it up, widening the
     * implementer's surface from a request it never made, with a grant note
     * reading as though it had.
     */
    if (READ_ONLY_ROLES.has(role)) this.discardSurfaceRequest(id);
    else this.handleSurfaceRequest(id);
    if (!result.telemetryParsed) throw new Breach("telemetry unparsable (S-4 circuit breaker)");
    /**
     * X-1 (PRDR-250): the observed turn count, for the one ceiling that reads it
     * back. Callers that do not bound turns ignore it; `researchStage` compares
     * it against `failure_research_tool_calls`.
     */
    return result.turns;
  }

  /**
   * SEC-3's lever: the hook denies and points here; the REFEREE decides.
   * Granting appends to the ticket surface (logged); protected paths and a
   * grant budget of three are hard limits.
   */
  /**
   * SEC-3 (PRDR-178): a read-only role's surface request never becomes someone
   * else's grant.
   *
   * The hook's deny text names `surface_request.json`, so a read-only session
   * that hits the boundary writes one — and nothing consumed it, so it sat
   * there until the next IMPLEMENT session on the same ticket, which did. The
   * implementer's surface widened from a request it never made. Removing it is
   * the whole fix: a read-only role has no surface to widen, and the note the
   * session left is already in the journal.
   */
  private discardSurfaceRequest(ticketId: string): void {
    rmSync(path.join(runsDir(this.ctx.root, ticketId), "surface_request.json"), { force: true });
  }

  private handleSurfaceRequest(ticketId: string): void {
    const ctx = this.ctx;
    const file = path.join(runsDir(ctx.root, ticketId), "surface_request.json");
    if (!existsSync(file)) return;
    let request: { path?: string; justification?: string };
    try {
      request = JSON.parse(readFileSync(file, "utf8")) as typeof request;
    } catch {
      request = {};
    }
    rmSync(file, { force: true });
    const target = (request.path ?? "").trim();
    const why = (request.justification ?? "").slice(0, 200);
    const ticket = readTicket(ctx.root, ticketId);
    const grants = ticket.notes.filter((n) => n.text.startsWith("surface granted:")).length;

    /**
     * SEC-3′ (PRDR-132): the same floor the POLICY enforces, plus the
     * requirement that a request name a path at all. This consulted
     * `config.protected` alone and never checked the value's shape, so `**`,
     * `.git/**` and `/etc/**` were all granted.
     */
    const floor = [...ctx.loaded.config.protected, ...STRUCTURAL_PROTECTED];
    const key = repoPathKey(target);
    const isProtected = key !== "" && (picomatch.isMatch(key, floor, { dot: true }) || coversProtected(key, floor));
    /**
     * SEC-3 (PRDR-183): the note names WHICH rule refused, and survives an
     * empty request.
     *
     * It was `surface DENIED: ${target} (${why})`, so a request arriving with
     * no `path` rendered as `surface DENIED:  ()` — a denial that does not say
     * what was denied or why. Observed live: a session hit a real blocker,
     * asked for a widening twice, and left two notes carrying no path, one of
     * them no justification either. Three different refusals also read
     * identically, so an operator could not tell "you named no path" from
     * "that path is protected" from "you have had your three".
     */
    if (!isConcreteRepoPath(target) || isProtected || grants >= 3) {
      const refusal =
        target === ""
          ? "the request named no path"
          : !isConcreteRepoPath(target)
            ? `\`${target}\` is not a concrete repository path — one path, no globs`
            : isProtected
              ? `\`${target}\` is protected and stays immutable to sessions`
              : `the grant budget of three is exhausted (already granted ${String(grants)})`;
      const said = why.trim() === "" ? "" : ` — the session said: ${why.trim()}`;
      appendNote(ctx.root, ticketId, { author: "kernel", text: `surface DENIED: ${refusal}${said} (SEC-3)` });
      return;
    }
    /* PRDR-227: the effective surface widens; the approved projection subtracts `granted`, so the approval stands. */
    writeTicket(ctx.root, { ...ticket, surface: [...ticket.surface, target], granted: [...ticket.granted, target] });
    appendNote(ctx.root, ticketId, { author: "kernel", text: `surface granted: ${target} — ${why} (SEC-3)` });
  }

  /**
   * PRDR-112: an outage names its victims. Every ticket whose session crashed
   * inside the streak gets a note the pool's sweep recognises — a ticket the
   * outage pushed into NEEDS_HUMAN is re-queued on resume, because "not a
   * finding against this ticket" is a sentence the operator typed twelve
   * times across three gates. The run journal keeps the window and the list.
   */
  private markOutage(): void {
    const ctx = this.ctx;
    const first = this.streak[0]?.at ?? ctx.iso();
    const last = this.streak.at(-1)?.at ?? ctx.iso();
    ctx.journal.appendTicketEvent("run", {
      event: "outage",
      at: ctx.iso(),
      from: first,
      to: last,
      sessions: this.streak.map((s) => ({ ticket: s.id, role: s.role, at: s.at })),
    });
    for (const id of new Set(this.streak.map((s) => s.id))) {
      const roles = this.streak.filter((s) => s.id === id).map((s) => s.role).join(", ");
      appendNote(ctx.root, id, {
        author: "kernel",
        text: `outage: ${this.streak.length} consecutive $0 crashes between ${first} and ${last}; this ticket's ${roles} crashed inside it — not a finding against the ticket (PRDR-112)`,
      });
    }
    this.streak = [];
  }

  /**
   * X-4″ (PRDR-102): the session signalled that the ticket is larger than one
   * session, with the split it proposes. The file STAYS — it is the evidence
   * the next PLAN of these documents receives — and the note carries the
   * proposal to the human the ticket goes to.
   */
  consumeOversizedSignal(ticketId: string): { note: string; split: string[] } | null {
    const ctx = this.ctx;
    const file = path.join(runsDir(ctx.root, ticketId), "oversized.json");
    if (!existsSync(file)) return null;
    let note = "oversized";
    let split: string[] = [];
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { note?: unknown; split?: unknown };
      /* SEC-4 (PRDR-169): session-authored free text. */
      if (typeof parsed.note === "string" && parsed.note.trim() !== "") note = scrub(parsed.note.trim());
      if (Array.isArray(parsed.split)) split = parsed.split.filter((p): p is string => typeof p === "string" && p.trim() !== "").map((p) => p.trim());
    } catch {
      /* the signal's existence is the event; the proposal is best-effort */
    }
    const proposal = split.length === 0 ? "no split proposed" : split.map((p, i) => `${i + 1}) ${p}`).join(" ");
    appendNote(ctx.root, ticketId, { author: "kernel", text: `oversized (X-4″): ${note} — proposed split: ${proposal}` });
    ctx.journal.appendTicketEvent(ticketId, { event: "oversized", at: ctx.iso(), note, split });
    return { note, split };
  }

  /**
   * X-4: the session signalled falsification by writing the signal file.
   * X-4′ (PRDR-111): it may name the paths it is missing; the referee decides
   * whether that is a dependency or a human's.
   */
  consumeFalsifiedSignal(ticketId: string): FalsifiedSignal | null {
    const ctx = this.ctx;
    const file = path.join(runsDir(ctx.root, ticketId), "falsified.json");
    if (!existsSync(file)) return null;
    let note = "premise falsified";
    let missing: string[] = [];
    let retracted = false;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { note?: unknown; missing?: unknown; retracted?: unknown };
      /* SEC-4 (PRDR-169): the session wrote this file; its free text is scrubbed before a note or journal event carries it. */
      if (typeof parsed.note === "string" && parsed.note !== "") note = scrub(parsed.note);
      if (Array.isArray(parsed.missing)) {
        missing = parsed.missing.filter((m): m is string => typeof m === "string" && m.trim() !== "").map((m) => m.trim());
      }
      /* X-4‴ (PRDR-212): the boolean `true`, and only that — prose inside a standing signal is still a signal. */
      retracted = parsed.retracted === true;
    } catch {
      /* the signal's existence is the event; the note is best-effort */
    }
    rmSync(file, { force: true });
    /**
     * X-4‴ (PRDR-212): a falsification its author took back is no
     * falsification. gate-313's bootstrap session wrote the signal on the
     * strength of a permission wall it had not been told about, finished the
     * ticket, and wrote the retraction into the signal; the referee read a file
     * and admitted PREMISE_FALSIFIED. A session cannot delete a file, so the
     * retraction is an overwrite, and it is a field. Recorded in both places a
     * human reads: the ticket's notes and its journal.
     */
    if (retracted) {
      appendNote(ctx.root, ticketId, { author: "kernel", text: `falsification withdrawn by the session: ${note}` });
      ctx.journal.appendTicketEvent(ticketId, { event: "falsification_withdrawn", at: ctx.iso(), note });
      return null;
    }
    const detail = missing.length === 0 ? note : `${note} — missing: ${missing.join(", ")}`;
    appendNote(ctx.root, ticketId, { author: "kernel", text: `falsified mid-implementation: ${detail}` });
    return { note, missing };
  }

  /**
   * S-6: a role's prompt prefix is byte-identical within a run. One prompt per
   * role (PRDR-093 removed the variant layer), so the role IS the prompt
   * identity S-6 pins.
   *
   * PRDR-172: this used to claim it "catches a prompt file edited mid-flight",
   * and it does not. `prefixFor`'s three inputs are all `readonly`, assigned
   * once in `RefereeContext`'s constructor, which is itself constructed once
   * per run at both production call sites — so for a fixed role the mismatch
   * branch is unreachable by construction. Editing `AGENTS.md` mid-run was
   * observed to neither throw nor be noticed; the next session silently used
   * the stale rules text. S-6 in the PRD is a prompt-CACHE-efficiency
   * invariant, not a file-edit detector, and this assertion is what makes the
   * caching claim honest: a tripwire on an assumption, not a watcher. Detecting
   * a mid-run prompt edit would need the prefix re-derived per session, which
   * is a different change with its own cache cost.
   */
  private rememberPrefix(role: RoleId, spec: SessionSpec): void {
    const seen = this.prefixSeen.get(role);
    const hash = prefixHash(spec);
    if (seen !== undefined && seen !== hash) {
      throw new KernelBoundaryError(`S-6 violated: role ${role} prefix hash moved within a run`);
    }
    this.prefixSeen.set(role, hash);
  }

  private prefixFor(role: RoleId): string {
    return stablePrefix(this.ctx.prompts.prompts[role], this.ctx.rulesText, this.ctx.bindingsPreamble);
  }

  private toolsFor(role: RoleId): readonly string[] {
    /**
     * The referee's advisory copy; the SDK backend composes the enforced set
     * (sessions/guard.ts), including domain-scoped WebFetch once PRDR-062
     * gives docs domains a config home.
     */
    if (READ_ONLY_ROLES.has(role)) {
      return role === "research" ? ["Read", "Grep", "Glob", "WebSearch"] : ["Read", "Grep", "Glob"];
    }
    return ["Read", "Grep", "Glob", "Edit", "Write", "Bash(git add:*)", "Bash(git commit:*)"];
  }
}

function artifactNameFor(role: string): string {
  if (role === "diagnose") return "hypothesis.json";
  if (role === "research") return "research.json";
  if (role === "review") return "review.json";
  return `${role}.json`;
}
