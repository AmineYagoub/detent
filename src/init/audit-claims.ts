import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { stateDir, writeArtifact } from "../fs/layout.js";
import { noteUnitComplete } from "../kernel/ledger.js";
import { scrubJson } from "../kernel/scrub.js";
import { claimBriefSchema, type Claim, type ClaimBrief, type ClaimVerdict } from "../schemas/audit.js";
import { SCHEMA_VERSION, parseArtifact } from "../schemas/common.js";
import { sourceIssue } from "./audit-passages.js";
import { withOneRelaunch } from "./retry.js";

/**
 * C-2⁶, C-2¹¹ (PRDR-281) — every external claim the survey found, checked
 * against a primary source by a session of its own.
 *
 * This is C-3a's engine, moved to where the claims are: a brief per claim,
 * cached and committed, one relaunch with the validator's words, X-6a's
 * local-search rule, and PRDR-266's ascent for the verdict that says nothing
 * settles the claim. What does not move is the share: PRDR-265 made the pool
 * a count rather than a limit, and C-2⁶ goes on to tell no session any number
 * to stay within, because a session told a number checks less. The calls are
 * counted, and reported against `planning_research_tool_calls`.
 */

const normal = (text: string): string => text.trim().toLowerCase().replace(/\s+/gu, " ");

/** The claim and its subject, a dependency at its pinned version where there is one: a version bump checks the claim again. */
export function claimHash(claim: string, subject: string): string {
  return createHash("sha256").update(`${normal(claim)}\0${normal(subject)}`).digest("hex");
}

/** C-2¹¹: committed, as planning briefs are (C-3a, P8), so a re-run pays nothing for a claim it has checked. */
export function auditBriefPath(root: string, hash: string): string {
  return path.join(stateDir(root), "research", "audit", `${hash}.json`);
}

/** D-19's rule: the session's own file, keyed by claim and cleared before each launch. */
export function claimArtifactPath(root: string, hash: string): string {
  return path.join(stateDir(root), "state", `audit-claim-${hash.slice(0, 12)}.json`);
}

/**
 * What a `verify_claim` session is handed, one skeleton per verdict, as a
 * planning question is handed both of its arms (PRDR-264): a session with no
 * shape for a result reports it by writing nothing.
 */
export function claimBriefSkeletons(claim: string, hash: string): Record<string, Record<string, unknown>> {
  const base = {
    schema_version: SCHEMA_VERSION,
    claim,
    claim_hash: hash,
    evidence: [{ source: "<the doc, file or page consulted>", claim: "<what it establishes>" }],
    sources_consulted: [{ tier: 1, ref: "<what was consulted, with its tier>" }],
    local_search: { docs_checked: ["<paths searched>"], code_checked: ["<paths searched>"] },
    what_would_falsify: "<an observation that would overturn the verdict>",
  };
  const source = "<the primary source that settles it: a link, or a repository path with its line, such as a dependency's file at its pinned version>";
  return {
    expected_output: { ...base, verdict: "confirmed", source },
    expected_output_if_wrong: { ...base, verdict: "wrong", source, correction: "<what is true instead>" },
    expected_output_if_unverified: {
      ...base,
      verdict: "unverified",
      sources_consulted: [
        { tier: 1, ref: "<this project's docs and code, searched first>" },
        { tier: 3, ref: "<the outside source that did not settle it: required>" },
      ],
    },
  };
}

export interface CheckedClaim extends Claim {
  readonly claim_hash: string;
  readonly verdict: ClaimVerdict;
  readonly source?: string;
  readonly correction?: string;
  /** False when no session produced a brief the validator took: the claim was never checked, and reads as unverified. */
  readonly checked: boolean;
}

export interface AuditResearch {
  readonly sessions: number;
  readonly cache_hits: number;
  /** Observed, as C-3a counts them since PRDR-265: turns, one call's worth each. */
  readonly tool_calls: number;
}

export interface CheckClaimsDeps {
  readonly root: string;
  /** The documents being checked; none of them is a source that can settle a claim. */
  readonly documents: readonly string[];
  readonly launch: (claim: Claim, hash: string, artifactOut: string, previous: { readonly issue: string } | null) => Promise<{ readonly toolCalls: number }>;
  readonly note?: (text: string) => void;
}

function readClaimBrief(file: string, hash: string, deps: CheckClaimsDeps): { value: ClaimBrief | null; issue: string | null } {
  if (!existsSync(file)) return { value: null, issue: "the session wrote no artifact" };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { value: null, issue: "the artifact is not JSON" };
  }
  const parsed = parseArtifact(claimBriefSchema, raw);
  if (!parsed.ok) return { value: null, issue: parsed.reason === "invalid" ? parsed.issues.join("; ") : parsed.reason };
  if (parsed.value.claim_hash !== hash) {
    return { value: null, issue: "the brief checks another claim: its claim_hash is not the one it was given" };
  }
  const source = parsed.value.source === undefined ? null : sourceIssue(deps.root, parsed.value.source, deps.documents);
  return source === null ? { value: parsed.value, issue: null } : { value: null, issue: source };
}

type Verdict = Omit<CheckedClaim, keyof Claim>;

const settled = (hash: string, brief: ClaimBrief): Verdict => ({
  claim_hash: hash,
  verdict: brief.verdict,
  ...(brief.source === undefined ? {} : { source: brief.source }),
  ...(brief.correction === undefined ? {} : { correction: brief.correction }),
  checked: true,
});

type Tally = { -readonly [K in keyof AuditResearch]: AuditResearch[K] };

/**
 * One claim's verdict. A cached brief answers for free, and is read with the
 * checks a fresh one gets, so a dependency file it cites that has since gone
 * is checked again. A brief refused twice leaves the claim unverified and
 * unchecked, and the checkpoint records it so; it never ends the phase.
 */
async function check(claim: Claim, hash: string, deps: CheckClaimsDeps, tally: Tally): Promise<Verdict> {
  const cached = readClaimBrief(auditBriefPath(deps.root, hash), hash, deps).value;
  if (cached !== null) {
    tally.cache_hits += 1;
    return settled(hash, cached);
  }
  const artifactOut = claimArtifactPath(deps.root, hash);
  const attempt = await withOneRelaunch<ClaimBrief>(
    { stage: `AUDIT's check of "${claim.claim}"`, note: deps.note },
    async (previous) => {
      rmSync(artifactOut, { force: true });
      const result = await deps.launch(claim, hash, artifactOut, previous);
      tally.sessions += 1;
      tally.tool_calls += result.toolCalls;
      return readClaimBrief(artifactOut, hash, deps);
    },
  );
  if (attempt.value === null) {
    deps.note?.(`AUDIT could not check "${claim.claim}" (${claim.subject}), so it is recorded as unverified and unchecked (C-2¹¹)`);
    return { claim_hash: hash, verdict: "unverified", checked: false };
  }
  /* SEC-4 (PRDR-252): the brief is committed, and it carries a model's own prose. */
  const brief = claimBriefSchema.parse(scrubJson(attempt.value));
  writeArtifact(deps.root, path.posix.join("research", "audit", `${hash}.json`), brief);
  /* C-2¹¹, X-1⁵: a brief is a unit of work, as a slice's checkpoint is. */
  noteUnitComplete(deps.root);
  return settled(hash, brief);
}

/**
 * C-2¹⁶ (PRDR-304): how many claims AUDIT checks at once. The claims are
 * independent, each session writes its own brief under its own surface
 * (S-1″), and a phase's launches share its one journal (PRDR-203), so a batch
 * shortens the phase and changes nothing a check is given. Spend is still
 * read at each launch (D-25), and what the batch can run past a reading is
 * one batch (D-28′).
 */
export const AUDIT_CLAIM_BATCH = 4;

/**
 * `work` on each item, up to `size` at once, the next starting as one ends. A
 * failure stops the taking and lets what is in flight end, so a check that
 * finishes still commits its brief and records its spend; then the first
 * failure is thrown, as a check in sequence threw it.
 */
async function inBatches<T>(items: readonly T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const failed: { error?: unknown } = {};
  const worker = async (): Promise<void> => {
    for (let item = queue.shift(); item !== undefined && !("error" in failed); item = queue.shift()) {
      try {
        await work(item);
      } catch (error) {
        if (!("error" in failed)) failed.error = error;
      }
    }
  };
  await Promise.all(Array.from({ length: size }, worker));
  if ("error" in failed) throw failed.error;
}

/**
 * Check each claim once, by its hash, and record every place the documents
 * rely on it with that one verdict: a claim that is wrong in two places is
 * wrong in both, and WRITE is given each place (C-2¹³). The checks run in
 * batches (C-2¹⁶), and the verdicts are recorded in the survey's order
 * whatever order they end in, so neither the checkpoint nor WRITE depends on
 * scheduling.
 */
export async function checkClaims(
  claims: readonly Claim[],
  deps: CheckClaimsDeps,
): Promise<{ readonly claims: readonly CheckedClaim[]; readonly research: AuditResearch }> {
  const tally: Tally = { sessions: 0, cache_hits: 0, tool_calls: 0 };
  /* Each claim is checked as its first place states it, as the checks in sequence did. */
  const groups = new Map<string, { readonly first: Claim; readonly places: [number, Claim][] }>();
  claims.forEach((claim, index) => {
    const hash = claimHash(claim.claim, claim.subject);
    const group = groups.get(hash) ?? { first: claim, places: [] };
    group.places.push([index, claim]);
    groups.set(hash, group);
  });
  const out: CheckedClaim[] = [];
  await inBatches([...groups], AUDIT_CLAIM_BATCH, async ([hash, { first, places }]) => {
    const verdict = await check(first, hash, deps, tally);
    for (const [index, claim] of places) out[index] = { ...claim, ...verdict };
  });
  return { claims: out, research: tally };
}
