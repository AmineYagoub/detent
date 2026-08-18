import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { approvalSchema, type Approval, type Binding } from "../schemas/records.js";
import type { Skip } from "../adapter/bind.js";
import type { Ticket } from "../schemas/ticket.js";
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
  if (input.bootstrap !== null) {
    lines.push(
      "",
      `Greenfield: ${input.bootstrap} establishes the project's own verification tooling.`,
      "Its gates passing is what promotes the provisional bindings above to approved (C-4).",
    );
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
export function recordApproval(root: string, approvedBy: string, nowMs: number): Approval {
  const approval = approvalSchema.parse({
    schema_version: 1,
    approved_by: approvedBy,
    at: new Date(nowMs).toISOString(),
    plan_hash: planHash(root),
  });
  writeFileSync(approvalPath(root), `${JSON.stringify(approval, null, 2)}\n`);
  return approval;
}

/** The hash a presentation covers, for callers that want it without writing. */
export function presentationHash(presentation: string): string {
  return createHash("sha256").update(presentation).digest("hex");
}
