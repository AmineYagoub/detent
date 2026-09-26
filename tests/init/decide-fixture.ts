import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../../src/fs/layout.js";
import type { DecideAsk } from "../../src/init/decide.js";
import { runInit } from "../../src/init/machine.js";
import { buildPipeline, type PipelineDeps } from "../../src/init/pipeline.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { BUDGETS, PROMPTS } from "./plan-fixture.js";
import { inputsOf } from "./slicing-fixture.js";

/**
 * PRDR-282 — DECIDE's fixture: documents with one contradiction, one gap and
 * one wrong external claim, an AUDIT that finds exactly those, and a DECIDE
 * session scripted per test. Greenfield unless a test adds a stack marker.
 */

export type Json = Record<string, unknown>;

export const PRD = ["# Toolshed", "", "Borrowing is free in the MVP.", "", "Payments use the Stripe API, and a refund returns the card fee.", ""].join("\n");
export const ROADMAP = ["# Roadmap", "", "Launch is in spring.", "Borrowing costs two dollars a day from launch.", ""].join("\n");
export const DOCS = { "PRD.md": PRD, "docs/roadmap.md": ROADMAP };
export const EXISTING = { ...DOCS, "package.json": `${JSON.stringify({ name: "toolshed", scripts: { test: "node --test" } })}\n`, "src/borrow.js": "export const price = 0;\n" };

const FREE = { file: "PRD.md", line: 3, quote: "Borrowing is free in the MVP." };
const PAID = { file: "docs/roadmap.md", line: 4, quote: "Borrowing costs two dollars a day from launch." };
const FEE = { file: "PRD.md", line: 5, quote: "a refund returns the card fee" };

export const SURVEY: Json = {
  schema_version: SCHEMA_VERSION,
  documents_read: ["PRD.md", "docs/roadmap.md"],
  contradictions: [{ topic: "the price of borrowing", passages: [FREE, PAID], why: "free and two dollars a day cannot both hold at launch" }],
  gaps: [{ topic: "late returns", detail: "no document says what happens when a tool comes back late", passages: [] }],
  drift: [],
  claims: [{ claim: "A Stripe refund returns the card processing fee.", subject: "Stripe API", passage: FEE }],
};

const brief = (inputs: Json, verdict: "confirmed" | "wrong"): Json => ({
  schema_version: SCHEMA_VERSION,
  claim: inputs["claim"],
  claim_hash: inputs["claim_hash"],
  verdict,
  source: "https://docs.stripe.com/refunds",
  ...(verdict === "wrong" ? { correction: "Stripe keeps the processing fee when a payment is refunded." } : {}),
  evidence: [{ source: "https://docs.stripe.com/refunds", claim: "the processing fee is not returned" }],
  sources_consulted: [{ tier: 3, ref: "https://docs.stripe.com/refunds" }],
  local_search: { docs_checked: ["PRD.md"], code_checked: [] },
  what_would_falsify: "a Stripe page saying the fee is refunded",
});

/** AUDIT finds the fixture's three items; `verdict` is the claim's. */
export const auditFinds =
  (verdict: "confirmed" | "wrong" = "wrong", survey: Json = SURVEY): StageFn =>
  (spec) => {
    const inputs = inputsOf(spec) as Json;
    writeFileSync(spec.artifactOut, `${JSON.stringify(inputs["task"] === "survey" ? survey : brief(inputs, verdict))}\n`);
    return okResult({ turns: 3 });
  };

export interface Decide {
  readonly stage: StageFn;
  /** The inputs of every DECIDE session, in order. */
  readonly inputs: Json[];
}

/** A DECIDE session answering by attempt; null writes nothing. */
export function decide(answer: (attempt: number, inputs: Json) => Json | null): Decide {
  const inputs: Json[] = [];
  const stage: StageFn = (spec) => {
    const given = inputsOf(spec) as Json;
    inputs.push(given);
    const artifact = answer(inputs.length - 1, given);
    if (artifact !== null) writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
    return okResult({ turns: 2 });
  };
  return { stage, inputs };
}

export const artifact = (over: Json = {}): Json => ({ schema_version: SCHEMA_VERSION, questions: [], defaults: [], settled: [], ...over });

export const PRICE = {
  question: "Is borrowing free at launch, or two dollars a day?",
  why_asked: "It is the product's price, which is counted in money.",
  options: [
    { answer: "Free in the MVP", consequence: "No revenue until pricing lands." },
    { answer: "Two dollars a day", consequence: "The payment rail ships with the MVP." },
  ],
  settles: ["C1"],
};
export const LATE = { value: "A late return blocks new loans until the tool is back.", reason: "The queue rule the PRD implies.", settles: ["G1"] };
export const REFUND = { value: "A refund keeps Stripe's processing fee.", reason: "Stripe's refund documentation, the claim's correction.", settles: ["K1"] };
export const TS_STACK = { language: "TypeScript", toolchain: "Node.js 24 with pnpm 10", scaffold_files: ["package.json"], gates: { test: "pnpm test" } };
export const STACK_DEFAULT = { value: "TypeScript on Node.js 24 with pnpm.", reason: "The documents name no stack; this is the tooling they imply.", settles: ["stack"], stack: TS_STACK };

/** Every item settled: the price asked, the rest defaulted, and the stack where it is open. */
export const SORTED = (inputs: Json): Json => {
  const ids = (inputs["items"] as { id: string }[]).map((i) => i.id);
  return artifact({ questions: [PRICE], defaults: [LATE, REFUND, ...(ids.includes("stack") ? [STACK_DEFAULT] : [])] });
};

const THROUGH_DECIDE = new Set(["INIT_FS", "DISCOVER", "AUDIT", "DECIDE"]);

export interface Through {
  readonly ask?: DecideAsk;
  readonly notes?: string[];
  readonly audit?: StageFn;
  readonly all?: boolean;
  readonly more?: Partial<PipelineDeps>;
  readonly script?: Readonly<Record<string, StageFn>>;
}

/** The real pipeline, stopped after DECIDE unless `all`. */
export async function initThrough(root: string, stub: Decide, opts: Through = {}) {
  const handlers = buildPipeline({
    root,
    backend: new MockBackend({ audit: opts.audit ?? auditFinds(), spec_write: stub.stage, ...opts.script }),
    prompts: PROMPTS,
    budgets: BUDGETS,
    ...(opts.ask === undefined ? {} : { askDecisions: opts.ask }),
    note: (t) => opts.notes?.push(t),
    ...opts.more,
  }).filter((h) => opts.all === true || THROUGH_DECIDE.has(h.phase));
  return await runInit(root, handlers);
}

export const decideOutputs = (root: string): Json =>
  (JSON.parse(readFileSync(path.join(stateDir(root), "state", "DECIDE.json"), "utf8")) as { outputs: Json }).outputs;
