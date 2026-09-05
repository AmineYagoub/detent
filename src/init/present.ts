import { writeFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { approvalSchema, type Approval, type Binding } from "../schemas/records.js";
import type { Skip } from "../adapter/bind.js";
import type { Ticket } from "../schemas/ticket.js";
import type { PlanQuestion, PlanReview } from "../schemas/init.js";
import { planHash } from "./machine.js";
import { bindingTable } from "./bind.js";
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
 */

export function approvalPath(root: string): string {
  return path.join(stateDir(root), "plan", "approval.json");
}

export interface PresentInput {
  readonly root: string;
  readonly tickets: readonly Ticket[];
  readonly bindings: readonly Binding[];
  readonly skips: readonly Skip[];
  readonly bootstrap: string | null;
  readonly assignments: Readonly<Record<string, string>>;
  /** C-2‴: the increments the plan was planned in. */
  readonly slices?: readonly { readonly id: string; readonly title: string; readonly tickets: readonly string[] }[];
  /** C-3′: every question planning could not answer, each with the assumption the plan proceeds on. */
  readonly questions?: readonly PlanQuestion[];
  /** Findings the reviews still held after their revision round. */
  readonly findings?: PlanReview["findings"];
}

/** C-2‴/C-3′: what PRESENT shows beyond the tickets, gathered from every planning phase's outputs. */
export function presentInputsFromOutputs(
  outputs: Readonly<Record<string, Record<string, unknown>>>,
): Pick<PresentInput, "slices" | "questions" | "findings"> {
  const list = <T>(phase: string, key: string): T[] => (outputs[phase]?.[key] as T[] | undefined) ?? [];
  const seen = new Set<string>();
  const takenIds = new Set<string>();
  const questions: PlanQuestion[] = [];
  for (const q of [...list<PlanQuestion>("ANALYZE", "open_questions"), ...list<PlanQuestion>("SLICE", "questions"), ...list<PlanQuestion>("PLAN", "questions")]) {
    const key = q.question.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    /**
     * PRDR-119: three stages number their questions independently, so the
     * batch could show the same id twice. The id is what a human writes down
     * when answering, so it has to mean one question.
     */
    let id = q.id;
    for (let n = 2; takenIds.has(id); n += 1) id = `${q.id}-${n}`;
    takenIds.add(id);
    questions.push({ ...q, id });
  }
  const plan = outputs["PLAN"]?.["plan"] as { slices?: PresentInput["slices"] } | undefined;
  return { slices: plan?.slices ?? [], questions, findings: list<PlanReview["findings"][number]>("PLAN", "review_findings") };
}

/** The PRESENT summary. Rendered identically by `init` and by `run` (C-7). */
export function renderPresentation(input: PresentInput): string {
  const lines = [
    "Plan ready for approval.",
    "",
    "Verification bindings:",
    bindingTable(input.bindings, input.skips),
    "",
    `Tickets (${input.tickets.length}):`,
    ...input.tickets.map((t) => {
      const blocked = t.blockers.length === 0 ? "" : `  ← blocked on ${t.blockers.join(", ")}`;
      const role = input.assignments[t.id];
      return `  ${t.id}  ${t.title}${blocked}${role === undefined ? "" : `  [${role.split("@")[0]}]`}`;
    }),
  ];
  if (input.slices !== undefined && input.slices.length > 1) {
    lines.push("", `Slices (${input.slices.length}, in order — a slice cannot start before the ones it thickens are DONE):`);
    for (const s of input.slices) lines.push(`  ${s.id}  ${s.title}  — ${s.tickets.length} ticket(s)`);
  }
  if (input.bootstrap !== null) {
    lines.push(
      "",
      `Greenfield: ${input.bootstrap} establishes the project's own verification tooling.`,
      "Its gates passing is what promotes the provisional bindings above to approved (C-4).",
    );
  }
  const questions = input.questions ?? [];
  if (questions.length > 0) {
    lines.push(
      "",
      `Open questions (${questions.length}) — the plan proceeds on the assumption stated; to change one, answer it in the planning documents and re-run \`detent init\` (C-3′/C-8):`,
    );
    for (const q of questions) {
      lines.push(`  ${q.blocking ? "[BLOCKING] " : ""}${q.id}: ${q.question}`);
      if (q.assumption !== "") lines.push(`      assumed: ${q.assumption}`);
    }
  }
  const findings = input.findings ?? [];
  if (findings.length > 0) {
    lines.push("", `Review findings held after revision (${findings.length}) — judgement calls for you, not defects the machine kept grinding on (D-24):`);
    for (const f of findings) lines.push(`  ${f.tag}${f.ticket === undefined ? "" : ` (${f.ticket})`}: ${f.finding}`);
  }
  lines.push("", "Bindings and tickets are overridable — edit them and re-run `detent init` (C-3b/C-8).");
  return lines.join("\n");
}

export type ApprovalDecision =
  | { readonly kind: "approved"; readonly by: string }
  | { readonly kind: "declined" }
  | { readonly kind: "deferred" };

export interface PresentDeps extends PresentInput {
  /** Absent on a non-TTY: approval defers to the first `run` (C-7). */
  readonly ask?: (presentation: string) => Promise<ApprovalDecision>;
  readonly print?: (text: string) => void;
  readonly now?: () => number;
}

export async function presentStage(deps: PresentDeps): Promise<PhaseOutcome> {
  const presentation = renderPresentation(deps);
  deps.print?.(presentation);

  /**
   * C-3′ (PRDR-117): the whole plan is written and shown FIRST; a question no
   * assumption could carry makes this AWAIT_INFO — one batch, asked once, at
   * the end — rather than a stop somewhere in the middle of planning.
   */
  const blocking = (deps.questions ?? []).filter((q) => q.blocking);
  if (blocking.length > 0) {
    return {
      kind: "interrupt",
      interrupt: "AWAIT_INFO",
      message:
        `${presentation}\n\n${blocking.length} blocking question(s) need an answer before this plan can be approved:\n` +
        `${blocking.map((q, i) => `  ${i + 1}. ${q.question}`).join("\n")}\n\n` +
        "Answer them in the planning documents and re-run `detent init` — only the slices whose inputs changed are re-planned (C-8).",
      items: blocking.map((q) => q.question),
    };
  }

  const decision: ApprovalDecision = deps.ask === undefined ? { kind: "deferred" } : await deps.ask(presentation);

  if (decision.kind === "approved") {
    recordApproval(deps.root, decision.by, deps.now?.() ?? Date.now());
    return { kind: "complete", outputs: { approved: true, approved_by: decision.by } };
  }

  /*
   * C-7: declining or deferring both leave the plan READY-unapproved. The
   * difference is only what the user was told; neither is an error, and the
   * first `run` presents the same summary either way.
   */
  return {
    kind: "interrupt",
    interrupt: "AWAIT_APPROVAL",
    message:
      decision.kind === "declined"
        ? `${presentation}\n\nApproval declined — the plan is ready but unapproved. Re-run \`detent init\` after editing, or approve at the start of \`detent run\`.`
        : `${presentation}\n\nApproval deferred — \`detent run\` will present this plan before executing (C-7).`,
    items: deps.tickets.map((t) => t.id),
  };
}

/** C-7: approval is recorded with who, when, and the hash of what was approved. */
function recordApproval(root: string, approvedBy: string, nowMs: number): Approval {
  const approval = approvalSchema.parse({
    schema_version: 1,
    approved_by: approvedBy,
    at: new Date(nowMs).toISOString(),
    plan_hash: planHash(root),
  });
  writeFileSync(approvalPath(root), `${JSON.stringify(approval, null, 2)}\n`);
  return approval;
}
