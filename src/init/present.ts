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
import type { CheckFailure, HeldFinding } from "../schemas/init.js";
import { ADVICE_INLINE_MAX, renderHeldFindings, writeAdvice } from "./present-advice.js";
import type { PresentQuestion } from "./questions.js";
import { defectInterrupt, defectLines, specLines, type PresentedDefault, type PresentedDefect, type PresentedRisk } from "./present-spec.js";
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
  /** C-2‴: the increments the plan was planned in. */
  readonly slices?: readonly { readonly id: string; readonly title: string; readonly tickets: readonly string[] }[];
  /** C-3′: every question planning could not answer, each with the assumption the plan proceeds on; C-3‴ merges near-duplicates. */
  readonly questions?: readonly PresentQuestion[];
  /** C-3⁗ (PRDR-282): every vetoable default the decision log holds, with its reason, listed beside the assumptions. */
  readonly defaults?: readonly PresentedDefault[];
  /** C-2¹⁴ (PRDR-284): the majors VALIDATE's last round left open, listed beside the defaults. */
  readonly risks?: readonly PresentedRisk[];
  /** C-4⁵ (PRDR-292): what PLAN found the pack leaves unsettled; while one is open, approval is not offered. */
  readonly specDefects?: readonly PresentedDefect[];
  /** C-3‴ (PRDR-282): planning questions the log's decisions already answer, by id, so they are named and not asked again. */
  readonly answeredByLog?: readonly { readonly id: string; readonly entry: string }[];
  /** Findings the reviews still held after their revision round, each marked with why (D-24′). */
  readonly findings?: readonly HeldFinding[];
  /** D-24′ (PRDR-209): where the full list went when it did not fit on the screen. */
  readonly adviceFile?: string;
  /**
   * PRDR-196: what the revision rounds did, summed over the slices.
   *
   * The audit of that ticket found the per-slice figure written to every cache
   * and read by nothing — a measurement stored where nobody looks, which is one
   * hop from the defect the ticket is about. PRESENT is where an operator
   * decides whether to approve, so it is where the number belongs.
   */
  readonly revisions?: { readonly resolved: number; readonly survived: number; readonly introduced: number };
  /** C-4⁗″ (PRDR-200): the same count with nothing revised — never shown apart from the line above. */
  readonly churn?: { readonly resolved: number; readonly survived: number; readonly introduced: number };
  /**
   * PRDR-166: the globs DISCOVER actually searched, so an AWAIT_INFO answer can
   * be put where the next run will read it.
   *
   * Carried from `DISCOVER.json`'s recorded `patterns_searched` rather than
   * imported from `DOC_PATTERNS`: a second copy in the message would drift from
   * the one that did the searching, and the operator would be told to satisfy
   * the wrong list.
   */
  readonly docPatterns?: readonly string[];
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
  const questions = input.questions ?? [];
  if (questions.length > 0) {
    lines.push(
      "",
      `Open questions (${questions.length}) — the plan proceeds on the assumption stated; to change one, answer it in the planning documents and re-run \`detent init\` (C-3′/C-8):`,
    );
    for (const q of questions) {
      lines.push(`  ${q.blocking ? "[BLOCKING] " : ""}${q.id}: ${q.question}`);
      if (q.assumption !== "") lines.push(`      assumed: ${q.assumption}`);
      /* C-3‴: one answer covers both; the other id is named so its own assumption can be found. */
      if (q.also !== undefined && q.also.length > 0) lines.push(`      also asked as ${q.also.join(", ")} — the same question in another stage's words; one answer covers both (C-3‴)`);
    }
  }
  const answered = input.answeredByLog ?? [];
  if (answered.length > 0) {
    lines.push("", `Not asked again (${answered.length}) — the decision log already answers: ${answered.map((a) => `${a.id} by ${a.entry}`).join(", ")} (C-3‴).`);
  }
  lines.push(...defectLines(defects), ...failureLines(failures), ...specLines(input.defaults ?? [], input.risks ?? []));
  const edges = input.derivedEdges ?? [];
  if (edges.length > 0) {
    lines.push(
      "",
      `Dependencies Detent derived (${edges.length}) — the plan declared a name one ticket owns and another needs, so the edge is the plan's own, not a guess (A-1‴):`,
    );
    for (const e of edges) lines.push(`  ${e.consumer} → ${e.provider}   (${e.contract})`);
  }
  const rev = input.revisions;
  if (rev !== undefined && rev.resolved + rev.survived + rev.introduced > 0) {
    lines.push(
      "",
      `Revision rounds: ${String(rev.resolved)} finding(s) resolved, ${String(rev.survived)} survived the revision, ` +
        `${String(rev.introduced)} introduced by it (PRDR-196).`,
    );
    /**
     * C-4⁗″ (PRDR-200): never the revision figure alone.
     *
     * The same arithmetic over repeated reads of an UNCHANGED draft still
     * returns resolutions and introductions, because the reviewer does not
     * reproduce itself. Read without that line beside it, the figure above
     * says the revision did something it may not have done.
     *
     * PRDR-270: as a RATE, and with the two lines named as the different
     * measurements they are. This printed the churn's raw counts, which at
     * `PLAN_REVIEW_SAMPLES` = 3 are summed over k*(k-1) = 6 ordered pairs, beside
     * a revision figure over ONE before/after pair — the scale mismatch
     * `nullNote` renders a rate to avoid, committed directly under a comment
     * that claimed this code prevented it. The old sentence also told the reader
     * the difference between the lines was the revision's doing and, after the
     * semicolon, not to subtract them. Both halves are gone: the rates are over
     * different populations — unfiltered reads against the filtered set — so
     * their difference is not an effect size in either direction.
     */
    const churn = input.churn;
    if (churn !== undefined) {
      const seen = churn.resolved + churn.survived;
      const rate = seen === 0 ? null : Math.round((churn.resolved / seen) * 100);
      lines.push(
        rate === null
          ? `  ...and no null was sampled for this draft, so the figure above stands unqualified (C-4⁗″).`
          : `  ...and with NOTHING revised, repeated reads of the same draft resolve ${String(rate)}% of what they saw. ` +
            `That rate is over UNFILTERED reads and the figure above is over the filtered set, so the two are not the ` +
            `same baseline and the gap between them is not the revision's effect (C-4⁗″, PRDR-270).`,
      );
    }
  }
  const findings = input.findings ?? [];
  if (findings.length > 0) lines.push(...renderHeldFindings(findings, input.adviceFile));
  lines.push("", "Bindings and tickets are overridable — edit them and re-run `detent init` (C-3b/C-8).");
  /** S-3″ (PRDR-121): shown only when this run produced evidence it would have helped. */
  const reminder = symbolReminder(input.symbols, findings);
  if (reminder !== null) lines.push(reminder);
  return lines.join("\n");
}

/**
 * PRDR-166: where the answer goes, in terms the next run will honour.
 *
 * "Answer them in the planning documents" was the whole instruction, and it is
 * unfollowable: a `planning-answers.md` at the root matches none of DISCOVER's
 * globs, so the file is never read, planning re-derives, and the same question
 * returns with nothing to distinguish it from an answer judged inadequate.
 */
export function answerInstruction(patterns: readonly string[]): string {
  const base =
    "Answer them in a planning document and re-run `detent init` — only the slices whose inputs changed are re-planned (C-8).";
  if (patterns.length === 0) return base;
  return [
    base,
    "",
    "A planning document is a file matching one of the globs DISCOVER searched — an answer written anywhere else is not read:",
    ...patterns.map((p) => `  ${p}`),
  ].join("\n");
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
  readonly print?: (text: string) => void;
  readonly now?: () => number;
}

export async function presentStage(deps: PresentDeps): Promise<PhaseOutcome> {
  /* D-24′ (PRDR-209): a wall goes to a file and the screen gets the summary; a short list stays inline. */
  const held = deps.findings ?? [];
  const adviceFile = held.length > ADVICE_INLINE_MAX ? writeAdvice(deps.root, held) : undefined;
  /* A-1⁷ (PRDR-293): the checks, on the tickets and the bindings as they stand. */
  const failures = presentFailures(deps.tickets, deps.slices ?? [], deps.checks, { bindings: deps.bindings, packages: deps.packages ?? [ROOT_PACKAGE] });
  const presentation = renderPresentation({ ...deps, failures, ...(adviceFile === undefined ? {} : { adviceFile }) });
  deps.print?.(presentation);

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
    blocking: (deps.questions ?? []).filter((q) => q.blocking).length,
    spec_defects: (deps.specDefects ?? []).length,
    check_failures: failures.length,
  } satisfies Presentation);

  /** C-4⁵ (PRDR-292): an open spec defect holds approval, and the operator is told each one and how a re-run closes it. */
  const defective = defectInterrupt(presentation, deps.specDefects ?? []);
  if (defective !== null) return defective;
  /** A-1⁷ (PRDR-293): so does a check that still fails, a path no gate can fail among them (V-5′). */
  const failing = failureInterrupt(presentation, failures);
  if (failing !== null) return failing;

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
      message: [
        presentation,
        "",
        `${String(blocking.length)} blocking question(s) need an answer before this plan can be approved:`,
        blocking.map((q, i) => `  ${String(i + 1)}. ${q.question}`).join("\n"),
        "",
        answerInstruction(deps.docPatterns ?? []),
      ].join("\n"),
      items: blocking.map((q) => q.question),
    };
  }

  const decision: ApprovalDecision = deps.ask === undefined ? { kind: "deferred" } : await deps.ask(presentation);

  if (decision.kind === "approved") {
    recordApproval(deps.root, decision.by, deps.now?.() ?? Date.now());
    return { kind: "complete", outputs: { approved: true, approved_by: decision.by } };
  }

  /*
   * C-7: declining or deferring both leave the plan READY-unapproved. Neither
   * is an error, and the first `run` presents the same summary either way —
   * the rendering persisted above is the one it replays (PRDR-255).
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

/**
 * C-7: approval is recorded with who, when, and the hash of what was approved.
 *
 * Exported for the second exit (PRDR-255). It stays the ONE writer of
 * `approval.json` on both exits, so the who/when/plan-hash record has a single
 * shape and a single place to get it wrong. `approvedBy` is the decision's own
 * `by` at every call site — there is no environment fallback on this path,
 * because an absent human is not an approving one (C-5).
 */
export function recordApproval(root: string, approvedBy: string, nowMs: number): Approval {
  const approval = approvalSchema.parse({
    schema_version: SCHEMA_VERSION,
    approved_by: approvedBy,
    at: new Date(nowMs).toISOString(),
    plan_hash: planHash(root),
  });
  writeFileSync(approvalPath(root), `${JSON.stringify(approval, null, 2)}\n`);
  return approval;
}

