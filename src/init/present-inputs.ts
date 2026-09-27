import type { PlanQuestion, PlanReview } from "../schemas/init.js";
import type { PresentInput } from "./present.js";
import { isPresentedDefect } from "./present-spec.js";
import { mergeSimilar, similarQuestions } from "./questions.js";

/**
 * What PRESENT shows beyond the tickets, read from what every planning phase
 * left in its outputs. This is a boundary: an output is whatever a build
 * wrote, older ones included, so every value here is `unknown` until a guard
 * says otherwise, and what is returned is renderable or absent (PRDR-157,
 * PRDR-164).
 */

/** C-2‴/C-3′: what PRESENT shows beyond the tickets, gathered from every planning phase's outputs. */
export function presentInputsFromOutputs(
  outputs: Readonly<Record<string, Record<string, unknown>>>,
): Pick<
  PresentInput,
  "slices" | "questions" | "defaults" | "risks" | "specDefects" | "answeredByLog" | "findings" | "derivedEdges" | "gateNotices" | "contractFindings" | "revisions"
> {
  /**
   * PRDR-157: `?? []` only covered null and undefined, so any OTHER wrong type
   * came straight back — a string was spread into characters and `q.question`
   * dereferenced `undefined`. This function's whole reason to exist is reading
   * a checkpoint an older build wrote, where every value is `unknown`.
   */
  const list = <T>(phase: string, key: string): T[] => {
    const value = outputs[phase]?.[key];
    return Array.isArray(value) ? (value as T[]) : [];
  };
  /** A question a person can actually be shown: both fields present and stringy. */
  const isQuestion = (q: unknown): q is PlanQuestion =>
    typeof q === "object" && q !== null && typeof (q as PlanQuestion).question === "string" && typeof (q as PlanQuestion).id === "string";
  const isSlice = (s: unknown): s is NonNullable<PresentInput["slices"]>[number] =>
    typeof s === "object" && s !== null && typeof (s as { id?: unknown }).id === "string" && Array.isArray((s as { tickets?: unknown }).tickets);
  /**
   * PRDR-164: the other two fields.
   *
   * The first pass filtered the ELEMENTS of `questions` and `slices` and
   * checked only the container type for these — so `review_findings: [null]`
   * survived the builder and `renderPresentation` died on `f.tag`, and
   * `symbol-reminder.ts` iterates the same array. "Returns something
   * renderable or nothing" has to hold for everything it returns.
   */
  const isFinding = (f: unknown): f is PlanReview["findings"][number] =>
    typeof f === "object" && f !== null && typeof (f as { tag?: unknown }).tag === "string" && typeof (f as { finding?: unknown }).finding === "string";
  const isEdge = (e: unknown): e is NonNullable<PresentInput["derivedEdges"]>[number] =>
    typeof e === "object" &&
    e !== null &&
    typeof (e as { consumer?: unknown }).consumer === "string" &&
    typeof (e as { provider?: unknown }).provider === "string" &&
    typeof (e as { contract?: unknown }).contract === "string";
  /** A decision-log row as DECIDE's outputs carry it, every named field a string. */
  const isRow =
    <K extends string>(...keys: readonly K[]) =>
    (v: unknown): v is Record<K, string> =>
      typeof v === "object" && v !== null && keys.every((k) => typeof (v as Record<string, unknown>)[k] === "string");
  /* C-2¹³, C-2¹⁴: the log as the specification phase left it, defaults its writers added among them: VALIDATE's, else WRITE's, else DECIDE's. */
  const logged = ["VALIDATE", "WRITE"].find((phase) => Array.isArray(outputs[phase]?.["defaults"])) ?? "DECIDE";
  const decisions = list<unknown>(logged, "decisions").filter(isRow("id", "question"));
  const answeredByLog: { id: string; entry: string }[] = [];
  const seen = new Set<string>();
  const takenIds = new Set<string>();
  const questions: PlanQuestion[] = [];
  for (const q of [
    ...list<PlanQuestion>("SLICE", "questions"),
    ...list<PlanQuestion>("PLAN", "questions"),
  ].filter(isQuestion)) {
    const key = q.question.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const answered = decisions.find((d) => similarQuestions(d.question, q.question));
    if (answered !== undefined) {
      answeredByLog.push({ id: q.id, entry: answered.id });
      continue;
    }
    /**
     * PRDR-119: the stages number their questions independently, so the
     * batch could show the same id twice. The id is what a human writes down
     * when answering, so it has to mean one question.
     */
    let id = q.id;
    for (let n = 2; takenIds.has(id); n += 1) id = `${q.id}-${n}`;
    takenIds.add(id);
    questions.push({ ...q, id });
  }
  const plan = outputs["PLAN"]?.["plan"] as { slices?: unknown } | undefined;
  /**
   * PRDR-157: `slices: "not an array"` used to pass straight through, and
   * `renderPresentation` then read `.length` on the string (12, so the block
   * rendered) and iterated its characters until `s.tickets.length` threw. The
   * builder is the boundary; it returns something renderable or nothing.
   */
  const slices = (Array.isArray(plan?.slices) ? plan.slices : []).filter(isSlice);
  return {
    slices,
    /* C-3‴ (PRDR-207): the exact-text pass above, then the near-duplicate backstop — one entry, both ids. */
    questions: mergeSimilar(questions),
    defaults: list<unknown>(logged, "defaults").filter(isRow("id", "value", "reason")),
    risks: list<unknown>("VALIDATE", "risks").filter(isRow("id", "where", "fix", "left", "reason")),
    specDefects: list<unknown>("PLAN", "spec_defects").filter(isPresentedDefect),
    answeredByLog,
    findings: list<PlanReview["findings"][number]>("PLAN", "review_findings").filter(isFinding),
    contractFindings: list<PlanReview["findings"][number]>("PLAN", "contract_findings").filter(isFinding),
    ...(((v): v is { resolved: number; survived: number; introduced: number } =>
      typeof v === "object" && v !== null && typeof (v as { resolved?: unknown }).resolved === "number")(
      outputs["PLAN"]?.["revision_summary"],
    )
      ? { revisions: outputs["PLAN"]["revision_summary"] as { resolved: number; survived: number; introduced: number } }
      : {}),
    ...(((v): v is { resolved: number; survived: number; introduced: number } =>
      typeof v === "object" && v !== null && typeof (v as { resolved?: unknown }).resolved === "number")(
      outputs["PLAN"]?.["churn_summary"],
    )
      ? { churn: outputs["PLAN"]["churn_summary"] as { resolved: number; survived: number; introduced: number } }
      : {}),
    derivedEdges: list<{ consumer: string; provider: string; contract: string }>("PLAN", "derived_edges").filter(isEdge),
    gateNotices: list<unknown>("DETERMINE_VERIFICATION", "gate_notices").filter((n): n is string => typeof n === "string"),
  };
}
