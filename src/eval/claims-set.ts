import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { auditBriefPath, claimHash } from "../init/audit-claims.js";
import { lineOf } from "../init/audit-passages.js";
import { surveyPath } from "../init/audit.js";
import { detentBuild } from "../kernel/build.js";
import { auditSurveySchema, claimBriefSchema, type Claim, type ClaimBrief } from "../schemas/audit.js";
import { SCHEMA_VERSION } from "../schemas/common.js";
import { EvalRefused, committedFiles, gitRoot, refuseInside, treeDir, treeOf, writeSetFile, writeTree, type ClaimsSet } from "./sets.js";

/**
 * N-8 (PRDR-326) — the claims set, read from the copy where arm A ran.
 *
 * Arm A checked each claim in a session of its own, on a build before
 * PRDR-306, whose check sessions wrote their one brief at the top of their
 * artifact (`state/audit-claim-<hash>.json`). Those artifacts whose claim the
 * copy's survey holds are arm A's; the grouped checks that ran after it wrote
 * an envelope of briefs, and are not. The set keeps the brief AUDIT committed
 * for the claim, and a committed verdict that disagrees with the artifact's
 * refuses the set.
 *
 * The set is every claim arm A found wrong, and the first `confirmed` of the
 * claims it confirmed in the order of their hashes: an order no one chose, so
 * the sample favours no kind of claim. A confirmed brief names the primary
 * source that settled its claim, as the prompt asks of `confirmed`.
 *
 * The tree is the copy's last commit. Arm A read the project before WRITE
 * rewrote its documents, and WRITE commits nothing, so the commit is what the
 * checks read. Each claim's passage is found in that tree, or the set is
 * refused: a passage the tree does not hold means the survey read other
 * documents.
 */

const ARTIFACT = /^audit-claim-[0-9a-f]{12}\.json$/u;

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Arm A's briefs: each one-claim artifact whose claim the survey holds, as AUDIT committed it. */
function armA(root: string, surveyed: ReadonlyMap<string, Claim>): Map<string, ClaimBrief> {
  const dir = path.join(stateDir(root), "state");
  const out = new Map<string, ClaimBrief>();
  for (const name of existsSync(dir) ? readdirSync(dir).filter((n) => ARTIFACT.test(n)).sort() : []) {
    /* A grouped check's envelope of briefs is no brief, so the schema refuses it. */
    const artifact = claimBriefSchema.safeParse(readJson(path.join(dir, name)));
    if (!artifact.success || !surveyed.has(artifact.data.claim_hash)) continue;
    const committed = claimBriefSchema.safeParse(readJson(auditBriefPath(root, artifact.data.claim_hash)));
    if (!committed.success) continue;
    if (committed.data.verdict !== artifact.data.verdict) {
      throw new EvalRefused(`arm A's brief for "${artifact.data.claim}" says ${artifact.data.verdict}, and the brief AUDIT committed for it says ${committed.data.verdict}`);
    }
    out.set(artifact.data.claim_hash, committed.data);
  }
  return out;
}

const byHash = (a: { readonly claim_hash: string }, b: { readonly claim_hash: string }): number => (a.claim_hash < b.claim_hash ? -1 : 1);

export interface BuiltSet<T> {
  readonly set: T;
  /** What the operator is told of it: where it came from, and how many of each. */
  readonly report: readonly string[];
}

/** Builds the claims set from `from`, the copy where arm A ran, into `setDir`, which must not exist yet. */
export function buildClaimsSet(from: string, setDir: string, opts: { readonly confirmed: number; readonly now?: () => Date }): BuiltSet<ClaimsSet> {
  const { root, gitDir } = gitRoot(from, "the copy the set is read from,");
  refuseInside(setDir, root);
  const survey = auditSurveySchema.safeParse(readJson(surveyPath(root)));
  if (!survey.success) throw new EvalRefused(`${root} holds no survey this build can read at ${surveyPath(root)}`);
  const surveyed = new Map<string, Claim>();
  for (const claim of survey.data.claims) {
    const hash = claimHash(claim.claim, claim.subject);
    if (!surveyed.has(hash)) surveyed.set(hash, claim);
  }
  const briefs = armA(root, surveyed);
  const all = [...briefs.values()].map((brief) => ({ claim_hash: brief.claim_hash, brief })).sort(byHash);
  const wrong = all.filter((b) => b.brief.verdict === "wrong");
  const confirmed = all.filter((b) => b.brief.verdict === "confirmed");
  if (wrong.length === 0) throw new EvalRefused(`arm A's ${String(all.length)} briefs in ${root} find no claim wrong, so there is nothing a setup must find`);
  if (confirmed.length < opts.confirmed) throw new EvalRefused(`arm A confirmed ${String(confirmed.length)} claims, fewer than the ${String(opts.confirmed)} asked for`);
  const chosen = [...wrong.map((b) => ({ ...b, expected: "wrong" as const })), ...confirmed.slice(0, opts.confirmed).map((b) => ({ ...b, expected: "confirmed" as const }))];

  const head = committedFiles(root);
  const tree = treeOf(head.files, head.read);
  writeTree(setDir, tree, head.read);
  const unplaced = chosen.flatMap((c) => {
    const claim = surveyed.get(c.claim_hash);
    return claim === undefined || lineOf(treeDir(setDir), claim.passage) === null ? [claim?.claim ?? c.claim_hash] : [];
  });
  if (unplaced.length > 0) {
    rmSync(setDir, { recursive: true, force: true });
    throw new EvalRefused(`the copy's last commit does not hold the passage of ${String(unplaced.length)} claim(s), so it is not what the survey read: ${unplaced.slice(0, 3).join("; ")}`);
  }
  const set: ClaimsSet = {
    schema_version: SCHEMA_VERSION,
    kind: "claims",
    built: { at: (opts.now?.() ?? new Date()).toISOString(), build: detentBuild(), from: root, git_dir: gitDir },
    selection:
      `every claim arm A found wrong (${String(wrong.length)}), and the first ${String(opts.confirmed)} of the ${String(confirmed.length)} it confirmed, ` +
      "in the order of their hashes; arm A's briefs are the one-claim artifacts of its checks, as AUDIT committed them",
    documents: survey.data.documents_read,
    tree,
    claims: chosen.map((c) => ({ claim: surveyed.get(c.claim_hash) as Claim, claim_hash: c.claim_hash, expected: c.expected, arm_a: c.brief })),
  };
  writeSetFile(setDir, set);
  const count = (v: string): number => all.filter((b) => b.brief.verdict === v).length;
  return {
    set,
    report: [
      `arm A: ${String(all.length)} briefs (${String(count("confirmed"))} confirmed, ${String(count("wrong"))} wrong, ${String(count("unverified"))} unverified)`,
      `the claims set: ${String(wrong.length)} wrong and ${String(opts.confirmed)} confirmed, with a tree of ${String(head.files.length)} files at ${root}'s last commit`,
    ],
  };
}
