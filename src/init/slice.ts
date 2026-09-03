import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { parseArtifact } from "../schemas/common.js";
import { slicesSchema, type Analysis, type Slices } from "../schemas/init.js";
import { PRODUCTION_BASELINE } from "./baseline.js";
import type { PhaseOutcome } from "./machine.js";

/**
 * C-2‴ (PRDR-117) — SLICE: the whole pack, cut into ordered increments.
 *
 * A planner-role session reads every discovered document and produces the
 * slice sequence: the walking skeleton first, each later slice thickening
 * what came before, every requirement id placed exactly once, every
 * applicable production-baseline item placed too. PLAN then plans one slice
 * at a time — what one session can write and one human can read — and never
 * stops between slices: the questions each stage raises ride to PRESENT.
 */

export function slicesPath(root: string): string {
  return path.join(stateDir(root), "state", "slices.json");
}

export interface SliceDeps {
  readonly root: string;
  readonly docs: readonly string[];
  readonly analysis: Analysis | null;
  readonly greenfield: boolean;
  readonly baseline: "production" | "none";
  readonly launch: (inputs: Record<string, unknown>) => Promise<void>;
  readonly note?: (text: string) => void;
}

/** The EXACT artifact SLICE writes; a test parses it through `slicesSchema`. */
export function slicesSkeleton(): Record<string, unknown> {
  return {
    schema_version: 1,
    slices: [
      {
        id: "s01",
        title: "<short name — required>",
        goal: "<what works end to end when this slice is DONE — required>",
        requirement_ids: ["<every requirement id this slice delivers, exactly as written in the documents>"],
        baseline_items: ["<PB-### ids from production_baseline this slice delivers — may be empty>"],
        docs: ["<repo-relative documents this slice plans from>"],
        depends_on: [],
        expected_tickets: 20,
        rationale: "<why this slice, here — may be empty>",
      },
    ],
    questions: [{ id: "q1", question: "<a question ONLY the user can answer — omit entry if none>", blocking: false, assumption: "<what the slicing proceeds on if unanswered>" }],
  };
}

export async function sliceStage(deps: SliceDeps): Promise<PhaseOutcome> {
  rmSync(slicesPath(deps.root), { force: true });
  await deps.launch({
    stage: "SLICE",
    docs: deps.docs,
    analysis: deps.analysis,
    greenfield: deps.greenfield,
    production_baseline: deps.baseline === "none" ? [] : PRODUCTION_BASELINE,
    expected_output: slicesSkeleton(),
    instruction:
      "Cut the WHOLE document set into ordered slices — increments of the product, each a thin end-to-end path that works " +
      "when it is DONE. The first slice is the walking skeleton through the riskiest integration; each later slice thickens " +
      "earlier ones and names them in `depends_on`. Place EVERY requirement id the documents define in exactly one slice's " +
      "`requirement_ids`, exactly as written. Place every `production_baseline` item whose `applies_when` the product meets " +
      "into the slice where it belongs (PB-### in `baseline_items`); an item that does not apply is omitted, and the " +
      "rationale of the slice that would have carried it says why. Size a slice to 15–40 tickets (`expected_tickets`). " +
      "Do NOT draft tickets here. A question the documents cannot answer goes in `questions` with the assumption the " +
      "slicing proceeds on — mark it blocking only if no assumption can carry it. Write EXACTLY the `expected_output` " +
      "shape to artifact_out; the validator is strict (P2).",
  });
  const file = slicesPath(deps.root);
  const raw = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  const parsed = raw === null ? null : parseArtifact(slicesSchema, raw);
  if (parsed === null || !parsed.ok) {
    throw new Error(
      parsed === null
        ? "SLICE produced no slices artifact"
        : `SLICE produced an invalid slices artifact: ${parsed.reason === "invalid" ? parsed.issues.join("; ") : "newer schema"}`,
    );
  }
  const slices: Slices = parsed.value;
  deps.note?.(`sliced the documents into ${slices.slices.length} increment(s): ${slices.slices.map((s) => `${s.id} ${s.title}`).join("; ")}`);
  return {
    kind: "complete",
    outputs: {
      slices: slices.slices as unknown as Record<string, unknown>[],
      questions: slices.questions as unknown as Record<string, unknown>[],
    },
  };
}

/** The typed view of what SLICE put on the pipeline bus. */
export function slicesFromOutputs(outputs: Readonly<Record<string, Record<string, unknown>>>): Slices["slices"] {
  const raw = outputs["SLICE"]?.["slices"];
  if (raw === undefined) return [];
  const parsed = slicesSchema.safeParse({ schema_version: 1, slices: raw });
  return parsed.success ? parsed.data.slices : [];
}
