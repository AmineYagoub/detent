import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parkForeignUntracked, restoreParked } from "../../src/kernel/worktree-park.js";
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
