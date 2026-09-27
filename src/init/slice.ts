import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { stateDir } from "../fs/layout.js";
import { SCHEMA_VERSION, parseArtifact } from "../schemas/common.js";
import { sliceAdditionsSchema, slicesSchema, type SliceSpec, type Slices } from "../schemas/init.js";
import { DECISION_LOG_PATH, type Pack } from "../schemas/pack.js";
import { PRODUCTION_BASELINE } from "./baseline.js";
import type { DecidedStack } from "./decide-log.js";
import type { PhaseOutcome } from "./machine.js";
import { detentBuild, UNRECORDED_BUILD } from "../kernel/build.js";
import { previousAttemptInput, refusedAttemptInput, withOneRelaunch, type RetriedAttempt } from "./retry.js";
import {
  additionsSkeleton,
  cutIssue,
  milestonesOf,
  placement,
  readSlicing,
  seedOf,
  seededSkeleton,
  sinceRecord,
  withAdditions,
  writeSlicing,
  type Placement,
} from "./slice-seed.js";

/**
 * C-2‴ (PRDR-117) — SLICE: the whole pack, cut into ordered increments.
 *
 * A planner-role session cuts the product into the slice sequence: the
 * walking skeleton first, each later slice thickening what came before, every
 * requirement id placed exactly once, every applicable production-baseline
 * item placed too. PLAN then plans one slice at a time — what one session can
 * write and one human can read — and never stops between slices.
 *
 * C-3⁗, C-4⁵ (PRDR-292): the cut asks nothing. The founder answers at DECIDE,
 * and what a pack still leaves open, PLAN reports as a spec defect.
 *
 * C-2⁸, C-2¹⁵ (PRDR-291): on a pack, code seeds the session from the checker's
 * parse and checks its cut (`slice-seed.ts`), and a cut on record is kept.
 * Without a parse, where WRITE wrote no pack, the session cuts the documents
 * as they are, as C-2‴ built it.
 */

export function slicesPath(root: string): string {
  return path.join(stateDir(root), "state", "slices.json");
}

/** C-2¹⁵: where a session that may only add writes what it placed. */
export function additionsPath(root: string): string {
  return path.join(stateDir(root), "state", "slice-additions.json");
}

export interface SliceDeps {
  readonly root: string;
  readonly docs: readonly string[];
  readonly greenfield: boolean;
  /** D-10′ (PRDR-290): in greenfield, the stack entry the decision log records; null in an existing project. Handed to the session only without a parse. */
  readonly stack: DecidedStack | null;
  /** C-2⁸ (PRDR-291): the checker's parse VALIDATE handed on; null or absent where WRITE wrote no pack. */
  readonly pack?: Pack | null;
  /** C-2¹⁵: the baseline, the band and the prompt, as one digest; a cut on record made under another is cut again. */
  readonly basis?: string;
  readonly baseline: "production" | "none";
  /** C-2⁵′: the ticket band one slice should hold; the size of the largest artifact a session must write. */
  readonly sliceSize: { readonly min: number; readonly max: number };
  readonly launch: (inputs: Record<string, unknown>, artifactOut: string) => Promise<void>;
  readonly note?: (text: string) => void;
}

interface Cut {
  readonly slices: readonly SliceSpec[];
}

/** The EXACT artifact SLICE writes without a parse; a test parses it through `slicesSchema`. */
export function slicesSkeleton(): Record<string, unknown> {
  return {
    schema_version: SCHEMA_VERSION,
    slices: [
      {
        id: "s01",
        title: "<short name — required>",
        goal: "<what works end to end when this slice is DONE — required>",
        requirement_ids: ["<every requirement id this slice delivers, exactly as written in the documents>"],
        baseline_items: ["<PB-### ids from production_baseline this slice delivers — may be empty>"],
        docs: ["<repo-relative documents this slice plans from>"],
        depends_on: [],
        rationale: "<why this slice, here — may be empty>",
      },
    ],
  };
}

/** PLAN's fallback where nothing was sliced: one slice over every document. */
export function wholeProduct(docs: readonly string[]): SliceSpec {
  return { id: "s01", title: "the plan", goal: "everything the documents ask for", requirement_ids: [], baseline_items: [], docs: [...docs], depends_on: [], rationale: "" };
}

export async function sliceStage(deps: SliceDeps): Promise<PhaseOutcome> {
  const pack = deps.pack ?? null;
  const ids = pack === null ? new Map<string, number>() : placement(pack, deps.docs);
  if (pack !== null && ids.size === 0) {
    deps.note?.("SLICE: the documents planning reads hold no live requirement of the pack, so the slicer cuts them as they are (C-2‴)");
  }
  const cut = pack === null || ids.size === 0 ? await proseCut(deps) : await seededCut(deps, pack, ids);
  const slices = groundSlices(cut.slices, deps, pack !== null && ids.size > 0 ? pack : null);
  deps.note?.(`sliced the documents into ${slices.length} increment(s): ${slices.map((s) => `${s.id} ${s.title}`).join("; ")}`);
  deps.note?.(planningSessions(slices.length));
  return {
    kind: "complete",
    outputs: { slices: slices as unknown as Record<string, unknown>[] },
  };
}

/**
 * N-5′: what PLAN will spend, as the formula over the slice count, since how
 * many revisions and redrafts it buys is not known before it runs. The slicer
 * estimates no ticket count (C-2⁸): its estimates were off by 58%. A slice is
 * a draft and one review read (C-4⁸, PRDR-294), and one more session where the
 * read finds a blocker or major, which buys one revision that nothing reads
 * again. Each redraft A-1⁷'s checks send is one session more: one for a
 * slice's draft or revision that fails them, and one each time the checks
 * across the plan send a slice failures it was not sent before. A slice whose
 * draft still fails them is not read. SLICE's own session has run and is not
 * counted, so this is N-5′'s `1 + 2N + R + C` less it.
 */
export function planningSessions(n: number): string {
  const slices = n === 1 ? "1 slice takes" : `${String(n)} slices take`;
  const formula =
    `${slices} at least ${String(2 * n)} planning sessions, 2N + R + C: a draft and one review read per slice, one more for ` +
    "each of the R slices whose review finds a blocker or major, and one for each of the C redrafts the plan's checks send (A-1⁷).";
  return `PLAN will now run to the end of the product: ${formula} It does not stop until the plan exists (C-2‴).`;
}

/** A strict artifact read from `file`: its value, or why it is unusable. */
function readArtifact<T>(file: string, schema: z.ZodType<T>): RetriedAttempt<T> {
  if (!existsSync(file)) return { value: null, issue: "no artifact written" };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    /* A truncated write is an unusable attempt, not a crash with a JSON stack trace. */
    return { value: null, issue: `artifact is not JSON: ${(err as Error).message}` };
  }
  const parsed = parseArtifact(schema, raw);
  if (!parsed.ok) {
    return { value: null, issue: parsed.reason === "invalid" ? parsed.issues.join("; ") : `schema_version ${parsed.found} is newer than ${parsed.supported}` };
  }
  return { value: parsed.value, issue: null };
}

const sizing = (deps: SliceDeps): string =>
  `Size a slice to ${deps.sliceSize.min}–${deps.sliceSize.max} tickets — one slice is drafted by ONE session into ONE artifact, and that ` +
  "artifact is the largest thing this pipeline must produce without failing. A large product is many slices, and that is the point. ";

const BASELINE =
  "Place every `production_baseline` item whose `applies_when` the product meets into the slice where it belongs (PB-### in " +
  "`baseline_items`); an item that does not apply is omitted, and the rationale of the slice that would have carried it says why. ";

const NO_TICKETS = "Do NOT draft tickets here, and do not estimate how many a slice holds. ";

/** C-2‴: the documents cut as they are, where there is no parse to seed from. */
async function proseCut(deps: SliceDeps): Promise<Cut> {
  const attempt = await withOneRelaunch<Slices>({ stage: "SLICE", note: deps.note }, async (previous) => {
    rmSync(slicesPath(deps.root), { force: true });
    await deps.launch(
      {
        stage: "SLICE",
        docs: deps.docs,
        greenfield: deps.greenfield,
        stack: deps.stack,
        production_baseline: deps.baseline === "none" ? [] : PRODUCTION_BASELINE,
        slice_size: deps.sliceSize,
        expected_output: slicesSkeleton(),
        ...previousAttemptInput(previous, "slices artifact"),
        instruction:
          "Cut the WHOLE document set into ordered slices — increments of the product, each a thin end-to-end path that works " +
          "when it is DONE. The first slice is the walking skeleton through the riskiest integration; each later slice thickens " +
          "earlier ones and names them in `depends_on`. Place EVERY requirement id the documents define in exactly one slice's " +
          `\`requirement_ids\`, exactly as written. ${BASELINE}${sizing(deps)}${NO_TICKETS}Write EXACTLY the \`expected_output\` ` +
          "shape to artifact_out; the validator is strict.",
      },
      slicesPath(deps.root),
    );
    return readArtifact(slicesPath(deps.root), slicesSchema);
  });
  if (attempt.value === null) throw new Error(`SLICE produced no usable slices artifact: ${attempt.issue}`);
  return attempt.value;
}

/**
 * C-2⁸, C-2¹⁵: the pack cut from its seed. A cut on record made under the same
 * baseline, band and prompt is kept: what left the pack leaves its slice, and
 * what joined it is placed by a session that may only add, so no slice
 * changes id or members but for what moved. Otherwise the session cuts the
 * seed whole.
 */
async function seededCut(deps: SliceDeps, pack: Pack, ids: Placement): Promise<Cut> {
  const basis = deps.basis ?? "";
  const record = readSlicing(deps.root);
  if (record !== null && record.basis !== basis) {
    deps.note?.("SLICE: the baseline, the band or the prompt moved since the product was last cut, so it is cut again (C-2⁸)");
  }
  const since = record !== null && record.basis === basis ? sinceRecord(record, ids) : null;
  if (since?.kept.length === 0) deps.note?.("SLICE: no slice on record keeps a requirement the pack still holds, so the product is cut again (C-2⁸)");
  let cut: Cut;
  /** N-5″ (PRDR-297): who cut what stands: the record's builds for the cut it keeps, and this one for what it adds or cuts afresh. */
  let builds: readonly string[] = [detentBuild()];
  if (record !== null && since !== null && since.kept.length > 0) {
    const kept = record.builds ?? [UNRECORDED_BUILD];
    builds = since.added.length === 0 ? kept : [...new Set([...kept, detentBuild()])];
    if (since.removed.length > 0) {
      deps.note?.(`SLICE: ${since.removed.join(", ")} left the cut on record, and the slices that held ${since.removed.length === 1 ? "it" : "them"} are planned again (C-2⁸)`);
    }
    const slices = since.added.length === 0 ? since.kept : await addTo(deps, pack, ids, since.kept, since.added);
    if (since.removed.length + since.added.length === 0) {
      deps.note?.("SLICE: the pack's requirement ids and milestones are those the product was cut on; the cut on record stands, and no session runs (C-2⁸)");
    }
    cut = { slices };
  } else {
    const attempt = await withOneRelaunch<Slices>({ stage: "SLICE", note: deps.note }, async (previous) => await seededOnce(deps, pack, ids, previous));
    if (attempt.value === null) throw new Error(`SLICE produced no usable slices artifact: ${attempt.issue}`);
    cut = attempt.value;
  }
  writeSlicing(deps.root, { basis, placement: Object.fromEntries(ids), slices: [...cut.slices], builds });
  return cut;
}

async function seededOnce(deps: SliceDeps, pack: Pack, ids: Placement, previous: { readonly issue: string } | null): Promise<RetriedAttempt<Slices>> {
  rmSync(slicesPath(deps.root), { force: true });
  await deps.launch(
    {
      stage: "SLICE",
      seed: seedOf(pack, ids),
      docs: deps.docs,
      production_baseline: deps.baseline === "none" ? [] : PRODUCTION_BASELINE,
      slice_size: deps.sliceSize,
      expected_output: seededSkeleton(),
      ...refusedAttemptInput(previous, "slices artifact"),
      instruction:
        "Order and group the `seed` into slices — increments of the product, each a thin end-to-end path that works when it is " +
        "DONE. The seed lists every requirement id to place, grouped by milestone, in order, then by module, with how many " +
        "acceptance criteria each group's requirements have. Place EVERY id in exactly one slice's `requirement_ids`, exactly as " +
        "written, and no id the seed does not list. Keep milestone order: no slice holds a requirement of an earlier milestone " +
        "than one a slice before it holds. A module's group may be split across slices or joined with others; the criteria " +
        "counts say how much each asks. The first slice is the walking skeleton through the riskiest integration; each later " +
        "slice thickens earlier ones and names them in `depends_on`. The documents in `docs` say what each id means: read what " +
        `you need to judge the riskiest integration. ${BASELINE}${sizing(deps)}${NO_TICKETS}Write EXACTLY the ` +
        "`expected_output` shape to artifact_out: the validator is strict, and a slicing that leaves an id out, places one " +
        "twice, names one the seed does not list, or breaks milestone order is refused.",
    },
    slicesPath(deps.root),
  );
  const read = readArtifact(slicesPath(deps.root), slicesSchema);
  if (read.value === null) return read;
  const issue = cutIssue(pack, ids, read.value.slices);
  return issue === null ? read : { value: null, issue };
}

/** C-2¹⁵: `added` placed by a session that may only add, to `kept` or to new slices. */
async function addTo(deps: SliceDeps, pack: Pack, ids: Placement, kept: readonly SliceSpec[], added: readonly string[]): Promise<SliceSpec[]> {
  const want = new Set(added);
  deps.note?.(
    `SLICE: ${added.join(", ")} ${added.length === 1 ? "is" : "are"} not in the cut on record; a slice session that may only add ` +
      "places them, and every slice keeps its id and members (C-2⁸)",
  );
  const attempt = await withOneRelaunch<SliceSpec[]>({ stage: "SLICE", note: deps.note }, async (previous) => {
    rmSync(additionsPath(deps.root), { force: true });
    await deps.launch(
      {
        stage: "SLICE",
        slices: kept.map((s) => ({ id: s.id, title: s.title, goal: s.goal, requirement_ids: s.requirement_ids, milestones: milestonesOf(ids, s) })),
        seed: seedOf(pack, new Map([...ids].filter(([id]) => want.has(id)))),
        docs: deps.docs,
        slice_size: deps.sliceSize,
        expected_output: additionsSkeleton(),
        ...refusedAttemptInput(previous, "additions artifact"),
        instruction:
          "The product is already sliced: `slices` lists each slice in order, with its id, title, goal, requirement ids and " +
          "milestones. The pack has gained the requirement ids in `seed`, grouped by milestone, then by module. Place each of them, " +
          "and nothing else: in an existing slice, as a `placed` entry naming it, or in a new slice in `new_slices`, with an id no " +
          "slice has and `after`, the slice it follows (null puts it first). You may not move, remove or rename anything already " +
          "placed, and every slice keeps its id. Keep milestone order: no slice holds a requirement of an earlier milestone than " +
          "one a slice before it holds, new slices included. Place an id in the slice it thickens, and open a new slice only where " +
          `none fits within ${deps.sliceSize.min}–${deps.sliceSize.max} tickets. Write EXACTLY the \`expected_output\` shape to ` +
          "artifact_out: anything that moves what is placed, leaves an id of the seed out, or breaks milestone order is refused.",
      },
      additionsPath(deps.root),
    );
    const read = readArtifact(additionsPath(deps.root), sliceAdditionsSchema);
    if (read.value === null) return { value: null, issue: read.issue };
    const merged = withAdditions(kept, read.value, want);
    if (merged.value === null) return merged;
    const ordered = slicesSchema.safeParse({ schema_version: SCHEMA_VERSION, slices: merged.value });
    if (!ordered.success) return { value: null, issue: ordered.error.issues.map((i) => i.message).join("; ") };
    const issue = cutIssue(pack, ids, merged.value);
    return issue === null ? { value: merged.value, issue: null } : { value: null, issue };
  });
  if (attempt.value === null) throw new Error(`SLICE could not place ${added.join(", ")}: ${attempt.issue}`);
  return attempt.value;
}

/**
 * A slice's `docs` and `baseline_items` are the model's words, and PLAN spends
 * a session on each slice believing them. A path that was never discovered is
 * dropped here rather than handed to a planner that will read nothing and plan
 * from an empty desk; a slice left with no documents falls back to the whole
 * discovered set, which is the safe direction. An unknown PB id is dropped the
 * same way, noted, so a typo cannot silently retire a baseline item.
 *
 * C-2¹² (PRDR-282): the decision log joins every slice that names its own
 * documents, whatever the model listed. A row there wins over the documents it
 * settles (C-2⁷), and a slice planned without it would plan on what the log
 * overrules. A slice with none plans from every document, the log among them.
 *
 * C-2¹⁵ (PRDR-291) made a slice's documents code's on a pack, and C-4⁵
 * (PRDR-292) left it none: PLAN drafts a slice cut from the pack from its
 * records, so nothing reads a document path there.
 */
function groundSlices(slices: readonly SliceSpec[], deps: SliceDeps, pack: Pack | null): SliceSpec[] {
  const discovered = new Set(deps.docs);
  const log = discovered.has(DECISION_LOG_PATH) ? [DECISION_LOG_PATH] : [];
  const known = new Set(PRODUCTION_BASELINE.map((b) => b.id));
  return slices.map((slice) => {
    const items = slice.baseline_items.filter((b) => known.has(b));
    const strays = slice.baseline_items.filter((b) => !known.has(b));
    if (strays.length > 0) deps.note?.(`${slice.id}: ${strays.join(", ")} name no production-baseline item — dropped`);
    if (pack !== null) return { ...slice, docs: [], baseline_items: items };
    const docs = slice.docs.filter((d) => discovered.has(d));
    const missing = slice.docs.filter((d) => !discovered.has(d));
    if (missing.length > 0) {
      deps.note?.(
        `${slice.id}: ${missing.join(", ")} ${missing.length === 1 ? "was" : "were"} never discovered — dropped from the slice` +
          `${docs.length === 0 ? "; it will plan from every discovered document" : ""}`,
      );
    }
    return { ...slice, docs: docs.length === 0 || docs.includes(DECISION_LOG_PATH) ? docs : [...docs, ...log], baseline_items: items };
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
  const parsed = slicesSchema.safeParse({ schema_version: SCHEMA_VERSION, slices: raw });
  if (!parsed.success) {
    throw new Error(
      `the SLICE checkpoint is unreadable (${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}) — ` +
        "delete .detent/state/SLICE.json and re-run `detent init` to re-slice",
    );
  }
  return parsed.data.slices;
}
