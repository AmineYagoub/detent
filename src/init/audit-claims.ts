import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { stateDir, writeArtifact } from "../fs/layout.js";
import { noteUnitComplete } from "../kernel/ledger.js";
import { scrubJson } from "../kernel/scrub.js";
import { claimBriefSchema, claimBriefsSchema, type Claim, type ClaimBrief, type ClaimTriage, type ClaimVerdict } from "../schemas/audit.js";
import { SCHEMA_VERSION, parseArtifact } from "../schemas/common.js";
import { sourceIssue } from "./audit-passages.js";
import { inBatches } from "./batches.js";
import type { Estimator } from "./progress.js";
import { sortClaims, type Pending, type TriageDeps } from "./audit-triage.js";

/**
 * C-2⁶, C-2¹¹ (PRDR-281) — the external claims the survey found, each worth
 * it checked against a primary source.
 *
 * This is C-3a's engine, moved to where the claims are: a brief per claim,
 * cached and committed, one relaunch with the validator's words, X-6a's
 * local-search rule, and PRDR-266's ascent for the verdict that says nothing
 * settles the claim. What does not move is the share: PRDR-265 made the pool
 * a count rather than a limit, and C-2⁶ goes on to tell no session any number
 * to stay within, because a session told a number checks less. The calls are
 * counted, and reported against `planning_research_tool_calls`.
 *
 * C-2¹⁸ (PRDR-306): a triage decides which claims are worth a check
 * (`audit-triage.ts`), and each is checked in a session of its own (D-34′,
 * PRDR-317).
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

/** D-19's rule: a check session's own file, keyed by the claim it checks and cleared before each launch. */
export function claimArtifactPath(root: string, hash: string): string {
  return path.join(stateDir(root), "state", `audit-claim-${hash.slice(0, 12)}.json`);
}

/**
 * The shapes a claim's brief takes, one per verdict, as a planning question
 * is handed both of its arms (PRDR-264): a session with no shape for a result
 * reports it by writing nothing. A `verify_claims` session is handed them in
 * `brief_shapes` (C-2¹⁸).
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

/**
 * C-2¹⁸: what a `verify_claims` session is handed: the envelope, and a brief's
 * shape for each verdict, the claim and its hash left for the session to echo.
 */
export function claimBriefsSkeleton(): Record<string, unknown> {
  const shapes = claimBriefSkeletons("<the claim, exactly as given>", "<its claim_hash, exactly as given>");
  return {
    expected_output: { schema_version: SCHEMA_VERSION, briefs: [shapes["expected_output"]] },
    brief_shapes: { confirmed: shapes["expected_output"], wrong: shapes["expected_output_if_wrong"], unverified: shapes["expected_output_if_unverified"] },
  };
}

export interface CheckedClaim extends Claim {
  readonly claim_hash: string;
  readonly verdict: ClaimVerdict;
  readonly source?: string;
  readonly correction?: string;
  /** False when no session produced a brief the validator took: the claim was never checked, and reads as unverified. */
  readonly checked: boolean;
  /** C-2¹⁸: why the triage kept the claim from a check; absent for a claim that was checked or answered from its brief. */
  readonly triage?: ClaimTriage;
}

export interface AuditResearch {
  readonly sessions: number;
  readonly cache_hits: number;
  /** Observed, as C-3a counts them since PRDR-265: turns, one call's worth each. */
  readonly tool_calls: number;
}

export interface CheckClaimsDeps extends TriageDeps {
  /** The documents being checked; none of them is a source that can settle a claim. */
  readonly documents: readonly string[];
  /** N-5⁗ (PRDR-325): says what the checks will cost before they run, and keeps their progress; absent, neither. */
  readonly estimate?: Estimator | undefined;
  /**
   * C-2¹⁶ (PRDR-304), X-1⁸ (PRDR-324): how many check sessions run at once,
   * `budgets.init_sessions_at_once`. The checks are independent, each session
   * writes its brief under its own surface (S-1″), and a phase's launches
   * share its one journal (PRDR-203), so running several shortens the phase
   * and changes nothing a check is given. Spend is still read at each launch
   * (D-25), and what the checks can run past a reading is one batch (D-28′).
   */
  readonly atOnce: number;
  /** The `verify_claims` session for `claim`, which is given it alone (D-34′). */
  readonly launch: (claim: Pending, artifactOut: string, previous: { readonly issue: string } | null) => Promise<{ readonly toolCalls: number }>;
}

/** What one claim's check reads and launches with: none of the triage, the width or the estimate (N-8, PRDR-326). */
export type OneCheckDeps = Pick<CheckClaimsDeps, "root" | "documents" | "launch" | "note">;

/** One brief, read with every check a brief gets, save which claim it is for. */
function briefFrom(raw: unknown, deps: OneCheckDeps): { value: ClaimBrief | null; issue: string | null } {
  const parsed = parseArtifact(claimBriefSchema, raw);
  if (!parsed.ok) return { value: null, issue: parsed.reason === "invalid" ? parsed.issues.join("; ") : parsed.reason };
  const source = parsed.value.source === undefined ? null : sourceIssue(deps.root, parsed.value.source, deps.documents);
  return source === null ? { value: parsed.value, issue: null } : { value: null, issue: source };
}

function readJson(file: string): { value: unknown; issue: string | null } {
  if (!existsSync(file)) return { value: null, issue: "the session wrote no artifact" };
  try {
    return { value: JSON.parse(readFileSync(file, "utf8")), issue: null };
  } catch {
    return { value: null, issue: "the artifact is not JSON" };
  }
}

/** A committed brief, read with the checks a fresh one gets, so one citing a file that has since gone is checked again. */
function cachedBrief(hash: string, deps: CheckClaimsDeps): ClaimBrief | null {
  const raw = readJson(auditBriefPath(deps.root, hash));
  if (raw.issue !== null) return null;
  const read = briefFrom(raw.value, deps);
  return read.value?.claim_hash === hash ? read.value : null;
}

/**
 * The briefs a `verify_claims` session wrote for `asked`, each taken or
 * refused on its own. Two briefs for one claim leave it with neither, since
 * nothing says which the session meant, and it is asked for again. A session
 * is given one claim (D-34′), and may still write a brief for another.
 */
function readBriefs(file: string, asked: readonly Pending[], deps: OneCheckDeps): { briefs: Map<string, ClaimBrief>; issue: string | null } {
  const briefs = new Map<string, ClaimBrief>();
  const raw = readJson(file);
  if (raw.issue !== null) return { briefs, issue: raw.issue };
  const envelope = parseArtifact(claimBriefsSchema, raw.value);
  if (!envelope.ok) return { briefs, issue: envelope.reason === "invalid" ? envelope.issues.join("; ") : envelope.reason };
  const given = new Set(asked.map((p) => p.hash));
  const twice = new Set<string>();
  const issues: string[] = [];
  envelope.value.briefs.forEach((item, i) => {
    const read = briefFrom(item, deps);
    if (read.value === null) issues.push(`brief ${String(i + 1)}: ${read.issue ?? "refused"}`);
    else if (!given.has(read.value.claim_hash)) issues.push(`brief ${String(i + 1)} checks another claim: its claim_hash is not one this session was given`);
    else if (briefs.has(read.value.claim_hash) || twice.has(read.value.claim_hash)) {
      twice.add(read.value.claim_hash);
      issues.push(`brief ${String(i + 1)} checks a claim another brief already checked, so neither stands`);
    } else briefs.set(read.value.claim_hash, read.value);
  });
  for (const hash of twice) briefs.delete(hash);
  const without = asked.filter((p) => !briefs.has(p.hash));
  if (without.length > 0) issues.push(`no usable brief for ${without.map((p) => `"${p.claim.claim}"`).join(", ")}`);
  return { briefs, issue: issues.length === 0 ? null : issues.join("; ") };
}

/** A claim's verdict, without the claim: what a check settles. */
export type Verdict = Omit<CheckedClaim, keyof Claim>;

const settled = (hash: string, brief: ClaimBrief): Verdict => ({
  claim_hash: hash,
  verdict: brief.verdict,
  ...(brief.source === undefined ? {} : { source: brief.source }),
  ...(brief.correction === undefined ? {} : { correction: brief.correction }),
  checked: true,
});

type Tally = { -readonly [K in keyof AuditResearch]: AuditResearch[K] };

/**
 * One claim's verdict, from a `verify_claims` session of its own (D-34′). A
 * brief missing or refused is asked for once more, with the validator's
 * words. A claim left without a brief twice is recorded unverified and
 * unchecked, and never ends the phase. The brief taken is committed on the
 * claim's hash, and is a unit of work.
 */
async function checkClaim(pending: Pending, deps: OneCheckDeps, tally: Tally): Promise<Verdict> {
  const { claim, hash } = pending;
  const artifactOut = claimArtifactPath(deps.root, hash);
  let previous: { readonly issue: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    rmSync(artifactOut, { force: true });
    const result = await deps.launch(pending, artifactOut, previous);
    tally.sessions += 1;
    tally.tool_calls += result.toolCalls;
    const read = readBriefs(artifactOut, [pending], deps);
    const brief = read.briefs.get(hash);
    if (brief !== undefined) {
      /* SEC-4 (PRDR-252): the brief is committed, and it carries a model's own prose. */
      const clean = claimBriefSchema.parse(scrubJson(brief));
      writeArtifact(deps.root, path.posix.join("research", "audit", `${hash}.json`), clean);
      /* C-2¹¹, X-1⁵: a brief is a unit of work, as a slice's checkpoint is. */
      noteUnitComplete(deps.root);
      return settled(hash, clean);
    }
    previous = { issue: read.issue ?? "no usable brief" };
    if (attempt === 0) deps.note?.(`AUDIT's check of "${claim.claim}" left no usable brief (${previous.issue}) — relaunching once, with the validator's own words (C-4⁗′)`);
  }
  deps.note?.(`AUDIT could not check "${claim.claim}" (${claim.subject}), so it is recorded as unverified and unchecked (C-2¹¹)`);
  return { claim_hash: hash, verdict: "unverified", checked: false };
}

/**
 * N-8 (PRDR-326): one claim checked as AUDIT checks it, in a session of its
 * own with one relaunch, its brief read with every check and committed. An
 * evaluation checks a set's claims with it, so what it measures is AUDIT's
 * check, and not a copy of it.
 */
export async function checkOneClaim(pending: Pending, deps: OneCheckDeps): Promise<{ readonly verdict: Verdict; readonly research: AuditResearch }> {
  const tally: Tally = { sessions: 0, cache_hits: 0, tool_calls: 0 };
  const verdict = await checkClaim(pending, deps, tally);
  return { verdict, research: tally };
}

/**
 * Settle each claim once, by its hash, and record every place the documents
 * rely on it with that one verdict: a claim that is wrong in two places is
 * wrong in both, and WRITE is given each place (C-2¹³). A committed brief
 * answers first, whatever a triage would say. The rest are triaged (C-2¹⁸):
 * one nothing rests on, or no source could settle, is recorded unverified and
 * unchecked with why, and the others are checked, each in a session of its
 * own (D-34′), in batches (C-2¹⁶). The verdicts are recorded in the survey's
 * order whatever order they end in, so neither the checkpoint nor WRITE
 * depends on scheduling.
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
  const record = (hash: string, verdict: Verdict): void => {
    for (const [index, claim] of groups.get(hash)?.places ?? []) out[index] = { ...claim, ...verdict };
  };
  const pending: Pending[] = [];
  for (const [hash, { first }] of groups) {
    const cached = cachedBrief(hash, deps);
    if (cached === null) pending.push({ claim: first, hash });
    else {
      tally.cache_hits += 1;
      record(hash, settled(hash, cached));
    }
  }
  const counted = (toolCalls: number): void => {
    tally.sessions += 1;
    tally.tool_calls += toolCalls;
  };
  const sorted = await sortClaims(pending, deps, counted);
  const toCheck: Pending[] = [];
  for (const p of pending) {
    const sort = sorted.get(p.hash) ?? "check";
    if (sort === "check") toCheck.push(p);
    else record(p.hash, { claim_hash: p.hash, verdict: "unverified", checked: false, triage: sort });
  }
  const step = deps.estimate?.begin({
    phase: "AUDIT",
    step: "AUDIT's claim checks",
    said: `AUDIT: ${String(toCheck.length)} claim${toCheck.length === 1 ? "" : "s"} to check, a session each, ${String(deps.atOnce)} at once`,
    units: toCheck.map(() => ({ role: "audit", task: "verify_claims" })),
    atOnce: deps.atOnce,
  });
  await inBatches(toCheck, deps.atOnce, async (p) => {
    const unit = step?.start();
    record(p.hash, await checkClaim(p, deps, tally));
    unit?.done();
  });
  step?.end();
  return { claims: out, research: tally };
}
