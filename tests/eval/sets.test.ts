import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildClaimsSet } from "../../src/eval/claims-set.js";
import { DETENT_ROOT, readSet, treeDir } from "../../src/eval/sets.js";
import { PRD, VERDICTS, armACopy, claimOf, hashOf, outside } from "./eval-fixture.js";

/**
 * PRDR-326 — the claims set is read from the copy where arm A ran (N-8): arm
 * A's briefs are the one-claim artifacts its checks wrote, as AUDIT committed
 * them; the set is every claim arm A found wrong and the first of those it
 * confirmed in the order of their hashes; and its tree is the copy's last
 * commit, which holds every claim's passage, since WRITE rewrote the working
 * files after the survey read them.
 */

describe("PRDR-326 the claims set, read from the copy where arm A ran (N-8)", () => {
  it("keeps every claim arm A found wrong and the first it confirmed in hash order, with the survey's words and arm A's briefs", () => {
    const from = armACopy();
    const setDir = outside();
    const { set, report } = buildClaimsSet(from, setDir, { confirmed: 2 });
    const wrong = [0, 3, 6].map(hashOf).sort();
    const confirmed = [1, 2, 5, 7, 8].map(hashOf).sort().slice(0, 2);
    expect(set.claims.map((c) => [c.claim_hash, c.expected])).toEqual([...wrong.map((h) => [h, "wrong"]), ...confirmed.map((h) => [h, "confirmed"])]);
    expect(set.claims.some((c) => c.claim_hash === hashOf(10)), "a grouped check is not arm A's").toBe(false);
    const first = set.claims[0];
    expect(first?.claim).toEqual(claimOf([0, 3, 6].find((i) => hashOf(i) === wrong[0]) ?? 0));
    expect(first?.arm_a.verdict).toBe("wrong");
    expect(first?.arm_a.what_would_falsify, "the brief AUDIT committed, not the session's own artifact").toBe("a later circular, as AUDIT committed it");
    expect(set.documents).toEqual(["README.md", "docs/prd.md"]);
    expect(set.built.from).toBe(from);
    expect(report).toEqual([
      "arm A: 10 briefs (5 confirmed, 3 wrong, 2 unverified)",
      `the claims set: 3 wrong and 2 confirmed, with a tree of 2 files at ${from}'s last commit`,
    ]);
    expect(readSet(setDir)).toEqual(set);
  });

  it("takes its tree from the last commit, which is what the survey read, and not the files WRITE rewrote since", () => {
    const setDir = outside();
    const { set } = buildClaimsSet(armACopy(), setDir, { confirmed: 2 });
    expect(Object.keys(set.tree)).toEqual(["README.md", "docs/prd.md"]);
    expect(readFileSync(path.join(treeDir(setDir), "docs", "prd.md"), "utf8")).toBe(PRD);
  });

  it("refuses to write a set inside this repository, inside the copy, or where a directory already is", () => {
    const from = armACopy();
    expect(() => buildClaimsSet(from, path.join(DETENT_ROOT, "evals", "claims"), { confirmed: 2 })).toThrow(/outside this repository, which is public/u);
    expect(() => buildClaimsSet(from, path.join(from, "evals"), { confirmed: 2 })).toThrow(/outside the copy it was read from/u);
    const taken = outside();
    mkdirSync(taken, { recursive: true });
    expect(() => buildClaimsSet(from, taken, { confirmed: 2 })).toThrow(/already exists/u);
    expect(existsSync(path.join(DETENT_ROOT, "evals"))).toBe(false);
  });

  it("refuses a copy where AUDIT committed a verdict other than arm A's", () => {
    const from = armACopy({ committed: (i) => (i === 3 ? "confirmed" : VERDICTS[i] ?? "confirmed") });
    expect(() => buildClaimsSet(from, outside(), { confirmed: 2 })).toThrow(/says wrong, and the brief AUDIT committed for it says confirmed/u);
  });

  it("refuses, and leaves nothing behind, where the last commit does not hold a claim's passage", () => {
    const from = armACopy();
    const survey = path.join(from, ".detent", "state", "audit-survey.json");
    const read = JSON.parse(readFileSync(survey, "utf8")) as { claims: { passage: { quote: string } }[] };
    for (const c of read.claims) c.passage.quote = "Rewritten by WRITE";
    writeFileSync(survey, `${JSON.stringify(read)}\n`);
    const setDir = outside();
    expect(() => buildClaimsSet(from, setDir, { confirmed: 2 })).toThrow(/last commit does not hold the passage of 5 claim/u);
    expect(existsSync(setDir)).toBe(false);
  });

  it("refuses a set whose tree is no longer the one its set.json digests", () => {
    const setDir = outside();
    buildClaimsSet(armACopy(), setDir, { confirmed: 2 });
    writeFileSync(path.join(treeDir(setDir), "README.md"), "# edited\n");
    expect(() => readSet(setDir)).toThrow(/its tree is not the one set.json digests \(README.md\)/u);
  });
});
