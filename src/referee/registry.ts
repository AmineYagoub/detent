import { z } from "zod";
import {
  ATTEMPT_STATES,
  Breach,
  DriftHaltSignal,
  EscrowError,
  SpendExhaustedError,
  TransitionError,
  type RefereeCore,
} from "../kernel/referee.js";

/**
 * T-100 — the R-1 tool registry: the referee's ONLY driver-facing surface.
 *
 * Eight tools, zod-validated on the way in and on the way out. Every driver —
 * the headless loop today, the model driver at MP2, the MCP server in between
 * — reaches legality exclusively through `callTool`; there is no second door.
 *
 * Failures a driver is expected to route (a breach, a drift halt, an illegal
 * transition, bad evidence, bad input) return as STRUCTURED errors rather than
 * throws, so the MCP transport and the in-process path behave identically.
 * Anything else — a `KernelBoundaryError`, an unexpected exception — is a
 * defect, and propagates as one (C-11's exit 1), exactly as it did in v2.
 */

export const TOOL_NAMES = ["next", "claim", "attempt", "record", "gate", "transition", "status", "report"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export interface RefereeToolError {
  readonly error: {
    readonly code: "DRIFT_HALT" | "BREACH" | "ILLEGAL_TRANSITION" | "BAD_EVIDENCE" | "INVALID_INPUT" | "UNKNOWN_TOOL";
    readonly message: string;
  };
}

export function isToolError(result: unknown): result is RefereeToolError {
  return typeof result === "object" && result !== null && "error" in result;
}

/* ---------------------------------------------------------------- schemas */

const ticketId = z.string().min(1);

const nextInput = z.object({}).strict();
const nextOutput = z.object({ pool: z.array(z.object({ id: ticketId, state: z.string() })) });

const claimInput = z.discriminatedUnion("op", [
  z.object({ op: z.literal("acquire"), ticket_id: ticketId }).strict(),
  z.object({ op: z.literal("release"), ticket_id: ticketId }).strict(),
]);
const claimOutput = z.object({
  ok: z.boolean(),
  reason: z.string().optional(),
  claimed_ref: z.string().optional(),
  resume: z.object({ state: z.string(), reset: z.array(z.string()) }).optional(),
});

const attemptInput = z.object({ ticket_id: ticketId, state: z.enum(ATTEMPT_STATES) }).strict();
const attemptOutput = z.object({ falsified_ref: z.string().optional() });

const gateInput = z
  .object({ ticket_id: ticketId, close_check: z.boolean().optional(), escalate_reason: z.string().optional() })
  .strict();
const refOutput = z.object({ ref: z.string() });

const recordInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("stage"), ticket_id: ticketId, stage: z.enum(["diagnose", "review", "research"]) }).strict(),
  z.object({ kind: z.literal("breach"), ticket_id: ticketId, reason: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("human"),
      ticket_id: ticketId,
      action: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("approve"), by: z.string().min(1) }).strict(),
        z.object({ kind: z.literal("requeue"), by: z.string().min(1), guidance: z.string() }).strict(),
      ]),
    })
    .strict(),
  z.object({ kind: z.literal("note"), ticket_id: ticketId, author: z.string().min(1), text: z.string() }).strict(),
  z.object({ kind: z.literal("open_generation"), ticket_id: ticketId, reason: z.string() }).strict(),
  z.object({ kind: z.literal("reopen_generation"), ticket_id: ticketId }).strict(),
  z
    .object({
      kind: z.literal("close_generation"),
      ticket_id: ticketId,
      outcome: z.enum(["done", "blocked", "needs_human"]),
    })
    .strict(),
  z.object({ kind: z.literal("dossier"), ticket_id: ticketId, reason: z.string() }).strict(),
  z.object({ kind: z.literal("finalize"), ticket_id: ticketId }).strict(),
  z.object({ kind: z.literal("drift_halt") }).strict(),
]);

const transitionInput = z.object({ ticket_id: ticketId, ref: z.string().min(1) }).strict();
const transitionOutput = z.object({ from: z.string(), event: z.string(), to: z.string() });

const emptyInput = z.object({}).strict();

/** Input schema per tool — the MCP server publishes these as JSON Schema. */
export const TOOL_INPUTS: Record<ToolName, z.ZodType> = {
  next: nextInput,
  claim: claimInput,
  attempt: attemptInput,
  record: recordInput,
  gate: gateInput,
  transition: transitionInput,
  status: emptyInput,
  report: emptyInput,
};

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  next: "The claimable pool: READY tickets plus unclaimed resumable in-flight tickets (C-9).",
  claim: "Atomically acquire or release one ticket's claim (R-2). A refused acquire names why.",
  attempt: "Launch the metered billable session for a state (R-4). The sole path to the backend.",
  record: "Derive evidence: run a validator-backed stage, record a breach, a human act, or lifecycle bookkeeping.",
  gate: "Run the bound gates with drift assertion and the X-5 flake filter; returns an evidence ref.",
  transition: "Admit one evidence ref against its ticket (ARCH-1's single apply site). Illegal moves are refused.",
  status: "Read-only: every ticket's state, and the pending (human-gated) set.",
  report: "Read-only: counts by state and the run's recorded spend.",
};

/* ---------------------------------------------------------------- dispatch */

/**
 * Validate, dispatch, and shape one tool call. Structured errors are part of
 * the contract; unexpected exceptions propagate as defects.
 */
export async function callTool(core: RefereeCore, name: string, rawInput: unknown): Promise<Record<string, unknown>> {
  if (!(TOOL_NAMES as readonly string[]).includes(name)) {
    return { error: { code: "UNKNOWN_TOOL", message: `no such referee tool: ${name}` } };
  }
  const parsed = TOOL_INPUTS[name as ToolName].safeParse(rawInput ?? {});
  if (!parsed.success) {
    return { error: { code: "INVALID_INPUT", message: `${name}: ${parsed.error.issues[0]?.message ?? "invalid input"}` } };
  }

  try {
    return await dispatch(core, name as ToolName, parsed.data);
  } catch (err) {
    if (err instanceof DriftHaltSignal) {
      return { error: { code: "DRIFT_HALT", message: err.message } };
    }
    if (err instanceof Breach || err instanceof SpendExhaustedError) {
      return { error: { code: "BREACH", message: err.message } };
    }
    if (err instanceof TransitionError) {
      return { error: { code: "ILLEGAL_TRANSITION", message: err.message } };
    }
    if (err instanceof EscrowError) {
      return { error: { code: "BAD_EVIDENCE", message: err.message } };
    }
    throw err;
  }
}

async function dispatch(core: RefereeCore, name: ToolName, input: unknown): Promise<Record<string, unknown>> {
  switch (name) {
    case "next":
      return nextOutput.parse({ pool: core.pool() });
    case "claim": {
      const arg = input as z.infer<typeof claimInput>;
      if (arg.op === "release") {
        core.releaseTicket(arg.ticket_id);
        return claimOutput.parse({ ok: true });
      }
      const result = core.acquire(arg.ticket_id);
      return claimOutput.parse({
        ok: result.ok,
        ...(result.reason !== undefined ? { reason: result.reason } : {}),
        ...(result.claimedRef !== undefined ? { claimed_ref: result.claimedRef } : {}),
        ...(result.resume !== undefined ? { resume: { state: result.resume.state, reset: [...result.resume.reset] } } : {}),
      });
    }
    case "attempt": {
      const arg = input as z.infer<typeof attemptInput>;
      const result = await core.attempt(arg.ticket_id, arg.state);
      return attemptOutput.parse({
        ...(result.falsifiedRef !== undefined ? { falsified_ref: result.falsifiedRef } : {}),
      });
    }
    case "gate": {
      const arg = input as z.infer<typeof gateInput>;
      const result = await core.evaluate(arg.ticket_id, {
        ...(arg.close_check !== undefined ? { closeCheck: arg.close_check } : {}),
        ...(arg.escalate_reason !== undefined ? { escalateReason: arg.escalate_reason } : {}),
      });
      return refOutput.parse(result);
    }
    case "record":
      return await dispatchRecord(core, input as z.infer<typeof recordInput>);
    case "transition": {
      const arg = input as z.infer<typeof transitionInput>;
      return transitionOutput.parse(core.admit(arg.ticket_id, arg.ref));
    }
    case "status":
      return core.statusData() as unknown as Record<string, unknown>;
    case "report":
      return core.reportData() as unknown as Record<string, unknown>;
  }
}

async function dispatchRecord(core: RefereeCore, arg: z.infer<typeof recordInput>): Promise<Record<string, unknown>> {
  switch (arg.kind) {
    case "stage":
      return refOutput.parse(await core.recordStage(arg.ticket_id, arg.stage));
    case "breach":
      return refOutput.parse(core.recordBreach(arg.ticket_id, arg.reason));
    case "human":
      return refOutput.parse(
        core.recordHuman(
          arg.ticket_id,
          arg.action.kind === "approve"
            ? { kind: "approve", by: arg.action.by }
            : { kind: "requeue", by: arg.action.by, guidance: arg.action.guidance },
        ),
      );
    case "note":
      core.addNote(arg.ticket_id, arg.author, arg.text);
      return { ok: true };
    case "open_generation":
      core.openGen(arg.ticket_id, arg.reason);
      return { ok: true };
    case "reopen_generation":
      core.reopenGen(arg.ticket_id);
      return { ok: true };
    case "close_generation":
      core.closeGen(arg.ticket_id, arg.outcome);
      return { ok: true };
    case "dossier":
      return core.writeDossierFor(arg.ticket_id, arg.reason);
    case "finalize":
      core.finalizeDone(arg.ticket_id);
      return { ok: true };
    case "drift_halt":
      return { reason: core.driftHaltSweep() };
  }
}
