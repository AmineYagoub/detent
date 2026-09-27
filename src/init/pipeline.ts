import { discover as discoverStack } from "../adapter/discover/index.js";
import { initLayout, stateDir } from "../fs/layout.js";
import type { Budgets } from "../schemas/budgets.js";
import { INIT_PHASES, type InitPhase } from "../schemas/init.js";
import type { PromptSet, SessionBackend } from "../sessions/backend.js";
import type { Sandbox } from "../sessions/sandbox.js";
import { isGreenfield } from "./greenfield.js";
import { determineVerification } from "./bind.js";
import { prepareAgents } from "./agents.js";
import { planDraftPath, planStage } from "./plan.js";
import { planOutputIntact } from "./plan-write.js";
import { presentInputsFromOutputs, presentStage, type ApprovalDecision } from "./present.js";
import { sliceStage, slicesFromOutputs, slicesPath } from "./slice.js";
import { baselineDigest } from "./baseline.js";
import type { SymbolsConfig } from "../adapter/symbols.js";
import { readBindings } from "../adapter/drift.js";
import { allTickets } from "../kernel/tickets/readers.js";
import type { Binding } from "../schemas/records.js";
import type { Skip } from "../adapter/bind.js";
import { awaitDocsMessage, discoverDocs, docPatternsFor } from "./discover-docs.js";
import { contentsDigest, listingDigest, valueDigest, type PhaseHandler } from "./machine.js";
import { launchInitSession, withInitJournal } from "./session.js";
import { classifyPack, hasConformanceRecord, packDocuments, packNote } from "./pack.js";
import { CONFORMANCE_RECORD_PATH, DECISION_LOG_PATH, packSchema, type Pack } from "../schemas/pack.js";
import type { LaunchOptions } from "./launch-batch.js";
import { sessionDeps } from "./session-deps.js";
import { auditPhase } from "./audit.js";
import { decidePhase, planningDocs, type DecideAsk } from "./decide.js";
import { readDecisionLog, type DecidedStack } from "./decide-log.js";
import { planningMarkers, writePhase } from "./write.js";
import { validatePhase } from "./validate.js";

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
  /** PRDR-268: revision rounds a faulted slice buys; `PLAN_REVISIONS` by default. */
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
  readonly print?: (text: string) => void;
}

/** The deps every init session launch shares — one place, so a new field cannot miss a call site. */

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
          patterns_searched: [...docPatterns(deps)],
          stack_markers: [...stack.stack.markers],
          package_manager: stack.stack.pm,
          candidate_count: stack.candidates.length,
          pack,
        },
      };
    },
  };
}

type Outputs = Readonly<Record<string, Record<string, unknown>>>;

/**
 * D-10′ (PRDR-290): the checker's parse of the pack, as VALIDATE handed it on
 * (C-2¹⁴), or null where WRITE wrote no pack. A parse that will not read FAILS
 * the phase, as an unreadable SLICE checkpoint does: planning on nothing where
 * a pack was validated would be the quiet failure.
 */
function planningPack(outputs: Outputs): Pack | null {
  const raw = outputs["VALIDATE"]?.["pack"];
  if (raw === undefined || raw === null) return null;
  const parsed = packSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new Error(
    `the VALIDATE checkpoint's parse of the pack is unreadable (${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}) — ` +
      "delete .detent/state/VALIDATE.json and re-run `detent init`",
  );
}

/**
 * D-10′ (PRDR-290): whether a stack must be decided, and the entry that
 * decided it. `greenfield` is code's, from the stack markers the specification
 * phase handed on (C-2¹³). In an existing project the stack is discovered, and
 * there is no entry to plan on. In greenfield the stack is the decision log's
 * entry: read from the parse where VALIDATE handed one, and from the log as it
 * stands where WRITE wrote no pack, since DECIDE records it either way. Both
 * are read from what the specification phase left, never from DECIDE's
 * outputs, which the in-flight scan cannot read (C-8″).
 */
function planningStack(root: string, outputs: Outputs): { readonly greenfield: boolean; readonly stack: DecidedStack | null } {
  const greenfield = isGreenfield(planningMarkers(outputs));
  if (!greenfield) return { greenfield, stack: null };
  const pack = planningPack(outputs);
  return { greenfield, stack: pack === null ? readDecisionLog(root).stack : pack.stack };
}

function determinePhase(deps: PipelineDeps): PhaseHandler {
  return {
    phase: "DETERMINE_VERIFICATION",
    /**
     * The CONTENTS of the files that define candidate commands: a changed
     * `scripts.test` must re-bind, which is the same region V-3 watches. In
     * greenfield, the stack entry it binds from (D-10′).
     */
    digest: (ctx) =>
      `${contentsDigest(deps.root, planningMarkers(ctx.outputs))}|${valueDigest(planningStack(deps.root, ctx.outputs))}`,
    run: async (ctx) =>
      await determineVerification({
        root: deps.root,
        ...(deps.symbols === undefined ? {} : { symbols: deps.symbols }),
        ...planningStack(deps.root, ctx.outputs),
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

function slicePhase(deps: PipelineDeps): PhaseHandler {
  return {
    phase: "SLICE",
    /** The CONTENTS of every document, the stack, the baseline and the prompt: any of them moving re-slices. */
    digest: (ctx) => {
      const docs = planningDocs(deps.root, ctx.outputs);
      return `${contentsDigest(deps.root, docs)}|${valueDigest([
        planningStack(deps.root, ctx.outputs),
        deps.planBaseline ?? "production",
        baselineDigest(),
        /* C-2⁵′: re-cutting on a new band is the whole point of the knob. */
        deps.sliceSize ?? { min: 12, max: 18 },
        deps.prompts.hashes.planner,
      ])}`;
    },
    run: async (ctx) =>
      await withInitJournal(deps.root, async (journal) => await sliceStage({
        root: deps.root,
        docs: planningDocs(deps.root, ctx.outputs),
        ...planningStack(deps.root, ctx.outputs),
        baseline: deps.planBaseline ?? "production",
        sliceSize: deps.sliceSize ?? { min: 12, max: 18 },
        ...(deps.note === undefined ? {} : { note: deps.note }),
        launch: async (inputs) => {
          await launchInitSession(sessionDeps(deps, journal), { role: "planner", inputs, artifactOut: slicesPath(deps.root) });
        },
      })),
  };
}

function planPhase(deps: PipelineDeps): PhaseHandler {
  return {
    phase: "PLAN",
    /* Chained: PLAN re-runs whenever the stack, the bindings or the slices moved; inside, unchanged slices are reused. */
    digest: (ctx) =>
      /* PRDR-082: the planner prompt joins the stack and the bindings — the
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
        ctx.outputs["SLICE"]?.["slices"] ?? null,
        deps.prompts.hashes.planner,
      ])}`,
    /** C-8‴: the tickets and the plan artifact are PLAN's output; if they are gone, plan again. */
    outputIntact: () => planOutputIntact(deps.root),
    run: async (ctx) => await withInitJournal(deps.root, async (journal) => {
      const bindings = (ctx.outputs["DETERMINE_VERIFICATION"]?.["bindings"] as Binding[] | undefined) ?? [];
      return await planStage({
        root: deps.root,
        ...planningStack(deps.root, ctx.outputs),
        docs: planningDocs(deps.root, ctx.outputs),
        boundSlots: bindings.map((b) => b.slot),
        budgets: deps.budgets,
        slices: slicesFromOutputs(ctx.outputs),
        baseline: deps.planBaseline ?? "production",
        ...(deps.revisionRounds === undefined ? {} : { revisionRounds: deps.revisionRounds }),
        promptHash: deps.prompts.hashes.planner,
        ...(deps.note === undefined ? {} : { note: deps.note }),
        /* PRDR-194: PLAN is the stage whose work has names worth recording — slices, redrafts, the coherence review. */
        ...(deps.progress === undefined ? {} : { progress: deps.progress }),
        ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
        launch: async (inputs: Record<string, unknown>, artifactOut?: string, options?: LaunchOptions) => {
          await launchInitSession(sessionDeps(deps, journal), {
            role: "planner",
            inputs,
            artifactOut: artifactOut ?? planDraftPath(deps.root),
            ...(options?.batch === undefined ? {} : { batch: options.batch }),
            ...(options?.told === undefined ? {} : { artifactTold: options.told }),
          });
        },
      });
    }),
  };
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
      return await presentStage({
        root: deps.root,
        tickets: allTickets(deps.root),
        bindings: stored.bindings,
        skips: stored.skips as unknown as Skip[],
        bootstrap: (ctx.outputs["PLAN"]?.["bootstrap"] as string | null | undefined) ?? null,
        assignments: (ctx.outputs["PREPARE_AGENTS"]?.["assignments"] as Record<string, string> | undefined) ?? {},
        ...presentInputsFromOutputs(ctx.outputs),
        /* PRDR-166: the globs DISCOVER recorded, not a second copy. */
        docPatterns: (ctx.outputs["DISCOVER"]?.["patterns_searched"] as string[] | undefined) ?? [],
        ...(deps.symbols === undefined ? {} : { symbols: deps.symbols }),
        ...(deps.askApproval === undefined ? {} : { ask: deps.askApproval }),
        ...(deps.print === undefined ? {} : { print: deps.print }),
      });
    },
  };
}
