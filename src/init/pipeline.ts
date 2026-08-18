import path from "node:path";
import { discover as discoverStack } from "../adapter/discover/index.js";
import { initLayout, stateDir } from "../fs/layout.js";
import type { Budgets } from "../schemas/budgets.js";
import { INIT_PHASES, type InitPhase } from "../schemas/init.js";
import type { PromptSet, SessionBackend } from "../sessions/backend.js";
import { analysisPath, analyzeStage } from "./analyze.js";
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
}

export function buildPipeline(deps: PipelineDeps): PhaseHandler[] {
  return [initFsPhase(deps), discoverPhase(deps), analyzePhase(deps)];
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
