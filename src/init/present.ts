import { writeFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { approvalSchema, type Approval, type Binding } from "../schemas/records.js";
import type { Skip } from "../adapter/bind.js";
import type { Ticket } from "../schemas/ticket.js";
import type { HeldFinding, PlanQuestion, PlanReview } from "../schemas/init.js";
import { ADVICE_INLINE_MAX, renderHeldFindings, writeAdvice } from "./present-advice.js";
import { planHash } from "./machine.js";
import { symbolReminder } from "./symbol-reminder.js";
import type { SymbolsConfig } from "../adapter/symbols.js";
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
  /** Findings the reviews still held after their revision round, each marked with why (D-24′). */
  readonly findings?: readonly HeldFinding[];
  /** D-24′ (PRDR-209): where the full list went when it did not fit on the screen. */
  readonly adviceFile?: string;
  /**
   * PRDR-196: what `applyContracts` PROVED, kept apart from what the review
   * judged.
   *
   * These were computed on every run and never carried out of `plan.ts` — the
   * log had them, the plan output did not, so the operator saw 74 findings from
   * a paid session and none of the 7 a deterministic check had established for
   * nothing. One kind is reliable and the other is judgement; merging them
   * would throw away the distinction that makes the first kind worth having.
   */
  readonly contractFindings?: PlanReview["findings"];
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

/** C-2‴/C-3′: what PRESENT shows beyond the tickets, gathered from every planning phase's outputs. */
export function presentInputsFromOutputs(
  outputs: Readonly<Record<string, Record<string, unknown>>>,
): Pick<PresentInput, "slices" | "questions" | "findings" | "derivedEdges" | "gateNotices" | "contractFindings" | "revisions"> {
  /**
   * PRDR-157: `?? []` only covered null and undefined, so any OTHER wrong type
   * came straight back — a string was spread into characters and `q.question`
   * dereferenced `undefined`. This function's whole reason to exist is reading
   * a checkpoint an older build wrote, where every value is `unknown`.
   */
  const list = <T>(phase: string, key: string): T[] => {
    const value = outputs[phase]?.[key];
    return Array.isArray(value) ? (value as T[]) : [];
  };
  /** A question a person can actually be shown: both fields present and stringy. */
  const isQuestion = (q: unknown): q is PlanQuestion =>
    typeof q === "object" && q !== null && typeof (q as PlanQuestion).question === "string" && typeof (q as PlanQuestion).id === "string";
  const isSlice = (s: unknown): s is NonNullable<PresentInput["slices"]>[number] =>
    typeof s === "object" && s !== null && typeof (s as { id?: unknown }).id === "string" && Array.isArray((s as { tickets?: unknown }).tickets);
  /**
   * PRDR-164: the other two fields.
   *
   * The first pass filtered the ELEMENTS of `questions` and `slices` and
   * checked only the container type for these — so `review_findings: [null]`
   * survived the builder and `renderPresentation` died on `f.tag`, and
   * `symbol-reminder.ts` iterates the same array. "Returns something
   * renderable or nothing" has to hold for everything it returns.
   */
  const isFinding = (f: unknown): f is PlanReview["findings"][number] =>
    typeof f === "object" && f !== null && typeof (f as { tag?: unknown }).tag === "string" && typeof (f as { finding?: unknown }).finding === "string";
  const isEdge = (e: unknown): e is NonNullable<PresentInput["derivedEdges"]>[number] =>
    typeof e === "object" &&
    e !== null &&
    typeof (e as { consumer?: unknown }).consumer === "string" &&
    typeof (e as { provider?: unknown }).provider === "string" &&
    typeof (e as { contract?: unknown }).contract === "string";
  const seen = new Set<string>();
  const takenIds = new Set<string>();
  const questions: PlanQuestion[] = [];
  for (const q of [
    ...list<PlanQuestion>("ANALYZE", "open_questions"),
    ...list<PlanQuestion>("SLICE", "questions"),
    ...list<PlanQuestion>("PLAN", "questions"),
  ].filter(isQuestion)) {
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
  const plan = outputs["PLAN"]?.["plan"] as { slices?: unknown } | undefined;
  /**
   * PRDR-157: `slices: "not an array"` used to pass straight through, and
   * `renderPresentation` then read `.length` on the string (12, so the block
   * rendered) and iterated its characters until `s.tickets.length` threw. The
   * builder is the boundary; it returns something renderable or nothing.
   */
  const slices = (Array.isArray(plan?.slices) ? plan.slices : []).filter(isSlice);
  return {
    slices,
    questions,
    findings: list<PlanReview["findings"][number]>("PLAN", "review_findings").filter(isFinding),
    contractFindings: list<PlanReview["findings"][number]>("PLAN", "contract_findings").filter(isFinding),
    ...(((v): v is { resolved: number; survived: number; introduced: number } =>
      typeof v === "object" && v !== null && typeof (v as { resolved?: unknown }).resolved === "number")(
      outputs["PLAN"]?.["revision_summary"],
    )
      ? { revisions: outputs["PLAN"]["revision_summary"] as { resolved: number; survived: number; introduced: number } }
      : {}),
    ...(((v): v is { resolved: number; survived: number; introduced: number } =>
      typeof v === "object" && v !== null && typeof (v as { resolved?: unknown }).resolved === "number")(
      outputs["PLAN"]?.["churn_summary"],
    )
      ? { churn: outputs["PLAN"]["churn_summary"] as { resolved: number; survived: number; introduced: number } }
      : {}),
    derivedEdges: list<{ consumer: string; provider: string; contract: string }>("PLAN", "derived_edges").filter(isEdge),
    gateNotices: list<unknown>("DETERMINE_VERIFICATION", "gate_notices").filter((n): n is string => typeof n === "string"),
  };
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
    }
  }
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
     */
    const churn = input.churn;
    if (churn !== undefined) {
      lines.push(
        `  ...and with NOTHING revised, the same count over repeated reads of the same draft: ` +
          `${String(churn.resolved)} resolved, ${String(churn.survived)} survived, ${String(churn.introduced)} introduced. ` +
          `The difference between the two lines is what the revision did; the second line is not error to subtract (C-4⁗″).`,
      );
    }
  }
  const proved = input.contractFindings ?? [];
  if (proved.length > 0) {
    lines.push(
      "",
      `Contract checks (${String(proved.length)}) — proved by code from the tickets' own \`provides\`/\`consumes\`, no session and no judgement (A-1‴):`,
    );
    for (const f of proved) lines.push(`  ${f.tag}${f.ticket === undefined ? "" : ` (${f.ticket})`}: ${f.finding}`);
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
 * globs, so the file is never read, ANALYZE re-derives, and the same question
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
  /** Absent on a non-TTY: approval defers to the first `run` (C-7). */
  readonly ask?: (presentation: string) => Promise<ApprovalDecision>;
  readonly print?: (text: string) => void;
  readonly now?: () => number;
}

export async function presentStage(deps: PresentDeps): Promise<PhaseOutcome> {
  /* D-24′ (PRDR-209): a wall goes to a file and the screen gets the summary; a short list stays inline. */
  const held = deps.findings ?? [];
  const adviceFile = held.length > ADVICE_INLINE_MAX ? writeAdvice(deps.root, held) : undefined;
  const presentation = renderPresentation(adviceFile === undefined ? deps : { ...deps, adviceFile });
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

