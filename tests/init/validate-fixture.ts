import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../../src/fs/layout.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import type { ConformanceRecord } from "../../src/schemas/pack.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { inputsOf } from "./slicing-fixture.js";
import type { Json } from "./decide-fixture.js";
import { initThroughWrite, read, writesPack, type Run, type Write } from "./write-fixture.js";

/**
 * PRDR-284 — VALIDATE's fixture: WRITE's pack, reviewers scripted per test,
 * and a writer that applies what they found. The pack has two areas: the
 * foundations (the decision log, the facts and the index) and the index's
 * one area, Lending, which holds `docs/prd/01-lending.md`.
 */

export const LENDING_PRD = "docs/prd/01-lending.md";
export const LATE_RULE = { file: LENDING_PRD, line: 6, quote: "A late return MUST block new loans until the tool is back" };
export const FEE_RULE = { file: LENDING_PRD, line: 7, quote: "A refund MUST keep the card processing fee" };

/** A reviewer's finding, a major contradiction at the late-return rule unless `over` says otherwise. */
export const finding = (over: Json = {}): Json => ({
  severity: "major",
  category: "contradiction",
  places: [LATE_RULE],
  why: "the rule and its criterion disagree on when a loan is late",
  fix: "state the grace period in LND-F-002",
  previous: null,
  ...over,
});

/** A review of everything the reviewer was given, with `findings`. */
export const review = (inputs: Json, findings: readonly Json[] = []): Json => ({
  schema_version: SCHEMA_VERSION,
  documents_read: [...((inputs["foundations"] as string[] | undefined) ?? []), ...((inputs["documents"] as string[] | undefined) ?? [])],
  findings,
});

export interface Reviewers {
  readonly stage: StageFn;
  /** The inputs of every reviewer, in order. */
  readonly inputs: Json[];
}

/** Reviewers answering per call; null writes no artifact. */
export function reviewers(answer: (call: number, inputs: Json, root: string) => Json | null): Reviewers {
  const inputs: Json[] = [];
  const stage: StageFn = (spec) => {
    const given = inputsOf(spec) as Json;
    inputs.push(given);
    const artifact = answer(inputs.length - 1, given, spec.cwd);
    if (artifact !== null) writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
    return okResult({ turns: 4 });
  };
  return { stage, inputs };
}

/** Reviewers who find nothing. */
export const clean = (): Reviewers => reviewers((_, inputs) => review(inputs));

/** Reviewers who report `per(round, area)` in each round, by area name. */
export const byRound = (per: (round: number, area: string) => readonly Json[]): Reviewers =>
  reviewers((_, inputs) => review(inputs, per(inputs["round"] as number, inputs["area"] as string)));

export interface Writer {
  readonly stage: StageFn;
  readonly inputs: Json[];
}

export interface Fix {
  /** Each file's text after the fix, from its text before. */
  readonly edit?: Readonly<Record<string, (text: string) => string>>;
  /** The account; null writes none. Absent, every finding applied. */
  readonly artifact?: Json | null;
}

/** VALIDATE's writer, answering per call. */
export function writer(answer: (call: number, inputs: Json, root: string) => Fix): Writer {
  const inputs: Json[] = [];
  const stage: StageFn = (spec) => {
    const given = inputsOf(spec) as Json;
    inputs.push(given);
    const { edit = {}, artifact } = answer(inputs.length - 1, given, spec.cwd);
    for (const [rel, change] of Object.entries(edit)) {
      const file = path.join(spec.cwd, ...rel.split("/"));
      writeFileSync(file, change(readFileSync(file, "utf8")));
    }
    const ids = ((given["findings"] as { id: string }[] | undefined) ?? []).map((f) => f.id);
    const account = artifact === undefined ? { schema_version: SCHEMA_VERSION, applied: ids, declined: [] } : artifact;
    if (account !== null) writeFileSync(spec.artifactOut, `${JSON.stringify(account)}\n`);
    return okResult({ turns: 6 });
  };
  return { stage, inputs };
}

/** A writer that applies every finding with an edit the next round can see: a line added to the Lending PRD. */
export const appliesAll = (): Writer =>
  writer((call) => ({ edit: { [LENDING_PRD]: (text) => text.replace("## 7. Acceptance criteria", `Fixed in call ${String(call)}.\n\n## 7. Acceptance criteria`) } }));

export const THROUGH_VALIDATE = new Set(["INIT_FS", "DISCOVER", "AUDIT", "DECIDE", "WRITE", "VALIDATE"]);

export interface ValidateRun extends Run {
  readonly reviewers?: Reviewers;
  readonly writer?: Writer;
  /** Seen after the run: every session's role, in order. */
  readonly seen?: { backend: MockBackend | null };
}

/** The real pipeline through VALIDATE (or all of it), WRITE writing the fixture's pack. */
export async function initThroughValidate(root: string, opts: ValidateRun = {}, stub: Write = writesPack()) {
  const script = { ...(opts.reviewers === undefined ? {} : { spec_review: opts.reviewers.stage }), ...opts.script };
  return await initThroughWrite(root, stub, {
    ...opts,
    through: opts.through ?? THROUGH_VALIDATE,
    ...(opts.writer === undefined ? {} : { fixStub: opts.writer.stage }),
    script,
    backend: (s) => {
      const backend = opts.backend?.(s) ?? new MockBackend(s);
      if (opts.seen !== undefined) opts.seen.backend = backend;
      return backend;
    },
  });
}

export const record = (root: string): ConformanceRecord => JSON.parse(read(root, "docs/conformance.json")) as ConformanceRecord;

export const validateOutputs = (root: string): Json =>
  (JSON.parse(readFileSync(path.join(stateDir(root), "state", "VALIDATE.json"), "utf8")) as { outputs: Json }).outputs;
