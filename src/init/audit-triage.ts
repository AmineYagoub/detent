import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { noteUnitComplete } from "../kernel/ledger.js";
import { claimTriageSchema, type Claim, type ClaimTriage, type TriageEntry } from "../schemas/audit.js";
import { SCHEMA_VERSION, parseArtifact } from "../schemas/common.js";
import { withOneRelaunch } from "./retry.js";

/**
 * C-2¹⁸ (PRDR-306) — AUDIT's triage: which claims are worth a check.
 *
 * C-2¹¹ checked every claim the survey listed, each in a session of its own on
 * claude-opus-5-5 at max. On tabachir 138 checks cost $426. DECIDE is given
 * only the claims that are not confirmed, so the 77 confirmations changed
 * nothing, and many of the 48 unverified were claims no source could settle.
 * The user's decision (D-34): one session sorts the claims first, and only a
 * claim a decision in the documents rests on and a primary source could
 * settle is checked, up to five of a topic to a session.
 */

/** C-2¹⁸: at most this many claims, all of one topic, to a check session (D-34). */
export const AUDIT_CLAIMS_PER_SESSION = 5;

/** A claim without a brief, and the hash its brief would be committed under. */
export interface Pending {
  readonly claim: Claim;
  readonly hash: string;
}

/** What triage decided for a claim. A claim it did not sort is checked alone, as every claim was before it. */
export type Sorted = { readonly kind: "check"; readonly topic: string } | { readonly kind: ClaimTriage };

/** Where the triage session writes, before anything has checked it, cleared before each launch (D-19). */
export function triagePath(root: string): string {
  return path.join(stateDir(root), "state", "audit-triage.json");
}

export function triageSkeleton(): Record<string, unknown> {
  return {
    schema_version: SCHEMA_VERSION,
    claims: [
      {
        claim_hash: "<the claim's claim_hash, exactly as given>",
        load_bearing: true,
        checkable: true,
        topic: "<what one source would settle with it: one law, one licence family, one platform's policy>",
        why: "<one sentence on both judgments>",
      },
    ],
  };
}

function readTriage(file: string, given: ReadonlySet<string>): { entries: Map<string, TriageEntry>; issue: string | null } {
  const entries = new Map<string, TriageEntry>();
  if (!existsSync(file)) return { entries, issue: "the session wrote no artifact" };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { entries, issue: "the artifact is not JSON" };
  }
  const parsed = parseArtifact(claimTriageSchema, raw);
  if (!parsed.ok) return { entries, issue: parsed.reason === "invalid" ? parsed.issues.join("; ") : parsed.reason };
  const issues: string[] = [];
  for (const entry of parsed.value.claims) {
    if (!given.has(entry.claim_hash)) issues.push(`${entry.claim_hash} is not a claim you were given`);
    else if (entries.has(entry.claim_hash)) issues.push(`${entry.claim_hash} is sorted twice`);
    else entries.set(entry.claim_hash, entry);
  }
  const unsorted = [...given].filter((hash) => !entries.has(hash));
  if (unsorted.length > 0) issues.push(`these claims are not sorted: ${unsorted.join(", ")}`);
  return { entries, issue: issues.length === 0 ? null : issues.join("; ") };
}

export interface TriageDeps {
  readonly root: string;
  readonly triage: (claims: readonly Pending[], artifactOut: string, previous: { readonly issue: string } | null) => Promise<{ readonly toolCalls: number }>;
  /** What an earlier run of this phase triaged (C-2¹⁷). */
  readonly triaged?: Readonly<Record<string, TriageEntry>> | undefined;
  readonly keepTriage?: ((entries: Readonly<Record<string, TriageEntry>>) => void) | undefined;
  readonly note?: ((text: string) => void) | undefined;
}

/**
 * The triage session's entries for `pending`, strict on the first attempt so
 * the relaunch hears everything, and on the second keeping what stands. A
 * claim it still leaves out is checked alone, and said. What it wrote is kept
 * with the survey, and is a unit of work (X-1⁵), as a brief is.
 */
async function triageSession(pending: readonly Pending[], deps: TriageDeps, counted: (toolCalls: number) => void): Promise<Map<string, TriageEntry>> {
  const given = new Set(pending.map((p) => p.hash));
  const out = triagePath(deps.root);
  const attempt = await withOneRelaunch<Map<string, TriageEntry>>({ stage: "AUDIT's triage", note: deps.note }, async (previous) => {
    rmSync(out, { force: true });
    counted((await deps.triage(pending, out, previous)).toolCalls);
    const read = readTriage(out, given);
    return previous === null && read.issue !== null ? { value: null, issue: read.issue } : { value: read.entries, issue: read.issue };
  });
  const entries = attempt.value ?? new Map<string, TriageEntry>();
  const unsorted = pending.length - entries.size;
  if (unsorted > 0) {
    deps.note?.(`AUDIT's triage left ${String(unsorted)} claim${unsorted === 1 ? "" : "s"} unsorted, so ${unsorted === 1 ? "it is" : "they are"} checked alone (C-2¹⁸)`);
  }
  if (entries.size > 0) {
    deps.keepTriage?.(Object.fromEntries(entries));
    noteUnitComplete(deps.root);
  }
  return entries;
}

const topicKey = (topic: string): string => topic.trim().toLowerCase().replace(/\s+/gu, " ");

/** How `entry` sorts a claim. An unsorted claim's topic is its own, so it is checked alone. */
export function sortedAs(entry: TriageEntry | undefined, hash: string): Sorted {
  if (entry === undefined) return { kind: "check", topic: `\0${hash}` };
  if (!entry.load_bearing) return { kind: "not_load_bearing" };
  if (!entry.checkable) return { kind: "uncheckable" };
  return { kind: "check", topic: topicKey(entry.topic) };
}

/** Sort `pending`: by what an earlier run kept, and by one triage session for the rest. */
export async function sortClaims(pending: readonly Pending[], deps: TriageDeps, counted: (toolCalls: number) => void): Promise<Map<string, Sorted>> {
  const kept = deps.triaged ?? {};
  const untriaged = pending.filter((p) => !Object.hasOwn(kept, p.hash));
  const fresh = untriaged.length === 0 ? new Map<string, TriageEntry>() : await triageSession(untriaged, deps, counted);
  return new Map(pending.map((p) => [p.hash, sortedAs(Object.hasOwn(kept, p.hash) ? kept[p.hash] : fresh.get(p.hash), p.hash)]));
}

/** The claims to check, by topic in the order each first appears, at most `AUDIT_CLAIMS_PER_SESSION` to a group. */
export function checkGroups(claims: readonly (Pending & { readonly topic: string })[]): Pending[][] {
  const byTopic = new Map<string, Pending[]>();
  for (const { topic, ...pending } of claims) {
    const group = byTopic.get(topic) ?? [];
    group.push(pending);
    byTopic.set(topic, group);
  }
  return [...byTopic.values()].flatMap((group) =>
    Array.from({ length: Math.ceil(group.length / AUDIT_CLAIMS_PER_SESSION) }, (_, i) => group.slice(i * AUDIT_CLAIMS_PER_SESSION, (i + 1) * AUDIT_CLAIMS_PER_SESSION)),
  );
}
