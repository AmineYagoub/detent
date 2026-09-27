import { heldAs } from "./present-advice.js";
import type { Budgets } from "../schemas/budgets.js";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { parseArtifact } from "../schemas/common.js";
import { contractKey, planDraftSchema, type PlanDraftTicket, type PlanReview, type SliceSpec, type SpecDefect } from "../schemas/init.js";
import { planSlices } from "./plan-slices.js";
import { wholePlanReview } from "./plan-whole.js";
import { applyContracts, catalogueFindings } from "./contracts.js";
import type { Binding } from "../schemas/records.js";
import { allTickets, readTicket } from "../kernel/tickets/readers.js";
import type { PhaseOutcome } from "./machine.js";
import { withOneRelaunch } from "./retry.js";
import type { LaunchOptions } from "./launch-batch.js";
import type { Pack } from "../schemas/pack.js";
import { wholeProduct } from "./slice.js";
import { draftInputs, type PreviousDraft } from "./plan-inputs.js";
import { draftIssues, openDefects } from "./plan-draft-checks.js";

export { planDraftSkeleton } from "./plan-inputs.js";

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
  | "requirement_ids"
  | "baseline_ids"
  | "criterion_ids"
  | "risk_label";
type UnmappedDraftKeys = Exclude<keyof PlanDraftTicket, MappedDraftKeys>;
/** Fails to compile the moment a drafted field is left unhandled. */
const DRAFT_MAPPING_IS_TOTAL: UnmappedDraftKeys extends never ? true : never = true;
void DRAFT_MAPPING_IS_TOTAL;

export { BOOTSTRAP_TICKET_ID } from "./plan-write.js";
import { BOOTSTRAP_TICKET_ID, bootstrapScaffold, writePlan, type DraftedTicket, type WriteDeps } from "./plan-write.js";

export function planDraftPath(root: string): string {
  return path.join(stateDir(root), "state", "plan-draft.json");
}

export function planPath(root: string): string {
  return path.join(stateDir(root), "plan", "plan.json");
}

export interface PlanDeps {
  readonly root: string;
  readonly greenfield: boolean;
  /** D-10′ (PRDR-290): in greenfield, the stack entry the decision log records, which PLAN hands the writer; null in an existing project. */
  readonly stack: WriteDeps["stack"];
  /** Repo-relative docs the plan derives from — hashed into A-2 (C-8). */
  readonly docs: readonly string[];
  /** Slots that actually bound, for the bootstrap ticket's criteria. */
  readonly boundSlots: readonly string[];
  /** PRDR-081: the budget a ticket must fit — the planner sizes against it. */
  readonly budgets: Budgets;
  /**
   * PRDR-084: the artifact path is per-launch — PLAN writes a draft, REVIEW_PLAN
   * a verdict. D-28′ (PRDR-203): a launch may belong to a batch gated once.
   */
  readonly launch: (inputs: Record<string, unknown>, artifactOut?: string, options?: LaunchOptions) => Promise<void>;
  /** C-4⁗‴ (PRDR-204): the clock the draws' bounded wait runs on; real time by default. */
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * PRDR-268: how many revision rounds a faulted slice buys; `PLAN_REVISIONS`
   * by default.
   *
   * A seam on PRDR-251's terms. The whole content of a second round is what it
   * is drafted against, and while the count was a module constant no test could
   * reach a value other than one — the same reason the S-5 refusal "could not be
   * tested while this was an inline literal". Production passes nothing.
   */
  readonly revisionRounds?: number;
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
  /** PRDR-082, C-4⁵ (PRDR-292): the hash of PLAN's and the review's prompts, folded into every slice's cache key. */
  readonly promptHash?: string;
  /** C-2⁸ (PRDR-291): the checker's parse VALIDATE handed on, whose records key each slice; null or absent where WRITE wrote no pack. */
  readonly pack?: Pack | null;
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
): Promise<{ readonly tickets: PlanDraftTicket[]; readonly spec_defects: SpecDefect[] }> {
  /* C-4⁵ (PRDR-292): a draft refused for what it says is relaunched as one, not told its content was sound. */
  let refused = false;
  const attempt = await withOneRelaunch<{ tickets: PlanDraftTicket[]; spec_defects: SpecDefect[] }>(
    { stage: `PLAN${scope.slice === undefined ? "" : ` ${scope.slice.id}`}`, note: deps.note },
    async (previous) => {
      await draftPlan(deps, scope, previous === null ? null : { ...previous, refused });
      try {
        return { value: readValidatedDraft(deps.root, deps.pack ?? null), issue: null };
      } catch (err) {
        refused = err instanceof DraftRefusal;
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
export async function draftPlan(deps: PlanDeps, scope: DraftScope = {}, previous: PreviousDraft | null = null): Promise<void> {
  /* A re-run derives fresh (C-8); a stale draft is an echo chamber, not an input. */
  rmSync(planDraftPath(deps.root), { force: true });
  await deps.launch(draftInputs(deps, scope, previous));
}

/**
 * C-2‴ (PRDR-117): PLAN runs to the end of the product. Every slice is
 * drafted, reviewed and revised in turn (`planSlices`), the whole plan is
 * reviewed once for coherence and coverage (`wholePlanReview`) with one
 * targeted revision of the slices it faults, and only then are tickets
 * written — bootstrap first, cross-slice order enforced, orphans removed.
 * No stage here asks a human anything, and none asks at all (C-3⁗): what a
 * draft finds the pack leaves open rides to PRESENT as a spec defect (C-4⁵).
 */
export async function planStage(deps: PlanDeps): Promise<PhaseOutcome> {
  const slices: readonly SliceSpec[] = deps.slices !== undefined && deps.slices.length > 0 ? deps.slices : [wholeProduct(deps.docs)];
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
  /* A-1⁵: the specs too, so coverage is decided here rather than read by the review. */
  const early = checked(deps, planned.tickets, slices, []);
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
  const contracts = checked(deps, reviewed.tickets, slices, settledNames);
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
  /**
   * A-1⁵ (PRDR-201): `contracts.findings` is NOT in this list.
   *
   * PRDR-196 put the checker's findings in front of the operator under their
   * own heading precisely because one kind is proved and the other is
   * judgement, and said that merging them discards the distinction that makes
   * the first worth having. They were nonetheless also concatenated here, so
   * every proof was printed twice — once as a proof and once as a judgement
   * call "held after revision", which is the one thing it is not. Shown once,
   * under the heading that says what it is.
   */
  /* D-24′ (PRDR-209): the whole-plan review's leftovers survived its revision round, and are marked so. */
  const findings = [...held, ...heldAs(reviewed.remaining, "after-revision"), ...written.findings];
  return {
    kind: "complete",
    outputs: {
      ...written,
      /* C-4⁵ (PRDR-292): each open one holds approval at PRESENT until the pack is amended. */
      spec_defects: openDefects(deps.pack ?? null, [...planned.spec_defects, ...reviewed.spec_defects]) as unknown as Record<string, unknown>[],
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

/** C-4⁵ (PRDR-292): a draft refused for what it says of the pack, not for its shape. */
export class DraftRefusal extends Error {}

export function readValidatedDraft(root: string, pack: Pack | null): { readonly tickets: PlanDraftTicket[]; readonly spec_defects: SpecDefect[] } {
  const raw = readDraft(root);
  const parsed = raw === null ? null : parseArtifact(planDraftSchema, raw);
  if (parsed === null || !parsed.ok) {
    throw new Error(
      parsed === null
        ? "PLAN produced no draft artifact"
        : `PLAN produced an invalid draft: ${parsed.reason === "invalid" ? parsed.issues.join("; ") : "newer schema"}`,
    );
  }
  const issues = draftIssues(root, pack, parsed.value);
  if (issues.length > 0) throw new DraftRefusal(`PLAN's draft was refused: ${issues.join("; ")}`);
  return { tickets: [...parsed.value.tickets], spec_defects: [...parsed.value.spec_defects] };
}

/**
 * A-1‴, A-1⁵ and C-4⁵: the contract checks, and a name of a catalogued kind
 * that the pack's catalogue does not hold. Free, deterministic, and run twice:
 * before the whole-plan review and on what reaches disk.
 */
function checked(deps: PlanDeps, tickets: readonly DraftedTicket[], slices: readonly SliceSpec[], settled: readonly string[]): ReturnType<typeof applyContracts> {
  const result = applyContracts(tickets, slices.map((s) => s.id), settled, slices, bootstrapScaffold(deps.greenfield, deps.stack));
  return { ...result, findings: [...result.findings, ...catalogueFindings(result.tickets, deps.pack ?? null)] };
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

