import type { GateResult } from "../adapter/run.js";
import type { Budgets } from "../schemas/budgets.js";
import type { Ticket } from "../schemas/ticket.js";
import { classify } from "./classify.js";
import { linkDiscovered } from "./tickets/mutations.js";

/**
 * T-022 — the flake filter (X-5, D-7, D-14).
 *
 * The classifier is advisory and this module is where that stops mattering: a
 * pattern match buys a failure exactly one isolated rerun, and **only a green
 * rerun** permits quarantine. A red rerun enters the ladder whatever the
 * pattern said, which is D-14's whole point — pattern matching must never
 * absolve a real regression.
 *
 * The rerun allowance is a budget, not a retry policy. `flake_reruns` is keyed
 * by failure signature, so the same failure cannot buy a second rerun later in
 * the same generation; X-1 routes its breach to ladder entry rather than to
 * BUDGET_BREACH, because a failure that will not go away is a failure.
 */

/** Why a red gate is being handed to the ladder. Recorded, never inferred. */
export type LadderReason =
  | "not-suspected"
  | "rerun-red"
  | "rerun-budget-exhausted";

export interface GreenDecision {
  readonly kind: "green";
  readonly result: GateResult;
}

export interface LadderDecision {
  readonly kind: "ladder";
  /** The result the kernel acts on — the rerun's when there was one. */
  readonly result: GateResult;
  readonly signature: string;
  readonly reason: LadderReason;
  readonly rerun: boolean;
}

/**
 * Constructible only by `filterFlake`, and only from a green rerun. Quarantine
 * writers take this type, so "a green rerun is the sole evidence" is a property
 * of the type system rather than of a caller remembering to check.
 */
export interface QuarantineDecision {
  readonly kind: "quarantine";
  /** The green rerun. */
  readonly result: GateResult;
  readonly signature: string;
  /** The failing output, kept so the quarantine ticket can carry evidence. */
  readonly firstOutput: string;
}

export type FlakeDecision = GreenDecision | LadderDecision | QuarantineDecision;

/**
 * Per-signature rerun accounting for the current generation. Scoped by
 * signature rather than by gate so that a failure which recurs across gates
 * cannot buy a rerun each time — X-1's `flake_reruns` is a ceiling, and the
 * AC's "a second rerun of the same signature is unreachable" is this map.
 */
export class RerunLedger {
  private readonly used = new Map<string, number>();

  constructor(readonly ceiling: number) {}

  usedFor(signature: string): number {
    return this.used.get(signature) ?? 0;
  }

  remaining(signature: string): number {
    return Math.max(0, this.ceiling - this.usedFor(signature));
  }

  /** Returns false once the ceiling is reached; never throws, never loops. */
  tryConsume(signature: string): boolean {
    if (this.remaining(signature) <= 0) return false;
    this.used.set(signature, this.usedFor(signature) + 1);
    return true;
  }
}

export interface FlakeInput {
  readonly first: GateResult;
  /**
   * Re-runs the failing gate **in isolation** (X-5). Isolation is the caller's
   * to arrange — a `test_single` binding where one exists, the same command
   * otherwise — because the filter must not know about gate slots.
   */
  readonly rerunInIsolation: () => Promise<GateResult>;
  /**
   * Required, and carries the ceiling. An optional ledger would mean a caller
   * that forgot to thread it got a fresh allowance on every red gate — an X-1
   * ceiling silently disabled, which is precisely what P6 forbids. Build it
   * once per generation with `ledgerFor(budgets)`.
   */
  readonly ledger: RerunLedger;
}

/**
 * Nothing here touches ticket counters. The filter cannot charge a fix budget
 * because it is given none — "zero fix budget consumed" is structural, not a
 * behaviour to be tested for.
 */
export async function filterFlake(input: FlakeInput): Promise<FlakeDecision> {
  const { first } = input;
  if (first.green) return { kind: "green", result: first };

  const verdict = classify(first.output, first.exitCode);
  const signature = verdict.signature;
  const { ledger } = input;

  // D-14: `suspectedFlake` is advisory. Not suspected means straight to the
  // ladder — no rerun is spent on a failure nothing suggested was flaky.
  if (!verdict.suspectedFlake) {
    return { kind: "ladder", result: first, signature, reason: "not-suspected", rerun: false };
  }

  if (!ledger.tryConsume(signature)) {
    return { kind: "ladder", result: first, signature, reason: "rerun-budget-exhausted", rerun: false };
  }

  const second = await input.rerunInIsolation();
  if (second.green) {
    return { kind: "quarantine", result: second, signature, firstOutput: first.output };
  }

  // Red on the rerun: the ladder gets the *fresh* result, so the fix session
  // reasons about the failure that actually persisted.
  return { kind: "ladder", result: second, signature, reason: "rerun-red", rerun: true };
}

/** One ledger per generation, built from the X-1 ceiling it enforces. */
export function ledgerFor(budgets: Pick<Budgets, "flake_reruns">): RerunLedger {
  return new RerunLedger(budgets.flake_reruns);
}

export interface QuarantineOptions {
  readonly id: string;
  readonly title?: string;
  readonly surface?: readonly string[];
}

/**
 * X-5: quarantine, linked `discovered_from` the ticket whose run surfaced it,
 * with nothing charged. The parameter type is `QuarantineDecision`, so this
 * cannot be reached from a ladder decision — the green rerun is the evidence
 * and the compiler holds the line (P8: the knowledge persists in the repo).
 */
export function quarantineTicket(
  root: string,
  parentId: string,
  decision: QuarantineDecision,
  opts: QuarantineOptions,
): Ticket {
  return linkDiscovered(
    root,
    parentId,
    {
      id: opts.id,
      type: "bug",
      title: opts.title ?? `flaky gate: ${decision.result.command}`,
      description:
        `A gate failed and then passed on an isolated rerun, so it was quarantined rather than fixed (X-5).\n\n` +
        `Signature: ${decision.signature}\nCommand: ${decision.result.command}\n\n` +
        `Failing output:\n${decision.firstOutput}`,
      acceptance_criteria: [
        `The gate \`${decision.result.command}\` passes on 10 consecutive isolated runs, or the flaky test is fixed or removed.`,
      ],
      surface: opts.surface ?? [],
    },
    "quarantines",
  );
}
