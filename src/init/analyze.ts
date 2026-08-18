import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { stateDir } from "../fs/layout.js";
import { parseArtifact } from "../schemas/common.js";
import { analysisSchema, type Analysis } from "../schemas/init.js";
import type { PhaseOutcome } from "./machine.js";
import { planResearch, type PlanResearchDeps, type PlanResearchResult } from "./plan-research.js";

/**
 * T-062 — the ANALYZE stage (C-3, D-10).
 *
 * A read-only planner session consumes the discovered docs **plus** the stack
 * facts and produces an analysis. Two things make this stage the pivot D-10
 * describes: in greenfield the chosen stack is an *output* here (there is no
 * stack to discover, so verification cannot be determined before it), and
 * un-implementable specs become one batched question set rather than a drip.
 *
 * The batch is genuinely single: questions the planner raised and questions
 * planning research could not answer (C-3a) arrive in the SAME AWAIT_INFO,
 * because two interruptions for one round of confusion is exactly the drip
 * C-3 forbids.
 */

export function analysisPath(root: string): string {
  return path.join(stateDir(root), "state", "analysis.json");
}

export interface AnalyzeDeps {
  readonly root: string;
  /** Repo-relative docs from T-061, and the stack facts from T-025. */
  readonly docs: readonly string[];
  readonly stackMarkers: readonly string[];
  /** Launch the read-only planner session; it writes `analysisPath(root)`. */
  readonly launch: (inputs: Record<string, unknown>) => Promise<void>;
  /** C-3a: absent when planning research is not configured for this init. */
  readonly research?: Omit<PlanResearchDeps, "root">;
  readonly note?: (text: string) => void;
}

export interface AnalyzeSuccess {
  readonly analysis: Analysis;
  readonly research: PlanResearchResult | null;
}

/**
 * Greenfield is the absence of stack markers, not a flag: a directory holding
 * only planning documents has nothing to bind against yet (C-1/D-10).
 */
export function isGreenfield(stackMarkers: readonly string[]): boolean {
  return stackMarkers.length === 0;
}

export async function analyzeStage(deps: AnalyzeDeps): Promise<PhaseOutcome> {
  const greenfield = isGreenfield(deps.stackMarkers);

  await deps.launch({
    docs: deps.docs,
    stack_markers: deps.stackMarkers,
    greenfield,
    instruction: greenfield
      ? "This is a greenfield project: choose the stack and justify it. Your analysis must include a `stack` object."
      : "This is an existing repository: describe what it is, and set `stack` to null — the stack is discovered, not chosen.",
  });

  const raw = readAnalysis(deps.root);
  const parsed = raw === null ? null : parseArtifact(analysisSchema, raw);
  if (parsed === null || !parsed.ok) {
    /*
     * An invalid analysis is not a question for the user — it is a failed
     * session. Surfacing it as AWAIT_INFO would put the model's malfunction
     * in the user's lap, so it fails the phase instead (P2).
     */
    throw new Error(
      parsed === null
        ? "ANALYZE produced no analysis artifact"
        : `ANALYZE produced an invalid analysis: ${parsed.reason === "invalid" ? parsed.issues.join("; ") : "newer schema"}`,
    );
  }
  const analysis = parsed.value;

  if (greenfield && analysis.stack === null) {
    throw new Error("ANALYZE ran on a greenfield project without choosing a stack — DETERMINE_VERIFICATION has nothing to bind (D-10)");
  }

  /** ---- C-3a: research the open questions before asking the human ---------- */
  let research: PlanResearchResult | null = null;
  const blocking = analysis.questions.filter((q) => q.blocking).map((q) => q.question);

  if (deps.research !== undefined && blocking.length > 0) {
    research = await planResearch(blocking, { ...deps.research, root: deps.root });
    for (const brief of research.briefs) {
      deps.note?.(`planning research answered: ${brief.question} — ${brief.answer.claim}`);
    }
  }

  /** Questions research could not settle (or that were never researched). */
  const stillOpen = research === null ? blocking : research.unanswered;

  if (stillOpen.length > 0) {
    /* C-3: ONE interruption carrying the whole batch. */
    return {
      kind: "interrupt",
      interrupt: "AWAIT_INFO",
      message:
        `The plan needs ${stillOpen.length} question(s) answered before it can be written.\n${ 
        stillOpen.map((q, i) => `  ${i + 1}. ${q}`).join("\n") 
        }\n\nAnswer them in the planning documents and re-run \`detent init\`.`,
      items: stillOpen,
    };
  }

  return {
    kind: "complete",
    outputs: {
      analysis: analysis as unknown as Record<string, unknown>,
      greenfield,
      research_briefs: research === null ? [] : research.briefs.map((b) => b.question_hash),
      research_tool_calls: research?.toolCallsUsed ?? 0,
    },
  };
}

export function readAnalysis(root: string): unknown {
  const file = analysisPath(root);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** The typed view of what ANALYZE put on the pipeline bus (for later phases). */
export function analysisFromOutputs(outputs: Readonly<Record<string, Record<string, unknown>>>): Analysis | null {
  const raw = outputs["ANALYZE"]?.["analysis"];
  if (raw === undefined) return null;
  const parsed = parseArtifact(analysisSchema, raw);
  return parsed.ok ? parsed.value : null;
}
