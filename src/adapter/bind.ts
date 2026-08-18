import { bindingSchema, type Binding } from "../schemas/records.js";
import { SCHEMA_VERSION } from "../schemas/common.js";
import { plausible, type Candidate, type Discovery, type StackFacts } from "./discover/types.js";
import { normalizeInvocation, type Invocation } from "./normalize.js";
import { GATE_SLOTS, looksLikeWatchMode, runGate, runnable, type GateResult, type GateSlot } from "./run.js";

/**
 * T-026 — binding execution (V-1, V-2).
 *
 * P4: an unexecuted binding is a guess. Every candidate is run once, with a
 * timeout, before it may be approved — including the auto-accepted ones, which
 * C-3b is explicit about. A candidate that has to be killed is watch-mode and
 * is rejected with an explanation rather than bound and discovered later.
 *
 * What this module never does is choose between two equally plausible
 * candidates. That is an interrupt (AWAIT_BINDING_CHOICE), and V-1 calls
 * guessing there a defect.
 */

import { CEILINGS } from "../schemas/budgets.js";

/** X-1's `binding_probe_timeout_ms` default — deliberately shorter than the gate
 *  timeout: a probe asks "does this terminate at all" (PRDR-061). */
export const DEFAULT_PROBE_TIMEOUT_MS: number = CEILINGS.binding_probe_timeout_ms.default;

export type RejectReason = "watch-mode" | "unrunnable";

export interface BoundOutcome {
  readonly kind: "bound";
  readonly slot: GateSlot;
  readonly binding: Binding;
  readonly result: GateResult;
}

export interface ChoiceRequiredOutcome {
  readonly kind: "choice-required";
  readonly slot: GateSlot;
  /** Structured, so C-3b's PRESENT summary can render it without re-deriving. */
  readonly candidates: readonly Candidate[];
}

export interface RejectedOutcome {
  readonly kind: "rejected";
  readonly slot: GateSlot;
  readonly candidate: Candidate;
  readonly reason: RejectReason;
  readonly explanation: string;
  readonly result: GateResult;
}

export interface UnboundOutcome {
  readonly kind: "unbound";
  readonly slot: GateSlot;
}

export type SlotOutcome = BoundOutcome | ChoiceRequiredOutcome | RejectedOutcome | UnboundOutcome;

/** V-1: an unbound slot is a human-acknowledged skip, recorded with who and when. */
export interface Skip {
  readonly slot: GateSlot;
  readonly acknowledged_by: string;
  readonly at: string;
}

export type GateRunner = (spec: {
  readonly command: string;
  readonly cwd: string;
  readonly slot: GateSlot;
  readonly timeoutMs: number;
  readonly env: Readonly<Record<string, string>>;
}) => Promise<GateResult>;

export interface BindOptions {
  readonly root: string;
  readonly timeoutMs?: number;
  readonly runner?: GateRunner;
  readonly now?: () => string;
  /** C-3b provenance. `auto` when Detent chose; a user id when a human did. */
  readonly approvedBy?: string;
  /** C-4: greenfield bindings are provisional until bootstrap ticket #1 passes. */
  readonly status?: Binding["status"];
  readonly facts?: Pick<StackFacts, "pm">;
  readonly normalize?: (candidate: Candidate, facts?: Pick<StackFacts, "pm">) => Invocation;
}

const defaultRunner: GateRunner = (spec) =>
  runGate({ command: spec.command, cwd: spec.cwd, slot: spec.slot, timeoutMs: spec.timeoutMs, env: spec.env });

/**
 * Execute one slot's candidates and decide. Ambiguity is answered before
 * anything is executed: asking the human is cheaper than running two suites,
 * and V-1 requires the interrupt regardless of what they would have returned.
 */
export async function bindSlot(
  slot: GateSlot,
  candidates: readonly Candidate[],
  opts: BindOptions,
): Promise<SlotOutcome> {
  const viable = plausible(candidates, slot);
  if (viable.length === 0) return { kind: "unbound", slot };
  if (viable.length > 1) return { kind: "choice-required", slot, candidates: viable };

  const candidate = viable[0] as Candidate;
  const normalize = opts.normalize ?? normalizeInvocation;
  const invocation = normalize(candidate, opts.facts);
  const runner = opts.runner ?? defaultRunner;

  const result = await runner({
    command: invocation.command,
    cwd: opts.root,
    slot,
    timeoutMs: opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    env: invocation.env,
  });

  if (looksLikeWatchMode(result)) {
    return {
      kind: "rejected",
      slot,
      candidate,
      reason: "watch-mode",
      explanation:
        `\`${invocation.command}\` did not exit within ${opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS}ms and had to be killed. ` +
        `A gate must terminate; this looks like watch mode. Bind a run-once form of the command instead (V-1).`,
      result,
    };
  }

  if (!runnable(result)) {
    return {
      kind: "rejected",
      slot,
      candidate,
      reason: "unrunnable",
      explanation:
        `\`${invocation.command}\` could not be executed (exit ${result.normalizedExit}). ` +
        `A binding Detent cannot run is not a gate. Install the tooling or bind a different command (V-1).`,
      result,
    };
  }

  // A command that runs and fails is a perfectly good binding: red tests are
  // the normal state of a repository mid-work, and V-1 asks only that the
  // command executes.
  return {
    kind: "bound",
    slot,
    binding: bindingSchema.parse({
      schema_version: SCHEMA_VERSION,
      slot,
      adapter: candidate.adapter,
      ref: candidate.ref,
      resolved: invocation.command,
      ...(candidate.pm === null ? {} : { pm: candidate.pm }),
      config_hash: candidate.config_hash,
      executed_at: (opts.now ?? (() => new Date().toISOString()))(),
      approved_by: opts.approvedBy ?? "auto",
      status: opts.status ?? "approved",
    } satisfies Binding),
    result,
  };
}

export interface BindReport {
  readonly outcomes: readonly SlotOutcome[];
  readonly bindings: readonly Binding[];
  /** Outcomes a human must resolve: C-3b's two interrupt conditions. */
  readonly interrupts: readonly (ChoiceRequiredOutcome | RejectedOutcome)[];
  readonly unbound: readonly GateSlot[];
}

export async function bindAll(discovery: Discovery, opts: BindOptions): Promise<BindReport> {
  const outcomes: SlotOutcome[] = [];
  for (const slot of GATE_SLOTS) {
    outcomes.push(await bindSlot(slot, discovery.candidates, { ...opts, facts: opts.facts ?? { pm: discovery.stack.pm } }));
  }
  return {
    outcomes,
    bindings: outcomes.filter((o): o is BoundOutcome => o.kind === "bound").map((o) => o.binding),
    interrupts: outcomes.filter(
      (o): o is ChoiceRequiredOutcome | RejectedOutcome => o.kind === "choice-required" || o.kind === "rejected",
    ),
    unbound: outcomes.filter((o): o is UnboundOutcome => o.kind === "unbound").map((o) => o.slot),
  };
}

/** V-1: record who acknowledged the skip and when. Never inferred. */
export function acknowledgeSkip(slot: GateSlot, acknowledgedBy: string, at = new Date().toISOString()): Skip {
  if (acknowledgedBy.trim() === "") throw new Error("a skip must name who acknowledged it (V-1)");
  return { slot, acknowledged_by: acknowledgedBy, at };
}

/** Identity of a candidate, stable across a JSON round trip. */
function identity(c: Candidate): string {
  return [c.slot, c.adapter, c.ref, c.resolved, c.config_hash].join("\0");
}

/**
 * The human's answer to AWAIT_BINDING_CHOICE. The chosen candidate is still
 * executed — V-1's order is discovery → execution → approval, and a human
 * choosing does not skip the execution step.
 *
 * Membership is by value, not by reference: C-5 interrupts batch at phase
 * boundaries and resume from a checkpoint (F-4), so the answer arrives in a
 * later process and the object identity of the offer is long gone.
 */
export async function resolveChoice(
  outcome: ChoiceRequiredOutcome,
  chosen: Candidate,
  user: string,
  opts: BindOptions,
): Promise<SlotOutcome> {
  const offered = outcome.candidates.find((c) => identity(c) === identity(chosen));
  if (offered === undefined) {
    throw new Error(`candidate ${chosen.resolved} was not among the choices offered for ${outcome.slot}`);
  }
  return await bindSlot(outcome.slot, [offered], { ...opts, approvedBy: user });
}
