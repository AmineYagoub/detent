import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { parseArtifact } from "../schemas/common.js";
import { slicesSchema, type Analysis, type Slices } from "../schemas/init.js";
import { PRODUCTION_BASELINE } from "./baseline.js";
import type { PhaseOutcome } from "./machine.js";
import { previousAttemptInput, withOneRelaunch } from "./retry.js";

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
  const attempt = await withOneRelaunch<Slices>({ stage: "SLICE", note: deps.note }, async (previous) => await sliceOnce(deps, previous));
  if (attempt.value === null) throw new Error(`SLICE produced no usable slices artifact: ${attempt.issue}`);

  const slices = groundSlices(attempt.value, deps);
  deps.note?.(`sliced the documents into ${slices.length} increment(s): ${slices.map((s) => `${s.id} ${s.title}`).join("; ")}`);
  /**
   * The operator learns the size of the run BEFORE it spends: planning is one
   * draft and one review per slice at best, roughly double that where a review
   * asks for a revision, plus the whole-plan review at the end.
   */
  const planned = slices.reduce((n, s) => n + s.expected_tickets, 0);
  deps.note?.(
    `PLAN will now run to the end of the product: ~${planned} ticket(s) across ${slices.length} slice(s), ` +
      `${2 * slices.length + 3}-${4 * slices.length + 5} planner sessions. It does not stop until the plan exists (C-2‴).`,
  );
  return {
    kind: "complete",
    outputs: {
      slices: slices as unknown as Record<string, unknown>[],
      questions: attempt.value.questions as unknown as Record<string, unknown>[],
    },
  };
}

async function sliceOnce(deps: SliceDeps, previous: { readonly issue: string } | null): Promise<{ value: Slices | null; issue: string | null }> {
  rmSync(slicesPath(deps.root), { force: true });
  await deps.launch({
    stage: "SLICE",
    docs: deps.docs,
    analysis: deps.analysis,
    greenfield: deps.greenfield,
    production_baseline: deps.baseline === "none" ? [] : PRODUCTION_BASELINE,
    expected_output: slicesSkeleton(),
    ...previousAttemptInput(previous, "slices artifact"),
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
  if (!existsSync(file)) return { value: null, issue: "no artifact written" };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    /* A truncated write is an unusable attempt, not a crash with a JSON stack trace. */
    return { value: null, issue: `artifact is not JSON: ${(err as Error).message}` };
  }
  const parsed = parseArtifact(slicesSchema, raw);
  if (!parsed.ok) {
    return { value: null, issue: parsed.reason === "invalid" ? parsed.issues.join("; ") : `schema_version ${parsed.found} is newer than ${parsed.supported}` };
  }
  return { value: parsed.value, issue: null };
}

/**
 * A slice's `docs` and `baseline_items` are the model's words, and PLAN spends
 * a session on each slice believing them. A path that was never discovered is
 * dropped here rather than handed to a planner that will read nothing and plan
 * from an empty desk; a slice left with no documents falls back to the whole
 * discovered set, which is the safe direction. An unknown PB id is dropped the
 * same way, noted, so a typo cannot silently retire a baseline item.
 */
function groundSlices(slices: Slices, deps: SliceDeps): Slices["slices"] {
  const discovered = new Set(deps.docs);
  const known = new Set(PRODUCTION_BASELINE.map((b) => b.id));
  return slices.slices.map((slice) => {
    const docs = slice.docs.filter((d) => discovered.has(d));
    const missing = slice.docs.filter((d) => !discovered.has(d));
    if (missing.length > 0) {
      deps.note?.(
        `${slice.id}: ${missing.join(", ")} ${missing.length === 1 ? "was" : "were"} never discovered — dropped from the slice` +
          `${docs.length === 0 ? "; it will plan from every discovered document" : ""}`,
      );
    }
    const items = slice.baseline_items.filter((b) => known.has(b));
    const strays = slice.baseline_items.filter((b) => !known.has(b));
    if (strays.length > 0) deps.note?.(`${slice.id}: ${strays.join(", ")} name no production-baseline item — dropped`);
    return { ...slice, docs, baseline_items: items };
  });
}

/**
 * The typed view of what SLICE put on the pipeline bus.
 *
 * A checkpoint that will not re-parse FAILS the phase. Returning an empty list
 * would be worse than an error: PLAN's fallback is a single unnamed slice over
 * the whole pack, so a stale or corrupt checkpoint would silently plan a large
 * product in one pass — the exact failure C-2‴ exists to prevent, announced as
 * success.
 */
export function slicesFromOutputs(outputs: Readonly<Record<string, Record<string, unknown>>>): Slices["slices"] {
  const raw = outputs["SLICE"]?.["slices"];
  if (raw === undefined) return [];
  const parsed = slicesSchema.safeParse({ schema_version: 1, slices: raw });
  if (!parsed.success) {
    throw new Error(
      `the SLICE checkpoint is unreadable (${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}) — ` +
        "delete .detent/state/SLICE.json and re-run `detent init` to re-slice",
    );
  }
  return parsed.data.slices;
}
