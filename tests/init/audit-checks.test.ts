import { rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditNotes, auditSurveySkeleton } from "../../src/init/audit.js";
import { claimBriefSkeletons, claimHash } from "../../src/init/audit-claims.js";
import { auditKey, codeFiles } from "../../src/init/audit-key.js";
import { checkSurvey, passageAt, sourceIssue } from "../../src/init/audit-passages.js";
import { auditSurveySchema, claimBriefSchema, type AuditSurvey } from "../../src/schemas/audit.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { git, removeTree, tmpTree, writeTree } from "../helpers.js";
import { repo } from "./plan-fixture.js";

/**
 * PRDR-281 — what code checks in what AUDIT's sessions write, and what AUDIT's
 * checkpoint is keyed by (C-2¹¹). The phase itself is driven in
 * `audit.test.ts`; these pin the checks one at a time.
 */

const PRD = ["# Toolshed", "", "Borrowing is free in the MVP.", "", "Payments use the Stripe API, and a", "   refund returns the card fee.", ""].join("\n");
const FREE = { file: "PRD.md", line: 3, quote: "Borrowing is free in the MVP." };
const INVENTED = { file: "PRD.md", line: 3, quote: "Borrowing is free forever." };

const plain: string[] = [];
afterEach(() => {
  for (const r of plain.splice(0)) removeTree(r);
});

const survey = (over: Record<string, unknown> = {}): AuditSurvey =>
  auditSurveySchema.parse({ schema_version: SCHEMA_VERSION, documents_read: ["PRD.md"], contradictions: [], gaps: [], drift: [], claims: [], ...over });

describe("PRDR-281: the skeletons are the schemas' own shapes", () => {
  it("the survey's, with no drift to write in a greenfield project", () => {
    for (const greenfield of [true, false]) expect(auditSurveySchema.safeParse(auditSurveySkeleton(greenfield)).success).toBe(true);
    expect(auditSurveySkeleton(true)["drift"]).toEqual([]);
    expect(auditSurveySkeleton(false)["drift"]).toHaveLength(1);
  });

  it("one per verdict, each a brief the validator takes", () => {
    const skeletons = claimBriefSkeletons("c", claimHash("c", "s"));
    expect(Object.keys(skeletons).sort()).toEqual(["expected_output", "expected_output_if_unverified", "expected_output_if_wrong"]);
    for (const [name, skeleton] of Object.entries(skeletons)) expect(claimBriefSchema.safeParse(skeleton).success, name).toBe(true);
    expect(skeletons["expected_output_if_unverified"]).not.toHaveProperty("source");
  });
});

describe("PRDR-281: a passage is at its file:line, whitespace aside", () => {
  it("is found on the line it starts on, across a line break", () => {
    const root = repo({ "PRD.md": PRD });
    expect(passageAt(root, FREE)).toBe(true);
    expect(passageAt(root, { file: "PRD.md", line: 5, quote: "and a refund returns the card fee" })).toBe(true);
  });

  it("is found across whitespace inside a line, in the document or in the quote", () => {
    const root = repo({ "PRD.md": "# Toolshed\n\nRent  is\tweekly.\n" });
    expect(passageAt(root, { file: "PRD.md", line: 3, quote: "Rent is weekly." })).toBe(true);
    expect(passageAt(root, { file: "PRD.md", line: 3, quote: "Rent is\n  weekly." })).toBe(true);
  });

  it("is not found a line away, past the end, in a file that is not there, or in one outside the root", () => {
    const root = repo({ "PRD.md": PRD });
    expect(passageAt(root, { ...FREE, line: 4 })).toBe(false);
    expect(passageAt(root, { file: "PRD.md", line: 6, quote: "and a refund" })).toBe(false);
    expect(passageAt(root, { ...FREE, line: 99 })).toBe(false);
    expect(passageAt(root, { ...FREE, file: "SRS.md" })).toBe(false);
    const outside = tmpTree({ "PRD.md": PRD });
    plain.push(outside);
    expect(passageAt(root, { ...FREE, file: path.relative(root, path.join(outside, "PRD.md")) })).toBe(false);
    expect(passageAt(root, { ...FREE, file: `../${path.basename(root)}/PRD.md` }), "the same file, reached the long way").toBe(true);
    expect(passageAt(root, INVENTED)).toBe(false);
    expect(passageAt(root, { file: "PRD.md", line: 3, quote: "Payments use the Stripe API" }), "said two lines on, not on this one").toBe(false);
  });
});

describe("PRDR-281: a verdict's source is a link, or a file that is there with the lines it cites", () => {
  const docs = ["PRD.md"];
  const fixture = (): string => repo({ "PRD.md": PRD, "node_modules/stripe/lib/refunds.js": "a\nb\n" });

  it("takes a link as given, and a file whole, at a line or over lines it has", () => {
    const root = fixture();
    for (const source of ["https://docs.stripe.com/refunds", "node_modules/stripe/lib/refunds.js", "node_modules/stripe/lib/refunds.js:2", "node_modules/stripe/lib/refunds.js:1-2"]) {
      expect(sourceIssue(root, source, docs), source).toBeNull();
    }
  });

  it("refuses a file that is not there, a directory, a path outside the root, and lines the file does not have", () => {
    const root = fixture();
    expect(sourceIssue(root, "node_modules/stripe/lib/charges.js:4", docs)).toMatch(/neither a link nor a file/u);
    expect(sourceIssue(root, "node_modules/stripe", docs)).toMatch(/neither a link nor a file/u);
    expect(sourceIssue(root, "../outside.js", docs)).toMatch(/neither a link nor a file/u);
    for (const lines of ["3", "0", "1-3", "2-1"]) {
      expect(sourceIssue(root, `node_modules/stripe/lib/refunds.js:${lines}`, docs), lines).toMatch(/does not have/u);
    }
  });

  it("refuses a document being checked, which cannot settle a claim it makes", () => {
    expect(sourceIssue(fixture(), "PRD.md:3", docs)).toMatch(/one of the documents being checked/u);
  });
});

describe("PRDR-281: a survey is checked against the documents it was given", () => {
  it("stands as written when everything it cites is there", () => {
    const root = repo({ "PRD.md": PRD, "src/borrow.js": "x\n" });
    const written = survey({
      contradictions: [{ topic: "t", passages: [FREE, { file: "PRD.md", line: 5, quote: "Payments use the Stripe API" }], why: "w" }],
      drift: [{ passage: FREE, code_checked: ["src/borrow.js", "src"], finding: "f" }],
    });
    const check = checkSurvey(root, written, { documents: ["PRD.md"], greenfield: false });
    expect(check).toEqual({ issues: [], kept: written, dropped: [], unread: [], moved: [] });
  });

  it("names the documents it did not read", () => {
    const root = repo({ "PRD.md": PRD, "SRS.md": "# srs\n" });
    const check = checkSurvey(root, survey(), { documents: ["PRD.md", "SRS.md"], greenfield: true });
    expect(check.unread).toEqual(["SRS.md"]);
    expect(check.issues.join(" ")).toContain("SRS.md");
  });

  it("drops a gap and a claim whose passage is not there, each by kind", () => {
    const root = repo({ "PRD.md": PRD });
    const written = survey({ gaps: [{ topic: "t", detail: "d", passages: [INVENTED] }], claims: [{ claim: "c", subject: "s", passage: INVENTED }] });
    const check = checkSurvey(root, written, { documents: ["PRD.md"], greenfield: true });
    expect(check.dropped.map((d) => [d.kind, d.passage])).toEqual([["gap", "PRD.md:3"], ["claim", "PRD.md:3"]]);
    expect(check.kept.gaps).toEqual([]);
    expect(check.kept.claims).toEqual([]);
    expect(check.issues.join(" ")).toMatch(/2 passage\(s\) are not at the file:line/u);
  });

  it("finds no passage in a file it was not given, even one that says it", () => {
    const root = repo({ "PRD.md": PRD, "notes.txt": `${FREE.quote}\n` });
    const written = survey({ claims: [{ claim: "c", subject: "s", passage: { ...FREE, file: "notes.txt", line: 1 } }] });
    expect(checkSurvey(root, written, { documents: ["PRD.md"], greenfield: true }).dropped).toHaveLength(1);
  });

  it("drops drift in a greenfield project, and drift naming code that is not there", () => {
    const root = repo({ "PRD.md": PRD, "src/borrow.js": "x\n" });
    const outside = tmpTree({ "borrow.js": "x\n" });
    plain.push(outside);
    const beyond = path.relative(root, path.join(outside, "borrow.js"));
    const escaped = checkSurvey(root, survey({ drift: [{ passage: FREE, code_checked: [beyond], finding: "f" }] }), { documents: ["PRD.md"], greenfield: false });
    expect(escaped.kept.drift, "code outside the repository is not this project's").toEqual([]);
    const drift = (code: string[]): Record<string, unknown> => ({ passage: FREE, code_checked: code, finding: "f" });
    const green = checkSurvey(root, survey({ drift: [drift(["src/borrow.js"])] }), { documents: ["PRD.md"], greenfield: true });
    expect(green.kept.drift).toEqual([]);
    expect(green.issues.join(" ")).toMatch(/greenfield/u);
    expect(green.dropped).toEqual([expect.objectContaining({ kind: "drift", passage: "PRD.md:3", reason: expect.stringMatching(/greenfield/u) })]);

    const existing = checkSurvey(root, survey({ drift: [drift(["src/borrow.js"]), drift(["src/gone.js"])] }), { documents: ["PRD.md"], greenfield: false });
    expect(existing.kept.drift).toEqual([drift(["src/borrow.js"])]);
    expect(existing.issues.join(" ")).toContain("src/gone.js");
    expect(existing.dropped).toEqual([expect.objectContaining({ kind: "drift", passage: "PRD.md:3", reason: expect.stringContaining("src/gone.js") })]);
  });
});

describe("PRDR-281: a claim brief's verdict carries what it must, and nothing a fact would not", () => {
  const brief = (over: Record<string, unknown>): boolean =>
    claimBriefSchema.safeParse({
      schema_version: SCHEMA_VERSION,
      claim: "c",
      claim_hash: claimHash("c", "s"),
      verdict: "confirmed",
      source: "https://example.com/c",
      evidence: [{ source: "PRD.md", claim: "says c" }],
      sources_consulted: [{ tier: 1, ref: "PRD.md" }],
      local_search: { docs_checked: ["PRD.md"], code_checked: [] },
      ...over,
    }).success;

  it("takes a confirmed claim with its source from any tier, and a wrong one with its correction", () => {
    expect(brief({})).toBe(true);
    expect(brief({ verdict: "wrong", correction: "not c" })).toBe(true);
  });

  it("refuses a settled verdict with no source, and a correction on anything but wrong", () => {
    expect(brief({ source: undefined })).toBe(false);
    expect(brief({ verdict: "wrong" })).toBe(false);
    expect(brief({ correction: "not c" })).toBe(false);
  });

  it("refuses an unverified verdict with a source, or with no consultation past tier 2 (PRDR-266)", () => {
    const outside = [{ tier: 1, ref: "PRD.md" }, { tier: 3, ref: "https://example.com" }];
    expect(brief({ verdict: "unverified", source: undefined, sources_consulted: outside })).toBe(true);
    expect(brief({ verdict: "unverified", sources_consulted: outside })).toBe(false);
    expect(brief({ verdict: "unverified", source: undefined })).toBe(false);
  });

  it("refuses a brief citing a URL with no local search behind it (X-6a)", () => {
    expect(brief({ evidence: [{ source: "https://example.com/c", claim: "c" }], local_search: { docs_checked: [], code_checked: [] } })).toBe(false);
  });

  it("is keyed by the claim and its subject, case and whitespace aside", () => {
    expect(claimHash("A  Stripe refund returns the fee.", " Stripe API ")).toBe(claimHash("a stripe refund returns the fee.", "stripe api"));
    expect(claimHash("c", "medusa 2.21.1")).not.toBe(claimHash("c", "medusa 2.22.0"));
  });
});

describe("PRDR-281: a survey's findings stand on passages", () => {
  it("refuses a contradiction with one side, and drift with no code read", () => {
    expect(auditSurveySchema.safeParse({ ...survey(), contradictions: [{ topic: "t", passages: [FREE], why: "w" }] }).success).toBe(false);
    expect(auditSurveySchema.safeParse({ ...survey(), drift: [{ passage: FREE, code_checked: [], finding: "f" }] }).success).toBe(false);
  });

  it("lists ten of a kind in the note and counts the rest, so a long audit does not bury the terminal", () => {
    const contradictions = Array.from({ length: 12 }, (_, i) => ({ topic: `t${String(i)}`, passages: [FREE, FREE], why: "w" }));
    const [note] = auditNotes({ contradictions, gaps: [], drift: [], claims: [], dropped: [], unread: [], research: { sessions: 0, cache_hits: 0, tool_calls: 0 } }, 16);
    expect(note).toContain("t9: PRD.md:3 vs PRD.md:3");
    expect(note).not.toContain("t10:");
    expect(note).toContain("and 2 more, in .detent/state/AUDIT.json");
  });
});

describe("PRDR-281: AUDIT's key is the documents, the code and the prompt, never the decision log", () => {
  it("lists the code git tracks or would track, less the documents and Detent's own paths", () => {
    const root = repo({
      "PRD.md": "# p\n",
      "docs/founder-decisions.md": "# d\n",
      "docs/archive/old.md": "# a context document, not the root's archive\n",
      "src/a.js": "a\n",
      ".gitignore": "dist/\n",
      "dist/out.js": "built\n",
      ".detent/plan/t-1.json": "{}\n",
      "archive/PRD.md": "# original\n",
    });
    git(root, "add", "src/a.js");
    git(root, "commit", "-q", "-m", "code");
    expect(codeFiles(root, ["PRD.md"])).toEqual([".gitignore", "docs/archive/old.md", "src/a.js"]);
  });

  it("walks the tree where git cannot list it, as discovery does", () => {
    const root = tmpTree({ "PRD.md": "# p\n", "src/a.js": "a\n", "node_modules/x/i.js": "x\n", "archive/PRD.md": "# o\n", ".detent/state/s.json": "{}\n" });
    plain.push(root);
    expect(codeFiles(root, ["PRD.md"])).toEqual(["src/a.js"]);
  });

  it("moves with the code, the documents and the prompt, and not with the decision log", () => {
    const root = repo({ "PRD.md": "# p\n", "src/a.js": "a\n" });
    const key = (docs: string[], prompt = "h"): string => auditKey(root, docs, ["raw", [], prompt]);
    const before = key(["PRD.md"]);
    writeTree(root, { "docs/founder-decisions.md": "# D-1\n" });
    expect(key(["PRD.md"]), "a decision log discovery has not listed").toBe(before);
    expect(key(["PRD.md", "docs/founder-decisions.md"]), "one it has").toBe(before);
    expect(key(["PRD.md"], "other")).not.toBe(before);
    writeTree(root, { "src/a.js": "b\n" });
    const edited = key(["PRD.md"]);
    expect(edited).not.toBe(before);
    writeTree(root, { "PRD.md": "# p, edited\n" });
    expect(key(["PRD.md"])).not.toBe(edited);
  });

  it("counts a tracked file deleted from the working tree as a change", () => {
    const root = repo({ "PRD.md": "# p\n", "src/a.js": "a\n" });
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "all");
    const before = auditKey(root, ["PRD.md"], []);
    rmSync(path.join(root, "src", "a.js"));
    expect(codeFiles(root, ["PRD.md"])).toContain("src/a.js");
    expect(auditKey(root, ["PRD.md"], [])).not.toBe(before);
  });
});
