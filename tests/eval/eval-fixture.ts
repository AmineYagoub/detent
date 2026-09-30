import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { claimHash } from "../../src/init/audit-claims.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { git, gitInit, writeTree } from "../helpers.js";

/**
 * PRDR-326 — a copy arm A ran on, for N-8's tests: ten claims checked one per
 * artifact, an eleventh checked in a grouped envelope, the briefs AUDIT
 * committed, and working files WRITE rewrote after the last commit.
 */

export type Json = Record<string, unknown>;

export const LINES = Array.from({ length: 12 }, (_, i) => `Rule ${String(i)}: the ministry's circular ${String(100 + i)} sets the term's dates.`);
export const PRD = `${LINES.join("\n")}\n`;
export const VERDICTS = ["wrong", "confirmed", "confirmed", "wrong", "unverified", "confirmed", "wrong", "confirmed", "confirmed", "unverified"] as const;

export const claimOf = (i: number): Json => ({ claim: `Circular ${String(100 + i)} sets the term's dates.`, subject: "the ministry's circulars", passage: { file: "docs/prd.md", line: i + 1, quote: LINES[i] } });
export const hashOf = (i: number): string => claimHash(`Circular ${String(100 + i)} sets the term's dates.`, "the ministry's circulars");

export function brief(i: number, verdict: string): Json {
  return {
    schema_version: SCHEMA_VERSION,
    claim: claimOf(i)["claim"],
    claim_hash: hashOf(i),
    verdict,
    ...(verdict === "unverified" ? {} : { source: `https://example.org/circular-${String(100 + i)}` }),
    ...(verdict === "wrong" ? { correction: "circular 200 sets them now" } : {}),
    evidence: [{ source: "https://example.org", claim: "what the ministry says" }],
    sources_consulted: [
      { tier: 1, ref: "docs/prd.md" },
      { tier: 3, ref: "https://example.org" },
    ],
    local_search: { docs_checked: ["docs/prd.md"], code_checked: [] },
    what_would_falsify: "a later circular",
  };
}

const put = (root: string, rel: string, value: unknown): void => writeTree(root, { [rel]: `${JSON.stringify(value)}\n` });

/** A copy arm A ran on, `committed` giving the verdict AUDIT committed for a claim where it differs from arm A's. */
export function armACopy(over: { readonly committed?: (i: number) => string } = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), "detent-armA-"));
  gitInit(root);
  writeTree(root, { "docs/prd.md": PRD, "README.md": "# Tabachir-like\n" });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "the documents");
  writeTree(root, { "docs/prd.md": "# Rewritten by WRITE\n", "docs/prd/01-principles.md": "# Principles\n" });
  const claims = [...VERDICTS.map((_, i) => claimOf(i)), claimOf(10)];
  put(root, ".detent/state/audit-survey.json", { schema_version: SCHEMA_VERSION, documents_read: ["README.md", "docs/prd.md"], contradictions: [], gaps: [], drift: [], claims });
  VERDICTS.forEach((verdict, i) => {
    put(root, `.detent/state/audit-claim-${hashOf(i).slice(0, 12)}.json`, brief(i, verdict));
    put(root, `.detent/research/audit/${hashOf(i)}.json`, { ...brief(i, over.committed?.(i) ?? verdict), what_would_falsify: "a later circular, as AUDIT committed it" });
  });
  put(root, `.detent/state/audit-claim-${hashOf(10).slice(0, 12)}.json`, { schema_version: SCHEMA_VERSION, briefs: [brief(10, "wrong")] });
  put(root, `.detent/research/audit/${hashOf(10)}.json`, brief(10, "wrong"));
  return realpathSync(root);
}

export const outside = (): string => path.join(mkdtempSync(path.join(tmpdir(), "detent-sets-")), "claims");
