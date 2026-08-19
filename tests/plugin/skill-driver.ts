import { callTool, isToolError, type RefereeToolError } from "../../src/referee/registry.js";
import type { RefereeCore } from "../../src/kernel/referee.js";

/**
 * T-120/T-123 — the SCRIPTED model driver: an independent sequencer that
 * plays the model's role by executing `skills/run/SKILL.md`'s program
 * literally, over the same tool surface a session would use (`callTool`),
 * reading nothing but tool results. Deliberately NOT an import of
 * `kernel/driver.ts` — the parity claim is that the skill's published table
 * reproduces the deterministic loop's admitted sequence, so the two
 * implementations must be independent. The live counterpart (a real model
 * executing the same skill) is T-124's exit.
 */

const TERMINAL: readonly string[] = ["DONE", "NEEDS_HUMAN", "BLOCKED"];

/** The states the skill's table handles — parity.test locks these to the skill body. */
export const SKILL_TABLE_STATES = [
  "IN_PROGRESS",
  "BLIND_FIX",
  "REVIEW_FIX",
  "INFORMED_FIX",
  "RESEARCH",
  "IN_REVIEW",
  "DIAGNOSED",
  "APPROVED",
] as const;

class RouteError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RouteError";
  }
}

export interface SkillDriverOutcome {
  readonly exit: "ok" | "human-gated" | "not-ready";
  readonly reason?: string;
  readonly toolsUsed: readonly string[];
}

export async function skillDriver(core: RefereeCore): Promise<SkillDriverOutcome> {
  const used = new Set<string>();

  const call = async (name: string, input: unknown): Promise<Record<string, unknown>> => {
    used.add(name);
    const result = await callTool(core, name, input);
    if (isToolError(result)) {
      const { code, message } = (result as RefereeToolError).error;
      throw new RouteError(code, message);
    }
    return result as Record<string, unknown>;
  };

  const transition = async (id: string, ref: string): Promise<string> =>
    (await call("transition", { ticket_id: id, ref }))["to"] as string;

  const gateTo = async (id: string, opts: Record<string, unknown> = {}): Promise<string> => {
    const ref = (await call("gate", { ticket_id: id, ...opts }))["ref"] as string;
    return await transition(id, ref);
  };

  const stageRecord = async (id: string, stage: string): Promise<string> => {
    const ref = (await call("record", { kind: "stage", ticket_id: id, stage }))["ref"] as string;
    return await transition(id, ref);
  };

  /** Step 4 of the skill: the state → move table, verbatim. */
  const stage = async (id: string, state: string): Promise<string> => {
    switch (state) {
      case "IN_PROGRESS": {
        const result = await call("attempt", { ticket_id: id, state });
        if (result["falsified_ref"] !== undefined) return await transition(id, result["falsified_ref"] as string);
        return await gateTo(id);
      }
      case "BLIND_FIX":
      case "REVIEW_FIX":
        await call("attempt", { ticket_id: id, state });
        return await gateTo(id);
      case "INFORMED_FIX":
        await call("attempt", { ticket_id: id, state });
        return await gateTo(id, { escalate_reason: "informed fix failed — the ladder cannot reopen (D-13)" });
      case "RESEARCH":
        return await stageRecord(id, "research");
      case "IN_REVIEW":
        return await stageRecord(id, "review");
      case "DIAGNOSED":
        return await stageRecord(id, "diagnose");
      case "APPROVED":
        return await gateTo(id, { close_check: true });
      default:
        throw new Error(`the skill's table has no row for state ${state}`);
    }
  };

  const processTicket = async (id: string, acquired: Record<string, unknown>): Promise<void> => {
    let state: string;
    if (acquired["claimed_ref"] !== undefined) {
      state = await transition(id, acquired["claimed_ref"] as string);
    } else {
      state = (acquired["resume"] as { state: string }).state;
    }

    while (!TERMINAL.includes(state)) {
      try {
        state = await stage(id, state);
      } catch (err) {
        if (err instanceof RouteError && err.code === "BREACH") {
          const ref = (await call("record", { kind: "breach", ticket_id: id, reason: err.message }))["ref"] as string;
          state = await transition(id, ref);
          break;
        }
        throw err;
      }
    }

    if (state === "NEEDS_HUMAN") {
      const pending = (await call("status", {}))["pending"] as { id: string; reason: string }[];
      const reason = pending.find((p) => p.id === id)?.reason ?? "escalated";
      await call("record", { kind: "dossier", ticket_id: id, reason });
      await call("record", { kind: "close_generation", ticket_id: id, outcome: "needs_human" });
      /* Step 6: present the escalation and WAIT — the scripted driver has no human, so it leaves the ticket pending. */
    } else if (state === "BLOCKED") {
      await call("record", { kind: "close_generation", ticket_id: id, outcome: "blocked" });
    } else if (state === "DONE") {
      await call("record", { kind: "finalize", ticket_id: id });
      await call("record", { kind: "close_generation", ticket_id: id, outcome: "done" });
    }
  };

  for (;;) {
    const pool = (await call("next", {}))["pool"] as { id: string }[];
    if (pool.length === 0) break;
    const id = pool[0]!.id;
    const acquired = await call("claim", { op: "acquire", ticket_id: id });
    if (acquired["ok"] !== true) continue;

    try {
      await processTicket(id, acquired);
    } catch (err) {
      if (err instanceof RouteError && err.code === "DRIFT_HALT") {
        const reason = (await call("record", { kind: "drift_halt" }))["reason"] as string;
        return { exit: "not-ready", reason, toolsUsed: [...used].sort() };
      }
      throw err;
    } finally {
      await call("claim", { op: "release", ticket_id: id });
    }
  }

  const pending = (await call("status", {}))["pending"] as unknown[];
  return { exit: pending.length > 0 ? "human-gated" : "ok", toolsUsed: [...used].sort() };
}
