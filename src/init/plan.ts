import type { Budgets } from "../schemas/budgets.js";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { parseArtifact } from "../schemas/common.js";
import { planDraftSchema, type CheckFailure, type PlanDraftTicket, type PlanReview, type SliceSpec, type SpecDefect } from "../schemas/init.js";
import { planSlices } from "./plan-slices.js";
import { checkPlan, failureLine, type PlanContext } from "./plan-checks.js";
import type { Gates } from "./plan-check-gates.js";
import type { Binding } from "../schemas/records.js";
import type { Skip } from "../adapter/bind.js";
import type { Candidate } from "../adapter/discover/types.js";
import { normalizeInvocation } from "../adapter/normalize.js";
import { ROOT_PACKAGE, gateLabel } from "../adapter/packages.js";
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
  /**
   * V-5′, A-1⁷ (PRDR-293): the packages and what each binds, which the gates
   * check reads. Absent, PLAN checks no gate, and PRESENT, which reads them
   * from `.detent/bindings.json` itself, still holds approval on a path no
   * gate can fail.
   */
  readonly gates?: Gates;
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
  /** Ids later slices depend on; a redraft keeps them or is discarded (`plan-cross.ts`). */
  readonly keepIds?: readonly string[];
  /** A-1⁷ (PRDR-293): what the checks proved wrong in `draft`, which this redraft fixes. */
  readonly failures?: readonly CheckFailure[];
  /** A-1⁷: the slice's draft the failures were found in, which a redraft keeps where they do not reach. */
  readonly draft?: readonly DraftedTicket[];
}

/** One drafting launch: the whole pack, or one slice of it (C-2‴). Called again with findings when a review asks (PRDR-084). */
export async function draftPlan(deps: PlanDeps, scope: DraftScope = {}, previous: PreviousDraft | null = null): Promise<void> {
  /* A re-run derives fresh (C-8); a stale draft is an echo chamber, not an input. */
  rmSync(planDraftPath(deps.root), { force: true });
  await deps.launch(draftInputs(deps, scope, previous));
}

/**
 * C-2‴ (PRDR-117): PLAN runs to the end of the product. Every slice is
 * drafted, checked, reviewed and revised in turn (`planSlices`), and after
 * every slice the checks run across the plan so far (A-1⁷, PRDR-293); only
 * then are tickets written — bootstrap first, cross-slice order enforced,
 * orphans removed. No stage here asks a human anything, and none asks at all
 * (C-3⁗): what a draft finds the pack leaves open rides to PRESENT as a spec
 * defect (C-4⁵), and what the checks still find there holds approval.
 *
 * The whole-plan model review is gone (A-1⁷). Its prompt carried every ticket
 * of every slice and outgrew its context on ksar-cloud's 547, and what it was
 * handed that code had proved it was told to treat as handled.
 */
export async function planStage(deps: PlanDeps): Promise<PhaseOutcome> {
  const slices: readonly SliceSpec[] = deps.slices !== undefined && deps.slices.length > 0 ? deps.slices : [wholeProduct(deps.docs)];
  const context = planContext(deps);
  const planned = await planSlices(deps, slices, context);
  /**
   * A-1‴ (PRDR-120): the declarations are checked by code, after every model
   * has had its say and before a ticket reaches disk. A provider the plan does
   * not already order before its consumer becomes an EDGE, derived from the
   * coupling rather than guessed. What still fails after the redrafts is the
   * operator's: PRESENT checks the tickets again as they stand, and holds
   * approval while any fails (A-1⁷).
   */
  const final = checkPlan(context, planned.tickets);
  const drafted = final.tickets;
  for (const d of final.derived) {
    deps.note?.(`${d.consumer} → ${d.provider}: edge derived from \`${d.contract}\` (A-1‴)`);
  }
  if (final.failures.length > 0) {
    deps.note?.(`checks: ${String(final.failures.length)} failure(s) remain after the redrafts, for the operator at PRESENT — ${final.failures.map(failureLine).join("; ")} (A-1⁷)`);
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
   * Every finding a slice's review still held after its revision round, with
   * A-1″'s repairs of the draft that stands. A finding that names a ticket a
   * later redraft has since replaced keeps its slice, so it can be found.
   */
  const live = new Set(drafted.map((t) => t.id));
  const held = planned.remaining.flatMap((r) =>
    r.findings.map((f) =>
      /* Keep the slice: a plan-wide finding names no ticket, and "which of twenty-five" is the first thing a reader asks. */
      f.ticket !== undefined && live.has(f.ticket) ? f : { ...f, finding: `[${r.slice}] ${f.finding}` },
    ),
  );
  /**
   * A-1⁵ (PRDR-201), A-1⁷ (PRDR-293): the checks' failures are NOT in this
   * list. What a check proves is not a judgement held after revision, and it
   * is not left for a session to read: it holds approval until the pack or the
   * tickets answer it, and PRESENT names each one from the tickets as they
   * stand.
   */
  const findings = [...held, ...written.findings];
  return {
    kind: "complete",
    outputs: {
      ...written,
      /* C-4⁵ (PRDR-292): each open one holds approval at PRESENT until the pack is amended. */
      spec_defects: openDefects(deps.pack ?? null, planned.spec_defects) as unknown as Record<string, unknown>[],
      review_findings: findings as unknown as Record<string, unknown>[],
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
      derived_edges: final.derived as unknown as Record<string, unknown>[],
    },
  };
}

/**
 * A-1⁷ (PRDR-293): what PLAN's checks read besides the tickets: the slices as
 * SLICE assigned them (none where no slice was cut, since then nothing was
 * assigned), the pack, the bootstrap's scaffold (A-1⁶), the gates, and the
 * work already DONE, which provides its names and is sent no redraft.
 */
export function planContext(deps: PlanDeps): PlanContext {
  return {
    slices: deps.slices ?? [],
    pack: deps.pack ?? null,
    scaffold: bootstrapScaffold(deps.greenfield, deps.stack),
    gates: deps.gates,
    done: allTickets(deps.root).filter((t) => t.state === "DONE"),
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
 * package and the slot are what is carried across (V-5′, PRDR-295): a
 * package's binding is promoted from what discovery finds in that package.
 *
 * The command stored is the one a gate RUNS, as `bindSlot` stores it: the
 * candidate normalized for invocation (V-4). Stored raw, a scaffold whose
 * `test` script is a runner that watches by default was stored as `npm run
 * test` and compared, before its first gate, with `npm run test -- --run`:
 * drift on a tree nothing had changed.
 */
export function finalizeBootstrap(
  root: string,
  ticketId: string,
  deps: {
    readonly readBindings: () => { readonly packages?: readonly string[]; readonly bindings: readonly Binding[]; readonly skips: readonly Skip[] };
    readonly writeBindings: (file: { packages?: string[]; bindings: Binding[]; skips: Skip[] }) => void;
    /** Candidates discoverable now, after bootstrap created the tooling, each with the package it was found in; none named is the root. */
    readonly rediscover: () => readonly (Candidate & { readonly package?: string })[];
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
    const now = candidates.find((c) => (c.package ?? ROOT_PACKAGE) === binding.package && c.slot === binding.slot);
    if (now === undefined) {
      /*
       * Bootstrap's gates passed, so SOMETHING ran — but nothing discoverable
       * backs this slot. Keeping it provisional is the honest record: an
       * approved binding with no config region has no baseline to drift from.
       */
      unresolved.push(gateLabel(binding));
      finalized.push(binding);
      continue;
    }
    finalized.push({
      ...binding,
      adapter: now.adapter,
      ref: now.ref,
      resolved: normalizeInvocation(now).command,
      config_hash: now.config_hash,
      ...(now.pm === null ? {} : { pm: now.pm }),
      executed_at: at,
      status: "approved",
    });
  }

  deps.writeBindings({ ...(file.packages === undefined ? {} : { packages: [...file.packages] }), bindings: finalized, skips: [...file.skips] });
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

