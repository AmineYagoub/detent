import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addMajors, buildReviewsSet } from "../../src/eval/reviews-set.js";
import { readSet } from "../../src/eval/sets.js";
import { keptReviewsPath } from "../../src/init/validate-kept.js";
import { main as evalBuild } from "../../scripts/eval-build.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { PROMPTS, repo } from "../init/plan-fixture.js";
import { CODES, prdOf } from "../init/validate-wide-fixture.js";
import { RAW } from "../init/write-fixture.js";
import { QUOTE, stoppedCopy } from "./review-fixture.js";

/**
 * PRDR-326 — the reviews set is read from a copy whose first VALIDATE round
 * kept its reviews (N-8). A kept review is its area's reviewer's only where
 * the key VALIDATE's code gives that area's task, over the tree the set keeps,
 * is the one it was kept under; that proves the tree is what the reviewer
 * read. The set is the areas whose proven review holds a blocker.
 */

const outside = (): string => path.join(mkdtempSync(path.join(tmpdir(), "detent-sets-")), "reviews");

describe("PRDR-326 the reviews set, read from a copy whose first round kept its reviews (N-8)", () => {
  it("proves each kept review by its key, and keeps the areas whose review holds a blocker, with their tasks and blockers", async () => {
    const from = await stoppedCopy();
    const setDir = outside();
    const { set, report } = buildReviewsSet(from, setDir, { promptHash: PROMPTS.hashes.spec_review });
    expect(set.areas.map((a) => [a.name, a.blockers.length, a.findings])).toEqual([[`Area ${CODES[0] ?? ""}`, 1, 1]]);
    expect(set.areas[0]?.task.documents).toEqual([prdOf(0)]);
    expect(set.areas[0]?.blockers[0]?.places).toEqual([{ file: prdOf(0), line: 5, quote: QUOTE }]);
    expect(set.areas[0]?.majors, "N-8′: its review holds no major").toEqual([]);
    expect(set.pack).toContain(prdOf(0));
    expect(set.prompt_hash).toBe(PROMPTS.hashes.spec_review);
    expect(report[0]).toMatch(/^kept reviews: (\d+), \1 proven by their keys as first-round reviews of this tree \(the rest reviewed an earlier pack or round\), holding 2 findings$/u);
    expect(report[1]).toMatch(/^the reviews set: 1 blockers in 1 areas, with a tree of \d+ files as the reviewers read them$/u);
    expect(readSet(setDir)).toEqual(set);
    expect(readFileSync(path.join(setDir, "tree", ...prdOf(0).split("/")), "utf8")).toBe(readFileSync(path.join(from, ...prdOf(0).split("/")), "utf8"));
  });

  it("leaves out a kept review whose documents moved since its reviewer read them", async () => {
    const from = await stoppedCopy();
    const moved = path.join(from, ...prdOf(0).split("/"));
    writeFileSync(moved, readFileSync(moved, "utf8").replace("## 7. Acceptance criteria", "An edit after the review.\n\n## 7. Acceptance criteria"));
    const setDir = outside();
    expect(() => buildReviewsSet(from, setDir, { promptHash: PROMPTS.hashes.spec_review })).toThrow(/are proven by their keys and none holds a blocker/u);
    expect(existsSync(setDir), "nothing left behind").toBe(false);
  });

  it("proves no review under another spec_review prompt's hash, and says a different one may be needed", async () => {
    const from = await stoppedCopy();
    expect(() => buildReviewsSet(from, outside(), { promptHash: "0".repeat(64) })).toThrow(/0 are proven by their keys and none holds a blocker; .*a different prompt hash may be needed/u);
  });

  it("refuses a copy that kept no first-round review", () => {
    const root = repo(RAW);
    writeFileSync(path.join(root, "x.json"), JSON.stringify({ schema_version: SCHEMA_VERSION }));
    expect(() => buildReviewsSet(root, outside(), { promptHash: PROMPTS.hashes.spec_review })).toThrow(/names no stack markers|keeps no reviews/u);
  });
});

describe("N-8′ the reviews set holds its majors (PRDR-334)", () => {
  /** The set's file with each area's majors left out, as a set built before N-8′ holds them. */
  function asBuiltBefore(setDir: string): string {
    const file = path.join(setDir, "set.json");
    const set = JSON.parse(readFileSync(file, "utf8")) as { areas: Record<string, unknown>[] };
    for (const area of set.areas) delete area["majors"];
    writeFileSync(file, `${JSON.stringify(set, null, 2)}\n`);
    return readFileSync(file, "utf8");
  }

  it("keeps each area's majors beside its blockers", async () => {
    const from = await stoppedCopy({ lendingMajor: true });
    const { set } = buildReviewsSet(from, outside(), { promptHash: PROMPTS.hashes.spec_review });
    expect(set.areas.map((a) => [a.name, a.blockers.length, a.majors?.length, a.findings]), "its minor counted, not kept").toEqual([[`Area ${CODES[0] ?? ""}`, 1, 1, 3]]);
    expect(set.areas[0]?.majors?.[0]).toMatchObject({ severity: "major", places: [{ file: prdOf(0), line: 5, quote: QUOTE }] });
  });

  it("adds the majors to a set built before N-8′, in place, from the copy it was read from, and changes nothing else", async () => {
    const from = await stoppedCopy({ lendingMajor: true });
    const setDir = outside();
    const { set } = buildReviewsSet(from, setDir, { promptHash: PROMPTS.hashes.spec_review });
    asBuiltBefore(setDir);
    const older = readSet(setDir);
    expect(older.kind === "reviews" && older.areas.every((a) => a.majors === undefined)).toBe(true);
    expect(evalBuild(["--majors", setDir]), "the script's --majors").toBe(0);
    expect(readSet(setDir), "the majors back, and the tree, the build stamp and the blockers as they were").toEqual(set);
    const again = addMajors(setDir);
    expect(again.report).toEqual([`${setDir} already holds its majors; nothing was written`]);
  });

  it("refuses to add them where the copy no longer keeps an area's review, or keeps one that differs", async () => {
    const from = await stoppedCopy({ lendingMajor: true });
    const setDir = outside();
    buildReviewsSet(from, setDir, { promptHash: PROMPTS.hashes.spec_review });
    const before = asBuiltBefore(setDir);
    const keptFile = keptReviewsPath(from);
    const kept = JSON.parse(readFileSync(keptFile, "utf8")) as { reviews: { key: string; findings: unknown[] }[] };
    const key = (readSet(setDir) as { areas: { key: string }[] }).areas[0]?.key ?? "";
    writeFileSync(keptFile, JSON.stringify({ ...kept, reviews: kept.reviews.map((r) => (r.key === key ? { ...r, findings: r.findings.slice(1) } : r)) }));
    expect(() => addMajors(setDir)).toThrow(/is not the one the set was built from: its blockers or its count of findings differ/u);
    writeFileSync(keptFile, JSON.stringify({ ...kept, reviews: kept.reviews.filter((r) => r.key !== key) }));
    expect(() => addMajors(setDir)).toThrow(new RegExp(`no longer keeps the review of Area ${CODES[0] ?? ""}, under the key ${key}`, "u"));
    expect(evalBuild(["--majors", setDir]), "the script refuses with 2").toBe(2);
    expect(readFileSync(path.join(setDir, "set.json"), "utf8"), "nothing written").toBe(before);
  });
});
