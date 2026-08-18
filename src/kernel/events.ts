import type { GateResult } from "../adapter/run.js";
import type { DriftHaltError } from "../adapter/drift.js";
import type { ResearchBrief, Review } from "../schemas/records.js";
import type { Event } from "../schemas/states.js";

/**
 * T-054 — evidence-carrying event constructors (ARCH-1's audit half).
 *
 * ARCH-1's AC: every `machine.apply` call site's event derives from a
 * validator result or a gate result. This module makes that a property of the
 * type system rather than of review discipline: the run loop's commit path
 * accepts only a `KernelEvent`, the brand below is not exported, and each
 * constructor demands the artifact that justifies its event — a `GATE_GREEN`
 * cannot be built without a `GateResult`, a `REVIEW_APPROVE` without a parsed
 * A-5 review, a `RESEARCH_VALID` without a parsed A-4 brief.
 *
 * The apply-site audit test completes the mechanical half: `machine.apply` is
 * importable only where the scan sanctions it, and no commit site passes a
 * bare event string.
 */

/** Real at runtime, unexported — so no other module can forge the brand. */
const derived: unique symbol = Symbol("detent.kernel.event");

export interface KernelEvent {
  /** Non-constructible outside this module: the brand symbol is not exported. */
  readonly [derived]: true;
  readonly event: Event;
  readonly evidence: string;
}

function make(event: Event, evidence: string): KernelEvent {
  return { [derived]: true, event, evidence } as KernelEvent;
}

// ---- claim / requeue (human- or kernel-act evidence) ------------------------

/** C-9: the atomic claim itself is the evidence. */
export function claimed(): KernelEvent {
  return make("CLAIMED", "claim-lock");
}

/** X-8: a requeue is a human act; the consent context is the evidence. */
export function humanRequeue(consent: string): KernelEvent {
  return make("HUMAN_REQUEUE", consent);
}

// ---- gate-derived -----------------------------------------------------------

export function gateGreen(result: GateResult | null, qualifier = ""): KernelEvent {
  const base = result === null ? "no bound gates" : `${result.slot ?? "gate"}:exit=${result.exitCode ?? "none"}`;
  return make("GATE_GREEN", qualifier === "" ? base : `${base}:${qualifier}`);
}

export function gateRed(result: GateResult): KernelEvent {
  return make("GATE_RED", `${result.slot ?? "gate"}:exit=${result.exitCode ?? "none"}`);
}

/** X-4: fail-as-predicted, observed by the kernel executing the repro. */
export function reproAsPredicted(repro: GateResult): KernelEvent {
  return make("REPRO_AS_PREDICTED", `repro:exit=${repro.exitCode ?? "none"}:as-predicted`);
}

/**
 * X-4's two falsification shapes: a hypothesis artifact that failed
 * validation, or a repro the kernel executed that did not fail as predicted.
 */
export function reproWrong(cause: { readonly invalidArtifact: string } | { readonly repro: GateResult; readonly why: string }): KernelEvent {
  if ("invalidArtifact" in cause) return make("REPRO_WRONG", cause.invalidArtifact);
  return make("REPRO_WRONG", `repro:exit=${cause.repro.exitCode ?? "none"}:${cause.why}`);
}

/** X-4: the session signalled falsification by writing the signal file. */
export function premiseFalsified(note: string): KernelEvent {
  return make("PREMISE_FALSIFIED", `falsified.json: ${note}`);
}

// ---- validator-derived ------------------------------------------------------

export function reviewApprove(review: Review): KernelEvent {
  return make("REVIEW_APPROVE", `review approve (verdict=${review.verdict})`);
}

export function reviewChanges(review: Review): KernelEvent {
  return make("REVIEW_CHANGES", `${review.changes.length} findings: ${review.changes.map((c) => c.tag).join(",")}`);
}

export function researchValid(brief: ResearchBrief, cached: boolean): KernelEvent {
  return make("RESEARCH_VALID", cached ? `brief cache hit: ${brief.cache_key}` : "research.json valid");
}

export function researchDry(reason: string): KernelEvent {
  return make("RESEARCH_DRY", reason);
}

export function upstreamBug(brief: ResearchBrief): KernelEvent {
  return make("UPSTREAM_BUG", `research.upstream_bug: ${brief.upstream_bug ?? ""}`);
}

// ---- kernel-decision events (ceiling and halt evidence) ---------------------

export function budgetBreach(reason: string): KernelEvent {
  return make("BUDGET_BREACH", reason);
}

export function gateDrift(halt: DriftHaltError): KernelEvent {
  return make("GATE_DRIFT", halt.halting.map((h) => h.slot).join(","));
}

export function riskLabelRequired(): KernelEvent {
  return make("RISK_LABEL_REQUIRED", "risk gate: ticket carries risk_label (B-4)");
}
