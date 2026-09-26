import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { discover as discoverStack } from "../adapter/discover/index.js";
import { stateDir } from "../fs/layout.js";
import { noteUnitComplete } from "../kernel/ledger.js";
import { SCHEMA_VERSION, parseArtifact } from "../schemas/common.js";
import { CONFORMANCE_RECORD_PATH, DECISION_LOG_PATH, PACK_PATHS } from "../schemas/pack.js";
import { writeArtifactSchema, type WriteArtifact } from "../schemas/write.js";
import { isGreenfield } from "./analyze.js";
import { readDecideRecord } from "./decide.js";
import { openItems } from "./decide-items.js";
import { decisionLogFile, nextId, readDecisionLog, type LogView } from "./decide-log.js";
import { discoverDocs, docPatternsFor } from "./discover-docs.js";
import { contentsDigest, listingDigest, valueDigest, type PhaseHandler, type PhaseOutcome } from "./machine.js";
import { checkPack } from "./pack-check.js";
import { conformanceRecord, packDocuments, writeConformanceRecord } from "./pack.js";
import type { PipelineDeps } from "./pipeline.js";
import { refusedAttemptInput, withOneRelaunch } from "./retry.js";
import { sessionDeps } from "./session-deps.js";
import { launchInitSession, withInitJournal } from "./session.js";
import { checkerIssues, citeIssues, holdsRequirement, logIssues, resolveLists, type Cited, type ListPlan } from "./write-checks.js";
import { archiveOriginal, changedSince, restoreFile, rollback, snapshot, type Snapshot } from "./write-tree.js";

/**
 * C-2⁶, C-2¹³ (PRDR-283) — WRITE: the audited and decided documents are
 * rewritten into the pack, and planning reads the pack.
 *
 * After AUDIT and DECIDE the documents were still in their author's shape:
 * requirements without ids, criteria without values, decisions in prose, so
 * PLAN could trace nothing and review could check nothing. One `spec_write`
 * session writes the pack at the pack's paths from the documents, AUDIT's
 * findings and the decision log, citing the entries that settled them. Code
 * checks what it wrote, moves the originals it rewrote to `archive/`, and
 * writes the conformance record, which says the pack is not validated.
 *
 * It writes on a raw document set only. A conforming pack is never rewritten
 * (specification decision 6); a changed pack's change and a written pack's
 * validation are VALIDATE's, which is not built; and `plan_docs`, which
 * narrows discovery to part of the set, leaves the documents as they are,
 * since a pack is written from the whole set.
 */

type Json = Record<string, unknown>;
type Ctx = Parameters<PhaseHandler["digest"]>[0];

/** Where the session writes its artifact, before anything has checked it, cleared before each launch (D-19). */
export function writeArtifactPath(root: string): string {
  return path.join(stateDir(root), "state", "write-artifact.json");
}

/** The `expected_output` skeleton; a test parses it through `writeArtifactSchema`, so the two cannot drift. */
export function writeSkeleton(): Json {
  return {
    schema_version: SCHEMA_VERSION,
    archive: ["<each document you were given whose content you rewrote into the pack>"],
    context: ["<each document you were given that stays as it is, where it is: a README, a runbook>"],
  };
}

export interface WriteStageDeps {
  readonly root: string;
  /** AUDIT's checkpoint outputs, as the bus carries them. */
  readonly audit: Json | undefined;
  /** The originals: every document DISCOVER found, which never lists the decision log (C-2¹²). */
  readonly documents: readonly string[];
  readonly stackMarkers: readonly string[];
  /** DISCOVER's patterns, which find the pack for the phases after WRITE. */
  readonly patterns: readonly string[];
  /** `YYYY-MM-DD`, for the record. */
  readonly today: string;
  readonly launch: (inputs: Json, artifactOut: string) => Promise<void>;
  readonly note?: (text: string) => void;
}

interface LogState {
  readonly view: LogView;
  readonly text: string;
}

const logState = (root: string): LogState => ({
  view: readDecisionLog(root),
  text: existsSync(decisionLogFile(root)) ? readFileSync(decisionLogFile(root), "utf8") : "",
});

const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter((v): v is Json => typeof v === "object" && v !== null) : []);

/**
 * Every finding AUDIT left open, with the entry that settled it, and the cites
 * that makes the pack owe. DECIDE ran in this `init` and re-settled any item
 * whose entry the log no longer held, so every entry here is in the log; an
 * item it left unsorted has none.
 */
function findings(deps: WriteStageDeps): { readonly shown: Json[]; readonly owed: Cited[] } {
  const settled = readDecideRecord(deps.root).settled;
  const shown: Json[] = [];
  const by = new Map<string, string[]>();
  for (const item of openItems(deps.audit, { stackOpen: false })) {
    const entry = settled[item.key] ?? null;
    shown.push({ ...item.shown, settled_by: entry });
    if (entry !== null) by.set(entry, [...(by.get(entry) ?? []), item.id]);
  }
  return { shown, owed: [...by].map(([id, items]) => ({ id, why: `which settles ${items.join(", ")}` })) };
}

function sessionInputs(deps: WriteStageDeps, log: LogView, shown: readonly Json[], greenfield: boolean): Json {
  return {
    task: "write",
    greenfield,
    stack_markers: [...deps.stackMarkers],
    documents: [...deps.documents],
    findings: shown,
    claims: list(deps.audit?.["claims"]),
    decision_log: DECISION_LOG_PATH,
    decision_log_entries: [
      ...log.decisions.map((d) => ({ id: d.id, question: d.question, answer: d.answer })),
      ...log.defaults.map((d) => ({ id: d.id, value: d.value })),
    ],
    next_default: nextId(log.ids, "X")(0),
    pack_paths: [...PACK_PATHS],
    expected_output: writeSkeleton(),
  };
}

function readWritten(file: string): { readonly artifact: WriteArtifact | null; readonly issue: string | null } {
  if (!existsSync(file)) return { artifact: null, issue: "the session wrote no artifact" };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { artifact: null, issue: "the artifact is not JSON" };
  }
  const parsed = parseArtifact(writeArtifactSchema, raw);
  if (!parsed.ok) return { artifact: null, issue: parsed.reason === "invalid" ? parsed.issues.join("; ") : parsed.reason };
  return { artifact: parsed.value, issue: null };
}

interface Written {
  readonly plan: ListPlan;
  /** Defaults the session added to the log. */
  readonly added: readonly string[];
  /** Cites the pack still owes after the second attempt. */
  readonly owing: readonly string[];
}

interface Attempt {
  readonly deps: WriteStageDeps;
  readonly before: Snapshot;
  readonly logBefore: LogState;
  readonly owed: readonly Cited[];
  readonly greenfield: boolean;
  readonly strict: boolean;
}

/** One attempt's result: refused on any issue when strict, and on the second, what stands, the pack as the session left it. */
function evaluate(a: Attempt): { value: Written | null; issue: string | null } {
  const { deps, before } = a;
  const read = readWritten(writeArtifactPath(deps.root));
  if (read.artifact === null) return { value: null, issue: read.issue };
  const damaged = logIssues(a.logBefore, logState(deps.root));
  if (damaged.length > 0) {
    restoreFile(deps.root, before, DECISION_LOG_PATH);
    deps.note?.(`WRITE: the decision log is restored as DECIDE left it, since the rewrite changed what it held: ${damaged.join("; ")}`);
  }
  const added = damaged.length > 0 ? [] : readDecisionLog(deps.root).defaults.filter((d) => !a.logBefore.view.ids.has(d.id)).map((d) => d.id);
  const { issues: listed, plan } = resolveLists(read.artifact, deps.documents, (rel) => changedSince(deps.root, before, rel));
  /* The pack as it will stand once the originals are archived. */
  const docs = packDocuments(deps.root).filter((rel) => !plan.archive.includes(rel));
  const owing = citeIssues(deps.root, docs, [...a.owed, ...added.map((id) => ({ id, why: "a default you added to the log" }))]);
  const holds = holdsRequirement(deps.root, docs, a.greenfield);
  const issues = [
    ...damaged,
    ...listed,
    ...(holds ? [] : ["the pack holds no requirement: write the module PRDs under docs/prd/"]),
    ...owing,
    ...checkerIssues(checkPack(deps.root, docs, { greenfield: a.greenfield })),
  ];
  if (a.strict && issues.length > 0) return { value: null, issue: issues.join("; ") };
  if (!holds) throw new Error("WRITE wrote no requirement in either attempt, so there is no pack to plan from (C-2¹³)");
  return { value: { plan, added, owing }, issue: null };
}

const names = (rels: readonly string[]): string => (rels.length === 0 ? "none" : rels.join(", "));

/** The originals archived, the record written, and what the operator is told. */
function apply(deps: WriteStageDeps, before: Snapshot, written: Written, greenfield: boolean): PhaseOutcome {
  const rewritten = written.plan.rewritten.map((rel) => ({ path: rel, original: archiveOriginal(deps.root, before, rel) }));
  const archived = written.plan.archive.map((rel) => ({ from: rel, to: archiveOriginal(deps.root, before, rel) }));
  const checker = checkPack(deps.root, packDocuments(deps.root), { greenfield });
  writeConformanceRecord(deps.root, conformanceRecord(deps.root, { checker, rounds: [], date: deps.today, validated: false }));
  const blocking = checker.findings.filter((f) => f.blocks).length;
  const notes = [
    `WRITE wrote the pack: it archived ${names(archived.map((m) => m.from))}, kept ${names(written.plan.context)} as context, and rewrote ` +
      `${names(rewritten.map((r) => r.path))} in place, keeping each original in archive/. The conformance record says the pack is not validated (C-2¹³)`,
    ...written.plan.notes,
    ...written.owing.map((issue) => `WRITE: ${issue}; the pack goes to planning without it (C-2⁶)`),
    ...(checker.green ? [] : [`WRITE: the pack checker is red, with ${String(blocking)} blocking finding${blocking === 1 ? "" : "s"}; the pack goes to planning as it stands (C-2¹³)`]),
  ];
  for (const text of notes) deps.note?.(text);
  /* X-1⁵ (C-2⁶): a completed WRITE is a unit of work. */
  noteUnitComplete(deps.root);
  return handoff(deps.root, deps.patterns, {
    ran: true,
    archived,
    rewritten,
    context: [...written.plan.context],
    added_defaults: [...written.added],
    checker_green: checker.green,
  });
}

export async function writeStage(deps: WriteStageDeps): Promise<PhaseOutcome> {
  const greenfield = isGreenfield(deps.stackMarkers);
  const before = snapshot(deps.root, deps.documents);
  const logBefore = logState(deps.root);
  const { shown, owed } = findings(deps);
  const inputs = sessionInputs(deps, logBefore.view, shown, greenfield);
  const artifactOut = writeArtifactPath(deps.root);
  let written: Written;
  try {
    const result = await withOneRelaunch<Written>({ stage: "WRITE", note: deps.note }, async (previous) => {
      rmSync(artifactOut, { force: true });
      await deps.launch({ ...inputs, ...refusedAttemptInput(previous, "artifact") }, artifactOut);
      return evaluate({ deps, before, logBefore, owed, greenfield, strict: previous === null });
    });
    if (result.value === null) throw new Error(`WRITE produced no usable artifact: ${result.issue ?? "unusable"}`);
    written = result.value;
  } catch (err) {
    /* C-2¹³: no pack came of it, so the pack's paths go back as they were, and nothing is archived. */
    rollback(deps.root, before);
    deps.note?.("WRITE: no pack came of its session, so the pack's paths are as they were before it ran, and nothing was archived");
    throw err;
  }
  return apply(deps, before, written, greenfield);
}

/**
 * What the phases after WRITE read, from the disk, whether WRITE wrote or
 * not: the documents DISCOVER's patterns find now, the decision log among
 * them where it exists, the stack markers, and the log's entries.
 */
function handoff(root: string, patterns: readonly string[], run: Json): PhaseOutcome {
  const log = readDecisionLog(root);
  const found = discoverDocs(root, patterns).docs.filter((doc) => doc !== DECISION_LOG_PATH);
  return {
    kind: "complete",
    outputs: {
      docs: log.exists ? [...found, DECISION_LOG_PATH].sort() : found,
      stack_markers: [...discoverStack(root).stack.markers],
      decisions: log.decisions,
      defaults: log.defaults,
      ...run,
    },
  };
}

/**
 * C-2¹³: everything WRITE's outputs say, read from the disk alone, as a phase
 * that restarts the chain must: the documents and stack markers DISCOVER's
 * patterns find, the pack's contents and its record, whose kind decides
 * whether WRITE writes, and `plan_docs`. Never the prompt: once WRITE has
 * written, a new prompt writes nothing, and a key that named it would re-plan
 * every written pack on an upgrade.
 */
function writeDigest(root: string, patterns: readonly string[], planDocs: readonly string[] | undefined): string {
  const markers = discoverStack(root).stack.markers.map((m) => `marker:${m}`);
  return [
    listingDigest([...discoverDocs(root, patterns).docs, ...markers]),
    contentsDigest(root, [...packDocuments(root), CONFORMANCE_RECORD_PATH]),
    valueDigest(planDocs ?? []),
  ].join("|");
}

/** What WRITE says when it writes nothing: a pack of each kind but raw, or a set `plan_docs` narrows. */
function skipNote(skip: string): string {
  if (skip === "plan_docs") {
    return (
      "WRITE: plan_docs narrows discovery to part of the document set, and a pack is written from the whole set, so nothing " +
      "is written, and planning reads the narrowed documents as they are (C-2¹³)"
    );
  }
  if (skip === "conforming") return "WRITE: the documents are a conforming pack, which is never rewritten (C-2⁶)";
  if (skip === "written") return "WRITE: the documents are the pack WRITE wrote, which is never rewritten: nothing has validated it, and planning reads it as it stands (C-2¹³)";
  return (
    "WRITE: the documents are a changed pack, which is never rewritten: its change is VALIDATE's to check, and this build " +
    "has no VALIDATE, so planning reads the pack as it stands (C-2¹³)"
  );
}

export function writePhase(deps: PipelineDeps): PhaseHandler {
  const patterns = docPatternsFor(deps.planDocs);
  const discovered = (ctx: Ctx, key: string): unknown => ctx.outputs["DISCOVER"]?.[key];
  const packOf = (ctx: Ctx): string => {
    const kind = (discovered(ctx, "pack") as { readonly kind?: unknown } | undefined)?.kind;
    return typeof kind === "string" ? kind : "raw";
  };
  return {
    phase: "WRITE",
    /* C-2¹³: the move re-runs DISCOVER on the next init, and must not re-plan; WRITE writes what its digest reads. */
    restartsChain: true,
    keyedAfterRun: true,
    digest: () => writeDigest(deps.root, patterns, deps.planDocs),
    run: async (ctx) => {
      const pack = packOf(ctx);
      const narrowed = deps.planDocs !== undefined && deps.planDocs.length > 0;
      const skip = pack !== "raw" ? pack : narrowed ? "plan_docs" : null;
      if (skip !== null) {
        deps.note?.(skipNote(skip));
        noteUnitComplete(deps.root);
        return handoff(deps.root, patterns, { ran: false, reason: skip });
      }
      const markers = (discovered(ctx, "stack_markers") as string[] | undefined) ?? [];
      return await withInitJournal(
        deps.root,
        async (journal) =>
          await writeStage({
            root: deps.root,
            audit: ctx.outputs["AUDIT"],
            documents: (discovered(ctx, "docs") as string[] | undefined) ?? [],
            stackMarkers: markers,
            patterns,
            today: (deps.now?.() ?? new Date()).toISOString().slice(0, 10),
            ...(deps.note === undefined ? {} : { note: deps.note }),
            launch: async (inputs, artifactOut) => {
              await launchInitSession(sessionDeps(deps, journal), { role: "spec_write", inputs, artifactOut, surface: PACK_PATHS });
            },
          }),
      );
    },
  };
}

/** C-2¹³: the stack markers the planning phases read, WRITE's, or DISCOVER's where WRITE is not in the pipeline. */
export function planningMarkers(outputs: Readonly<Record<string, Record<string, unknown>>>): string[] {
  const markers = outputs["WRITE"]?.["stack_markers"] ?? outputs["DISCOVER"]?.["stack_markers"];
  return Array.isArray(markers) ? (markers as string[]) : [];
}
