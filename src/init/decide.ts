import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { stateDir, writeArtifact } from "../fs/layout.js";
import { noteUnitComplete } from "../kernel/ledger.js";
import { SCHEMA_VERSION, parseArtifact } from "../schemas/common.js";
import { decideArtifactSchema, decideRecordSchema, type DecideArtifact, type DecideQuestion, type DecideRecord } from "../schemas/decide.js";
import { DECISION_LOG_PATH } from "../schemas/pack.js";
import { isGreenfield } from "./analyze.js";
import { checkDecide, openItems, type DecideCheck, type Item } from "./decide-items.js";
import { appendToDecisionLog, decisionLogFile, nextId, readDecisionLog, type DecidedStack, type LogAdditions, type LogView } from "./decide-log.js";
import { decideNotes, deferredMessage } from "./decide-notes.js";
import { contentsDigest, valueDigest, type PhaseHandler, type PhaseOutcome } from "./machine.js";
import type { PipelineDeps } from "./pipeline.js";
import { refusedAttemptInput, withOneRelaunch } from "./retry.js";
import { sessionDeps } from "./session-deps.js";
import { launchInitSession, withInitJournal } from "./session.js";

/**
 * C-2⁶, C-3⁗, C-2¹² (PRDR-282) — DECIDE: what AUDIT left open is asked or
 * settled before anything plans from it.
 *
 * C-3′ asked every question once, at PRESENT, after the whole plan was drafted
 * on assumptions, so a decision counted in money or contracts had every slice
 * resting on it drafted and reviewed before the founder saw it. DECIDE reads
 * AUDIT's checkpoint and the decision log, and one `spec_write` session sorts
 * each open item: a question C-3″ lets it ask, a vetoable default, or an entry
 * the log already holds. Code checks the sorting and writes the log.
 *
 * On a terminal the questions come in screens of at most four, the recommended
 * option first, and the answers become `D-n` entries. A founder who answers
 * later gets AWAIT_INFO, and nothing is written. Off a terminal nobody can be
 * asked, so each recommended answer is taken and logged as a vetoable `X-n`
 * (specification decision 9).
 */

type Json = Record<string, unknown>;
type Ctx = Parameters<PhaseHandler["digest"]>[0];

/** One question as a terminal shows it, the recommended option first. */
export interface AskedQuestion {
  readonly number: number;
  readonly question: string;
  readonly why_asked: string;
  readonly options: readonly { readonly answer: string; readonly consequence: string }[];
  /** False for the question that settles the stack: an answer in the founder's own words carries no stack entry (D-10′). */
  readonly ownAllowed: boolean;
}

/** An option by its index, or the founder's own words. */
export type DecideAnswer = { readonly option: number } | { readonly own: string };

/** C-3⁗: one screen of at most `SCREEN` questions; `later` defers every question. */
export type DecideAsk = (screen: readonly AskedQuestion[]) => Promise<readonly DecideAnswer[] | "later">;

export const SCREEN = 4;

/** Where the session writes, before anything has checked it, cleared before each launch (D-19). */
export function decideArtifactPath(root: string): string {
  return path.join(stateDir(root), "state", "decide-artifact.json");
}

/** Named apart from `DECIDE.json`, the checkpoint, which a case-insensitive file system would take for the same file. */
const RECORD = "state/decide-record.json";

export function readDecideRecord(root: string): DecideRecord {
  const empty: DecideRecord = { schema_version: SCHEMA_VERSION, settled: {}, draft: null };
  const file = path.join(stateDir(root), ...RECORD.split("/"));
  if (!existsSync(file)) return empty;
  try {
    const parsed = parseArtifact(decideRecordSchema, JSON.parse(readFileSync(file, "utf8")));
    return parsed.ok ? parsed.value : empty;
  } catch {
    return empty;
  }
}

/** The `expected_output` skeleton; a test parses it through `decideArtifactSchema`, so the two cannot drift. */
export function decideSkeleton(stackOpen: boolean): Json {
  const option = (which: string) => ({ answer: `<${which}>`, consequence: "<what choosing it means: the money, the contract, what the product then does>" });
  const stack = {
    language: "<the bare language name>",
    toolchain: "<the runtime and package manager, with versions>",
    scaffold_files: ["<each file the scaffold creates that later tickets lean on>"],
    gates: { test: "<the test command the documents name; leave out every slot they name none for>" },
  };
  return {
    schema_version: SCHEMA_VERSION,
    questions: [
      {
        question: "<a decision counted in money or contracts rather than in code>",
        why_asked: "<why only the founder can answer it>",
        options: [option("the option you recommend"), option("another option")],
        settles: ["<the ids of the items it settles>"],
      },
    ],
    defaults: [
      { value: "<the decision, stated as a rule the plan follows>", reason: "<why it is defensible: the passages, the source or the practice it follows>", settles: ["<the ids of the items it settles>"] },
      ...(stackOpen ? [{ value: "<the stack, in one sentence>", reason: "<why this stack>", settles: ["stack"], stack }] : []),
    ],
    settled: [{ item: "<an item id>", entry: "<the decision log's id for the entry that already settles it>" }],
  };
}

export interface DecideStageDeps {
  readonly root: string;
  /** AUDIT's checkpoint outputs, as the bus carries them. */
  readonly audit: Json | undefined;
  readonly documents: readonly string[];
  readonly stackMarkers: readonly string[];
  readonly promptHash: string;
  readonly launch: (inputs: Json, artifactOut: string) => Promise<void>;
  /** A terminal's asker; absent off a terminal, where nobody can be asked (specification decision 9). */
  readonly ask?: DecideAsk;
  readonly note?: (text: string) => void;
}

function readDecide(file: string, items: readonly Item[], log: LogView, strict: boolean): { value: DecideCheck | null; issue: string | null } {
  if (!existsSync(file)) return { value: null, issue: "the session wrote no artifact" };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { value: null, issue: "the artifact is not JSON" };
  }
  const parsed = parseArtifact(decideArtifactSchema, raw);
  if (!parsed.ok) return { value: null, issue: parsed.reason === "invalid" ? parsed.issues.join("; ") : parsed.reason };
  const check = checkDecide(parsed.value, items, log);
  /* C-2¹²: strict on the first attempt, so the relaunch hears everything; the second keeps what stands. */
  if (strict && check.issues.length > 0) return { value: null, issue: check.issues.join("; ") };
  return { value: check, issue: null };
}

async function sort(deps: DecideStageDeps, open: readonly Item[], log: LogView, greenfield: boolean): Promise<DecideCheck> {
  const artifactOut = decideArtifactPath(deps.root);
  const stackOpen = open.some((i) => i.kind === "stack");
  const sorted = await withOneRelaunch<DecideCheck>({ stage: "DECIDE", note: deps.note }, async (previous) => {
    rmSync(artifactOut, { force: true });
    await deps.launch(
      {
        task: "decide",
        greenfield,
        stack_markers: [...deps.stackMarkers],
        documents: [...deps.documents],
        decision_log: DECISION_LOG_PATH,
        decision_log_entries: [
          ...log.decisions.map((d) => ({ id: d.id, question: d.question, answer: d.answer })),
          ...log.defaults.map((d) => ({ id: d.id, value: d.value })),
        ],
        items: open.map((i) => i.shown),
        expected_output: decideSkeleton(stackOpen),
        ...refusedAttemptInput(previous, "decision artifact"),
      },
      artifactOut,
    );
    return readDecide(artifactOut, open, log, previous === null);
  });
  if (sorted.value === null) throw new Error(`DECIDE produced no usable artifact: ${sorted.issue ?? "unusable"}`);
  return sorted.value;
}

const asked = (q: DecideQuestion, number: number): AskedQuestion => ({
  number,
  question: q.question,
  why_asked: q.why_asked,
  options: q.options.map((o) => ({ answer: o.answer, consequence: o.consequence })),
  ownAllowed: !q.options.some((o) => o.stack !== undefined),
});

/** Every question, in screens of at most four; `later` on any screen defers them all. */
async function askAll(ask: DecideAsk, questions: readonly DecideQuestion[]): Promise<DecideAnswer[] | "later"> {
  const answers: DecideAnswer[] = [];
  for (let at = 0; at < questions.length; at += SCREEN) {
    const screen = questions.slice(at, at + SCREEN).map((q, i) => asked(q, at + i + 1));
    const got = await ask(screen);
    if (got === "later") return "later";
    if (got.length !== screen.length) throw new Error(`the asker answered ${String(got.length)} of ${String(screen.length)} questions`);
    answers.push(...got);
  }
  return answers;
}

/** What the log gains, and which entry settles each item. `answers` is null off a terminal: each recommended option is taken. */
function settle(sorted: DecideArtifact, answers: readonly DecideAnswer[] | null, log: LogView) {
  const nextD = nextId(log.ids, "D");
  const nextX = nextId(log.ids, "X");
  const add: { decisions: LogAdditions["decisions"][number][]; defaults: LogAdditions["defaults"][number][]; stack: DecidedStack | null } = {
    decisions: [],
    defaults: [],
    stack: null,
  };
  const by = new Map(sorted.settled.map((s) => [s.item, s.entry]));
  const recommended: string[] = [];
  for (const d of sorted.defaults) {
    const id = nextX(add.defaults.length);
    add.defaults.push({ id, value: d.value, reason: d.reason });
    for (const item of d.settles) by.set(item, id);
    if (d.stack !== undefined) add.stack = { ...d.stack, decision: id };
  }
  sorted.questions.forEach((q, n) => {
    const answer = answers?.[n];
    const option = answer === undefined ? q.options[0] : "option" in answer ? q.options[answer.option] : undefined;
    let id: string;
    if (answer === undefined) {
      id = nextX(add.defaults.length);
      add.defaults.push({
        id,
        value: option?.answer ?? "",
        reason: `The recommended answer to "${q.question}", taken without asking, since off a terminal nobody can be asked (specification decision 9): ${option?.consequence ?? ""}`,
      });
      recommended.push(id);
    } else {
      id = nextD(add.decisions.length);
      add.decisions.push({
        id,
        question: q.question,
        answer: option?.answer ?? ("own" in answer ? answer.own : ""),
        reason: option?.consequence ?? "The founder's own answer, given at DECIDE.",
      });
    }
    for (const item of q.settles) by.set(item, id);
    if (option?.stack !== undefined) add.stack = { ...option.stack, decision: id };
  });
  return { add, by, recommended };
}

function logDigest(root: string): string {
  return contentsDigest(root, [DECISION_LOG_PATH]);
}

/** What the phases after DECIDE read: the log as it stands once DECIDE is done, whether DECIDE wrote to it or not. */
function outputs(root: string, run: Json): PhaseOutcome {
  const log = readDecisionLog(root);
  return {
    kind: "complete",
    outputs: { log: log.exists ? DECISION_LOG_PATH : null, decisions: log.decisions, defaults: log.defaults, stack: log.stack, ...run },
  };
}

export async function decideStage(deps: DecideStageDeps): Promise<PhaseOutcome> {
  const greenfield = isGreenfield(deps.stackMarkers);
  const log = readDecisionLog(deps.root);
  const items = openItems(deps.audit, { stackOpen: greenfield && !log.hasStack });
  const record = readDecideRecord(deps.root);
  /* The stack is open while the log has none, whatever the record says; any other item, while no entry the log holds settles it. */
  const open = items.filter((i) => i.kind === "stack" || !log.ids.has(record.settled[i.key] ?? ""));
  if (open.length === 0) {
    deps.note?.(
      items.length === 0
        ? "DECIDE: AUDIT left nothing open, so there is nothing to decide (C-2¹²)"
        : "DECIDE: every item AUDIT left open is settled by an entry the decision log still holds, so no session ran (C-2¹²)",
    );
    noteUnitComplete(deps.root);
    return outputs(deps.root, { ran: true, session: false, asked: [], defaulted: [], recommended: [], unsorted: [] });
  }
  const key = createHash("sha256")
    .update(JSON.stringify([open.map((i) => i.key), logDigest(deps.root), deps.promptHash, greenfield, deps.documents]))
    .digest("hex");
  const reused = record.draft?.key === key ? record.draft.artifact : null;
  const sorted = reused === null ? await sort(deps, open, log, greenfield) : checkDecide(reused, open, log);
  writeArtifact(deps.root, RECORD, { ...record, draft: { key, artifact: sorted.kept } });

  const questions = sorted.kept.questions;
  const answers = deps.ask === undefined || questions.length === 0 ? null : await askAll(deps.ask, questions);
  if (answers === "later") {
    return { kind: "interrupt", interrupt: "AWAIT_INFO", message: deferredMessage(questions), items: questions.map((q) => q.question) };
  }
  const { add, by, recommended } = settle(sorted.kept, answers, log);
  appendToDecisionLog(deps.root, log, add);
  const settled = Object.fromEntries(open.flatMap((i) => (by.has(i.id) ? [[i.key, by.get(i.id) ?? ""]] : [])));
  writeArtifact(deps.root, RECORD, { schema_version: SCHEMA_VERSION, settled: { ...record.settled, ...settled }, draft: null });
  const run = {
    asked: add.decisions.map((d) => d.id),
    defaulted: add.defaults.map((d) => d.id).filter((id) => !recommended.includes(id)),
    recommended,
    cited: sorted.kept.settled.map((s) => s.entry),
    unsorted: sorted.unsorted.map((i) => ({ id: i.id, kind: i.kind, summary: i.summary })),
  };
  for (const text of decideNotes(run, questions, add.defaults)) deps.note?.(text);
  /* X-1⁵ (C-2⁶): a completed DECIDE is a unit of work. */
  noteUnitComplete(deps.root);
  return outputs(deps.root, { ran: true, session: reused === null, ...run });
}

/**
 * The documents a planning phase reads: VALIDATE's, the pack as it validated
 * it and the log among them (C-2¹⁴), or WRITE's where VALIDATE is not in the
 * pipeline (C-2¹³). Where neither is, what DISCOVER found, and the decision
 * log where it exists, which DISCOVER does not list (C-2¹²), read from disk,
 * so a digest taken before DECIDE runs, as the in-flight scan takes it, names
 * the same documents as one taken after. Each planning phase names the log's
 * contents in its own digest, which is how DECIDE, off the chain, re-plans.
 */
export function planningDocs(root: string, outputs: Readonly<Record<string, Record<string, unknown>>>): string[] {
  const written = outputs["VALIDATE"]?.["docs"] ?? outputs["WRITE"]?.["docs"];
  if (Array.isArray(written)) return [...(written as string[])];
  const docs = (outputs["DISCOVER"]?.["docs"] as string[] | undefined) ?? [];
  return existsSync(decisionLogFile(root)) && !docs.includes(DECISION_LOG_PATH) ? [...docs, DECISION_LOG_PATH].sort() : [...docs];
}

/** D-10′: the stack DECIDE recorded, or null; in greenfield it is the stack ANALYZE plans on. */
export function decidedStack(outputs: Readonly<Record<string, Record<string, unknown>>>): DecidedStack | null {
  const stack = outputs["DECIDE"]?.["stack"];
  return typeof stack === "object" && stack !== null ? (stack as DecidedStack) : null;
}

export function decidePhase(deps: PipelineDeps): PhaseHandler {
  const docsOf = (ctx: Ctx): string[] => (ctx.outputs["DISCOVER"]?.["docs"] as string[] | undefined) ?? [];
  const markersOf = (ctx: Ctx): string[] => (ctx.outputs["DISCOVER"]?.["stack_markers"] as string[] | undefined) ?? [];
  const packOf = (ctx: Ctx): string => {
    const kind = (ctx.outputs["DISCOVER"]?.["pack"] as { readonly kind?: unknown } | undefined)?.kind;
    return typeof kind === "string" ? kind : "raw";
  };
  return {
    phase: "DECIDE",
    /**
     * C-2¹²: off the chain, as AUDIT is, and keyed by the items AUDIT left
     * open rather than by AUDIT's words, which a re-run survey never repeats:
     * a code edit re-runs AUDIT, and only an item that moved re-runs DECIDE.
     * Keyed after it runs, since it writes the log its digest reads.
     */
    standalone: true,
    keyedAfterRun: true,
    digest: (ctx) =>
      valueDigest([
        openItems(ctx.outputs["AUDIT"], { stackOpen: false }).map((i) => i.key),
        logDigest(deps.root),
        deps.prompts.hashes.spec_write,
        markersOf(ctx),
        packOf(ctx),
      ]),
    run: async (ctx) => {
      const pack = packOf(ctx);
      if (pack !== "raw") {
        deps.note?.(
          pack === "conforming"
            ? "DECIDE: the documents are a conforming pack, whose decision log is the founder's record already, so nothing is decided (C-2⁶)"
            : pack === "written"
              ? "DECIDE: the documents are the pack WRITE wrote from what DECIDE decided, so nothing is decided again (C-2¹³)"
              : "DECIDE: the documents are a changed pack, whose change VALIDATE re-validates, so nothing is decided (C-2¹⁴)",
        );
        noteUnitComplete(deps.root);
        return outputs(deps.root, { ran: false, reason: pack });
      }
      return await withInitJournal(
        deps.root,
        async (journal) =>
          await decideStage({
            root: deps.root,
            audit: ctx.outputs["AUDIT"],
            documents: docsOf(ctx),
            stackMarkers: markersOf(ctx),
            promptHash: deps.prompts.hashes.spec_write,
            ...(deps.askDecisions === undefined ? {} : { ask: deps.askDecisions }),
            ...(deps.note === undefined ? {} : { note: deps.note }),
            launch: async (inputs, artifactOut) => {
              await launchInitSession(sessionDeps(deps, journal), { role: "spec_write", inputs, artifactOut });
            },
          }),
      );
    },
  };
}
