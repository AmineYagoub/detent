import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { READ_ONLY_ROLES, roleForState, type RoleId, type SessionState } from "../schemas/roles.js";
import type { Ticket } from "../schemas/ticket.js";
import { artifactWriteRule, prefixHash, stablePrefix, type SessionSpec } from "../sessions/backend.js";
import { enforceBaseGuard } from "./git.js";
import { runsDir } from "./journal.js";
import { currentCounters, currentGeneration, withCurrentCounters } from "./generations.js";
import { Breach, KernelBoundaryError, SessionRefusal, publicTicket, type RefereeContext } from "./referee-context.js";
import { readTicket } from "./tickets/readers.js";
import { appendNote, writeTicket } from "./tickets/mutations.js";

/**
 * T-104 — the session arm (R-4, S-2…S-6, D-25, B-3/P7, SEC-3).
 *
 * The referee's ONLY path to the backend: the spend launch gate, the X-1
 * net-session backstop, the ledger record, the S-6 prefix pin, the P7
 * base-guard sweep, and SEC-3's surface-request lever all live around the one
 * `backend.run` call. Arms above (core, stages) launch through here; nothing
 * else in the tree may construct a `SessionSpec`.
 */
export class SessionArm {
  private readonly prefixSeen = new Map<string, string>();

  constructor(private readonly ctx: RefereeContext) {}

  /** Inputs for the driver-launched attempt states, exactly as v2 assembled them. */
  attemptInputs(ticket: Ticket, state: SessionState, workDir: string): Record<string, unknown> {
    switch (state) {
      case "IN_PROGRESS":
        return { ticket: publicTicket(ticket) };
      case "INFORMED_FIX":
        return { ...this.fixInputs(ticket, workDir), research: this.ctx.maybeArtifact(ticket.id, "research.json") };
      case "REVIEW_FIX":
        return { ...this.fixInputs(ticket, workDir), review: this.ctx.maybeArtifact(ticket.id, "review.json") };
      default:
        return this.fixInputs(ticket, workDir);
    }
  }

  fixInputs(ticket: Ticket, workDir: string): Record<string, unknown> {
    return {
      ticket: publicTicket(ticket),
      failure: this.ctx.maybeArtifact(ticket.id, "last_failure.json"),
      hypothesis: this.ctx.maybeArtifact(ticket.id, "hypothesis.json"),
      diff: this.ctx.diff(workDir),
    };
  }

  async launch(ticket: Ticket, state: SessionState, inputs: Record<string, unknown>, workDir: string): Promise<void> {
    const ctx = this.ctx;
    const role = roleForState(state);
    const id = ticket.id;
    if (ctx.journal.unfinished(id, role)) {
      ctx.journal.appendTicketEvent(id, { stage: role, event: "skipped_after_crash", at: ctx.iso() });
      return;
    }

    /*
     * D-25: the spend ceiling is a launch gate, evaluated here and never
     * mid-flight — overshoot is bounded by the one session in flight.
     */
    ctx.spend.assertLaunchAllowed();

    let current = readTicket(ctx.root, id);
    const counters = currentCounters(current);
    if (counters.sessions >= ctx.budgets.sessions) {
      throw new Breach("net session ceiling (X-1) — backstop against a kernel accounting defect");
    }
    const generation = currentGeneration(current);
    current = {
      ...current,
      generations: withCurrentCounters(current.generations, generation.index, {
        ...counters,
        sessions: counters.sessions + 1,
      }),
    };
    writeTicket(ctx.root, current);

    const artifactOut = path.join(runsDir(ctx.root, id), artifactNameFor(role));
    mkdirSync(path.dirname(artifactOut), { recursive: true });
    const spec: SessionSpec = {
      role,
      ticketId: id,
      promptPrefix: this.prefixFor(role),
      promptVariable: JSON.stringify(
        {
          inputs,
          artifact_out: artifactOut,
          falsified_out: path.join(runsDir(ctx.root, id), "falsified.json"),
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
        ? [...this.toolsFor(role), artifactWriteRule(artifactOut)]
        : this.toolsFor(role),
      permissionMode: "",
      model: ctx.loaded.config.model_routing[role] ?? "",
      maxTurns: ctx.budgets.turns_per_stage,
      /**
       * S-2′/D-21: the per-ticket hook policy. Surface = the ticket's declared
       * surface plus ONLY the runs area, where artifact/falsified/surface-
       * request outs live — never `.detent/**` broadly. Protected = the
       * project's globs plus a STRUCTURAL floor (SEC-3): tickets, config,
       * bindings, and the plan are immutable to sessions even if a config
       * under-declares its protected set.
       */
      policy: {
        surface: [...ticket.surface, ".detent/runs/**"],
        protectedGlobs: [
          ...ctx.loaded.config.protected,
          ".detent/tickets/**",
          ".detent/config.json",
          ".detent/bindings.json",
          ".detent/plan/**",
        ],
        workRoot: workDir,
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
    ctx.journal.appendTicketEvent(id, { stage: role, event: "start", at: ctx.iso() });
    const result = await ctx.backend.run(spec);
    const generationNow = currentGeneration(readTicket(ctx.root, id));
    ctx.spend.record(id, generationNow.index, role, result, ctx.iso());
    ctx.journal.appendTicketEvent(id, {
      stage: role,
      event: "end",
      at: ctx.iso(),
      ok: result.ok,
      cost: result.costEstimateUsd,
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
    if (result.crashed === true && result.turns === 0) {
      throw new SessionRefusal(
        `backend refused ${role} session for ${id} (crashed, zero turns): ${result.rawTail.slice(-300)}`,
      );
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

    if (!READ_ONLY_ROLES.has(role)) this.handleSurfaceRequest(id);
    if (!result.telemetryParsed) throw new Breach("telemetry unparsable (S-4 circuit breaker)");
  }

  /**
   * SEC-3's lever: the hook denies and points here; the REFEREE decides.
   * Granting appends to the ticket surface (logged); protected paths and a
   * grant budget of three are hard limits.
   */
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

    const isProtected = target !== "" && picomatch.isMatch(target, [...ctx.loaded.config.protected], { dot: true });
    if (target === "" || isProtected || grants >= 3) {
      appendNote(ctx.root, ticketId, { author: "kernel", text: `surface DENIED: ${target} (${why}) (SEC-3)` });
      return;
    }
    writeTicket(ctx.root, { ...ticket, surface: [...ticket.surface, target] });
    appendNote(ctx.root, ticketId, { author: "kernel", text: `surface granted: ${target} — ${why} (SEC-3)` });
  }

  /** X-4: the session signalled falsification by writing the signal file. */
  consumeFalsifiedSignal(ticketId: string): string | null {
    const ctx = this.ctx;
    const file = path.join(runsDir(ctx.root, ticketId), "falsified.json");
    if (!existsSync(file)) return null;
    let note = "premise falsified";
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { note?: string };
      if (typeof parsed.note === "string" && parsed.note !== "") note = parsed.note;
    } catch {
      /* the signal's existence is the event; the note is best-effort */
    }
    rmSync(file, { force: true });
    appendNote(ctx.root, ticketId, { author: "kernel", text: `falsified mid-implementation: ${note}` });
    return note;
  }

  private rememberPrefix(role: string, spec: SessionSpec): void {
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
