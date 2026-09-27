import { REVIEW_SEVERITIES, type PlanFinding, type PlanRisk } from "../schemas/init.js";
import type { PresentInput } from "./present.js";
import { isPresentedDefect } from "./present-spec.js";

/**
 * What PRESENT shows beyond the tickets, read from what every planning phase
 * left in its outputs. This is a boundary: an output is whatever a build
 * wrote, older ones included, so every value here is `unknown` until a guard
 * says otherwise, and what is returned is renderable or absent (PRDR-157,
 * PRDR-164).
 *
 * C-7‴ (PRDR-296): no planning stage asks since C-3⁗, so nothing here gathers
 * a question. An older build's outputs may still hold SLICE's or PLAN's
 * `questions`; they are not read, and PRESENT lists none.
 */

/** C-2‴, C-7‴: what PRESENT shows beyond the tickets, gathered from every planning phase's outputs. */
export function presentInputsFromOutputs(
  outputs: Readonly<Record<string, Record<string, unknown>>>,
): Pick<
  PresentInput,
  "slices" | "decisions" | "defaults" | "risks" | "specDefects" | "findings" | "reviewRisks" | "unreviewed" | "derivedEdges" | "gateNotices"
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
  const isSlice = (s: unknown): s is NonNullable<PresentInput["slices"]>[number] =>
    typeof s === "object" && s !== null && typeof (s as { id?: unknown }).id === "string" && Array.isArray((s as { tickets?: unknown }).tickets);
  /**
   * PRDR-164: the other two fields.
   *
   * The first pass filtered the ELEMENTS of the questions and `slices` and
   * checked only the container type for these — so `review_findings: [null]`
   * survived the builder and `renderPresentation` died on `f.tag`, and
   * `symbol-reminder.ts` iterates the same array. "Returns something
   * renderable or nothing" has to hold for everything it returns.
   */
  const isFinding = (f: unknown): f is PlanFinding =>
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
    /* C-7‴ (PRDR-296): every D-n, as the founder answered it; only the three fields shown are kept. */
    decisions: list<unknown>(logged, "decisions")
      .filter(isRow("id", "question", "answer"))
      .map((d) => ({ id: d.id, question: d.question, answer: d.answer })),
    defaults: list<unknown>(logged, "defaults").filter(isRow("id", "value", "reason")),
    risks: list<unknown>("VALIDATE", "risks").filter(isRow("id", "where", "fix", "left", "reason")),
    specDefects: list<unknown>("PLAN", "spec_defects").filter(isPresentedDefect),
    findings: list<PlanFinding>("PLAN", "review_findings").filter(isFinding),
    /* C-4⁸ (PRDR-294): a risk renders its severity's rank, so one naming another severity is not one this build wrote. */
    reviewRisks: list<unknown>("PLAN", "review_risks")
      .filter(isRow("slice", "severity", "tag", "ticket", "finding", "fix"))
      .filter((r): r is PlanRisk => (REVIEW_SEVERITIES as readonly string[]).includes(r.severity) && r.severity !== "minor"),
    unreviewed: list<unknown>("PLAN", "unreviewed").filter(isRow("slice", "reason")),
    derivedEdges: list<{ consumer: string; provider: string; contract: string }>("PLAN", "derived_edges").filter(isEdge),
    gateNotices: list<unknown>("DETERMINE_VERIFICATION", "gate_notices").filter((n): n is string => typeof n === "string"),
  };
}
