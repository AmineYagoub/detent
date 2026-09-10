import type { Budgets } from "../schemas/budgets.js";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { parseArtifact } from "../schemas/common.js";
import { contractKey, planDraftSchema, type Analysis, type PlanDraftTicket, type PlanQuestion, type PlanReview, type SliceSpec } from "../schemas/init.js";
import { sessionBudget } from "./plan-review.js";
import { planSlices } from "./plan-slices.js";
import { wholePlanReview } from "./plan-whole.js";
import { applyContracts } from "./contracts.js";
import { sizingEvidence } from "./sizing-evidence.js";
import { PRODUCTION_BASELINE } from "./baseline.js";
import type { Binding } from "../schemas/records.js";
import { allTickets, readTicket } from "../kernel/tickets/readers.js";
import type { PhaseOutcome } from "./machine.js";
import { previousAttemptInput, withOneRelaunch } from "./retry.js";

/**
 * T-066 — PLAN generation and the bootstrap lifecycle (C-4, A-2).
 *
 * The planner drafts feature tickets; **Detent constructs the bootstrap
 * ticket itself**. That division is C-4's, and it matters: bootstrap #1 must
 * establish the project's native verification tooling and *prove every bound
 * slot executes green*, and a planner that forgot it — or wrote criteria that
 * did not actually prove it — would produce a plan whose whole foundation is
 * unverified. So the ticket is a fixed construction, its criteria derived
 * from the bindings that exist, and every other ticket is blocked on it.
 *
 * Greenfield bindings stay `provisional` until #1's gates pass; the flip to
 * `approved` (with baseline hashes) happens in the run loop when #1 reaches
 * DONE — see `finalizeBootstrap`.
 */

/**
 * PRDR-101's structural half: the draft-to-ticket mapping below is hand-written,
 * and `non_goals` went unhandled for the life of the pipeline because an
 * unmapped field does not fail — the ticket schema simply defaults it. Nothing
 * catches that, least of all the suite: the shared draft fixture writes
 * `non_goals: []`, which cannot distinguish dropped from honestly empty.
 *
 * So the mapping is made total at COMPILE time. Every key of a drafted ticket
 * must appear in `MappedDraftKeys`; adding a field to `planDraftSchema` without
 * listing it here is a type error rather than a silent default. The list is
 * still written by hand — but now it is checked against the schema, which is
 * the part that was missing.
 */
type MappedDraftKeys =
  | "id"
  | "type"
  | "title"
  | "description"
  | "acceptance_criteria"
  | "non_goals"
  | "surface"
  | "depends_on"
  | "provides"
  | "consumes"
  | "risk_label";
type UnmappedDraftKeys = Exclude<keyof PlanDraftTicket, MappedDraftKeys>;
/** Fails to compile the moment a drafted field is left unhandled. */
const DRAFT_MAPPING_IS_TOTAL: UnmappedDraftKeys extends never ? true : never = true;
void DRAFT_MAPPING_IS_TOTAL;

export { BOOTSTRAP_TICKET_ID } from "./plan-write.js";
import { BOOTSTRAP_TICKET_ID, writePlan, type DraftedTicket } from "./plan-write.js";

export function planDraftPath(root: string): string {
  return path.join(stateDir(root), "state", "plan-draft.json");
}

export function planPath(root: string): string {
  return path.join(stateDir(root), "plan", "plan.json");
}

export interface PlanDeps {
  readonly root: string;
  readonly greenfield: boolean;
  readonly analysis: Analysis | null;
  /** Repo-relative docs the plan derives from — hashed into A-2 (C-8). */
  readonly docs: readonly string[];
  /** Slots that actually bound, for the bootstrap ticket's criteria. */
  readonly boundSlots: readonly string[];
  /** PRDR-081: the budget a ticket must fit — the planner sizes against it. */
  readonly budgets: Budgets;
  /** PRDR-084: the artifact path is per-launch — PLAN writes a draft, REVIEW_PLAN a verdict. */
  readonly launch: (inputs: Record<string, unknown>, artifactOut?: string) => Promise<void>;
  readonly note?: (text: string) => void;
  /**
   * PRDR-194: where work actually BEGINS, distinct from `note`.
   *
   * `note` carries verdicts, reuse status, drift explanations and warnings as
   * well as progress, so a marker fed from it reports whichever came last — a
   * spend announcement was recorded as what a run was doing. One seam, one job.
   */
  readonly progress?: (text: string) => void;
  /** C-2‴ (PRDR-117): the increments SLICE cut; PLAN plans each in turn. Empty = one unnamed slice over `docs`. */
  readonly slices?: readonly SliceSpec[];
  /** C-2‴: the production baseline the plan must deliver, or "none" — written into the config. */
  readonly baseline?: "production" | "none";
  /** PRDR-082: the planner prompt hash, folded into every slice's cache key. */
  readonly promptHash?: string;
}

/**
 * The EXACT artifact shape PLAN must write (PRDR-067's sibling lesson from
 * T-140: prose contracts drift; `expected_output` plus a strict validator
 * does not). A test parses this skeleton through `planDraftSchema`.
 */
export function planDraftSkeleton(): Record<string, unknown> {
  return {
    schema_version: 1,
    tickets: [
      {
        id: "t-100",
        type: "feature",
        title: "<short imperative title — required>",
        description: "<what and why — may be empty>",
        acceptance_criteria: ["<testable criterion — at least one, non-empty>"],
        non_goals: ["<explicitly out of scope — may be empty list>"],
        surface: ["src/**", "tests/**"],
        depends_on: [],
        /** A-1‴: the names this ticket OWNS, each with the meaning a consumer needs. */
        provides: [{ kind: "symbol", id: "<pkg/path.ExportedName>", note: "<what it means — a consumer session is handed this verbatim>" }],
        /** A-1‴: names another ticket owns. Detent derives the dependency edge from these. */
        consumes: [{ kind: "config", id: "<KEY another ticket introduces — omit the list if none>" }],
        risk_label: false,
      },
    ],
    /** C-3′: omit the entry entirely when the slice raises no question — most do not. */
    questions: [
      {
        id: "<slice>-q1",
        question: "<a fact outside the documents AND outside engineering judgement — omit the entry if none>",
        blocking: false,
        assumption: "<what the plan proceeds on while it is unanswered — required unless blocking>",
      },
    ],
  };
}

/**
 * C-4⁗′ (PRDR-118): draft, and if the artifact is unusable, draft once more
 * with the validator's own words. `planDraftSchema` is strict, so one stray
 * key in one ticket of one slice would otherwise end a run that has already
 * planned nineteen others.
 */
export async function draftAndRead(
  deps: PlanDeps,
  scope: DraftScope,
): Promise<{ readonly tickets: PlanDraftTicket[]; readonly questions: PlanQuestion[] }> {
  const attempt = await withOneRelaunch<{ tickets: PlanDraftTicket[]; questions: PlanQuestion[] }>(
    { stage: `PLAN${scope.slice === undefined ? "" : ` ${scope.slice.id}`}`, note: deps.note },
    async (previous) => {
      await draftPlan(deps, scope, previous);
      try {
        return { value: readValidatedDraft(deps.root), issue: null };
      } catch (err) {
        return { value: null, issue: (err as Error).message };
      }
    },
  );
  if (attempt.value === null) {
    throw new Error(`PLAN could not draft ${scope.slice === undefined ? "the plan" : `slice ${scope.slice.id} (${scope.slice.title})`}: ${attempt.issue ?? "no usable draft"}. Slices already planned are cached — re-run \`detent init\` to resume here (C-8).`);
  }
  return attempt.value;
}

export interface DraftScope {
  readonly slice?: SliceSpec;
  readonly planIndex?: readonly DraftedTicket[];
  readonly findings?: PlanReview["findings"];
  /** Ids later slices depend on; a redraft keeps them or is discarded (plan-whole). */
  readonly keepIds?: readonly string[];
}

/** One drafting launch: the whole pack, or one slice of it (C-2‴). Called again with findings when a review asks (PRDR-084). */
export async function draftPlan(
  deps: PlanDeps,
  scope: DraftScope = {},
  previous: { readonly issue: string } | null = null,
): Promise<void> {
  /* A re-run derives fresh (C-8); a stale draft is an echo chamber, not an input. */
  rmSync(planDraftPath(deps.root), { force: true });
  const slice = scope.slice;
  const docs = slice !== undefined && slice.docs.length > 0 ? slice.docs : deps.docs;
  await deps.launch({
    stage: "PLAN",
    analysis: deps.analysis,
    docs,
    greenfield: deps.greenfield,
    bound_slots: deps.boundSlots,
    /**
     * PRDR-081: the planner sizes tickets against the budget that will
     * actually execute them. Without it the plan mirrors its documents'
     * altitude — a PRD in, PRD-sized epics out, each far past what one
     * session can finish or a gate can verify.
     */
    session_budget: sessionBudget(deps.budgets),
    /** X-4″ (PRDR-102): what the previous plan of these documents measured — turns per session, sessions that reported themselves oversized. */
    ...(sizingEvidence(deps.root) === null ? {} : { sizing_evidence: sizingEvidence(deps.root) }),
    ...(slice === undefined ? {} : { slice }),
    /** C-2⁗: the baseline items this slice carries, with what each is verified by — tickets are drafted from them. */
    ...(slice === undefined || deps.baseline === "none" || slice.baseline_items.length === 0
      ? {}
      : { production_baseline: PRODUCTION_BASELINE.filter((b) => slice.baseline_items.includes(b.id)) }),
    ...(scope.planIndex === undefined || scope.planIndex.length === 0
      ? {}
      : { plan_index: scope.planIndex.map((t) => ({ id: t.id, slice: t.slice, title: t.title, surface: t.surface })) }),
    ...(scope.findings === undefined ? {} : { review_findings: scope.findings }),
    ...(scope.keepIds === undefined || scope.keepIds.length === 0 ? {} : { keep_ids: scope.keepIds }),
    ...previousAttemptInput(previous, "plan draft"),
    expected_output: planDraftSkeleton(),
    instruction: `${
      deps.greenfield
        ? "Draft the feature tickets. Do NOT draft a scaffolding or setup ticket — Detent adds the bootstrap ticket itself and blocks everything on it."
        : "Draft the tickets. Each needs non-empty, testable acceptance criteria and an explicit surface."
    }${
      slice === undefined
        ? ""
        : ` Draft ONLY slice \`${slice.id}\` (${slice.title}): every requirement id in its \`requirement_ids\` and every baseline item in its \`baseline_items\` reaches a ticket, and nothing outside it does. A \`production_baseline\` item becomes tickets whose criteria are its \`verifiable_by\`, sourced \`baseline:PB-###\` (C-2⁗). Ticket ids are \`t-${slice.id}-NNN\`. A ticket that needs code an earlier slice built names that ticket in \`depends_on\` by its id from \`plan_index\`.`
    } Size every ticket to ONE implement session inside \`session_budget\`, and order the plan as vertical slices (walking skeleton first), never as infrastructure layers completed ahead of the first end-to-end path. A question the documents cannot answer goes in \`questions\` with the assumption the draft proceeds on. Write EXACTLY the \`expected_output\` shape to artifact_out — a top-level object with \`schema_version\`, \`tickets\` and \`questions\` only; the validator is strict and refuses unknown keys (P2).${
      scope.findings === undefined ? "" : " A previous draft drew the `review_findings` in your inputs — address every one of them in this draft."
    }${
      scope.keepIds === undefined || scope.keepIds.length === 0 ? "" : " Keep every ticket id in `keep_ids` exactly — later slices depend on them."
    }`,
  });
}

/**
 * C-2‴ (PRDR-117): PLAN runs to the end of the product. Every slice is
 * drafted, reviewed and revised in turn (`planSlices`), the whole plan is
 * reviewed once for coherence and coverage (`wholePlanReview`) with one
 * targeted revision of the slices it faults, and only then are tickets
 * written — bootstrap first, cross-slice order enforced, orphans removed.
 * No stage here asks a human anything: questions ride to PRESENT.
 */
export async function planStage(deps: PlanDeps): Promise<PhaseOutcome> {
  const slices: readonly SliceSpec[] =
    deps.slices !== undefined && deps.slices.length > 0
      ? deps.slices
      : [{ id: "s01", title: "the plan", goal: "everything the documents ask for", requirement_ids: [], baseline_items: [], docs: [...deps.docs], depends_on: [], expected_tickets: 20, rationale: "" }];
  const planned = await planSlices(deps, slices);
  /**
   * PRDR-193: the free check runs BEFORE the paid one.
   *
   * `applyContracts` is deterministic and costs nothing, and every ticket it
   * needs exists the moment `planSlices` returns. It used to run only after the
   * whole-plan review — the largest paid prompt `init` builds — so that session
   * rediscovered what code could prove. Observed live: gate-312's review spent
   * a session on `t-s02-003 consumes a name no ticket provides`, cited this
   * checker by ticket id, wrote that such defects "should be corrected rather
   * than discovered by it", and then paid again to redraft the slice.
   *
   * Only the FINDINGS move. Edge derivation stays below, on the reviewed
   * tickets, because an edge must land on the text that reaches disk and a
   * redraft rewrites that text.
   */
  const early = applyContracts(planned.tickets, slices.map((s) => s.id));
  if (early.findings.length > 0) {
    deps.note?.(
      `contract checks before review: ${String(early.findings.length)} finding(s) proved by code, not paid for — ${early.findings.map((f) => f.tag).join(", ")}`,
    );
  }
  const reviewed = await wholePlanReview(deps, slices, planned.tickets, early.findings);
  /**
   * A-1‴ (PRDR-120): the declarations are checked by code, after every model
   * has had its say and before a ticket reaches disk. Two tickets owning one
   * name, a name nobody owns and a shared file two tickets create become
   * findings; a provider the plan does not already order before its consumer
   * becomes an EDGE, derived from the coupling rather than guessed.
   */
  const inPlan = new Set(reviewed.tickets.map((t) => t.id));
  /** Names DONE work already owns, even where this plan no longer redrafts it. */
  const settledNames = allTickets(deps.root)
    .filter((t) => t.state === "DONE" && !inPlan.has(t.id))
    .flatMap((t) => t.provides.map((p) => contractKey(p)));
  const contracts = applyContracts(
    reviewed.tickets,
    slices.map((s) => s.id),
    settledNames,
  );
  const drafted = contracts.tickets;
  for (const d of contracts.derived) {
    deps.note?.(`${d.consumer} → ${d.provider}: edge derived from \`${d.contract}\` (A-1‴)`);
  }
  if (contracts.findings.length > 0) {
    deps.note?.(`contract checks: ${contracts.findings.length} finding(s) — ${contracts.findings.map((f) => f.tag).join(", ")}`);
  }

  const ids = new Set(drafted.map((t) => t.id));
  if (ids.size !== drafted.length) throw new Error("PLAN drafted duplicate ticket ids across slices");
  if (ids.has(BOOTSTRAP_TICKET_ID)) throw new Error(`PLAN drafted ${BOOTSTRAP_TICKET_ID}; the bootstrap ticket is Detent's (C-4)`);
  for (const ticket of drafted) {
    for (const dep of ticket.depends_on) {
      if (!ids.has(dep)) throw new Error(`ticket ${ticket.id} depends on unknown ticket ${dep}`);
    }
  }
  const written = writePlan(deps, drafted, slices);

  /**
   * Every finding a review still held after its revision round, from BOTH
   * levels: each slice's own review (and the normalisation that dropped an
   * impossible edge), then the whole plan's. A finding that names a ticket the
   * whole-plan revision has since replaced is dropped — it was answered.
   */
  const live = new Set(drafted.map((t) => t.id));
  const held = planned.remaining.flatMap((r) =>
    r.findings.map((f) =>
      /* Keep the slice: a plan-wide finding names no ticket, and "which of twenty-five" is the first thing a reader asks. */
      f.ticket !== undefined && live.has(f.ticket) ? f : { ...f, finding: `[${r.slice}] ${f.finding}` },
    ),
  );
  const findings = [...held, ...reviewed.remaining, ...contracts.findings, ...written.findings];
  return {
    kind: "complete",
    outputs: {
      ...written,
      questions: [...planned.questions, ...reviewed.questions] as unknown as Record<string, unknown>[],
      review_findings: findings as unknown as Record<string, unknown>[],
      /**
       * PRDR-196: the deterministic checker's findings reach the operator.
       *
       * They were noted to the log and dropped here, so the only signal the
       * literature calls reliable was the only one PRESENT never showed.
       */
      contract_findings: contracts.findings as unknown as Record<string, unknown>[],
      /**
       * PRDR-196: summed for PRESENT, because a measurement written to a cache
       * nobody reads is the defect this ticket is about, one directory over.
       */
      revision_summary: planned.revisions.reduce(
        (a, r) => ({ resolved: a.resolved + r.resolved, survived: a.survived + r.survived, introduced: a.introduced + r.introduced }),
        { resolved: 0, survived: 0, introduced: 0 },
      ) as unknown as Record<string, unknown>,
      /**
       * C-4⁗″ (PRDR-200): the null, summed the same way and shown beside it.
       *
       * The revision figure above was read for a week as though it isolated
       * the revision. It does not: run over reads of an UNCHANGED draft the
       * same arithmetic still returns resolutions and introductions, because
       * the reviewer does not reproduce itself. Neither number means anything
       * without the other, so neither is presented without the other.
       */
      churn_summary: planned.churns.reduce(
        (a, r) => ({ resolved: a.resolved + r.resolved, survived: a.survived + r.survived, introduced: a.introduced + r.introduced }),
        { resolved: 0, survived: 0, introduced: 0 },
      ) as unknown as Record<string, unknown>,
      derived_edges: contracts.derived as unknown as Record<string, unknown>[],
    },
  };
}

/*
 * ---------------------------------------------------------------------------
 * The other half of C-4: finalization when bootstrap #1 goes DONE
 */

/**
 * C-4: "Greenfield bindings are recorded `provisional` at init and finalized —
 * drift baseline set — when ticket #1's gates pass." Called by the run loop
 * the moment the bootstrap ticket reaches DONE; a no-op for every other
 * ticket, and idempotent.
 *
 * Finalization RE-DISCOVERS rather than looking the provisional binding up by
 * its own adapter. A greenfield binding was proposed from the chosen stack
 * (`greenfield:typescript`) and never discovered, because the tooling did not
 * exist; bootstrap #1 has just created it, so the real binding — with the
 * real config region that V-3 will watch — is what discovery finds NOW. The
 * slot is the only thing carried across.
 */
export function finalizeBootstrap(
  root: string,
  ticketId: string,
  deps: {
    readonly readBindings: () => { bindings: readonly Binding[]; skips: readonly unknown[] };
    readonly writeBindings: (file: { bindings: Binding[]; skips: unknown[] }) => void;
    /** Candidates discoverable now, after bootstrap created the tooling. */
    readonly rediscover: () => readonly {
      slot: string;
      adapter: string;
      ref: string;
      resolved: string;
      config_hash: string;
      pm: string | null;
    }[];
    readonly now?: () => string;
    readonly note?: (text: string) => void;
  },
): boolean {
  if (ticketId !== BOOTSTRAP_TICKET_ID) return false;
  const file = deps.readBindings();
  const provisional = file.bindings.filter((b) => b.status === "provisional");
  if (provisional.length === 0) return false;

  const candidates = deps.rediscover();
  const at = deps.now?.() ?? new Date().toISOString();
  const finalized: Binding[] = [];
  const unresolved: string[] = [];

  for (const binding of file.bindings) {
    if (binding.status !== "provisional") {
      finalized.push(binding);
      continue;
    }
    const now = candidates.find((c) => c.slot === binding.slot);
    if (now === undefined) {
      /*
       * Bootstrap's gates passed, so SOMETHING ran — but nothing discoverable
       * backs this slot. Keeping it provisional is the honest record: an
       * approved binding with no config region has no baseline to drift from.
       */
      unresolved.push(binding.slot);
      finalized.push(binding);
      continue;
    }
    finalized.push({
      ...binding,
      adapter: now.adapter,
      ref: now.ref,
      resolved: now.resolved,
      config_hash: now.config_hash,
      ...(now.pm === null ? {} : { pm: now.pm }),
      executed_at: at,
      status: "approved",
    });
  }

  deps.writeBindings({ bindings: finalized, skips: [...file.skips] });
  const promoted = provisional.length - unresolved.length;
  deps.note?.(
    `bootstrap complete: ${promoted} provisional binding(s) finalized with drift baselines (C-4)${ 
      unresolved.length === 0 ? "" : `; ${unresolved.join(", ")} stayed provisional — nothing discoverable backs them`}`,
  );
  return true;
}

/** Whether a ticket is claimable given C-4's bootstrap blocking. */
export function bootstrapBlocks(root: string, ticketId: string): boolean {
  if (ticketId === BOOTSTRAP_TICKET_ID) return false;
  if (!existsSync(path.join(stateDir(root), "plan", `${BOOTSTRAP_TICKET_ID}.json`))) return false;
  return readTicket(root, BOOTSTRAP_TICKET_ID).state !== "DONE";
}

export function readValidatedDraft(root: string): { readonly tickets: PlanDraftTicket[]; readonly questions: PlanQuestion[] } {
  const raw = readDraft(root);
  const parsed = raw === null ? null : parseArtifact(planDraftSchema, raw);
  if (parsed === null || !parsed.ok) {
    throw new Error(
      parsed === null
        ? "PLAN produced no draft artifact"
        : `PLAN produced an invalid draft: ${parsed.reason === "invalid" ? parsed.issues.join("; ") : "newer schema"}`,
    );
  }
  return { tickets: [...parsed.value.tickets], questions: [...parsed.value.questions] };
}

function readDraft(root: string): unknown {
  return readJson(planDraftPath(root));
}

function readJson(file: string): unknown {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

