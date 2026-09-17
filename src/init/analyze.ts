import path from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";
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
 * The batch is genuinely single — and since C-3′ (PRDR-117) it is asked at
 * PRESENT, with the whole plan: questions the planner raised and questions
 * planning research could not answer (C-3a) travel there together, each with
 * the assumption the plan proceeds on, because a stop in the middle of
 * planning is exactly the drip C-3 forbids.
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

/**
 * Greenfield is the absence of stack markers, not a flag: a directory holding
 * only planning documents has nothing to bind against yet (C-1/D-10).
 */
export function isGreenfield(stackMarkers: readonly string[]): boolean {
  return stackMarkers.length === 0;
}

/**
 * The EXACT artifact shape ANALYZE must write, handed to the session as
 * `expected_output` — T-140's live firing proved a prose contract is not
 * enough (the model produced a plan-shaped mega-document; the strict
 * validator refused it). A test parses this skeleton through
 * `analysisSchema`, so the contract cannot drift from the schema.
 */
export function analysisSkeleton(greenfield: boolean): Record<string, unknown> {
  return {
    schema_version: 1,
    summary: "<one-paragraph summary of what is being built — required, non-empty>",
    stack: greenfield
      ? {
          language: "<bare language name — Go, TypeScript, JavaScript, Python or Rust — required; details go in runtime/rationale>",
          runtime: "<runtime or empty string>",
          test_framework: "<test framework or empty string>",
          rationale: "<why this stack — may be empty>",
          scaffold_files: [
            "<each file the scaffold you chose creates that later tickets may lean on — the manifest (package.json), the compiler and test configuration, the lockfile if the tooling writes one; repo-relative; an empty array if none>",
          ],
          verification: {
            test: "<the test command the documents name, exactly as written — omit the key if the documents name none>",
            lint: "<lint command or omit>",
            typecheck: "<typecheck command or omit>",
            build: "<build command or omit>",
            e2e: "<end-to-end command or omit>",
          },
        }
      : null,
    questions: [
      {
        id: "q1",
        question: "<a question ONLY the user can answer — omit entry if none>",
        blocking: false,
        assumption: "<what the plan proceeds on while it is unanswered — required unless blocking>",
      },
    ],
    assumptions: [{ claim: "<assumption made>", evidence: "<why it is safe — may be empty>" }],
    docs_read: ["<repo-relative path actually read>"],
  };
}

export async function analyzeStage(deps: AnalyzeDeps): Promise<PhaseOutcome> {
  const greenfield = isGreenfield(deps.stackMarkers);

  /*
   * A re-run derives fresh (C-8): a stale analysis from a prior firing is an
   * echo chamber, not an input — T-140's sixth firing watched an analyst
   * faithfully reproduce its predecessor's questions from this very file.
   */
  rmSync(analysisPath(deps.root), { force: true });

  await deps.launch({
    docs: deps.docs,
    stack_markers: deps.stackMarkers,
    greenfield,
    expected_output: analysisSkeleton(greenfield),
    instruction:
      `${
        greenfield
          ? "This is a greenfield project: choose the stack and justify it. Your analysis must include a `stack` object, and `stack.scaffold_files` must name every file the scaffold creates that later tickets may lean on — the bootstrap ticket provides each of them, so a ticket consuming one is not reported as consuming a file no ticket creates (A-1⁶)."
          : "This is an existing repository: describe what it is, and set `stack` to null — the stack is discovered, not chosen."
      } Write EXACTLY the \`expected_output\` shape to artifact_out — same keys, no extras: the validator is strict and refuses unknown keys (P2). Do NOT write a plan, tickets, or bindings here; ANALYZE produces the analysis alone. A question the documents cannot answer goes in \`questions\` WITH the assumption the plan proceeds on while it is unanswered; \`blocking: true\` only when no assumption can carry it — questions are asked once, with the whole plan (C-3′).`,
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

  /**
   * C-3a: research every open question before it reaches the human. C-3′
   * (PRDR-117): what research cannot settle no longer stops the pipeline — it
   * rides to PRESENT with the assumption the plan proceeds on, and is asked
   * once, with the whole plan.
   */
  let research: PlanResearchResult | null = null;
  const asked = analysis.questions.map((q) => q.question);
  if (deps.research !== undefined && asked.length > 0) {
    research = await planResearch(asked, { ...deps.research, root: deps.root });
    for (const brief of research.briefs) {
      /* PRDR-264: `briefs` carries the `answered` arm only — the settled arm has no claim to print. */
      const claim = brief.answer?.claim;
      if (claim !== undefined) deps.note?.(`planning research answered: ${brief.question} — ${claim}`);
    }
  }
  /**
   * PRDR-264: a question research SETTLED as undecidable still rides to
   * PRESENT. It is not answered — the plan proceeds on its assumption exactly
   * as before — but it is no longer open to research, so it belongs in the
   * batch a human sees while being counted apart from the ones a bigger
   * ceiling could still reach.
   */
  const carried = new Set(research === null ? asked : [...research.unanswered, ...research.undecidable]);
  const open = analysis.questions.filter((q) => carried.has(q.question));
  if (open.length > 0) {
    /*
     * PRDR-260: one batch (C-3a), but its members are not alike. An init with
     * no research configured is named as such rather than counted among the
     * questions research failed to settle, which would read as a ceiling that
     * had been hit.
     *
     * PRDR-265 removed the third population this used to report. "Never
     * researched" meant the pool ran out before the question's turn, and that
     * arm is gone: a budget no longer decides which question gets asked. The
     * count was structurally zero from that commit on, and a zero the operator
     * is shown every run is worse than one that is not there — it advertises a
     * lever ("raise the ceiling") that stopped existing.
     */
    /**
     * PRDR-264: the fourth population, and the one that changes the advice.
     * A settled question needs no ceiling and no further research — it needs
     * the named human. Counted inside "researched without a usable answer" it
     * argued for exactly the act that cannot help it.
     */
    const settled = research === null ? null : new Set(research.undecidable);
    const settledCount = settled === null ? 0 : open.filter((q) => settled.has(q.question)).length;
    const breakdown =
      settled === null
        ? " — planning research did not run for this init"
        : ` — ${String(settledCount)} settled as undecidable (only a human can answer), ` +
          `${String(open.length - settledCount)} researched without a usable answer`;
    deps.note?.(
      `${String(open.length)} question(s) carried to PRESENT with their assumptions (C-3′)${breakdown}` +
        `${open.some((q) => q.blocking) ? "; one or more blocking" : ""}`,
    );
  }

  return {
    kind: "complete",
    outputs: {
      analysis: analysis as unknown as Record<string, unknown>,
      greenfield,
      /** C-3′: the questions research could not settle, assumptions attached, for PRESENT. */
      open_questions: open as unknown as Record<string, unknown>[],
      research_briefs: research === null ? [] : research.briefs.map((b) => b.question_hash),
      research_tool_calls: research?.toolCallsUsed ?? 0,
    },
  };
}

function readAnalysis(root: string): unknown {
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
