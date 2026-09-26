import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../../src/fs/layout.js";
import { runInit } from "../../src/init/machine.js";
import { buildPipeline, type PipelineDeps } from "../../src/init/pipeline.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { BUDGETS, PROMPTS } from "./plan-fixture.js";
import { inputsOf } from "./slicing-fixture.js";
import { DOCS, SORTED, SURVEY, auditFinds, decide, type Decide, type Json } from "./decide-fixture.js";

/**
 * PRDR-283 — WRITE's fixture: the DECIDE fixture's two documents and a README,
 * an AUDIT that finds their three items, a DECIDE that settles them off a
 * terminal (X-1 late returns, X-2 the refund fee, X-3 the stack, X-4 the price),
 * and a WRITE session scripted per test. Greenfield, as the DECIDE fixture is.
 */

export const README = "# Toolshed\n\nRun `pnpm install`, then `pnpm test`.\n";
export const RAW = { ...DOCS, "README.md": README };

export const INDEX = [
  "# Product requirements",
  "",
  "## Codes",
  "",
  "| Code | Area | PRD | Milestones |",
  "|---|---|---|---|",
  "| LND | Lending | [01-lending.md](01-lending.md) | M1 |",
  "",
  "## Milestones",
  "",
  "| Milestone | Contents |",
  "|---|---|",
  "| M1 | Lending |",
  "",
].join("\n");

export const LENDING = [
  "# 01 — Lending",
  "",
  "## 4. Functional requirements",
  "",
  "- **LND-F-001** [M1] Borrowing a tool MUST cost nothing in the MVP (X-4).",
  "- **LND-F-002** [M1] A late return MUST block new loans until the tool is back (X-1).",
  "- **LND-F-003** [M1] A refund MUST keep the card processing fee (X-2; facts §1.1).",
  "",
  "## 7. Acceptance criteria",
  "",
  "- **LND-AC-01** [M1] Given a member, when they borrow a tool, then they are charged 0 (LND-F-001).",
  "- **LND-AC-02** [M1] Given a member with a late tool, when they borrow another, then the answer is 409 (LND-F-002).",
  "- **LND-AC-03** [M1] Given a refunded payment of 1000, when the refund settles, then 1000 less the fee is returned (LND-F-003).",
  "",
].join("\n");

export const FACTS = [
  "# Verified facts",
  "",
  "## 1. Payments",
  "",
  "| Id | Fact | Source | Tag |",
  "|---|---|---|---|",
  "| 1.1 | Stripe keeps the processing fee when a payment is refunded. | https://docs.stripe.com/refunds | doc |",
  "",
].join("\n");

/** A pack the checker is green on, over the log DECIDE writes in greenfield (X-1 late returns, X-2 the fee, X-4 the price). */
export const PACK: Readonly<Record<string, string>> = {
  "docs/prd/index.md": INDEX,
  "docs/prd/01-lending.md": LENDING,
  "docs/research/verified-facts.md": FACTS,
};

/** The entry that settled one of the fixture's findings, as the session is told it. */
const settledBy = (inputs: Json, id: string): string =>
  String(((inputs["findings"] as Json[] | undefined) ?? []).find((f) => f["id"] === id)?.["settled_by"] ?? "");

/** The pack, citing whichever entries DECIDE settled the findings with: in an existing project the stack is no item, and the price is X-3. */
export function packFor(inputs: Json): Record<string, string> {
  const lending = LENDING.replace("(X-4)", `(${settledBy(inputs, "C1")})`)
    .replace("(X-1)", `(${settledBy(inputs, "G1")})`)
    .replace("(X-2;", `(${settledBy(inputs, "K1")};`);
  return { ...PACK, "docs/prd/01-lending.md": lending };
}

export const WROTE = (over: Json = {}): Json => ({ schema_version: SCHEMA_VERSION, archive: ["PRD.md", "docs/roadmap.md"], context: ["README.md"], ...over });

export interface Written {
  /** The files the session writes, relative to the root. */
  readonly files?: Readonly<Record<string, string>>;
  /** Its artifact; null writes none. */
  readonly artifact: Json | null;
}

export interface Write {
  readonly stage: StageFn;
  /** The inputs of every WRITE session, in order. */
  readonly inputs: Json[];
  readonly specs: SessionSpec[];
}

/** A WRITE session answering by attempt. */
export function write(answer: (attempt: number, inputs: Json, root: string) => Written): Write {
  const inputs: Json[] = [];
  const specs: SessionSpec[] = [];
  const stage: StageFn = (spec) => {
    const given = inputsOf(spec) as Json;
    inputs.push(given);
    specs.push(spec);
    const { files = {}, artifact } = answer(inputs.length - 1, given, spec.cwd);
    for (const [rel, text] of Object.entries(files)) {
      const abs = path.join(spec.cwd, ...rel.split("/"));
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, text);
    }
    if (artifact !== null) writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
    return okResult({ turns: 5 });
  };
  return { stage, inputs, specs };
}

/** The pack, and the artifact that archives both originals and keeps the README. */
export const writesPack = (): Write => write((_, inputs) => ({ files: packFor(inputs), artifact: WROTE() }));

/** One `spec_write` role, three tasks: DECIDE's session, WRITE's and VALIDATE's writer, told apart by `task`. */
export function specWrite(decideStub: Decide, writeStub: Write, fixStub?: StageFn): StageFn {
  return (spec) => {
    const task = (inputsOf(spec) as Json)["task"];
    if (task === "fix") {
      if (fixStub === undefined) throw new Error("VALIDATE's writer ran, and this test scripted none");
      return fixStub(spec);
    }
    return task === "write" ? writeStub.stage(spec) : decideStub.stage(spec);
  };
}

/** The DECIDE fixture's AUDIT, reading every document it is given, the README included. */
export const auditReads: StageFn = (spec) => auditFinds("wrong", { ...SURVEY, documents_read: (inputsOf(spec) as Json)["documents"] ?? [] })(spec);

const THROUGH_WRITE = new Set(["INIT_FS", "DISCOVER", "AUDIT", "DECIDE", "WRITE"]);

export interface Run {
  readonly notes?: string[];
  readonly all?: boolean;
  /** The phases to run, where not `all` and not through WRITE. */
  readonly through?: ReadonlySet<string>;
  readonly decideStub?: Decide;
  /** VALIDATE's writer, the `fix` task of `spec_write`. */
  readonly fixStub?: StageFn;
  readonly more?: Partial<PipelineDeps>;
  readonly script?: Readonly<Record<string, StageFn>>;
  readonly backend?: (script: Record<string, StageFn>) => MockBackend;
}

/** The real pipeline, stopped after WRITE unless `all` or `through` says otherwise. */
export async function initThroughWrite(root: string, stub: Write, opts: Run = {}) {
  const script = { audit: auditReads, spec_write: specWrite(opts.decideStub ?? decide((_, i) => SORTED(i)), stub, opts.fixStub), ...opts.script };
  const handlers = buildPipeline({
    root,
    backend: opts.backend?.(script) ?? new MockBackend(script),
    prompts: PROMPTS,
    budgets: BUDGETS,
    note: (t) => opts.notes?.push(t),
    ...opts.more,
  }).filter((h) => opts.all === true || (opts.through ?? THROUGH_WRITE).has(h.phase));
  return await runInit(root, handlers);
}

export const writeOutputs = (root: string): Json =>
  (JSON.parse(readFileSync(path.join(stateDir(root), "state", "WRITE.json"), "utf8")) as { outputs: Json }).outputs;

export const read = (root: string, rel: string): string => readFileSync(path.join(root, ...rel.split("/")), "utf8");
