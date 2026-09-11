import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parkForeignUntracked, restoreParked, settleWorktree, unstageAdditions } from "../../src/kernel/worktree-park.js";
import { resetDirtyTracked } from "../../src/kernel/git.js";
import { git, gitInit, removeTree, tmpTree } from "../helpers.js";

/**
 * PRDR-100 — a terminated session's untracked output must not fail the next
 * ticket's gate.
 *
 * Observed live on the N-7 gate: t-116 breached the turns ceiling at 103 turns
 * and left 21 untracked files under `src/verification/**`. t-102, whose surface
 * is `src/kernel/fs/**`, then failed the whole-tree lint gate on them and burned
 * implement, blind_fix, research and informed_fix — about $5.80 — on a failure
 * D-21 forbade it from touching. The surfaces were perfectly disjoint, so no
 * plan and no reviewer could have prevented it.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

function repoWithDebris(): string {
  const root = tmpTree({ "README.md": "seed\n" });
  roots.push(root);
  gitInit(root);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "seed");
  /* What a terminated session leaves behind: untracked, uncommitted, unowned. */
  mkdirSync(path.join(root, "src/verification/discovery"), { recursive: true });
  writeFileSync(path.join(root, "src/verification/discovery/make.ts"), "export const a = 1;\n");
  mkdirSync(path.join(root, "tests/verification"), { recursive: true });
  writeFileSync(path.join(root, "tests/verification/determinism.test.ts"), "export const b = 2;\n");
  /* And the claiming ticket's own untracked work, which must survive. */
  mkdirSync(path.join(root, "src/kernel/fs"), { recursive: true });
  writeFileSync(path.join(root, "src/kernel/fs/boundary.ts"), "export const c = 3;\n");
  return root;
}

const CLAIMANT = ["src/kernel/fs/**", "tests/fs/**"];
const OWNER = ["src/verification/discovery/**", "tests/verification/**"];

describe("PRDR-100 foreign untracked debris is parked, not inherited", () => {
  it("moves aside what the claiming ticket does not own", () => {
    const root = repoWithDebris();
    const parked = parkForeignUntracked(root, CLAIMANT);

    expect(parked.sort()).toEqual([
      "src/verification/discovery/make.ts",
      "tests/verification/determinism.test.ts",
    ]);
    expect(existsSync(path.join(root, "src/verification/discovery/make.ts"))).toBe(false);
    expect(existsSync(path.join(root, "tests/verification/determinism.test.ts"))).toBe(false);
  });

  it("leaves the claiming ticket's OWN untracked work in place", () => {
    const root = repoWithDebris();
    parkForeignUntracked(root, CLAIMANT);
    expect(existsSync(path.join(root, "src/kernel/fs/boundary.ts"))).toBe(true);
  });

  it("parks under .git, never in the worktree — the F-2 boundary lint governs .detent", () => {
    const root = repoWithDebris();
    parkForeignUntracked(root, CLAIMANT);
    expect(existsSync(path.join(root, ".git/detent-parked/src/verification/discovery/make.ts"))).toBe(true);
    /* Nothing new in the worktree for a whole-tree gate to trip over. */
    expect(git(root, "status", "--short", "--untracked-files=all")).not.toContain("verification");
  });

  it("gives it back when its owner claims — B-5's resume, preserved", () => {
    const root = repoWithDebris();
    parkForeignUntracked(root, CLAIMANT);

    const back = restoreParked(root, OWNER);
    expect(back.sort()).toEqual([
      "src/verification/discovery/make.ts",
      "tests/verification/determinism.test.ts",
    ]);
    expect(existsSync(path.join(root, "src/verification/discovery/make.ts"))).toBe(true);
  });

  it("restores nothing for a ticket that owns none of it", () => {
    const root = repoWithDebris();
    parkForeignUntracked(root, CLAIMANT);
    expect(restoreParked(root, ["docs/**"])).toEqual([]);
    expect(existsSync(path.join(root, "src/verification/discovery/make.ts"))).toBe(false);
  });

  it("never parks .detent state — that is the kernel's own, not a ticket's", () => {
    const root = repoWithDebris();
    mkdirSync(path.join(root, ".detent/research"), { recursive: true });
    writeFileSync(path.join(root, ".detent/research/brief.json"), "{}\n");
    const parked = parkForeignUntracked(root, CLAIMANT);
    expect(parked.some((p) => p.startsWith(".detent/"))).toBe(false);
    expect(existsSync(path.join(root, ".detent/research/brief.json"))).toBe(true);
  });
});

/**
 * PRDR-214 — the index is part of the tree.
 *
 * gate-313: generation 0 of the bootstrap staged `tmp_check/probe.txt` while
 * probing its tools, falsified, and was requeued. Parking reads
 * `ls-files --others`; a staged path is not "others", so generation 1 inherited
 * it on the change surface of every review, with no verb to unstage it. And
 * `resetDirtyTracked` would have thrown on it at a resume: `checkout HEAD --`
 * cannot restore a path HEAD does not have.
 */
function repoWithStagedDebris(): string {
  const root = tmpTree({ "README.md": "seed\n", "src/kernel/fs/seed.ts": "export const s = 0;\n" });
  roots.push(root);
  gitInit(root);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "seed");
  /* Staged by a previous generation, never committed: one foreign, one the claimant owns. */
  mkdirSync(path.join(root, "tmp_check"), { recursive: true });
  writeFileSync(path.join(root, "tmp_check/probe.txt"), "probe\n");
  writeFileSync(path.join(root, "src/kernel/fs/partial.ts"), "export const p = 1;\n");
  git(root, "add", "tmp_check/probe.txt", "src/kernel/fs/partial.ts");
  return root;
}

describe("PRDR-214 what a previous generation staged is settled with the tree", () => {
  it("a staged addition is unstaged — the file stays on disk, the index forgets it", () => {
    const root = repoWithStagedDebris();
    expect(unstageAdditions(root).sort()).toEqual(["src/kernel/fs/partial.ts", "tmp_check/probe.txt"]);
    expect(git(root, "diff", "--cached", "--name-only").trim()).toBe("");
    expect(existsSync(path.join(root, "tmp_check/probe.txt"))).toBe(true);
    expect(existsSync(path.join(root, "src/kernel/fs/partial.ts"))).toBe(true);
  });

  it("settle unstages BEFORE parking: the foreign one is parked, the owned one stays, and both are on the record", () => {
    const root = repoWithStagedDebris();
    const settled = settleWorktree(root, CLAIMANT);
    expect([...(settled?.unstaged ?? [])].sort()).toEqual(["src/kernel/fs/partial.ts", "tmp_check/probe.txt"]);
    expect(settled?.parked).toEqual(["tmp_check/probe.txt"]);
    expect(existsSync(path.join(root, "tmp_check/probe.txt"))).toBe(false);
    expect(existsSync(path.join(root, "src/kernel/fs/partial.ts"))).toBe(true);
    /* What a pathspec-less `git commit` would now carry: nothing of the previous generation's. */
    expect(git(root, "status", "--short", "--untracked-files=all")).not.toContain("tmp_check");
  });

  it("a clean index and tree settle to null, exactly as before", () => {
    const root = tmpTree({ "README.md": "seed\n" });
    roots.push(root);
    gitInit(root);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "seed");
    expect(settleWorktree(root, CLAIMANT)).toBeNull();
  });

  it("resetDirtyTracked never throws on a staged-new path: it resets what HEAD has and leaves the rest to settle", () => {
    const root = repoWithStagedDebris();
    writeFileSync(path.join(root, "README.md"), "modified\n");
    expect(() => resetDirtyTracked(root)).not.toThrow();
    expect(resetDirtyTracked(root)).toEqual([]);
    expect(git(root, "show", "HEAD:README.md")).toBe("seed\n");
    expect(existsSync(path.join(root, "tmp_check/probe.txt"))).toBe(true);
  });

  it("parking works in a linked worktree, where `.git` is a file — the park root is the worktree's git directory", () => {
    const main = tmpTree({ "README.md": "seed\n" });
    roots.push(main);
    gitInit(main);
    git(main, "add", "-A");
    git(main, "commit", "-q", "-m", "seed");
    const wt = path.join(main, ".detent/worktrees/t1");
    mkdirSync(path.dirname(wt), { recursive: true });
    git(main, "worktree", "add", "-q", wt, "-b", "ticket/t1");
    mkdirSync(path.join(wt, "tmp_check"), { recursive: true });
    writeFileSync(path.join(wt, "tmp_check/probe.txt"), "probe\n");

    expect(parkForeignUntracked(wt, CLAIMANT)).toEqual(["tmp_check/probe.txt"]);
    expect(existsSync(path.join(wt, "tmp_check/probe.txt"))).toBe(false);
    const gitDir = git(wt, "rev-parse", "--absolute-git-dir").trim();
    expect(existsSync(path.join(gitDir, "detent-parked/tmp_check/probe.txt"))).toBe(true);
    expect(restoreParked(wt, ["tmp_check/**"])).toEqual(["tmp_check/probe.txt"]);
    expect(existsSync(path.join(wt, "tmp_check/probe.txt"))).toBe(true);
  });
});

/** Audit of PRDR-214: a staged RENAME is an addition and a deletion, not a third thing. */
describe("audit of PRDR-214: a staged rename settles as the addition and the deletion it is", () => {
  it("the new path is unstaged, the old path is restored, and nothing throws", () => {
    const root = tmpTree({ "README.md": "seed\n" });
    roots.push(root);
    gitInit(root);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "seed");
    mkdirSync(path.join(root, "docs"), { recursive: true });
    git(root, "mv", "README.md", "docs/readme.md");
    /* Rename detection would report one `R` here; read raw, it is an `A` and a `D`. */
    expect(unstageAdditions(root)).toEqual(["docs/readme.md"]);
    expect(resetDirtyTracked(root)).toEqual(["README.md"]);
    expect(existsSync(path.join(root, "README.md"))).toBe(true);
    expect(existsSync(path.join(root, "docs/readme.md"))).toBe(true);
    expect(git(root, "diff", "--cached", "--name-only").trim()).toBe("");
  });
});
