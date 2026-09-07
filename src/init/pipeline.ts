import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { discover as discoverStack } from "../adapter/discover/index.js";
import { initLayout, stateDir } from "../fs/layout.js";
import type { Budgets } from "../schemas/budgets.js";
import { INIT_PHASES, type InitPhase } from "../schemas/init.js";
import type { PromptSet, SessionBackend } from "../sessions/backend.js";
import { analysisFromOutputs, analysisPath, analyzeStage } from "./analyze.js";
import { determineVerification } from "./bind.js";
import { prepareAgents } from "./agents.js";
import { planDraftPath, planStage } from "./plan.js";
import { presentInputsFromOutputs, presentStage, type ApprovalDecision } from "./present.js";
import { sliceStage, slicesFromOutputs, slicesPath } from "./slice.js";
import { baselineDigest } from "./baseline.js";
import type { SymbolsConfig } from "../adapter/symbols.js";
import { readBindings } from "../adapter/drift.js";
import { allTickets } from "../kernel/tickets/readers.js";
import type { Binding } from "../schemas/records.js";
import type { Skip } from "../adapter/bind.js";
import { awaitDocsMessage, discoverDocs, DOC_PATTERNS } from "./discover-docs.js";
import { contentsDigest, listingDigest, valueDigest, type PhaseHandler } from "./machine.js";
import { type InitSessionDeps, launchInitSession } from "./session.js";

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
  /** PRDR-114: routed models for the init roles (planner, research). */
  readonly modelRouting?: Readonly<Record<string, string>>;
  /** C-2‴ (PRDR-117): the production baseline SLICE plans against; "none" opts out. */
  readonly planBaseline?: "production" | "none";
  /** S-3′ (PRDR-121): optional symbol intelligence; absent, every stage runs unchanged. */
  readonly symbols?: SymbolsConfig;
  /** C-2⁵′ (PRDR-125): the ticket band one slice should hold. */
  readonly sliceSize?: { readonly min: number; readonly max: number };
  readonly note?: (text: string) => void;
  /** C-7: present inline on a TTY; absent defers approval to the first `run`. */
  readonly askApproval?: (presentation: string) => Promise<ApprovalDecision>;
  readonly print?: (text: string) => void;
}

/** The deps every init session launch shares — one place, so a new field cannot miss a call site. */
function sessionDeps(deps: PipelineDeps): InitSessionDeps {
  return {
    root: deps.root,
    backend: deps.backend,
    prompts: deps.prompts,
    spendCeiling: deps.budgets.run_spend_usd,
    ...(deps.docsDomains === undefined ? {} : { docsDomains: deps.docsDomains }),
    ...(deps.modelRouting === undefined ? {} : { modelRouting: deps.modelRouting }),
  };
}

export function buildPipeline(deps: PipelineDeps): PhaseHandler[] {
  return [
    initFsPhase(deps),
    discoverPhase(deps),
    analyzePhase(deps),
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
function docPatterns(deps: PipelineDeps): readonly string[] {
  return deps.planDocs !== undefined && deps.planDocs.length > 0 ? deps.planDocs : DOC_PATTERNS;
}

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
     */
    digest: () => {
      const docs = discoverDocs(deps.root, docPatterns(deps)).docs;
      const stack = discoverStack(deps.root);
      return listingDigest([...docs, ...stack.stack.markers.map((m) => `marker:${m}`)]);
    },
    run: async () => {
      const docs = discoverDocs(deps.root, docPatterns(deps));
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
      return {
        kind: "complete",
        outputs: {
          docs: [...docs.docs],
          patterns_searched: [...docPatterns(deps)],
          stack_markers: [...stack.stack.markers],
          package_manager: stack.stack.pm,
          candidate_count: stack.candidates.length,
        },
      };
    },
  };
}

function analyzePhase(deps: PipelineDeps): PhaseHandler {
  return {
    phase: "ANALYZE",
    /**
     * The CONTENTS of the discovered docs: ANALYZE is what an edit invalidates
     * (C-8's AC). Folded with DISCOVER's output so a newly-appearing doc also
     * re-runs analysis.
     */
    digest: (ctx) => {
      const docs = (ctx.outputs["DISCOVER"]?.["docs"] as string[] | undefined) ?? discoverDocs(deps.root, docPatterns(deps)).docs;
      /* PRDR-082: the prompt is an input — a Detent upgrade that changes how
       * the phase reasons must invalidate it, exactly as an edited doc does. */
      return `${contentsDigest(deps.root, docs)}|${valueDigest([ctx.outputs["DISCOVER"]?.["stack_markers"] ?? [], deps.prompts.hashes.planner])}`;
    },
    run: async (ctx) => {
      const docs = (ctx.outputs["DISCOVER"]?.["docs"] as string[] | undefined) ?? [];
      const stackMarkers = (ctx.outputs["DISCOVER"]?.["stack_markers"] as string[] | undefined) ?? [];
      return await analyzeStage({
        root: deps.root,
        docs,
        stackMarkers,
        ...(deps.note === undefined ? {} : { note: deps.note }),
        launch: async (inputs) => {
          await launchInitSession(
            sessionDeps(deps),
            { role: "planner", inputs, artifactOut: analysisPath(deps.root) },
          );
        },
        research: {
          budget: deps.budgets.planning_research_tool_calls,
          ...(deps.note === undefined ? {} : { note: deps.note }),
          researchOne: async (question, remaining) => {
            const artifactOut = path.join(stateDir(deps.root), "state", "planning-brief.json");
            const result = await launchInitSession(
              sessionDeps(deps),
              {
                role: "research",
                inputs: { question, tool_call_budget: remaining, hierarchy: "X-6a: project docs → codebase → official docs → upstream issues → technical sources → general web" },
                artifactOut,
                withWeb: true,
              },
            );
            const { readFileSync, existsSync } = await import("node:fs");
            const brief = existsSync(artifactOut) ? JSON.parse(readFileSync(artifactOut, "utf8")) : null;
            /*
             * Turns are the observable proxy for tool calls the backend reports;
             * S-4's telemetry has no per-call counter, so a turn is one call's
             * worth of budget. The ceiling is enforced either way (C-3a).
             */
            return { brief, toolCalls: Math.max(1, result.turns) };
          },
        },
      });
    },
  };
}


function determinePhase(deps: PipelineDeps): PhaseHandler {
  return {
    phase: "DETERMINE_VERIFICATION",
    /**
     * The CONTENTS of the files that define candidate commands: a changed
     * `scripts.test` must re-bind, which is the same region V-3 watches.
     */
    digest: (ctx) => {
      const markers = (ctx.outputs["DISCOVER"]?.["stack_markers"] as string[] | undefined) ?? [];
      return `${contentsDigest(deps.root, markers)}|${valueDigest(ctx.outputs["ANALYZE"]?.["greenfield"] ?? null)}`;
    },
    run: async (ctx) =>
      await determineVerification({
        root: deps.root,
        ...(deps.symbols === undefined ? {} : { symbols: deps.symbols }),
        greenfield: ctx.outputs["ANALYZE"]?.["greenfield"] === true,
        analysis: analysisFromOutputs(ctx.outputs),
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
    /** The CONTENTS of every document, the analysis, the baseline and the prompt: any of them moving re-slices. */
    digest: (ctx) => {
      const docs = (ctx.outputs["DISCOVER"]?.["docs"] as string[] | undefined) ?? [];
      return `${contentsDigest(deps.root, docs)}|${valueDigest([
        ctx.outputs["ANALYZE"]?.["analysis"] ?? null,
        deps.planBaseline ?? "production",
        baselineDigest(),
        /* C-2⁵′: re-cutting on a new band is the whole point of the knob. */
        deps.sliceSize ?? { min: 12, max: 18 },
        deps.prompts.hashes.planner,
      ])}`;
    },
    run: async (ctx) =>
      await sliceStage({
        root: deps.root,
        docs: (ctx.outputs["DISCOVER"]?.["docs"] as string[] | undefined) ?? [],
        analysis: analysisFromOutputs(ctx.outputs),
        greenfield: ctx.outputs["ANALYZE"]?.["greenfield"] === true,
        baseline: deps.planBaseline ?? "production",
        sliceSize: deps.sliceSize ?? { min: 12, max: 18 },
        ...(deps.note === undefined ? {} : { note: deps.note }),
        launch: async (inputs) => {
          await launchInitSession(sessionDeps(deps), { role: "planner", inputs, artifactOut: slicesPath(deps.root) });
        },
      }),
  };
}

function planPhase(deps: PipelineDeps): PhaseHandler {
  return {
    phase: "PLAN",
    /* Chained: PLAN re-runs whenever analysis, the bindings or the slices moved; inside, unchanged slices are reused. */
    digest: (ctx) =>
      /* PRDR-082: the planner prompt joins the analysis and the bindings — the
       * inputs that actually determine this plan. */
      /**
       * C-8‴ (PRDR-118): PLAN's own OUTPUT joins its inputs. No phase digest
       * covered what the phase had written, so deleting `.detent/plan/` — a
       * botched merge, a branch switch, a start-over — reused every checkpoint
       * and reported READY over an empty directory. The slice caches survive,
       * so re-running PLAN after a deletion costs the write, not the planning.
       */
      `${valueDigest([
        ctx.outputs["ANALYZE"]?.["analysis"] ?? null,
        ctx.outputs["DETERMINE_VERIFICATION"]?.["bindings"] ?? null,
        ctx.outputs["SLICE"]?.["slices"] ?? null,
        deps.prompts.hashes.planner,
      ])}`,
    /** C-8‴: the tickets and the plan artifact are PLAN's output; if they are gone, plan again. */
    outputIntact: () => planOutputIntact(deps.root),
    run: async (ctx) => {
      const bindings = (ctx.outputs["DETERMINE_VERIFICATION"]?.["bindings"] as Binding[] | undefined) ?? [];
      return await planStage({
        root: deps.root,
        greenfield: ctx.outputs["ANALYZE"]?.["greenfield"] === true,
        analysis: analysisFromOutputs(ctx.outputs),
        docs: (ctx.outputs["DISCOVER"]?.["docs"] as string[] | undefined) ?? [],
        boundSlots: bindings.map((b) => b.slot),
        budgets: deps.budgets,
        slices: slicesFromOutputs(ctx.outputs),
        baseline: deps.planBaseline ?? "production",
        promptHash: deps.prompts.hashes.planner,
        ...(deps.note === undefined ? {} : { note: deps.note }),
        launch: async (inputs: Record<string, unknown>, artifactOut?: string) => {
          await launchInitSession(
            sessionDeps(deps),
            { role: "planner", inputs, artifactOut: artifactOut ?? planDraftPath(deps.root) },
          );
        },
      });
    },
  };
}

/**
 * Whether PLAN's own output is still on disk: the plan artifact exists and
 * every ticket it names has a file. Deleting `.detent/plan/` — a botched merge,
 * a branch switch, a start-over — used to reuse every checkpoint and report
 * READY over an empty directory. Re-planning after a deletion costs the write,
 * not the planning: the slice caches are untouched.
 */
function planOutputIntact(root: string): boolean {
  const file = path.join(stateDir(root), "plan", "plan.json");
  if (!existsSync(file)) return false;
  try {
    const plan = JSON.parse(readFileSync(file, "utf8")) as { tickets?: unknown };
    const ids = Array.isArray(plan.tickets) ? (plan.tickets as string[]) : [];
    const have = new Set(allTickets(root).map((t) => t.id));
    return ids.every((id) => have.has(id));
  } catch {
    return false;
  }
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
        ...(deps.symbols === undefined ? {} : { symbols: deps.symbols }),
        ...(deps.askApproval === undefined ? {} : { ask: deps.askApproval }),
        ...(deps.print === undefined ? {} : { print: deps.print }),
      });
    },
  };
}
