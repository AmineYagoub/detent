import { afterEach, describe, expect, it } from "vitest";
import { commitPatch, ticketCommits } from "../../src/kernel/git.js";
import { git, gitInit, removeTree, tmpTree, writeTree } from "../helpers.js";

/**
 * PRDR-094 — the review basis is the ticket's OWN commits.
 *
 * The claim base is pinned at first acquire (PRDR-069) so later generations
 * judge the whole ticket rather than the last patch. That makes `base..HEAD` a
 * span other tickets commit into, and the surface pathspec was trusted to
 * filter them back out — on the false assumption that surfaces are disjoint
 * across tickets. When they overlap, the reviewer is shown work the ticket
 * never wrote, and no fix generation can resolve it: the hunks belong to
 * another ticket and are already DONE.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

/** A run branch where t1 claims, then t2 and t3 commit into t1's own surface. */
function interleavedRepo(): { readonly root: string; readonly base: string } {
  const root = tmpTree({ "src/seed.ts": "export const seed = 0;\n" });
  roots.push(root);
  gitInit(root);
  git(root, "add", "-A");
  git(root, "commit", "-m", "seed");
  const base = git(root, "rev-parse", "HEAD").trim();

  const commit = (id: string, files: Record<string, string>): void => {
    writeTree(root, files);
    git(root, "add", "-A");
    git(root, "commit", "-m", `${id}: work`);
  };
  commit("t1", { "src/a.ts": "export const a = 1;\n" });
  commit("t2", { "src/b.ts": "export const b = 2;\n" });
  commit("t3", { "src/c.ts": "export const c = 3;\n" });
  return { root, base };
}

describe("PRDR-094 the reviewer sees only the ticket's own work", () => {
  it("the old range basis swept in the other tickets — this is the bug being fixed", () => {
    const { root, base } = interleavedRepo();
    /* What `git diff <base>` (the previous basis) would have shown the reviewer. */
    const range = git(root, "diff", base, "--", ":(glob)src/**");
    expect(range).toContain("src/a.ts");
    expect(range).toContain("src/b.ts");
    expect(range).toContain("src/c.ts");
  });

  it("the ticket's own commits exclude work another ticket committed into its surface", () => {
    const { root, base } = interleavedRepo();
    const own = ticketCommits(root, "t1", base);
    expect(own).toHaveLength(1);

    const body = own.map((sha) => commitPatch(root, sha, ["--", ":(glob)src/**"])).join("");
    expect(body).toContain("src/a.ts");
    expect(body).not.toContain("src/b.ts");
    expect(body).not.toContain("src/c.ts");
  });

  it("a requeued ticket is still judged as one body of work across its generations (PRDR-069 preserved)", () => {
    const { root, base } = interleavedRepo();
    /* X-8: a later generation commits after the other tickets already landed. */
    writeTree(root, { "src/a2.ts": "export const a2 = 1;\n" });
    git(root, "add", "-A");
    git(root, "commit", "-m", "t1: work (generation 1)");

    const own = ticketCommits(root, "t1", base);
    expect(own).toHaveLength(2);

    const body = own.map((sha) => commitPatch(root, sha, ["--", ":(glob)src/**"])).join("");
    /* Both generations present... */
    expect(body).toContain("src/a.ts");
    expect(body).toContain("src/a2.ts");
    /* ...and still nothing borrowed from the tickets in between. */
    expect(body).not.toContain("src/b.ts");
    expect(body).not.toContain("src/c.ts");
  });

  it("a ticket that has not committed yet has no own commits, and falls back to the worktree", () => {
    const { root, base } = interleavedRepo();
    expect(ticketCommits(root, "t-nothing", base)).toEqual([]);
  });

  it("a null base yields no commits rather than scanning all history", () => {
    const { root } = interleavedRepo();
    expect(ticketCommits(root, "t1", null)).toEqual([]);
  });

  it("commitPatch handles a root commit, which has no parent to diff against", () => {
    const root = tmpTree({ "src/only.ts": "export const only = 1;\n" });
    roots.push(root);
    gitInit(root);
    git(root, "add", "-A");
    git(root, "commit", "-m", "t9: the very first commit");
    const sha = git(root, "rev-parse", "HEAD").trim();
    expect(commitPatch(root, sha, ["--", ":(glob)src/**"])).toContain("src/only.ts");
  });
});
