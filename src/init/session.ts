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
import { RunJournal } from "../kernel/journal.js";
import { SpendLedger } from "../kernel/ledger.js";

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
  readonly rulesText?: string;
  /** X-6/S-3 docs domains for research-capable init sessions. */
  readonly docsDomains?: readonly string[];
}

export interface InitSessionRequest {
  readonly role: RoleId;
  readonly inputs: Record<string, unknown>;
  /** Absolute path the session writes its artifact to. */
  readonly artifactOut: string;
  /** C-3a: research capability for planning questions. */
  readonly withWeb?: boolean;
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
    promptVariable: JSON.stringify({ inputs: request.inputs, artifact_out: request.artifactOut }, null, 2),
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
    model: "",
  };
}

export async function launchInitSession(deps: InitSessionDeps, request: InitSessionRequest): Promise<SessionResult> {
  mkdirSync(path.dirname(request.artifactOut), { recursive: true });

  const journal = RunJournal.open(deps.root);
  let result: SessionResult;
  try {
    const ledger = new SpendLedger(deps.root, journal, deps.spendCeiling);
    /* D-25: the ceiling is a launch gate, evaluated here and never mid-flight. */
    ledger.assertLaunchAllowed();
    journal.appendTicketEvent(INIT_TICKET, { stage: request.role, event: "start", at: new Date().toISOString() });
    result = await deps.backend.run(initSessionSpec(deps, request));
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
  } finally {
    journal.close();
  }

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
  return result;
}
