import { discover as discoverStack, gatherFacts } from "../adapter/discover/index.js";
import { ROOT_PACKAGE, findPackages, gateLabel, packageDir } from "../adapter/packages.js";
import { initLayout, stateDir } from "../fs/layout.js";
import type { Budgets } from "../schemas/budgets.js";
import { INIT_PHASES, type InitPhase } from "../schemas/init.js";
import type { PromptSet, SessionBackend } from "../sessions/backend.js";
import type { Sandbox } from "../sessions/sandbox.js";
import { determineVerification } from "./bind.js";
import { prepareAgents } from "./agents.js";
import { planDraftPath, planStage } from "./plan.js";
import { planOutputIntact } from "./plan-write.js";
import { presentStage, type ApprovalDecision } from "./present.js";
import { presentInputsFromOutputs } from "./present-inputs.js";
import { sliceStage, slicesFromOutputs } from "./slice.js";
import { baselineDigest } from "./baseline.js";
import type { SymbolsConfig } from "../adapter/symbols.js";
import { readBindings } from "../adapter/drift.js";
import { allTickets } from "../kernel/tickets/readers.js";
import type { Binding } from "../schemas/records.js";
import { awaitDocsMessage, discoverDocs, docPatternsFor } from "./discover-docs.js";
import { phaseSpend } from "./phase-spend.js";
import { planBuilds } from "./plan-builds.js";
import { contentsDigest, listingDigest, valueDigest, type PhaseHandler, type PhaseOutcome } from "./machine.js";
import { settleAmendments } from "./amendment-replan.js";
import { launchInitSession, withInitJournal } from "./session.js";
import { classifyPack, hasConformanceRecord, packDocuments, packNote, readConformanceRecord } from "./pack.js";
import { CONFORMANCE_RECORD_PATH, DECISION_LOG_PATH } from "../schemas/pack.js";
import { sessionDeps } from "./session-deps.js";
import { auditPhase } from "./audit.js";
import { decidePhase, planningDocs, type DecideAsk } from "./decide.js";
import { planningMarkers, writePhase } from "./write.js";
import { validatePhase } from "./validate.js";
import { isGreenfield } from "./greenfield.js";
import { placement } from "./slice-seed.js";
import { declaredPackages, draftingPack, planningPack, planningStack, presentChecks } from "./planning-outputs.js";
import { estimator } from "./progress.js";

/**
 * The `init` pipeline, assembled (C-4.1).
 *
 * One handler per phase, in the PRD's order. Phases whose tickets have not
 * landed are simply absent — `pendingPhases()` names them, so a partial
 * pipeline reports what it cannot yet do instead of quietly reaching READY.
 */

export interface PipelineDeps {
  readonly root: string;
  readonly backend: SessionBackend;
  readonly prompts: PromptSet;
  readonly budgets: Budgets;
  /** PRDR-086: narrows C-2 discovery to this increment's documents. Empty = all. */
  readonly planDocs?: readonly string[];
  readonly docsDomains?: readonly string[];
  /** PRDR-114 / PRDR-197: what each init role is routed to — its model, and its effort. */
  readonly modelRouting?: Readonly<Record<string, string>>;
  readonly effortRouting?: Readonly<Record<string, string>>;
  /** C-2‴ (PRDR-117): the production baseline SLICE plans against; "none" opts out. */
  readonly planBaseline?: "production" | "none";
  /** S-3⁸ (PRDR-121): optional symbol intelligence; absent, every stage runs unchanged. */
  readonly symbols?: SymbolsConfig;
  /** C-2⁵′ (PRDR-125): the ticket band one slice should hold. */
  readonly sliceSize?: { readonly min: number; readonly max: number };
  /**
   * S-6‴: how a VALIDATE reviewer gets the foundations, the config's
   * `review_foundations`, `given` unless the config says `read`. `init` always
   * passes it. A pipeline built without it, as a test builds one, has each
   * reviewer read them.
   */
  readonly reviewFoundations?: "read" | "given";
  readonly note?: (text: string) => void;
  /**
   * PRDR-194: where work actually BEGINS, distinct from `note`.
   *
   * `note` carries verdicts, reuse status, drift explanations and warnings as
   * well as progress, so a marker fed from it reports whichever came last — a
   * spend announcement was recorded as what a run was doing. One seam, one job.
   */
  readonly progress?: (text: string) => void;
  /** PRDR-185: injectable wait for the outage backoff; real time by default. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** PRDR-189: the clock a stated reset is measured against. */
  readonly now?: () => Date;
  /**
   * C-7: present inline on a TTY; absent defers approval to the first `run`,
   * which presents the persisted rendering and offers the decision there
   * (PRDR-255 — `kernel/run.ts`'s `offerDeferredApproval`). Absent is never
   * approved: `presentStage` returns `deferred`, and the second exit refuses
   * without an asker of its own.
   */
  readonly askApproval?: (presentation: string) => Promise<ApprovalDecision>;
  /** C-3⁗ (PRDR-282): DECIDE's questions, asked on a terminal; absent, each recommended answer is taken (specification decision 9). */
  readonly askDecisions?: DecideAsk;
  /** S-1⁗ (PRDR-285): the sandbox VALIDATE's reviewers simulate in, asked when a round first runs; absent, this machine is probed. */
  readonly sandbox?: () => Promise<Sandbox>;
  /** C-7‴ (PRDR-296): shows PRESENT's rendering before `askApproval` is put; nothing else prints it. */
  readonly print?: (text: string) => void;
  /** N-5″ (PRDR-297): put before `askApproval` where more than one build made the plan; absent, the answer is no. */
  readonly acceptMixedBuilds?: (builds: readonly string[]) => Promise<boolean>;
}

export function buildPipeline(deps: PipelineDeps): PhaseHandler[] {
  return [
    initFsPhase(deps),
    discoverPhase(deps),
    auditPhase(deps),
    decidePhase(deps),
    writePhase(deps),
    validatePhase(deps),
    determinePhase(deps),
    slicePhase(deps),
    planPhase(deps),
    prepareAgentsPhase(deps),
    presentPhase(deps),
  ];
}

/** Phases with no handler yet, in pipeline order — the honest gap list. */
export function pendingPhases(handlers: readonly PhaseHandler[]): InitPhase[] {
  const built = new Set(handlers.map((h) => h.phase));
  return INIT_PHASES.filter((p) => !built.has(p));
}

/* --------------------------------------------------------------------------- */

/** PRDR-086: the configured slice scope, or the full C-2 family set. */
const docPatterns = (deps: PipelineDeps): readonly string[] => docPatternsFor(deps.planDocs);

/**
 * C-2¹² (PRDR-282): DISCOVER never lists the decision log. DECIDE writes it,
 * and a listing that held it would replay every phase from DISCOVER on the next
 * `init`; the planning phases add it to what they read (`planningDocs`).
 */
const notTheLog = (doc: string): boolean => doc !== DECISION_LOG_PATH;

function initFsPhase(deps: PipelineDeps): PhaseHandler {
  return {
    phase: "INIT_FS",
    /*
     * The layout either exists or it does not; nothing about its contents
     * changes what this phase does.
     */
    digest: () => listingDigest([stateDir(deps.root)]),
    run: async () => {
      initLayout(deps.root);
      return { kind: "complete", outputs: { state_dir: ".detent" } };
    },
  };
}

function discoverPhase(deps: PipelineDeps): PhaseHandler {
  return {
    phase: "DISCOVER",
    /**
     * The LISTING, not the contents: DISCOVER answers "which files exist",
     * so editing a document's text must not re-run it (C-8). Both halves of
     * C-2 are here — planning docs and stack facts.
     *
     * C-2⁹ (PRDR-279): with a conformance record, DISCOVER also answers
     * whether the pack is still the one validated, which is a question about
     * what its documents say, so their contents and the record's join the
     * digest. Without a record the digest is the listing alone, exactly as
     * before: a raw document set keeps C-8's behaviour, and a checkpoint
     * written before this field is reused only where no record exists, which
     * is the one case its missing `pack` output can mean.
     */
    digest: () => {
      const docs = discoverDocs(deps.root, docPatterns(deps)).docs.filter(notTheLog);
      const stack = discoverStack(deps.root);
      const listing = listingDigest([...docs, ...stack.stack.markers.map((m) => `marker:${m}`)]);
      if (!hasConformanceRecord(deps.root)) return listing;
      return `${listing}|${contentsDigest(deps.root, [...packDocuments(deps.root), CONFORMANCE_RECORD_PATH])}`;
    },
    run: async () => {
      const found = discoverDocs(deps.root, docPatterns(deps));
      const docs = { ...found, docs: found.docs.filter(notTheLog) };
      const stack = discoverStack(deps.root);
      if (docs.docs.length === 0) {
        /* C-2: no docs → AWAIT_DOCS with the exact list of what was looked for. */
        return {
          kind: "interrupt",
          interrupt: "AWAIT_DOCS",
          message: awaitDocsMessage(docs, deps.root),
          items: [...docs.patternsSearched],
        };
      }
      /*
       * C-2⁹ (PRDR-279): raw, written, conforming or changed, recorded for the
       * phases after this one and said aloud when it is a pack. AUDIT, DECIDE
       * and WRITE route on it (C-2¹¹, C-2¹², C-2¹³). VALIDATE classifies the
       * pack again when it runs, since WRITE, before it, may have written one
       * (C-2¹⁴).
       */
      const pack = classifyPack(deps.root, { greenfield: isGreenfield(stack.stack.markers) });
      const said = packNote(pack);
      if (said !== null) deps.note?.(said);
      return {
        kind: "complete",
        outputs: {
          docs: [...docs.docs],
          stack_markers: [...stack.stack.markers],
          package_manager: stack.stack.pm,
          candidate_count: stack.candidates.length,
          pack,
        },
      };
    },
  };
}

/**
 * V-5′: the marker files of every package below the root, which define its
 * candidates as the root's markers define the root's. Empty where the root is
 * the one package, so a project with one package keys as it did before them.
 */
function packageMarkers(root: string): string[] {
  return findPackages(root)
    .filter((pkg) => pkg !== ROOT_PACKAGE)
    .flatMap((pkg) => gatherFacts(packageDir(root, pkg)).markers.map((m) => `${pkg}/${m}`));
}

function determinePhase(deps: PipelineDeps): PhaseHandler {
  return {
    phase: "DETERMINE_VERIFICATION",
    /**
     * The CONTENTS of the files that define candidate commands: a changed
     * `scripts.test` must re-bind, which is the same region V-3 watches. In
     * greenfield, the stack entry it binds from (D-10′). V-5′ (PRDR-295): each
     * package's own marker files, and the packages the pack declares, where
     * there are any beyond the root.
     */
    digest: (ctx) => {
      const base = `${contentsDigest(deps.root, planningMarkers(ctx.outputs))}|${valueDigest(planningStack(deps.root, ctx.outputs))}`;
      const markers = packageMarkers(deps.root);
      const declared = declaredPackages(deps.root, ctx.outputs).filter((pkg) => pkg.path !== ROOT_PACKAGE);
      return markers.length === 0 && declared.length === 0 ? base : `${base}|${contentsDigest(deps.root, markers)}|${valueDigest(declared)}`;
    },
    run: async (ctx) =>
      await determineVerification({
        root: deps.root,
        ...(deps.symbols === undefined ? {} : { symbols: deps.symbols }),
        ...planningStack(deps.root, ctx.outputs),
        packages: declaredPackages(deps.root, ctx.outputs),
        /**
         * PRDR-156: this was the one handler in this file that did not forward
         * `note`, so V-1‴'s vacuous-gate notice was emitted into an undefined
         * callback and no operator ever saw it. The feature was complete,
         * tested at the adapter layer, and unreachable.
         */
        ...(deps.note === undefined ? {} : { note: deps.note }),
      }),
  };
}

/** C-2⁸: what a cut answers to besides the pack's ids: the baseline, the band and SLICE's prompt, not PLAN's or the review's (C-4⁵). */
const sliceBasis = (deps: PipelineDeps): string =>
  valueDigest([
    deps.planBaseline ?? "production",
    baselineDigest(),
    /* C-2⁵′: re-cutting on a new band is the whole point of the knob. */
    deps.sliceSize ?? { min: 12, max: 18 },
    deps.prompts.hashes.slice,
  ]);

/** C-4⁵ (PRDR-292): the prompts a slice's cache answers to, its draft's and its review's. */
const planPrompts = (deps: PipelineDeps): string => valueDigest([deps.prompts.hashes.plan, deps.prompts.hashes.plan_review]);

function slicePhase(deps: PipelineDeps): PhaseHandler {
  return {
    phase: "SLICE",
    /**
     * C-2⁸ (PRDR-291): on a pack, the live requirement ids with their
     * milestones, and the basis. An edit to what a requirement says re-cuts
     * nothing, and the criteria counts that guide the cut do not key it.
     * On a pack, re-running on the chain keeps the cut on record (C-2¹⁵).
     * Without a parse, the CONTENTS of every document and the stack, as C-2‴
     * keyed it, and each re-run cuts again.
     */
    digest: (ctx) => {
      const docs = planningDocs(deps.root, ctx.outputs);
      const pack = planningPack(ctx.outputs);
      const ids = pack === null ? [] : [...placement(pack, docs)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      if (ids.length > 0) return valueDigest(["pack", ids, sliceBasis(deps)]);
      return `${contentsDigest(deps.root, docs)}|${valueDigest([planningStack(deps.root, ctx.outputs), sliceBasis(deps)])}`;
    },
    run: async (ctx) =>
      await withInitJournal(deps.root, async (journal) => await sliceStage({
        root: deps.root,
        docs: planningDocs(deps.root, ctx.outputs),
        ...planningStack(deps.root, ctx.outputs),
        pack: planningPack(ctx.outputs),
        basis: sliceBasis(deps),
        baseline: deps.planBaseline ?? "production",
        sliceSize: deps.sliceSize ?? { min: 12, max: 18 },
        ...(deps.note === undefined ? {} : { note: deps.note }),
        launch: async (inputs, artifactOut) => {
          await launchInitSession(sessionDeps(deps, journal, "SLICE"), { role: "planner", inputs, artifactOut });
        },
      })),
  };
}

function planPhase(deps: PipelineDeps): PhaseHandler {
  return {
    phase: "PLAN",
    /* Chained: PLAN re-runs whenever the stack, the bindings or the slices moved; inside, unchanged slices are reused. */
    digest: (ctx) =>
      /* PRDR-082: PLAN's and the review's prompts join the stack and the bindings — the
       * inputs that actually determine this plan. */
      /**
       * C-8‴ (PRDR-118): PLAN's own OUTPUT joins its inputs. No phase digest
       * covered what the phase had written, so deleting `.detent/plan/` — a
       * botched merge, a branch switch, a start-over — reused every checkpoint
       * and reported READY over an empty directory. The slice caches survive,
       * so re-running PLAN after a deletion costs the write, not the planning.
       */
      `${valueDigest([
        planningStack(deps.root, ctx.outputs),
        ctx.outputs["DETERMINE_VERIFICATION"]?.["bindings"] ?? null,
        /* A-1⁷ (PRDR-293): the gates check reads which packages there are, a package with no gate among them. */
        ctx.outputs["DETERMINE_VERIFICATION"]?.["packages"] ?? null,
        ctx.outputs["SLICE"]?.["slices"] ?? null,
        planPrompts(deps),
      ])}`,
    /** C-8‴: the tickets and the plan artifact are PLAN's output; if they are gone, plan again. */
    outputIntact: () => planOutputIntact(deps.root),
    run: async (ctx) => {
      const outcome = await planWithJournal(deps, ctx);
      /* X-4⁸ (PRDR-286): outside PLAN's journal, since a requeue journals its own transition. */
      if (outcome.kind === "complete") settleAmendments(deps.root, (outcome.outputs["replanned"] as string[] | undefined) ?? [], deps.note);
      return outcome;
    },
  };
}

async function planWithJournal(deps: PipelineDeps, ctx: Parameters<PhaseHandler["run"]>[0]): Promise<PhaseOutcome> {
  return await withInitJournal(deps.root, async (journal) => {
    /* A checkpoint written before packages holds bindings with none, which were the root's. */
    const bindings = (ctx.outputs["DETERMINE_VERIFICATION"]?.["bindings"] as (Omit<Binding, "package"> & { readonly package?: string })[] | undefined) ?? [];
    return await planStage({
      root: deps.root,
      ...planningStack(deps.root, ctx.outputs),
      docs: planningDocs(deps.root, ctx.outputs),
      /**
       * V-5′ (PRDR-295): each gate by its label, the root's by slot alone as
       * before packages and a package's as `package:slot`, so a project with
       * one package keys its plan as it did, and the bootstrap ticket proves
       * every package's gates.
       */
      boundSlots: bindings.map((b) => gateLabel({ package: b.package ?? ROOT_PACKAGE, slot: b.slot })),
      budgets: deps.budgets,
      slices: slicesFromOutputs(ctx.outputs),
      baseline: deps.planBaseline ?? "production",
      promptHash: planPrompts(deps),
      pack: draftingPack(deps.root, ctx.outputs),
      /* A-1⁷ (PRDR-293): the gates check reads what PRESENT reads. */
      gates: readBindings(deps.root),
      ...(deps.note === undefined ? {} : { note: deps.note }),
      /* PRDR-194: PLAN is the stage whose work has names worth recording — slices and the redrafts the checks send. */
      ...(deps.progress === undefined ? {} : { progress: deps.progress }),
      estimate: estimator(deps),
      launch: async (inputs: Record<string, unknown>) => {
        await launchInitSession(sessionDeps(deps, journal, "PLAN"), { role: "planner", inputs, artifactOut: planDraftPath(deps.root) });
      },
      /* C-4⁸ (PRDR-294): the review runs on a role of its own, with its own prompt, model and effort. */
      launchReview: async (inputs: Record<string, unknown>, artifactOut: string) => {
        await launchInitSession(sessionDeps(deps, journal, "PLAN"), { role: "plan_review", inputs, artifactOut });
      },
    });
  });
}

function prepareAgentsPhase(deps: PipelineDeps): PhaseHandler {
  return {
    phase: "PREPARE_AGENTS",
    /*
     * The vendored prompt hashes plus the ticket set: a re-vendored prompt
     * must re-assign, because `role@hash` would otherwise name a stale build.
     */
    /**
     * The ticket CONTENTS, not just the ids: the role a ticket opens on is
     * derived from its `type` (S-7), and PRESENT invites editing tickets — so
     * flipping one to `bug` and re-running left `assignments.json` naming the
     * role for the type it used to be.
     */
    digest: (ctx) =>
      valueDigest([deps.prompts.hashes, ctx.outputs["PLAN"]?.["tickets"] ?? null, allTickets(deps.root).map((t) => `${t.id}:${t.type}`)]),
    run: async () =>
      prepareAgents({
        root: deps.root,
        tickets: allTickets(deps.root),
        prompts: deps.prompts,
        ...(deps.note === undefined ? {} : { note: deps.note }),
      }),
  };
}

function presentPhase(deps: PipelineDeps): PhaseHandler {
  return {
    phase: "PRESENT",
    digest: (ctx) =>
      valueDigest([
        ctx.outputs["PLAN"]?.["tickets"] ?? null,
        ctx.outputs["PREPARE_AGENTS"]?.["assignments"] ?? null,
        presentInputsFromOutputs(ctx.outputs),
      ]),
    run: async (ctx) => {
      const stored = readBindings(deps.root);
      const inputs = presentInputsFromOutputs(ctx.outputs);
      return await presentStage({
        root: deps.root,
        tickets: allTickets(deps.root),
        bindings: stored.bindings,
        skips: stored.skips,
        packages: stored.packages,
        checks: presentChecks(deps.root, ctx.outputs),
        bootstrap: (ctx.outputs["PLAN"]?.["bootstrap"] as string | null | undefined) ?? null,
        assignments: (ctx.outputs["PREPARE_AGENTS"]?.["assignments"] as Record<string, string> | undefined) ?? {},
        ...inputs,
        /* C-7‴ (PRDR-296): read when PRESENT runs, and not in its digest, since every session moves it. */
        spend: phaseSpend(deps.root),
        /* N-5″ (PRDR-297): read from what made the plan, which no build puts in a key (C-8). */
        builds: planBuilds(deps.root, inputs.slices ?? []),
        packHash: readConformanceRecord(deps.root)?.hash ?? null,
        ...(deps.symbols === undefined ? {} : { symbols: deps.symbols }),
        ...(deps.askApproval === undefined ? {} : { ask: deps.askApproval }),
        ...(deps.print === undefined ? {} : { print: deps.print }),
        ...(deps.acceptMixedBuilds === undefined ? {} : { acceptMixedBuilds: deps.acceptMixedBuilds }),
      });
    },
  };
}
