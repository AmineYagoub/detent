import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { STATE_DIR, stateDir } from "../fs/layout.js";
import { SCHEMA_VERSION, parseArtifact } from "../schemas/common.js";
import { DECISION_LOG_PATH, PACK_PATHS, PACK_PRECEDENCE, type OPEN_REASONS, type PackFinding } from "../schemas/pack.js";
import { fixArtifactSchema, reviewArtifactSchema, type FindingPlace, type FixArtifact, type ReviewFinding } from "../schemas/validate.js";
import type { ScratchGrant } from "../sessions/sandbox.js";
import { decisionLogFile, nextId, readDecisionLog, type LogView } from "./decide-log.js";
import { checkPack } from "./pack-check.js";
import { packDocuments } from "./pack.js";
import { refusedAttemptInput, withOneRelaunch, type RetriedAttempt } from "./retry.js";
import { checkReview, fixIssues, outcomes, type Outcome, type Severity } from "./validate-checks.js";
import { simulationInput } from "./validate-scratch.js";
import type { Area } from "./validate-scope.js";
import { checkerIssues, citeIssues, holdsRequirement, logIssues } from "./write-checks.js";
import { changedSince, packPathFiles, restoreFile, rollback, snapshot, type Snapshot } from "./write-tree.js";

/**
 * C-2¹⁴ (PRDR-284) — the sessions of one VALIDATE round: a `spec_review`
 * reviewer per area, one after another, and one `spec_write` writer that
 * applies what they found.
 *
 * A reviewer reads its area's documents after the foundations and reports
 * each defect at its `file:line`, quoted, with the exact fix. In a round after
 * the first it verifies: it is given the findings of the round before in its
 * area, what became of each, and the diff of the fixes, and hunts the defects
 * those fixes introduced. The writer is given every finding of the round and
 * the pack's paths to write; code then checks the pack as it checks WRITE's
 * (C-2¹³). A writer whose fixes still leave the checker red has them undone.
 */

type Json = Record<string, unknown>;

export function reviewArtifactPath(root: string): string {
  return path.join(stateDir(root), "state", "review-artifact.json");
}

export function fixArtifactPath(root: string): string {
  return path.join(stateDir(root), "state", "fix-artifact.json");
}

/** The reviewer's `expected_output`; a test parses it through `reviewArtifactSchema`, so the two cannot drift. */
export function reviewSkeleton(): Json {
  return {
    schema_version: SCHEMA_VERSION,
    documents_read: ["<every document you read, the foundations included>"],
    findings: [
      {
        severity: "major",
        category: "contradiction",
        places: [{ file: "<a document of the pack>", line: 1, quote: "<its words, verbatim, from the line they start on>" }],
        why: "<what is wrong, and what a plan built on it would get wrong>",
        fix: "<the exact fix: which document changes, and to what>",
        previous: null,
      },
    ],
  };
}

/** The writer's `expected_output`, parsed by a test through `fixArtifactSchema`. */
export function fixSkeleton(): Json {
  return {
    schema_version: SCHEMA_VERSION,
    applied: ["<the id of each finding you fixed>"],
    declined: [{ id: "<the id of a finding you did not fix>", reason: "<why it is no defect, or why its fix would be wrong>" }],
  };
}

/** A finding as the next round, or the operator, is shown it, with what became of it. */
export interface Shown {
  readonly id: string;
  readonly severity: Severity;
  readonly places: readonly FindingPlace[];
  readonly why: string;
  readonly fix: string;
  readonly left: "applied" | (typeof OPEN_REASONS)[number];
  readonly reason: string;
}

export interface RoundDeps {
  readonly root: string;
  readonly greenfield: boolean;
  /** S-1⁗ (PRDR-285): with the round's scratch directory, or null when the round has none. */
  readonly review: (inputs: Json, artifactOut: string, scratch: ScratchGrant | null) => Promise<void>;
  readonly fix: (inputs: Json, artifactOut: string) => Promise<void>;
  readonly note?: ((text: string) => void) | undefined;
}

export interface ReviewTask {
  readonly area: Area;
  readonly foundations: readonly string[];
  /** The area's documents in the round's scope. */
  readonly documents: readonly string[];
  /** A verification's: the findings of the round before in this area. */
  readonly previous: readonly Shown[] | null;
  /** A verification's: the diff of the round before's fixes, repo-relative, where one was kept. */
  readonly diff: string | null;
  /** The checker's heuristic reports on the documents in scope (C-2¹⁰). */
  readonly heuristic: readonly PackFinding[];
}

function readArtifact<T>(file: string, schema: z.ZodType<T>): { readonly value: T | null; readonly issue: string | null } {
  if (!existsSync(file)) return { value: null, issue: "the session wrote no artifact" };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { value: null, issue: "the artifact is not JSON" };
  }
  const parsed = parseArtifact(schema, raw);
  if (!parsed.ok) return { value: null, issue: parsed.reason === "invalid" ? parsed.issues.join("; ") : parsed.reason };
  return { value: parsed.value, issue: null };
}

/**
 * One reviewer: refused on any issue the first time; the second time, the
 * findings that stand, the rest dropped aloud, and any document it did not
 * read named. With the round's scratch directory it may simulate (S-1⁗), and
 * a simulation's findings are checked as every other is.
 */
export async function reviewArea(deps: RoundDeps, round: number, task: ReviewTask, pack: readonly string[], scratch: ScratchGrant | null): Promise<ReviewFinding[]> {
  const out = reviewArtifactPath(deps.root);
  const verify = task.previous !== null;
  const inputs: Json = {
    task: verify ? "verify" : "review",
    round,
    area: task.area.name,
    foundations: [...task.foundations],
    documents: [...task.documents],
    heuristic: task.heuristic.map((f) => ({ file: f.file, line: f.line, text: f.text, report: f.message })),
    ...(verify ? { previous: task.previous, diff: task.diff } : {}),
    simulation: simulationInput(scratch),
    precedence: [...PACK_PRECEDENCE],
    expected_output: reviewSkeleton(),
  };
  const stage = `VALIDATE round ${String(round)}, ${task.area.name}`;
  const result = await withOneRelaunch<ReviewFinding[]>({ stage, note: deps.note }, async (previous) => {
    rmSync(out, { force: true });
    await deps.review({ ...inputs, ...refusedAttemptInput(previous, "review") }, out, scratch);
    const read = readArtifact(out, reviewArtifactSchema);
    if (read.value === null) return { value: null, issue: read.issue };
    const checked = checkReview(deps.root, read.value, { pack, documents: task.documents, previous: (task.previous ?? []).map((p) => p.id) });
    if (previous === null && checked.issues.length > 0) return { value: null, issue: checked.issues.join("; ") };
    for (const d of checked.dropped) deps.note?.(`${stage}: a finding at ${d} stands on nothing, so it is dropped (C-2¹⁴)`);
    if (checked.unread.length > 0) deps.note?.(`${stage}: the reviewer did not read ${checked.unread.join(", ")}, so this round did not review ${checked.unread.length === 1 ? "it" : "them"} (C-2¹⁴)`);
    return { value: [...checked.kept], issue: null };
  });
  if (result.value === null) throw new Error(`${stage}: the reviewer produced no usable review: ${result.issue ?? "unusable"}`);
  return result.value;
}

/** What the writer is given for one finding: its id, and what its source says of it, a reviewer's finding or the checker's. */
export type ToFix = { readonly id: string } & Readonly<Record<string, unknown>>;

export interface Fixed {
  readonly outcome: ReadonlyMap<string, Outcome>;
  /** The pack's documents the fixes changed, which stand. */
  readonly changed: readonly string[];
  /** The diff of those changes, repo-relative; null when nothing changed. */
  readonly diff: string | null;
  /** Whether the fixes stand: false when the checker was still red on them, and they were undone. */
  readonly stood: boolean;
}

interface Attempt {
  readonly artifact: FixArtifact;
  readonly green: boolean;
  readonly holds: boolean;
  readonly blocking: readonly string[];
}

const logState = (root: string): { readonly view: LogView; readonly text: string } => ({
  view: readDecisionLog(root),
  text: existsSync(decisionLogFile(root)) ? readFileSync(decisionLogFile(root), "utf8") : "",
});

/**
 * One writer over `findings`, labelled `label` (a round, or the checker's).
 * Checked as WRITE's session is: the log keeps what it held, a default it adds
 * is cited, a requirement stands, and the checker is green (C-2¹³). A first
 * attempt with anything wrong is relaunched with the list; the second keeps
 * what stands, and undoes every fix when the checker is still red. An artifact
 * that is unusable twice fails the phase, with the pack as it was.
 */
export async function fixFindings(deps: RoundDeps, label: string, findings: readonly ToFix[], source: "checker" | "review"): Promise<Fixed> {
  const before = snapshot(deps.root, []);
  const logBefore = logState(deps.root);
  const ids = findings.map((f) => f.id);
  const out = fixArtifactPath(deps.root);
  const inputs: Json = {
    task: "fix",
    source,
    findings: [...findings],
    decision_log: DECISION_LOG_PATH,
    decision_log_entries: [
      ...logBefore.view.decisions.map((d) => ({ id: d.id, question: d.question, answer: d.answer })),
      ...logBefore.view.defaults.map((d) => ({ id: d.id, value: d.value })),
    ],
    next_default: nextId(logBefore.view.ids, "X")(0),
    pack_paths: [...PACK_PATHS],
    precedence: [...PACK_PRECEDENCE],
    expected_output: fixSkeleton(),
  };
  const stage = `VALIDATE's writer, ${label}`;
  let result: RetriedAttempt<Attempt>;
  try {
    result = await withOneRelaunch<Attempt>({ stage, note: deps.note }, async (previous) => {
      rmSync(out, { force: true });
      await deps.fix({ ...inputs, ...refusedAttemptInput(previous, "account") }, out);
      return evaluate(deps, stage, { before, logBefore, ids, strict: previous === null });
    });
  } catch (err) {
    rollback(deps.root, before);
    throw err;
  }
  if (result.value === null) {
    rollback(deps.root, before);
    throw new Error(`${stage}: no usable account of the fixes: ${result.issue ?? "unusable"}; the pack is as it was before it ran`);
  }
  const { artifact, green, holds, blocking } = result.value;
  if (!green || !holds) {
    rollback(deps.root, before);
    const why = holds ? `its fixes left the pack checker red: ${blocking.join("; ")}` : "its fixes left the pack holding no requirement";
    deps.note?.(`${stage}: ${why}, so every fix of ${label} is undone (C-2¹⁴)`);
    return { outcome: new Map(ids.map((id) => [id, { left: "undone", reason: why }])), changed: [], diff: null, stood: false };
  }
  const changed = [...new Set([...before.files.keys(), ...packPathFiles(deps.root)])].filter((rel) => changedSince(deps.root, before, rel)).sort();
  return { outcome: outcomes(artifact, ids, changed.length > 0), changed, diff: changed.length === 0 ? null : writeDiff(deps.root, label, before, changed), stood: true };
}

function evaluate(
  deps: RoundDeps,
  stage: string,
  a: { readonly before: Snapshot; readonly logBefore: ReturnType<typeof logState>; readonly ids: readonly string[]; readonly strict: boolean },
): { value: Attempt | null; issue: string | null } {
  const read = readArtifact(fixArtifactPath(deps.root), fixArtifactSchema);
  if (read.value === null) return { value: null, issue: read.issue };
  const damaged = logIssues(a.logBefore, logState(deps.root));
  if (damaged.length > 0) {
    restoreFile(deps.root, a.before, DECISION_LOG_PATH);
    deps.note?.(`${stage}: the decision log is restored as it was, since the fixes changed what it held: ${damaged.join("; ")}`);
  }
  const added = damaged.length > 0 ? [] : readDecisionLog(deps.root).defaults.filter((d) => !a.logBefore.view.ids.has(d.id)).map((d) => d.id);
  const docs = packDocuments(deps.root);
  const owing = citeIssues(deps.root, docs, added.map((id) => ({ id, why: "a default you added to the log" })));
  const holds = holdsRequirement(deps.root, docs, deps.greenfield);
  const blocking = checkerIssues(checkPack(deps.root, docs, { greenfield: deps.greenfield }));
  const issues = [
    ...fixIssues(read.value, a.ids),
    ...damaged,
    ...(holds ? [] : ["the pack holds no requirement"]),
    ...owing,
    ...blocking,
  ];
  if (a.strict && issues.length > 0) return { value: null, issue: issues.join("; ") };
  for (const issue of owing) deps.note?.(`${stage}: ${issue}`);
  return { value: { artifact: read.value, green: blocking.length === 0, holds, blocking }, issue: null };
}

/** Where the diff of the writer labelled `label` is kept, repo-relative: the next round's reviewers read it, and so does a round that carries on after a stop. */
export function diffPath(label: string): string {
  return `${STATE_DIR}/state/validate/${label.replace(/[^a-z0-9]+/giu, "-").toLowerCase()}.diff`;
}

/**
 * The diff of one writer's changes, for the next round's reviewers: the
 * snapshot's bytes and the tree's, side by side under `.detent/`, compared by
 * `git diff --no-index`, which exits 1 when they differ.
 */
function writeDiff(root: string, label: string, before: Snapshot, changed: readonly string[]): string {
  const rel = diffPath(label);
  const file = path.join(root, ...rel.split("/"));
  const work = file.replace(/\.diff$/u, "");
  rmSync(work, { recursive: true, force: true });
  for (const side of ["before", "after"]) mkdirSync(path.join(work, side), { recursive: true });
  for (const rel of changed) {
    const was = before.files.get(rel);
    const now = path.join(root, ...rel.split("/"));
    const put = (side: string, bytes: Buffer): void => {
      const to = path.join(work, side, ...rel.split("/"));
      mkdirSync(path.dirname(to), { recursive: true });
      writeFileSync(to, bytes);
    };
    if (was !== undefined) put("before", was);
    if (existsSync(now)) put("after", readFileSync(now));
  }
  let text: string;
  try {
    text = execFileSync("git", ["diff", "--no-index", "--no-color", "--", "before", "after"], { cwd: work, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const { status, stdout } = err as { status?: unknown; stdout?: unknown };
    if (status !== 1 || typeof stdout !== "string") throw err;
    text = stdout;
  }
  rmSync(work, { recursive: true, force: true });
  writeFileSync(file, text);
  return rel;
}
