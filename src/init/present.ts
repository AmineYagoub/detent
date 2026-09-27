import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stateDir, writeArtifact } from "../fs/layout.js";
import { SCHEMA_VERSION, parseArtifact } from "../schemas/common.js";
import {
  approvalSchema,
  presentationSchema,
  type Approval,
  type Binding,
  type Presentation,
} from "../schemas/records.js";
import type { Skip } from "../adapter/bind.js";
import type { Ticket } from "../schemas/ticket.js";
import type { CheckFailure, PlanFinding, PlanRisk, UnreviewedSlice } from "../schemas/init.js";
import { reviewLines } from "./present-review.js";
import {
  decisionLines,
  defectInterrupt,
  defectLines,
  riskLines,
  type PresentedDecision,
  type PresentedDefault,
  type PresentedDefect,
  type PresentedRisk,
} from "./present-spec.js";
import { planLines, type PlannedSlice } from "./present-plan.js";
import { spendLines, type PhaseSpend } from "./phase-spend.js";
import { buildLines, type BuildShare } from "./plan-builds.js";
import { isMixed } from "../kernel/build.js";
import { planHash } from "./machine.js";
import { symbolReminder } from "./symbol-reminder.js";
import type { SymbolsConfig } from "../adapter/symbols.js";
import { bindingTable } from "./bind.js";
import { failureInterrupt, failureLines, presentFailures, type PresentChecks } from "./present-checks.js";
import { ROOT_PACKAGE } from "../adapter/packages.js";
import type { PhaseOutcome } from "./machine.js";

/**
 * T-068 — PRESENT and dual-exit approval (C-7, C-3b).
 *
 * The summary is the last thing a human sees before work begins, so it shows
 * what was decided *and who decided it*: every binding with its provenance
 * (`auto` or a user), every skip with who acknowledged it, and the ticket
 * graph. C-3b requires auto-accepted bindings to be visible and overridable
 * here — an invisible auto-decision is indistinguishable from a guess.
 *
 * Approval is dual-exit (C-7): offered inline on a TTY, and otherwise
 * deferred to the first `detent run`, which presents the same summary. A
 * declined approval is not a failure — it leaves the plan READY-unapproved.
 *
 * PRDR-255 built the second exit. Until then this paragraph described it in the
 * present indicative and `run` refused with a string pointing back at `init`;
 * the rendering is now persisted here (`presentation.json`) and replayed there,
 * which is what makes "the same summary" a fact rather than an intention.
 *
 * C-7‴ (PRDR-296): what the summary holds is what an operator decides on: the
 * slices, tickets and milestones, the decision log with each default marked
 * vetoable, the checks that still fail, the spec defects planning found, the
 * risks VALIDATE and the plan's review left, and what each specification phase
 * and planning cost. It is printed once, and it is the text persisted.
 */

export function approvalPath(root: string): string {
  return path.join(stateDir(root), "plan", "approval.json");
}

/**
 * C-7 (PRDR-255): what PRESENT showed, for the second exit to replay.
 *
 * `null` when the file is absent or will not parse, and the caller REFUSES on
 * null rather than rendering something else. A plan `init` never presented has
 * no approved-by-a-human rendering to show, and inventing one at run time is
 * the failure this record exists to prevent.
 */
export function readPresentation(root: string): Presentation | null {
  const file = path.join(stateDir(root), "plan", "presentation.json");
  if (!existsSync(file)) return null;
  const parsed = parseArtifact(presentationSchema, JSON.parse(readFileSync(file, "utf8")));
  return parsed.ok ? parsed.value : null;
}

export interface PresentInput {
  readonly root: string;
  readonly tickets: readonly Ticket[];
  readonly bindings: readonly Binding[];
  readonly skips: readonly Skip[];
  /** V-5′ (PRDR-295): every package DETERMINE_VERIFICATION found; the root alone where absent. */
  readonly packages?: readonly string[];
  /** A-1⁷ (PRDR-293): what the checks read besides the tickets and the gates; absent, no slice's coverage is checked. */
  readonly checks?: PresentChecks;
  /** A-1⁷: the checks that fail on the tickets as they stand, which `presentStage` works out; a caller rendering on its own passes none. */
  readonly failures?: readonly CheckFailure[];
  readonly bootstrap: string | null;
  readonly assignments: Readonly<Record<string, string>>;
  /** C-2‴: the increments the plan was planned in, listed with their milestones (C-7‴). */
  readonly slices?: readonly PlannedSlice[];
  /** C-7‴ (PRDR-296): every decision the log holds, as the founder answered it. */
  readonly decisions?: readonly PresentedDecision[];
  /** C-3⁗ (PRDR-282): every default the decision log holds, with its reason, each marked vetoable (C-7‴). */
  readonly defaults?: readonly PresentedDefault[];
  /** C-2¹⁴ (PRDR-284): the majors VALIDATE's last round left open, listed beside the defaults. */
  readonly risks?: readonly PresentedRisk[];
  /** C-4⁵ (PRDR-292): what PLAN found the pack leaves unsettled; while one is open, approval is not offered. */
  readonly specDefects?: readonly PresentedDefect[];
  /** C-4⁸ (PRDR-294): what PLAN recorded on its tickets: the review's minors, which PRESENT counts, and A-1″'s repairs, which it lists. */
  readonly findings?: readonly PlanFinding[];
  /** C-4⁸: the blockers and majors each slice's one revision was sent, shown as risks. */
  readonly reviewRisks?: readonly PlanRisk[];
  /** C-4⁸: the slices no review read, and why. */
  readonly unreviewed?: readonly UnreviewedSlice[];
  /** C-7‴ (PRDR-296): what `init` has spent on the root, by phase; reported, never capped (decision 16). */
  readonly spend?: readonly PhaseSpend[];
  /** N-5″ (PRDR-297): the Detent builds that made the plan, and what each made (`plan-builds.ts`). */
  readonly builds?: readonly BuildShare[];
  /** N-5″: the hash of the pack the plan was planned from, or null without one. */
  readonly packHash?: string | null;
  /** A-1‴: edges Detent derived from declared coupling rather than the planner writing them. */
  readonly derivedEdges?: readonly { readonly consumer: string; readonly provider: string; readonly contract: string }[];
  /**
   * V-1‴ (PRDR-163): bound gates that may verify nothing.
   *
   * Also rendered here, not only printed at bind time. The `note` callback
   * fires once, inside `DETERMINE_VERIFICATION.run` — and a reused phase never
   * calls `run`, while `init` interrupts at AWAIT_APPROVAL and therefore almost
   * always resumes. Without this the operator saw the warning on the first
   * `init` and never again, including in the summary they actually approve.
   */
  readonly gateNotices?: readonly string[];
  /** S-3″: absent means unconfigured, which is what earns the reminder. */
  readonly symbols?: SymbolsConfig;
}

/**
 * The PRESENT summary. Rendered here, by `init`, and replayed verbatim by
 * `run` from the record `presentStage` persists (C-7, PRDR-255) — `run` does
 * not call this function, and a second rendering is exactly what must not
 * happen: it would be derived from whatever the tree holds at run time rather
 * than from what the human was shown.
 */
export function renderPresentation(input: PresentInput): string {
  const defects = input.specDefects ?? [];
  const failures = input.failures ?? [];
  const lines = [
    defects.length > 0
      ? "Plan drafted, and not approvable while the spec defects below are open."
      : failures.length > 0
        ? "Plan drafted, and not approvable while a check below fails."
        : "Plan ready for approval.",
    "",
    "Verification bindings:",
    bindingTable(input.bindings, input.skips, input.packages),
    "",
    ...planLines(input.tickets, input.slices ?? [], input.assignments, input.checks),
  ];
  const gateNotices = input.gateNotices ?? [];
  if (gateNotices.length > 0) {
    lines.push("", `Gates that may verify nothing (${gateNotices.length}) — evidence, not a refusal (V-1‴):`);
    for (const n of gateNotices) lines.push(`  ${n}`);
  }
  if (input.bootstrap !== null) {
    lines.push(
      "",
      `Greenfield: ${input.bootstrap} establishes the project's own verification tooling.`,
      "Its gates passing is what promotes the provisional bindings above to approved (C-4).",
    );
  }
  const findings = input.findings ?? [];
  lines.push(
    ...decisionLines(input.decisions ?? [], input.defaults ?? []),
    ...defectLines(defects),
    ...failureLines(failures),
    ...riskLines(input.risks ?? []),
    ...reviewLines(input.reviewRisks ?? [], input.unreviewed ?? [], findings),
  );
  const edges = input.derivedEdges ?? [];
  if (edges.length > 0) {
    lines.push(
      "",
      `Dependencies Detent derived (${edges.length}) — the plan declared a name one ticket owns and another needs, so the edge is the plan's own, not a guess (A-1‴):`,
    );
    for (const e of edges) lines.push(`  ${e.consumer} → ${e.provider}   (${e.contract})`);
  }
  lines.push(...spendLines(input.spend ?? []));
  lines.push(...buildLines(input.builds ?? [], input.packHash ?? null));
  lines.push("", "Bindings and tickets are overridable — edit them and re-run `detent init` (C-3b/C-8).");
  /** S-3″ (PRDR-121): shown only when this run produced evidence it would have helped. */
  const reminder = symbolReminder(input.symbols, [...findings, ...(input.reviewRisks ?? [])]);
  if (reminder !== null) lines.push(reminder);
  return lines.join("\n");
}

export type ApprovalDecision =
  | { readonly kind: "approved"; readonly by: string }
  | { readonly kind: "declined" }
  | { readonly kind: "deferred" };

export interface PresentDeps extends PresentInput {
  /**
   * Absent on a non-TTY: approval defers to the first `run` (C-7), which
   * presents this same rendering and offers the decision there on a TTY of its
   * own (PRDR-255). Absent must never mean approved — see `RunOptions.approve`.
   */
  readonly ask?: (presentation: string) => Promise<ApprovalDecision>;
  /** C-7‴ (PRDR-296): shows the presentation before `ask` is put; nothing else prints it here. */
  readonly print?: (text: string) => void;
  /**
   * N-5″ (PRDR-297): put before `ask` where more than one build made the plan,
   * as a toolchain install is asked (PRDR-276). Only a yes lets approval be
   * offered; absent, the answer is no.
   */
  readonly acceptMixedBuilds?: (builds: readonly string[]) => Promise<boolean>;
  readonly now?: () => number;
}

/** N-5″ (PRDR-297): what either exit says where a plan more than one build made was not accepted. */
export const MIXED_BUILDS_REFUSED =
  "Not approved: more than one Detent build made this plan, or a part of it names no build, and that was not accepted. " +
  "`detent init --replan` makes again everything the builds above made, with this build alone; or accept it — y at the " +
  "question on a terminal, or `--accept-mixed-builds` beside `--approve` (N-5″).";

export async function presentStage(deps: PresentDeps): Promise<PhaseOutcome> {
  /* A-1⁷ (PRDR-293): the checks, on the tickets and the bindings as they stand. */
  const failures = presentFailures(deps.tickets, deps.slices ?? [], deps.checks, { bindings: deps.bindings, packages: deps.packages ?? [ROOT_PACKAGE] });
  const presentation = renderPresentation({ ...deps, failures });
  const made = { builds: (deps.builds ?? []).map((b) => b.build), pack_hash: deps.packHash ?? null };

  /**
   * C-7 (PRDR-255): the rendering is kept, so the second exit can replay it.
   *
   * Written on EVERY branch — before the returns below that hold approval, and
   * whatever the decision turns out to be — because `run` may be reached from
   * any of them and what it shows must be what was shown here. That is the
   * whole content of "rendered identically by `init` and by `run`", which was
   * prose for as long as `run` had nothing to render from.
   */
  writeArtifact(deps.root, path.posix.join("plan", "presentation.json"), {
    schema_version: SCHEMA_VERSION,
    presentation,
    plan_hash: planHash(deps.root),
    spec_defects: (deps.specDefects ?? []).length,
    check_failures: failures.length,
    ...made,
  } satisfies Presentation);

  /** C-4⁵ (PRDR-292): an open spec defect holds approval, and the operator is told each one and how a re-run closes it. */
  const defective = defectInterrupt(presentation, deps.specDefects ?? []);
  if (defective !== null) return defective;
  /** A-1⁷ (PRDR-293): so does a check that still fails, a path no gate can fail among them (V-5′). */
  const failing = failureInterrupt(presentation, failures);
  if (failing !== null) return failing;

  /*
   * C-7‴ (PRDR-296): the presentation reaches the operator once. Where
   * approval is asked, it is printed before the question and the answer's
   * interrupt does not repeat it; anywhere else the interrupt carries it, as
   * the two above do. It used to print here and again twice from the CLI,
   * among the machine's messages and as the interrupt.
   */
  const shown = deps.ask !== undefined && deps.print !== undefined;
  if (shown) deps.print?.(presentation);
  /* N-5″ (PRDR-297): a plan more than one build made is offered for approval only once that is accepted. */
  if (deps.ask !== undefined && isMixed(made.builds) && !((await deps.acceptMixedBuilds?.(made.builds)) ?? false)) {
    return {
      kind: "interrupt",
      interrupt: "AWAIT_APPROVAL",
      message: shown ? MIXED_BUILDS_REFUSED : `${presentation}\n\n${MIXED_BUILDS_REFUSED}`,
      items: deps.tickets.map((t) => t.id),
    };
  }
  const decision: ApprovalDecision = deps.ask === undefined ? { kind: "deferred" } : await deps.ask(presentation);

  if (decision.kind === "approved") {
    recordApproval(deps.root, decision.by, deps.now?.() ?? Date.now(), made);
    return { kind: "complete", outputs: { approved: true, approved_by: decision.by } };
  }

  /*
   * C-7: declining or deferring both leave the plan READY-unapproved. Neither
   * is an error, and the first `run` presents the same summary either way —
   * the rendering persisted above is the one it replays (PRDR-255).
   */
  const outcome =
    decision.kind === "declined"
      ? "Approval declined — the plan is ready but unapproved. Re-run `detent init` after editing, or approve at the start of `detent run`."
      : "Approval deferred — `detent run` will present this plan before executing (C-7).";
  return {
    kind: "interrupt",
    interrupt: "AWAIT_APPROVAL",
    message: shown ? outcome : `${presentation}\n\n${outcome}`,
    items: deps.tickets.map((t) => t.id),
  };
}

/**
 * C-7: approval is recorded with who, when, and the hash of what was approved;
 * N-5″ (PRDR-297) adds the builds that made it and the pack it was planned from.
 *
 * Exported for the second exit (PRDR-255). It stays the ONE writer of
 * `approval.json` on both exits, so the who/when/plan-hash record has a single
 * shape and a single place to get it wrong. `approvedBy` is the decision's own
 * `by` at every call site — there is no environment fallback on this path,
 * because an absent human is not an approving one (C-5).
 */
export function recordApproval(
  root: string,
  approvedBy: string,
  nowMs: number,
  made: { readonly builds: readonly string[]; readonly pack_hash: string | null },
): Approval {
  const approval = approvalSchema.parse({
    schema_version: SCHEMA_VERSION,
    approved_by: approvedBy,
    at: new Date(nowMs).toISOString(),
    plan_hash: planHash(root),
    builds: [...made.builds],
    pack_hash: made.pack_hash,
  });
  writeFileSync(approvalPath(root), `${JSON.stringify(approval, null, 2)}\n`);
  return approval;
}

