import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { noteUnitComplete } from "../kernel/ledger.js";
import { auditSurveySchema } from "../schemas/audit.js";
import { SCHEMA_VERSION, parseArtifact } from "../schemas/common.js";
import { isGreenfield } from "./greenfield.js";
import { checkClaims, claimBriefSkeletons, type AuditResearch, type CheckedClaim } from "./audit-claims.js";
import { auditedDocuments, auditKey } from "./audit-key.js";
import { dropKeptSurvey, keepSurvey, readKeptSurvey } from "./audit-survey.js";
import { checkSurvey, type Dropped, type SurveyCheck } from "./audit-passages.js";
import type { PhaseHandler, PhaseOutcome } from "./machine.js";
import type { PipelineDeps } from "./pipeline.js";
import { refusedAttemptInput, withOneRelaunch } from "./retry.js";
import { sessionDeps } from "./session-deps.js";
import { launchInitSession, withInitJournal } from "./session.js";

/**
 * C-2⁶, C-2¹¹ (PRDR-281) — AUDIT: the documents are judged before anything
 * plans from them.
 *
 * ANALYZE read the documents to plan from them, not to doubt them, so a
 * contradiction became an assumption and an external claim was taken as
 * written, both met again only by the session that built on them. AUDIT reads
 * them first, in two steps under one role and one prompt: a survey that finds
 * contradictions, gaps, drift from the code, and the external claims, and then
 * a session per claim, four at a time (C-2¹⁶), that checks it against a
 * primary source. Code checks every passage and every source the sessions
 * cite (C-2¹¹). The checked survey is kept until the phase completes, so a
 * run stopped during the checks is re-run on the same claims (C-2¹⁷).
 *
 * It runs on a raw document set only. A conforming pack's checker stands for
 * it (specification decision 6). A changed pack is never audited as a raw
 * PRD: C-2⁷ gives its change to VALIDATE, which re-validates it (C-2¹⁴). A
 * pack WRITE wrote is not audited again: AUDIT read the documents it was
 * written from (C-2¹³), and VALIDATE reviews what WRITE made of them.
 */

type Json = Record<string, unknown>;
type Ctx = Parameters<PhaseHandler["digest"]>[0];

/** Where the survey session writes, before anything has validated it, cleared before each launch (D-19). */
export function surveyPath(root: string): string {
  return path.join(stateDir(root), "state", "audit-survey.json");
}

/** The survey's `expected_output`. A test parses it through `auditSurveySchema`, so the contract cannot drift from the schema. */
export function auditSurveySkeleton(greenfield: boolean): Json {
  const passage = { file: "<one of the documents you were given>", line: 1, quote: "<its words, verbatim, from the line they start on>" };
  return {
    schema_version: SCHEMA_VERSION,
    documents_read: ["<every document you were given>"],
    contradictions: [{ topic: "<what the documents disagree about>", passages: [passage, passage], why: "<why they cannot all hold>" }],
    gaps: [{ topic: "<what is missing>", detail: "<what no document says, and what a plan needs it for>", passages: [] }],
    drift: greenfield ? [] : [{ passage, code_checked: ["<the repository paths you read>"], finding: "<what the code does instead>" }],
    claims: [{ claim: "<one external fact the documents rely on>", subject: "<what it is about: a dependency at its pinned version, or a service>", passage }],
  };
}

const HIERARCHY =
  "X-6a: project docs → codebase, dependency sources at their pinned versions included → official docs at that version → " +
  "upstream issues and changelogs → technical sources → general web";

export interface AuditStageDeps {
  readonly root: string;
  /** The documents the survey is given, the decision log already left out (C-2¹¹). */
  readonly documents: readonly string[];
  readonly stackMarkers: readonly string[];
  /** X-1 `planning_research_tool_calls`: what the claim checks are counted against, never a number a session is told (C-2⁶). */
  readonly pool: number;
  readonly launch: (inputs: Json, artifactOut: string) => Promise<{ readonly toolCalls: number }>;
  readonly note?: (text: string) => void;
  /** C-2¹⁷ (PRDR-305): the key AUDIT's checkpoint is looked up by, which the survey is kept under until the phase completes. */
  readonly key: string;
}

function readSurvey(
  file: string,
  root: string,
  opts: { readonly documents: readonly string[]; readonly greenfield: boolean; readonly strict: boolean },
): { value: SurveyCheck | null; issue: string | null } {
  if (!existsSync(file)) return { value: null, issue: "the session wrote no artifact" };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { value: null, issue: "the artifact is not JSON" };
  }
  const parsed = parseArtifact(auditSurveySchema, raw);
  if (!parsed.ok) return { value: null, issue: parsed.reason === "invalid" ? parsed.issues.join("; ") : parsed.reason };
  const check = checkSurvey(root, parsed.value, opts);
  /* C-2¹¹: strict on the first attempt, so the relaunch hears everything; the second keeps what stands and says what did not. */
  if (opts.strict && check.issues.length > 0) return { value: null, issue: check.issues.join("; ") };
  return { value: check, issue: null };
}

const count = (n: number, noun: string): string => `${String(n)} ${noun}${n === 1 ? "" : "s"}`;
const LISTED = 10;

function listed<T>(title: string, items: readonly T[], line: (item: T) => string): string[] {
  if (items.length === 0) return [];
  const more = items.length > LISTED ? [`    and ${String(items.length - LISTED)} more, in .detent/state/AUDIT.json`] : [];
  return [`  ${title}:`, ...items.slice(0, LISTED).map((item) => `    - ${line(item)}`), ...more];
}

interface Found {
  readonly contradictions: readonly { readonly topic: string; readonly passages: readonly { readonly file: string; readonly line: number }[] }[];
  readonly gaps: readonly { readonly topic: string }[];
  readonly drift: readonly { readonly passage: { readonly file: string; readonly line: number }; readonly finding: string }[];
  readonly claims: readonly CheckedClaim[];
  readonly dropped: readonly Dropped[];
  readonly unread: readonly string[];
  readonly research: AuditResearch;
}

/**
 * C-2¹¹: what the operator is told. It names each finding that needs a person:
 * a contradiction, a drift, a claim the documents have wrong. DECIDE reads the
 * checkpoint and sorts what it leaves open (C-2¹², PRDR-282); the note is where
 * the operator sees what DECIDE was given.
 */
export function auditNotes(found: Found, pool: number): string[] {
  const at = (p: { readonly file: string; readonly line: number }): string => `${p.file}:${String(p.line)}`;
  const wrong = found.claims.filter((c) => c.verdict === "wrong");
  const unverified = found.claims.filter((c) => c.verdict === "unverified");
  const notes = [
    [
      `AUDIT found ${count(found.contradictions.length, "contradiction")}, ${count(found.gaps.length, "gap")}, ` +
        `${count(found.drift.length, "drift finding")} and ${count(found.claims.length, "external claim")} ` +
        `(${String(found.claims.length - wrong.length - unverified.length)} confirmed, ${String(wrong.length)} wrong, ` +
        `${String(unverified.length)} unverified). DECIDE sorts what they leave open before anything plans (C-2¹²).`,
      ...listed("contradictions", found.contradictions, (c) => `${c.topic}: ${c.passages.map(at).join(" vs ")}`),
      ...listed("drift", found.drift, (d) => `${at(d.passage)}: ${d.finding}`),
      ...listed("wrong", wrong, (c) => `${c.claim} (${at(c.passage)}): ${c.correction ?? ""} [${c.source ?? ""}]`),
      ...listed("unverified", unverified, (c) => `${c.claim} (${at(c.passage)})${c.checked ? "" : ", never checked"}`),
    ].join("\n"),
  ];
  if (found.claims.length > 0) {
    const r = found.research;
    notes.push(
      `AUDIT's research: ${count(r.sessions, "session")}, ${String(r.cache_hits)} claim(s) answered from the cache; ` +
        `${count(r.tool_calls, "tool call")} counted against planning_research_tool_calls (${String(pool)}), ` +
        "which no session was told and nothing enforces (C-2⁶, X-1)",
    );
  }
  if (found.dropped.length > 0) {
    const which = found.dropped.map((d) => `${d.kind} at ${d.passage} (${d.reason})`).join("; ");
    notes.push(`AUDIT dropped ${count(found.dropped.length, "finding")} that the survey could not anchor twice (C-2¹¹): ${which}`);
  }
  if (found.unread.length > 0) {
    notes.push(`AUDIT's survey says it did not read ${found.unread.join(", ")}, so what they say was not audited (C-2¹¹)`);
  }
  return notes;
}

/** C-2¹⁷ (PRDR-305): the survey a stopped run checked, where nothing AUDIT's key covers has moved since. */
function keptSurvey(deps: AuditStageDeps): SurveyCheck | null {
  const kept = readKeptSurvey(deps.root, deps.key);
  if (kept !== null) {
    deps.note?.(
      `AUDIT's survey is the one an earlier run checked, kept while nothing it read has moved: its ${count(kept.kept.claims.length, "claim")} ` +
        "are checked from where that run stopped, and each one already briefed answers from the cache (C-2¹⁷)",
    );
  }
  return kept;
}

async function surveyAnew(deps: AuditStageDeps, greenfield: boolean): Promise<SurveyCheck> {
  const artifactOut = surveyPath(deps.root);
  const survey = await withOneRelaunch<SurveyCheck>({ stage: "AUDIT's survey", note: deps.note }, async (previous) => {
    rmSync(artifactOut, { force: true });
    await deps.launch(
      {
        task: "survey",
        documents: [...deps.documents],
        greenfield,
        stack_markers: [...deps.stackMarkers],
        expected_output: auditSurveySkeleton(greenfield),
        ...refusedAttemptInput(previous, "survey"),
      },
      artifactOut,
    );
    return readSurvey(artifactOut, deps.root, { documents: deps.documents, greenfield, strict: previous === null });
  });
  if (survey.value === null) throw new Error(`AUDIT's survey produced no usable artifact: ${survey.issue ?? "unusable"}`);
  /* C-2¹⁷ (PRDR-305): kept until the phase completes, and a unit of work, as a brief is (X-1⁵). */
  keepSurvey(deps.root, deps.key, survey.value);
  noteUnitComplete(deps.root);
  return survey.value;
}

export async function auditStage(deps: AuditStageDeps): Promise<PhaseOutcome> {
  const greenfield = isGreenfield(deps.stackMarkers);
  const { kept, dropped, unread } = keptSurvey(deps) ?? (await surveyAnew(deps, greenfield));
  const checked = await checkClaims(kept.claims, {
    root: deps.root,
    documents: deps.documents,
    ...(deps.note === undefined ? {} : { note: deps.note }),
    launch: async (claim, hash, out, previous) =>
      await deps.launch(
        {
          task: "verify_claim",
          claim: claim.claim,
          claim_hash: hash,
          subject: claim.subject,
          passage: claim.passage,
          hierarchy: HIERARCHY,
          ...claimBriefSkeletons(claim.claim, hash),
          ...refusedAttemptInput(previous, "claim brief"),
        },
        out,
      ),
  });
  const found: Found = {
    contradictions: kept.contradictions,
    gaps: kept.gaps,
    drift: kept.drift,
    claims: checked.claims,
    dropped,
    unread,
    research: checked.research,
  };
  for (const text of auditNotes(found, deps.pool)) deps.note?.(text);
  /* C-2¹⁷ (PRDR-305): the checkpoint the machine writes next stands for the kept survey. */
  dropKeptSurvey(deps.root);
  /* X-1⁵ (C-2⁶): a completed AUDIT is a unit of work. */
  noteUnitComplete(deps.root);
  return { kind: "complete", outputs: { ran: true, greenfield, documents: [...deps.documents], ...found } };
}

export function auditPhase(deps: PipelineDeps): PhaseHandler {
  const docsOf = (ctx: Ctx): string[] => (ctx.outputs["DISCOVER"]?.["docs"] as string[] | undefined) ?? [];
  const markersOf = (ctx: Ctx): string[] => (ctx.outputs["DISCOVER"]?.["stack_markers"] as string[] | undefined) ?? [];
  /* A DISCOVER checkpoint from before C-2⁹ has no `pack`, and it is reused only where no record exists: raw. */
  const packOf = (ctx: Ctx): string => {
    const kind = (ctx.outputs["DISCOVER"]?.["pack"] as { readonly kind?: unknown } | undefined)?.kind;
    return typeof kind === "string" ? kind : "raw";
  };
  const keyOf = (ctx: Ctx): string => auditKey(deps.root, docsOf(ctx), [packOf(ctx), markersOf(ctx), deps.prompts.hashes.audit]);
  return {
    phase: "AUDIT",
    /** C-2¹¹: an answer written to the decision log re-runs DISCOVER, and must not re-run this. */
    standalone: true,
    digest: keyOf,
    run: async (ctx) => {
      const pack = packOf(ctx);
      if (pack !== "raw") {
        deps.note?.(
          pack === "conforming"
            ? "AUDIT: the documents are a conforming pack, and its checker stands for it, so nothing is audited (C-2⁶, specification decision 6)"
            : pack === "written"
              ? "AUDIT: the documents are the pack WRITE wrote from documents AUDIT already read, so nothing is audited again. " +
                "VALIDATE reviews it, an edit to it since included (C-2¹⁴)"
              : "AUDIT: the documents are a changed pack, which is not audited as a raw PRD (C-2⁷): VALIDATE re-validates its change (C-2¹⁴)",
        );
        noteUnitComplete(deps.root);
        return { kind: "complete", outputs: { ran: false, reason: pack } };
      }
      return await withInitJournal(
        deps.root,
        async (journal) =>
          await auditStage({
            root: deps.root,
            documents: auditedDocuments(docsOf(ctx)),
            stackMarkers: markersOf(ctx),
            pool: deps.budgets.planning_research_tool_calls,
            key: keyOf(ctx),
            ...(deps.note === undefined ? {} : { note: deps.note }),
            launch: async (inputs, artifactOut) => {
              const result = await launchInitSession(sessionDeps(deps, journal, "AUDIT"), { role: "audit", inputs, artifactOut });
              /* C-3a's proxy: a turn is one call's worth, as S-4 has no per-call counter. */
              return { toolCalls: Math.max(1, result.turns) };
            },
          }),
      );
    },
  };
}
