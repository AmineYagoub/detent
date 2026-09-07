import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { falsificationProbe, falsifyEvidence, isTestPath } from "../../src/kernel/falsify.js";
import { git, removeTree, writeTree } from "../helpers.js";

/**
 * V-6 (PRDR-150) — a test that would pass WITHOUT the change it ships with is
 * not evidence that the change works.
 *
 * Three of the 7 September audit's critical blockers had a passing test
 * asserting the property they violated, and the remediation repeated it. All of
 * them are one mechanical property, which is what this probe measures.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

/** A repo with a base commit, then a ticket commit touching source and tests. */
function repoWithTicketWork(files: Record<string, string>): { root: string; base: string } {
  const root = mkdtempSync(path.join(tmpdir(), "detent-falsify-"));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  writeTree(root, { "src/calc.js": "module.exports = { add: (a, b) => a + b };\n" });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  const base = git(root, "rev-parse", "HEAD").trim();
  writeTree(root, files);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "ticket work");
  return { root, base };
}

describe("V-6 the falsification probe", () => {
  it("flags a test that still passes with its own source change reverted", async () => {
    const { root, base } = repoWithTicketWork({
      "src/calc.js": "module.exports = { add: (a, b) => a + b, mul: (a, b) => a * b };\n",
      /* Asserts something true before the change too — the defect this exists to catch. */
      "tests/calc.test.js": "require('../src/calc.js');\n",
    });
    /* The tests pass without the source change: that is the whole finding. */
    const probe = await falsificationProbe({ workDir: root, base, runTests: async () => true });
    expect(probe.skipped).toBeNull();
    expect(probe.unfalsified).toEqual(["tests/calc.test.js"]);
    expect(falsifyEvidence(probe)["unfalsified_tests"]).toEqual(["tests/calc.test.js"]);
  });

  it("says nothing about a test that genuinely depends on its source change", async () => {
    const { root, base } = repoWithTicketWork({
      "src/calc.js": "module.exports = { add: (a, b) => a + b, mul: (a, b) => a * b };\n",
      "tests/calc.test.js": "const c = require('../src/calc.js'); if (c.mul(2,3) !== 6) process.exit(1);\n",
    });
    /* Reverting the source makes the tests red — the healthy case. */
    const probe = await falsificationProbe({ workDir: root, base, runTests: async () => false });
    expect(probe.unfalsified).toEqual([]);
    expect(falsifyEvidence(probe)).toEqual({});
  });

  /** The probe mutates the tree, so its failure mode matters more than its success. */
  it("restores the tree whether the tests pass, fail, or the runner throws", async () => {
    const source = "module.exports = { add: (a, b) => a + b, mul: (a, b) => a * b };\n";
    for (const runTests of [
      async (): Promise<boolean> => true,
      async (): Promise<boolean> => false,
      async (): Promise<boolean> => {
        throw new Error("gate exploded");
      },
    ]) {
      const { root, base } = repoWithTicketWork({ "src/calc.js": source, "tests/calc.test.js": "require('../src/calc.js');\n" });
      await falsificationProbe({ workDir: root, base, runTests }).catch(() => undefined);
      expect(readFileSync(path.join(root, "src/calc.js"), "utf8"), "the source half must come back").toBe(source);
      expect(git(root, "status", "--porcelain").trim(), "the tree must be clean afterwards").toBe("");
    }
  });

  it("skips a diff with nothing to falsify — no tests, or no source for them to depend on", async () => {
    const onlySource = repoWithTicketWork({ "src/calc.js": "module.exports = { add: (a, b) => a + b, mul: (a, b) => a * b };\n" });
    expect((await falsificationProbe({ workDir: onlySource.root, base: onlySource.base, runTests: async () => true })).unfalsified).toEqual([]);

    const onlyTests = repoWithTicketWork({ "tests/calc.test.js": "require('../src/calc.js');\n" });
    const probe = await falsificationProbe({ workDir: onlyTests.root, base: onlyTests.base, runTests: async () => true });
    expect(probe.unfalsified).toEqual([]);
    expect(probe.skipped).toBeNull();
  });

  it("reports a probe that could not run, rather than guessing about the tests", async () => {
    const { root } = repoWithTicketWork({ "tests/calc.test.js": "x\n" });
    const probe = await falsificationProbe({ workDir: root, base: null, runTests: async () => true });
    expect(probe.unfalsified).toEqual([]);
    expect(probe.skipped).toContain("no claim base");
  });

  /**
   * Wrong in the harmless direction on purpose: a missed test file means no
   * probe, never a false accusation.
   */
  it("recognises the ordinary test-path conventions", () => {
    for (const p of ["tests/a.test.ts", "src/a.test.ts", "src/__tests__/a.ts", "spec/a.js", "pkg/foo_test.go", "app/test_thing.py"]) {
      expect(isTestPath(p), p).toBe(true);
    }
    for (const p of ["src/a.ts", "src/latest.ts", "docs/testing.md", "src/contest/a.ts"]) {
      expect(isTestPath(p), p).toBe(false);
    }
  });
});
