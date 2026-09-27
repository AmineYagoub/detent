import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect } from "vitest";
import { runInit, type InitOptions, type InitResult } from "../../src/init/machine.js";
import { checkPack } from "../../src/init/pack-check.js";
import { packDocuments } from "../../src/init/pack.js";
import { buildPipeline, type PipelineDeps } from "../../src/init/pipeline.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { MockBackend, okResult } from "../../src/sessions/mock.js";
import { CONFORMING_PACK, commitRecord, packRepo } from "./pack-fixture.js";
import { APPROVE_PLAN, BUDGETS, PROMPTS, planning } from "./plan-fixture.js";
import { covering, inputsOf, sliceOf, ticket } from "./slicing-fixture.js";

/**
 * PRDR-291 — SLICE on a pack (C-2⁸): the pack fixture, conforming, with a
 * planner that answers SLICE's two artifacts, each slice's draft and every
 * review, and logs which it served. Nothing else runs a session on a
 * conforming pack, so what a case asserts is what planning did.
 */

export type Json = Record<string, unknown>;

export interface Cut {
  readonly id: string;
  readonly requirement_ids: readonly string[];
  readonly depends_on?: readonly string[];
  readonly baseline_items?: readonly string[];
}

/** The pack fixture's live requirements cut three ways: the M0 foundation, then M1's catalog and M1's checkout. */
export const CUT: readonly Cut[] = [
  { id: "s01", requirement_ids: ["CAT-F-001"] },
  { id: "s02", requirement_ids: ["CAT-F-002", "CAT-N-001"], depends_on: ["s01"] },
  { id: "s03", requirement_ids: ["CHK-F-001", "CHK-F-002"], depends_on: ["s01"] },
];

/**
 * A slicing of `cut` in words that differ with every take, as a model's do:
 * 1 of 24 titles survived between two real runs. Only the ids are the cut's.
 */
export function slicing(cut: readonly Cut[], take: number): Json {
  return {
    schema_version: SCHEMA_VERSION,
    slices: cut.map((s) => ({
      id: s.id,
      title: `${s.id}, take ${String(take)}`,
      goal: `it works end to end, as take ${String(take)} put it`,
      requirement_ids: [...s.requirement_ids],
      baseline_items: [...(s.baseline_items ?? [])],
      depends_on: [...(s.depends_on ?? [])],
      rationale: `cut on take ${String(take)}`,
    })),
  };
}

export interface Script {
  /** SLICE's slicing on its n-th launch (1-based); `slicing(CUT, n)` by default. */
  readonly slices?: (take: number, inputs: Json) => Json;
  /** The artifact of the session that may only add, on its n-th launch. */
  readonly additions?: (take: number, inputs: Json) => Json;
  /** PRDR-292: a slice's draft on that slice's n-th launch (1-based); one ticket delivering its requirements by default. */
  readonly draft?: (take: number, inputs: Json) => Json;
  /** PRDR-292: a review's verdict on the n-th review launch of its slice; approval by default. */
  readonly review?: (take: number, inputs: Json) => Json;
}

export interface Seeded {
  readonly root: string;
  /** SLICE, SLICE:add, PLAN:<slice> and REVIEW, one per planner launch, in order. */
  readonly log: string[];
  /** Every planner launch's inputs, in order. */
  readonly inputs: Json[];
  /** PRDR-292: every planner launch's session spec, in order, as the backend received it. */
  readonly specs: SessionSpec[];
  readonly notes: string[];
  readonly init: (opts?: InitOptions, deps?: Partial<PipelineDeps>) => Promise<InitResult>;
}

/** The launches since the last `clear`, as the planner served them. */
export const planned = (s: Seeded): string[] => s.log.filter((e) => e.startsWith("PLAN:"));
export const sliced = (s: Seeded): string[] => s.log.filter((e) => e.startsWith("SLICE"));
export const clear = (s: Seeded): void => {
  s.log.splice(0);
  s.inputs.splice(0);
  s.specs.splice(0);
  s.notes.splice(0);
};

/**
 * Each slice's draft: one ticket delivering the slice's requirements and
 * carrying, word for word, every criterion its records hold, so it passes
 * A-1⁷'s checks (PRDR-293) and a case that is not about them sees no redraft.
 */
export const draft = (inputs: Json): Json => covering(inputs, [ticket(`t-${sliceOf(inputs)}-001`)]) as Json;

/** The pack fixture as `files`, committed with the record that says it conforms, and a scripted planner over it. */
export function seeded(files: Readonly<Record<string, string>> = CONFORMING_PACK, script: Script = {}): Seeded {
  const root = packRepo(files);
  commitRecord(root);
  const log: string[] = [];
  const inputs: Json[] = [];
  const specs: SessionSpec[] = [];
  const notes: string[] = [];
  let takes = 0;
  let adds = 0;
  const drafts = new Map<string, number>();
  const reviews = new Map<string, number>();
  const backend = new MockBackend({
    ...planning((spec) => {
      const given = inputsOf(spec);
      inputs.push(given);
      specs.push(spec);
      const out = path.basename(spec.artifactOut);
      let artifact: Json;
      if (out === "slices.json") {
        takes += 1;
        log.push("SLICE");
        artifact = (script.slices ?? ((take: number) => slicing(CUT, take)))(takes, given);
      } else if (out === "slice-additions.json") {
        adds += 1;
        log.push("SLICE:add");
        if (script.additions === undefined) throw new Error("this case scripted no session that may only add");
        artifact = script.additions(adds, given);
      } else if (out === "plan-draft.json") {
        const slice = sliceOf(given);
        log.push(`PLAN:${slice}`);
        drafts.set(slice, (drafts.get(slice) ?? 0) + 1);
        artifact = (script.draft ?? ((_take: number, i: Json) => draft(i)))(drafts.get(slice) ?? 1, given);
      } else if (out === "plan-review.json") {
        log.push("REVIEW");
        const slice = sliceOf(given);
        reviews.set(slice, (reviews.get(slice) ?? 0) + 1);
        artifact = (script.review ?? ((): Json => APPROVE_PLAN))(reviews.get(slice) ?? 1, given);
      } else {
        throw new Error(`the planner was asked for ${spec.artifactOut}, which no planning stage writes`);
      }
      writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
      return okResult();
    }),
  });
  const init = async (opts: InitOptions = {}, deps: Partial<PipelineDeps> = {}): Promise<InitResult> =>
    await runInit(
      root,
      buildPipeline({
        root,
        backend,
        prompts: PROMPTS,
        budgets: BUDGETS,
        note: (t) => notes.push(t),
        sandbox: async () => ({ kind: "off", reason: "the test fixture probes no sandbox" }),
        ...deps,
      }),
      opts,
    );
  return { root, log, inputs, specs, notes, init };
}

/**
 * Edit one pack document and commit the record that says the pack conforms,
 * as a validation of the edit would leave it. The checker must stay green: a
 * red pack stops at VALIDATE, and nothing would plan.
 */
export function edit(root: string, file: string, ...changes: readonly (readonly [string, string])[]): void {
  const abs = path.join(root, ...file.split("/"));
  let text = readFileSync(abs, "utf8");
  for (const [from, to] of changes) {
    expect(text, `${file} holds the text this edit replaces`).toContain(from);
    text = text.replace(from, to);
  }
  writeFileSync(abs, text);
  const red = checkPack(root, packDocuments(root), { greenfield: true }).findings.filter((f) => f.blocks);
  expect(red.map((f) => `${f.file}:${String(f.line)} [${f.rule}] ${f.message}`), "the edited pack stays green").toEqual([]);
  commitRecord(root);
}

/** SLICE's launches' inputs: the full slicing's, then the session's that may only add. */
export const sliceInputs = (s: Seeded): Json[] => s.inputs.filter((i) => i["stage"] === "SLICE");
