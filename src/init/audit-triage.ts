import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { noteUnitComplete } from "../kernel/ledger.js";
import { claimTriageSchema, triageEntrySchema, type Claim, type ClaimTriage, type TriageEntry } from "../schemas/audit.js";
import { SCHEMA_VERSION, parseArtifact } from "../schemas/common.js";

/**
 * C-2¹⁸ (PRDR-306) — AUDIT's triage: which claims are worth a check.
 *
 * C-2¹¹ checked every claim the survey listed, each in a session of its own on
 * claude-opus-5-5 at max. On tabachir 138 checks cost $426. DECIDE is given
 * only the claims that are not confirmed, so the 77 confirmations changed
 * nothing, and many of the 48 unverified were claims no source could settle.
 * The user's decision (D-34): one session sorts the claims first, and only a
 * claim a decision in the documents rests on and a primary source could
 * settle is checked. D-34′ (PRDR-317) checks each in a session of its own, as
 * C-2¹¹ did, since checks given five claims of a topic found fewer of the
 * claims that were wrong.
 */

/** A claim without a brief, and the hash its brief would be committed under. */
export interface Pending {
  readonly claim: Claim;
  readonly hash: string;
}

/** What triage decided for a claim: checked, or why not. A claim it did not sort is checked, as every claim was before it. */
export type Sorted = "check" | ClaimTriage;

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
        why: "<one sentence on both judgments>",
      },
    ],
  };
}

/**
 * C-2¹⁹ (PRDR-308): the entries a triage session wrote for `given`, each
 * taken or refused on its own, as a brief is. Two entries for one claim leave
 * it with neither, since nothing says which the session meant.
 */
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
  const twice = new Set<string>();
  const issues: string[] = [];
  parsed.value.claims.forEach((item, i) => {
    const at = `entry ${String(i + 1)}`;
    const entry = triageEntrySchema.safeParse(item);
    if (!entry.success) issues.push(`${at}: ${entry.error.issues.map((x) => `${x.path.join(".") || "<entry>"}: ${x.message}`).join("; ")}`);
    else if (!given.has(entry.data.claim_hash)) issues.push(`${at}: ${entry.data.claim_hash} is not a claim you were given`);
    else if (entries.has(entry.data.claim_hash) || twice.has(entry.data.claim_hash)) {
      twice.add(entry.data.claim_hash);
      issues.push(`${at}: ${entry.data.claim_hash} is sorted twice, so neither entry stands`);
    } else entries.set(entry.data.claim_hash, entry.data);
  });
  for (const hash of twice) entries.delete(hash);
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

const claims = (n: number): string => `${String(n)} claim${n === 1 ? "" : "s"}`;

/**
 * The triage session's entries for `pending`. What the first attempt sorts
 * stands, and the claims it left unsorted, and only they, go to one relaunch
 * with the validator's words (C-2¹⁹, PRDR-308). A claim still unsorted is
 * checked, and said. What each attempt sorts is kept with the survey
 * and is a unit of work (X-1⁵), as a brief is.
 */
async function triageSession(pending: readonly Pending[], deps: TriageDeps, counted: (toolCalls: number) => void): Promise<Map<string, TriageEntry>> {
  const out = triagePath(deps.root);
  const entries = new Map<string, TriageEntry>();
  let asked = [...pending];
  let previous: { readonly issue: string } | null = null;
  for (let attempt = 0; attempt < 2 && asked.length > 0; attempt += 1) {
    rmSync(out, { force: true });
    counted((await deps.triage(asked, out, previous)).toolCalls);
    const read = readTriage(out, new Set(asked.map((p) => p.hash)));
    if (read.entries.size > 0) {
      for (const [hash, entry] of read.entries) entries.set(hash, entry);
      deps.keepTriage?.(Object.fromEntries(read.entries));
      noteUnitComplete(deps.root);
    }
    asked = asked.filter((p) => !read.entries.has(p.hash));
    previous = { issue: read.issue ?? "unsorted" };
    if (attempt === 0 && asked.length > 0) {
      deps.note?.(`AUDIT's triage sorted all but ${claims(asked.length)} (${previous.issue}) — relaunching once for those alone, with the validator's own words (C-4⁗′)`);
    }
  }
  if (asked.length > 0) {
    deps.note?.(`AUDIT's triage left ${claims(asked.length)} unsorted, so ${asked.length === 1 ? "it is" : "they are"} checked (C-2¹⁸)`);
  }
  return entries;
}

/** How `entry` sorts a claim. A claim the triage did not sort is checked. */
export function sortedAs(entry: TriageEntry | undefined): Sorted {
  if (entry === undefined) return "check";
  if (!entry.load_bearing) return "not_load_bearing";
  if (!entry.checkable) return "uncheckable";
  return "check";
}

/** Sort `pending`: by what an earlier run kept, and by one triage session for the rest. */
export async function sortClaims(pending: readonly Pending[], deps: TriageDeps, counted: (toolCalls: number) => void): Promise<Map<string, Sorted>> {
  const kept = deps.triaged ?? {};
  const untriaged = pending.filter((p) => !Object.hasOwn(kept, p.hash));
  const fresh = untriaged.length === 0 ? new Map<string, TriageEntry>() : await triageSession(untriaged, deps, counted);
  return new Map(pending.map((p) => [p.hash, sortedAs(Object.hasOwn(kept, p.hash) ? kept[p.hash] : fresh.get(p.hash))]));
}
