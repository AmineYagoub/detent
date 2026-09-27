import type { Pack } from "../schemas/pack.js";
import { packSchema } from "../schemas/pack.js";
import type { DeclaredPackage } from "./bind-declared.js";
import { planningDocs } from "./decide.js";
import { readDecisionLog, type DecidedStack } from "./decide-log.js";
import { isGreenfield } from "./greenfield.js";
import { bootstrapScaffold } from "./plan-write.js";
import type { PresentChecks } from "./present-checks.js";
import { slicesFromOutputs } from "./slice.js";
import { placement } from "./slice-seed.js";
import { planningMarkers } from "./write.js";

/**
 * What the specification phase and SLICE left for planning to read, from the
 * phases' outputs: the pack's parse, the stack entry, the packages the pack
 * declares, and what PRESENT's checks read (A-1⁷). Moved out of `pipeline.ts`
 * by PRDR-293, which added the last of them; every phase that reads one reads
 * it from here.
 */

export type Outputs = Readonly<Record<string, Record<string, unknown>>>;

/**
 * D-10′ (PRDR-290): the checker's parse of the pack, as VALIDATE handed it on
 * (C-2¹⁴), or null where WRITE wrote no pack. A parse that will not read FAILS
 * the phase, as an unreadable SLICE checkpoint does: planning on nothing where
 * a pack was validated would be the quiet failure.
 */
export function planningPack(outputs: Outputs): Pack | null {
  const raw = outputs["VALIDATE"]?.["pack"];
  if (raw === undefined || raw === null) return null;
  const parsed = packSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new Error(
    `the VALIDATE checkpoint's parse of the pack is unreadable (${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}) — ` +
      "delete .detent/state/VALIDATE.json and re-run `detent init`",
  );
}

/**
 * C-4⁵ (PRDR-292): the parse PLAN drafts from, where SLICE cut the pack's own
 * requirements. Where the documents planning reads hold none of them, SLICE
 * cut those documents as they are (C-2‴), and PLAN drafts from them the same
 * way: a slice cut from prose has no records to be handed.
 */
export function draftingPack(root: string, outputs: Outputs): Pack | null {
  const pack = planningPack(outputs);
  return pack !== null && placement(pack, planningDocs(root, outputs)).size > 0 ? pack : null;
}

/**
 * D-10′ (PRDR-290): whether a stack must be decided, and the entry that
 * decided it. `greenfield` is code's, from the stack markers the specification
 * phase handed on (C-2¹³). In an existing project the stack is discovered, and
 * there is no entry to plan on. In greenfield the stack is the decision log's
 * entry: read from the parse where VALIDATE handed one, and from the log as it
 * stands where WRITE wrote no pack, since DECIDE records it either way. Both
 * are read from what the specification phase left, never from DECIDE's
 * outputs, which the in-flight scan cannot read (C-8″).
 */
export function planningStack(root: string, outputs: Outputs): { readonly greenfield: boolean; readonly stack: DecidedStack | null } {
  const greenfield = isGreenfield(planningMarkers(outputs));
  if (!greenfield) return { greenfield, stack: null };
  const pack = planningPack(outputs);
  return { greenfield, stack: pack === null ? readDecisionLog(root).stack : pack.stack };
}

/**
 * V-5′ (PRDR-295): the packages the pack declares under `## Packages`, from
 * the parse VALIDATE handed on, or from the log as it stands where WRITE wrote
 * no pack, as the stack entry is read.
 */
export function declaredPackages(root: string, outputs: Outputs): readonly DeclaredPackage[] {
  const pack = planningPack(outputs);
  return pack === null ? readDecisionLog(root).packages : pack.packages;
}

/**
 * A-1⁷ (PRDR-293): what PRESENT's checks read besides the tickets and the
 * gates: the slices as SLICE assigned them, the parse PLAN drafted from, and
 * the files the bootstrap's scaffold creates.
 */
export function presentChecks(root: string, outputs: Outputs): PresentChecks {
  const { greenfield, stack } = planningStack(root, outputs);
  return { slices: slicesFromOutputs(outputs), pack: draftingPack(root, outputs), scaffold: bootstrapScaffold(greenfield, stack) };
}
