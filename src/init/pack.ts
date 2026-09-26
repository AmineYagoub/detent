import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SCHEMA_VERSION, parseArtifact } from "../schemas/common.js";
import {
  CONFORMANCE_RECORD_PATH,
  conformanceRecordSchema,
  type ConformanceRecord,
  type PackStatus,
} from "../schemas/pack.js";
import { DOC_PATTERNS, discoverDocs } from "./discover-docs.js";
import { UNCHECKED, checkPack } from "./pack-check.js";

/**
 * C-2⁷ (PRDR-279) — whether a document set is a pack that was validated.
 *
 * The record makes "conforming" decidable: a hash that matches the documents
 * and a checker that was green on them, not anyone's say-so. An edit breaks
 * the hash, and the record's per-document hashes then name what changed, so
 * a changed pack is re-validated for the change and never read as a raw PRD.
 */

/** A conformance record that cannot be read. `init` stops on it rather than guess (F-3). */
export class ConformanceRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConformanceRecordError";
  }
}

const recordFile = (root: string): string => path.join(root, ...CONFORMANCE_RECORD_PATH.split("/"));

export const hasConformanceRecord = (root: string): boolean => existsSync(recordFile(root));

/**
 * The pack's documents: everything C-2's full discovery finds. Always the
 * full set, whatever `plan_docs` narrows planning to: whether the pack is the
 * one validated is a question about the whole pack, and a narrowed set would
 * read as every other document removed. The record is never among them,
 * because no C-2 pattern matches `.json`; a test holds that, since a record
 * that hashed itself could never match.
 */
export function packDocuments(root: string): string[] {
  return [...discoverDocs(root, DOC_PATTERNS).docs];
}

const sha256 = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");

function documentHashes(root: string, docs: readonly string[]): Record<string, string> {
  return Object.fromEntries(docs.map((doc) => [doc, sha256(readFileSync(path.join(root, ...doc.split("/"))))]));
}

/** sha256 over the sorted `path NUL sha256 LF` lines: the pack's one hash. */
export function packHash(documents: Readonly<Record<string, string>>): string {
  return sha256(
    Object.keys(documents)
      .sort()
      .map((doc) => `${doc}\0${documents[doc] ?? ""}\n`)
      .join(""),
  );
}

export interface RecordParts {
  readonly checker: ConformanceRecord["checker"];
  readonly rounds: ConformanceRecord["rounds"];
  /** `YYYY-MM-DD`: the day the validation finished. */
  readonly date: string;
}

/**
 * The record for the pack as it stands. Nothing in `init` writes one yet:
 * VALIDATE (C-2⁶) is the phase that will. It is built here, beside the
 * reader, so that the hash has a single definition from the start.
 */
export function conformanceRecord(root: string, parts: RecordParts): ConformanceRecord {
  const documents = documentHashes(root, packDocuments(root));
  return conformanceRecordSchema.parse({
    schema_version: SCHEMA_VERSION,
    hash: packHash(documents),
    documents,
    checker: parts.checker,
    rounds: parts.rounds,
    date: parts.date,
  });
}

/** Committed with the pack: two-space JSON and a final newline, so a re-validation diffs line by line. */
export function writeConformanceRecord(root: string, record: ConformanceRecord): void {
  mkdirSync(path.dirname(recordFile(root)), { recursive: true });
  writeFileSync(recordFile(root), `${JSON.stringify(record, null, 2)}\n`);
}

/**
 * The committed record, or `null` when there is none. A record that is not
 * JSON (a merge left its markers in), that breaks the schema, that a newer
 * build wrote, or whose hash disagrees with its own documents is refused by
 * name: each would otherwise decide a pack's fate on a guess.
 */
export function readConformanceRecord(root: string): ConformanceRecord | null {
  if (!hasConformanceRecord(root)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(recordFile(root), "utf8"));
  } catch (err) {
    throw new ConformanceRecordError(`${CONFORMANCE_RECORD_PATH} is not JSON: ${(err as Error).message}`);
  }
  const parsed = parseArtifact(conformanceRecordSchema, raw);
  if (!parsed.ok) {
    throw new ConformanceRecordError(
      parsed.reason === "newer-schema"
        ? `${CONFORMANCE_RECORD_PATH} declares schema_version ${parsed.found}; this build supports ${parsed.supported}. Upgrade Detent to read it (F-3).`
        : `${CONFORMANCE_RECORD_PATH} is invalid: ${parsed.issues.join("; ")}`,
    );
  }
  if (packHash(parsed.value.documents) !== parsed.value.hash) {
    throw new ConformanceRecordError(`${CONFORMANCE_RECORD_PATH}: its hash does not match its own documents, so it vouches for nothing`);
  }
  return parsed.value;
}

/**
 * Raw, conforming or changed. A pack conforms when its documents hash to the
 * record, the record's checker was green, and the checker is green on them
 * now (C-2¹⁰). The last clause is the one a record cannot vouch for: the
 * rules can move under unchanged documents, in greenfield most of all, where
 * the stack entry is required (D-10′). Only blocking findings count; the
 * heuristic's reports are for VALIDATE's reviewers.
 */
export function classifyPack(root: string, opts: { readonly greenfield: boolean }): PackStatus {
  const record = readConformanceRecord(root);
  if (record === null) return { kind: "raw" };
  const docs = packDocuments(root);
  const current = documentHashes(root, docs);
  const added = docs.filter((doc) => !Object.hasOwn(record.documents, doc));
  const removed = Object.keys(record.documents)
    .filter((doc) => !Object.hasOwn(current, doc))
    .sort();
  const modified = docs.filter((doc) => Object.hasOwn(record.documents, doc) && record.documents[doc] !== current[doc]);
  if (added.length + removed.length + modified.length > 0) {
    return { kind: "changed", date: record.date, added, removed, modified, reasons: [] };
  }
  const reasons = [
    ...(record.checker.green ? [] : [`its record says the checker was red on ${record.date}`]),
    ...checkPack(root, docs, opts)
      .findings.filter((f) => f.blocks)
      .map((f) => `${f.file}${f.line > 0 ? `:${String(f.line)}` : ""} [${f.rule}] ${f.message}`),
  ];
  if (reasons.length === 0) return { kind: "conforming", date: record.date, hash: record.hash };
  return { kind: "changed", date: record.date, added: [], removed: [], modified: [], reasons };
}

const NOTED_REASONS = 10;

/**
 * What `init` says at DISCOVER. A raw document set is the ordinary case and
 * says nothing. A conforming pack's note says what the checker does not
 * check, so that "conforming" is not read as "reviewed" (C-2¹⁰).
 */
export function packNote(status: PackStatus): string | null {
  if (status.kind === "raw") return null;
  if (status.kind === "conforming") {
    return [
      `the documents are a conforming pack: they match their conformance record of ${status.date} (hash ${status.hash.slice(0, 12)}…),`,
      " and the pack checker is green on them now. It does not check:",
      ...UNCHECKED.map((u) => `\n  - ${u}`),
    ].join("");
  }
  const moved = [
    ...(status.modified.length > 0 ? [`modified ${status.modified.join(", ")}`] : []),
    ...(status.added.length > 0 ? [`added ${status.added.join(", ")}`] : []),
    ...(status.removed.length > 0 ? [`removed ${status.removed.join(", ")}`] : []),
  ];
  const shown = status.reasons.slice(0, NOTED_REASONS);
  const more = status.reasons.length - shown.length;
  return [
    `the pack no longer matches its conformance record of ${status.date}`,
    ...(moved.length > 0 ? [`: ${moved.join("; ")}`] : []),
    ...shown.map((r) => `\n  ${r}`),
    ...(more > 0 ? [`\n  … and ${String(more)} more`] : []),
  ].join("");
}
