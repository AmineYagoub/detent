import path from "node:path";
import { discover as discoverStack } from "../adapter/discover/index.js";
import { initLayout, stateDir } from "../fs/layout.js";
import type { Budgets } from "../schemas/budgets.js";
import { INIT_PHASES, type InitPhase } from "../schemas/init.js";
import type { PromptSet, SessionBackend } from "../sessions/backend.js";
import { analysisFromOutputs, analysisPath, analyzeStage } from "./analyze.js";
import { determineVerification } from "./bind.js";
import { prepareAgents } from "./agents.js";
import { planDraftPath, planStage } from "./plan.js";
import { presentStage, type ApprovalDecision } from "./present.js";
import { readBindings } from "../adapter/drift.js";
import { allTickets } from "../kernel/tickets/readers.js";
import type { Binding } from "../schemas/records.js";
import type { Skip } from "../adapter/bind.js";
import { awaitDocsMessage, discoverDocs, DOC_PATTERNS } from "./discover-docs.js";
import { contentsDigest, listingDigest, valueDigest, type PhaseHandler } from "./machine.js";
import { launchInitSession } from "./session.js";

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
  readonly docsDomains?: readonly string[];
  readonly note?: (text: string) => void;
  /** C-7: present inline on a TTY; absent defers approval to the first `run`. */
  readonly askApproval?: (presentation: string) => Promise<ApprovalDecision>;
  readonly print?: (text: string) => void;
}

export function buildPipeline(deps: PipelineDeps): PhaseHandler[] {
  return [
    initFsPhase(deps),
    discoverPhase(deps),
    analyzePhase(deps),
    determinePhase(deps),
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

// ---------------------------------------------------------------------------

function initFsPhase(deps: PipelineDeps): PhaseHandler {
  return {
    phase: "INIT_FS",
    // The layout either exists or it does not; nothing about its contents
    // changes what this phase does.
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
      const docs = discoverDocs(deps.root).docs;
      const stack = discoverStack(deps.root);
      return listingDigest([...docs, ...stack.stack.markers.map((m) => `marker:${m}`)]);
    },
    run: async () => {
      const docs = discoverDocs(deps.root);
      const stack = discoverStack(deps.root);
      if (docs.docs.length === 0) {
        // C-2: no docs → AWAIT_DOCS with the exact list of what was looked for.
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
          patterns_searched: [...DOC_PATTERNS],
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
      const docs = (ctx.outputs["DISCOVER"]?.["docs"] as string[] | undefined) ?? discoverDocs(deps.root).docs;
      return `${contentsDigest(deps.root, docs)}|${valueDigest(ctx.outputs["DISCOVER"]?.["stack_markers"] ?? [])}`;
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
            {
              root: deps.root,
              backend: deps.backend,
              prompts: deps.prompts,
              maxTurns: deps.budgets.turns_per_stage,
              ...(deps.docsDomains === undefined ? {} : { docsDomains: deps.docsDomains }),
            },
            { role: "planner", inputs, artifactOut: analysisPath(deps.root) },
          );
        },
        research: {
          budget: deps.budgets.planning_research_tool_calls,
          ...(deps.note === undefined ? {} : { note: deps.note }),
          researchOne: async (question, remaining) => {
            const artifactOut = path.join(stateDir(deps.root), "state", "planning-brief.json");
            const result = await launchInitSession(
              {
                root: deps.root,
                backend: deps.backend,
                prompts: deps.prompts,
                maxTurns: deps.budgets.turns_per_stage,
                ...(deps.docsDomains === undefined ? {} : { docsDomains: deps.docsDomains }),
              },
              {
                role: "research",
                inputs: { question, tool_call_budget: remaining, hierarchy: "X-6a: project docs → codebase → official docs → upstream issues → technical sources → general web" },
                artifactOut,
                withWeb: true,
              },
            );
            const { readFileSync, existsSync } = await import("node:fs");
            const brief = existsSync(artifactOut) ? JSON.parse(readFileSync(artifactOut, "utf8")) : null;
            // Turns are the observable proxy for tool calls the backend reports;
            // S-4's telemetry has no per-call counter, so a turn is one call's
            // worth of budget. The ceiling is enforced either way (C-3a).
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
        greenfield: ctx.outputs["ANALYZE"]?.["greenfield"] === true,
        analysis: analysisFromOutputs(ctx.outputs),
      }),
  };
}

function planPhase(deps: PipelineDeps): PhaseHandler {
  return {
    phase: "PLAN",
    // Chained: PLAN re-runs whenever analysis or the bindings moved.
    digest: (ctx) => valueDigest([ctx.outputs["ANALYZE"]?.["analysis"] ?? null, ctx.outputs["DETERMINE_VERIFICATION"]?.["bindings"] ?? null]),
    run: async (ctx) => {
      const bindings = (ctx.outputs["DETERMINE_VERIFICATION"]?.["bindings"] as Binding[] | undefined) ?? [];
      return await planStage({
        root: deps.root,
        greenfield: ctx.outputs["ANALYZE"]?.["greenfield"] === true,
        analysis: analysisFromOutputs(ctx.outputs),
        docs: (ctx.outputs["DISCOVER"]?.["docs"] as string[] | undefined) ?? [],
        boundSlots: bindings.map((b) => b.slot),
        ...(deps.note === undefined ? {} : { note: deps.note }),
        launch: async (inputs) => {
          await launchInitSession(
            {
              root: deps.root,
              backend: deps.backend,
              prompts: deps.prompts,
              maxTurns: deps.budgets.turns_per_stage,
              ...(deps.docsDomains === undefined ? {} : { docsDomains: deps.docsDomains }),
            },
            { role: "planner", inputs, artifactOut: planDraftPath(deps.root) },
          );
        },
      });
    },
  };
}

function prepareAgentsPhase(deps: PipelineDeps): PhaseHandler {
  return {
    phase: "PREPARE_AGENTS",
    // The vendored prompt hashes plus the ticket set: a re-vendored prompt
    // must re-assign, because `role@hash` would otherwise name a stale build.
    digest: (ctx) => valueDigest([deps.prompts.hashes, ctx.outputs["PLAN"]?.["tickets"] ?? null]),
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
    digest: (ctx) => valueDigest([ctx.outputs["PLAN"]?.["tickets"] ?? null, ctx.outputs["PREPARE_AGENTS"]?.["assignments"] ?? null]),
    run: async (ctx) => {
      const stored = readBindings(deps.root);
      return await presentStage({
        root: deps.root,
        tickets: allTickets(deps.root),
        bindings: stored.bindings,
        skips: stored.skips as unknown as Skip[],
        bootstrap: (ctx.outputs["PLAN"]?.["bootstrap"] as string | null | undefined) ?? null,
        assignments: (ctx.outputs["PREPARE_AGENTS"]?.["assignments"] as Record<string, string> | undefined) ?? {},
        ...(deps.askApproval === undefined ? {} : { ask: deps.askApproval }),
        ...(deps.print === undefined ? {} : { print: deps.print }),
      });
    },
  };
}
