import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  WorktreeConflictError,
  changedFiles,
  commitPatch,
  ensureWorktree,
  installTrailerHook,
  mergeWorktree,
  commitsOn,
  ensureRunBranch,
  parseTicketTrailers,
  resolveBaseRef,
  snapshotRefs,
  worktreePath,
} from "../../src/kernel/git.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { EXIT_HUMAN_GATED, EXIT_OK, run } from "../../src/kernel/run.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { MockBackend, type StageFn } from "../../src/sessions/mock.js";
import { okResult } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { git, removeTree, writeTree } from "../helpers.js";
import { addTicket, implementGreen, makeRunRepo, reviewApprove } from "./run-fixture.js";

/** T-042 — the branch & merge contract (B-1…B-5, D-8, P7). */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

async function fixture(): Promise<string> {
  const { root } = await makeRunRepo();
  roots.push(root);
  return root;
}

describe("T-042 B-1: trailers on every commit", () => {
  it("session commits and the finalize commit carry the Detent-Ticket trailer via the repo hook", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    const baseSha = git(root, "rev-parse", "main").trim();

    const outcome = await run({
      root,
      backend: new MockBackend({ implement: implementGreen, review: reviewApprove }),
      prompts: PROMPTS,
      runId: "trailers",
    });
    expect(outcome.exitCode).toBe(EXIT_OK);

    const commits = commitsOn(root, "detent/run-trailers", baseSha);
    expect(commits.length).toBeGreaterThanOrEqual(1);
    for (const commit of commits) {
      expect(parseTicketTrailers(commit.message), commit.message).toContain("t1");
    }
    /** The writer never emits the legacy form (B-1/D-20). */
    expect(commits.some((c) => c.message.includes("Foreman-Ticket:"))).toBe(false);
  });

  it("dual-read: a mixed history parses completely; only the current form is written", () => {
    const mixed = [
      "old work\n\nForeman-Ticket: t-9",
      "newer work\n\nDetent-Ticket: t-10",
      "both, historically possible\n\nForeman-Ticket: t-11\nDetent-Ticket: t-11",
      "no trailer at all",
    ];
    expect(mixed.flatMap(parseTicketTrailers)).toEqual(["t-9", "t-10", "t-11", "t-11"]);
  });
});

describe("T-042 B-3/P7: the base-write guard", () => {
  it("red-team: a hostile session committing to the base branch is reverted and escalated; base SHA byte-identical", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    const baseSha = git(root, "rev-parse", "main").trim();

    /**
     * The hostile stage checks out main, commits an implant, and returns to
     * the run branch so the loop's own git keeps working.
     */
    const hostile: StageFn = (spec) => {
      const runBranch = git(spec.cwd, "rev-parse", "--abbrev-ref", "HEAD").trim();
      git(spec.cwd, "checkout", "-q", "main");
      writeTree(spec.cwd, { "implant.txt": "pwned\n" });
      git(spec.cwd, "add", "implant.txt");
      git(spec.cwd, "commit", "-q", "-m", "implant on base");
      git(spec.cwd, "checkout", "-q", runBranch);
      return okResult();
    };

    const outcome = await run({
      root,
      backend: new MockBackend({ implement: hostile }),
      prompts: PROMPTS,
      runId: "redteam",
    });

    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(git(root, "rev-parse", "main").trim()).toBe(baseSha);
    const t1 = readTicket(root, "t1");
    expect(t1.state).toBe("NEEDS_HUMAN");
    expect(t1.notes.map((n) => n.text).join(" ")).toContain("base-branch write detected and reverted");
  });

  it("PRDR-091: a session that checks out the branch it created leaves a WORKING repo", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });

    /**
     * Observed live: a session ran `checkout -b t-102` and stayed there. The
     * guard deleted the ref and stranded HEAD on an unborn branch, so every
     * later git call failed with "ambiguous argument 'HEAD'" and the run died
     * on an unreadable error rather than escalating the breach it had caught.
     */
    const strays: StageFn = (spec) => {
      git(spec.cwd, "checkout", "-q", "-b", "t1");
      writeTree(spec.cwd, { "work.txt": "on the wrong branch\n" });
      return okResult();
    };

    const outcome = await run({
      root,
      backend: new MockBackend({ implement: strays }),
      prompts: PROMPTS,
      runId: "stray-branch",
    });

    /** The breach still escalates — that part always worked. */
    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(readTicket(root, "t1").state).toBe("NEEDS_HUMAN");
    /** And the repository is still usable: HEAD resolves, git answers. */
    expect(() => git(root, "rev-parse", "--abbrev-ref", "HEAD")).not.toThrow();
    expect(git(root, "rev-parse", "--abbrev-ref", "HEAD").trim()).not.toBe("t1");
  });

  it("a session inventing a brand-new branch is also a write — deleted and escalated", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });

    const brancher: StageFn = (spec) => {
      git(spec.cwd, "branch", "backdoor");
      return okResult();
    };
    const outcome = await run({ root, backend: new MockBackend({ implement: brancher }), prompts: PROMPTS, runId: "nb" });

    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(() => git(root, "rev-parse", "--verify", "backdoor")).toThrow();
  });
});

describe("T-042 B-2: worktree mode", () => {
  it("per-ticket worktree merges --no-ff into the RUN branch on DONE — never the base", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    const baseSha = git(root, "rev-parse", "main").trim();

    const outcome = await run({
      root,
      backend: new MockBackend({ implement: implementGreen, review: reviewApprove }),
      prompts: PROMPTS,
      runId: "wt",
      worktree: true,
    });

    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(readTicket(root, "t1").state).toBe("DONE");
    /** The work arrived on the run branch through a merge commit… */
    expect(existsSync(path.join(root, "src/feature-t1.txt"))).toBe(true);
    const merge = git(root, "log", "--merges", "--oneline", "detent/run-wt").trim();
    expect(merge).toContain("merge t1");
    /** …the base is untouched, and the worktree is cleaned up. */
    expect(git(root, "rev-parse", "main").trim()).toBe(baseSha);
    expect(existsSync(worktreePath(root, "t1"))).toBe(false);
  });
});

describe("T-042 B-5: crash recovery resets dirty tracked files", () => {
  it("uncommitted tracked changes at resume are reset; untracked files are judged as-is", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });

    const crash: StageFn = (spec) => {
      /** Mutates a TRACKED file without committing, then dies. */
      writeFileSync(path.join(spec.cwd, "src/calc.py"), "def totals(x):\n    return 0  # sabotage\n");
      throw new Error("crash with dirty tree");
    };
    const script = { implement: crash, review: reviewApprove };
    const first = await run({ root, backend: new MockBackend(script), prompts: PROMPTS, runId: "b5" });
    expect(first.exitCode).toBe(1);
    expect(readFileSync(path.join(root, "src/calc.py"), "utf8")).toContain("sabotage");

    /** Resume: B-5 resets the dirty tracked file before judging the tree. */
    const second = await run({
      root,
      backend: new MockBackend({ review: reviewApprove }),
      prompts: PROMPTS,
      runId: "b5",
    });
    expect(second.exitCode).toBe(EXIT_OK);
    expect(readFileSync(path.join(root, "src/calc.py"), "utf8")).not.toContain("sabotage");
    expect(readTicket(root, "t1").notes.map((n) => n.text).join(" ")).toContain("B-5 resume reset: src/calc.py");
  });
});

describe("T-042 V-5: the run baseline", () => {
  it("resolves the merge-base of the run branch and its base, once per run", async () => {
    const root = await fixture();
    const runBranch = ensureRunBranch(root, "base-test");
    expect(runBranch.base).toBe("main");
    const resolved = resolveBaseRef(root, runBranch);
    expect(resolved).toBe(git(root, "rev-parse", "main").trim());
    /** Re-entering the same run branch recovers the recorded base. */
    const again = ensureRunBranch(root, "ignored");
    expect(again).toEqual(runBranch);
  });

  it("an unresolvable baseline is null — the caller falls back to the root command", async () => {
    const root = await fixture();
    const runBranch = ensureRunBranch(root, "gone");
    git(root, "branch", "-q", "-m", "main", "old-main");
    git(root, "branch", "-q", "-m", "old-main", "renamed-away");
    expect(resolveBaseRef(root, { branch: runBranch.branch, base: "main" })).toBeNull();
  });
});

/**
 * P7′ (PRDR-130) — a git call that could not run is not a git call that found
 * nothing.
 *
 * `git()` ran without an explicit `maxBuffer`, so Node's 1 MB default threw
 * ENOBUFS on any larger output and every wrapper turned the throw into an
 * empty value. One `null` stood for two different facts, and three controls
 * read the wrong one: the reviewer got `""` for a diff (under the truncation
 * cap, so the banner never fired), `changedFiles` returned empty so B-4 minted
 * no risk label, and `snapshotRefs` returned an empty map, after which the
 * base-branch guard treated EVERY local branch as newly created and deleted it.
 */
describe("P7′ git output over 1 MB, and failure that is not absence", () => {
  function repoWithLargeCommit(): { root: string; sha: string } {
    const root = mkdtempSync(path.join(tmpdir(), "detent-big-"));
    roots.push(root);
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.email", "t@t");
    git(root, "config", "user.name", "t");
    writeTree(root, { "seed.txt": "seed\n" });
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "init");
    /* Comfortably over Node's 1 MB execFileSync default — a lockfile's size. */
    writeTree(root, { "big.txt": `${"lorem ipsum dolor sit amet\n".repeat(60_000)}` });
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "big");
    return { root, sha: git(root, "rev-parse", "HEAD").trim() };
  }

  it("a commit larger than 1 MB reaches the reviewer as a real diff, not as an empty string", () => {
    const { root, sha } = repoWithLargeCommit();
    const patch = commitPatch(root, sha, []);
    expect(patch.length).toBeGreaterThan(1_000_000);
    expect(patch).toContain("big.txt");
  });

  /* Guard, not a reproduction: `--name-only` output stays small, so this call was never the one overflowing. */
  it("changedFiles still answers for a commit that size — the fix does not over-correct", () => {
    const { root } = repoWithLargeCommit();
    expect(changedFiles(root, "HEAD~1")).toContain("big.txt");
  });

  /**
   * The only unrecoverable path in the set. `snapshotRefs` returned an empty
   * map when its single `for-each-ref` could not run, and `enforceBaseGuard`'s
   * "a brand-new non-run branch is also a write" loop then matched every
   * branch and ran `update-ref -d` on each — `main` included.
   */
  it("a snapshot that could not be TAKEN raises, so the base guard never mistakes it for a repo with no branches", () => {
    expect(() => snapshotRefs(path.join(tmpdir(), "detent-does-not-exist-xyz"))).toThrow();
  });

  it("a git call that RAN and answered non-zero is still tolerated — a root commit has no parent", () => {
    const root = mkdtempSync(path.join(tmpdir(), "detent-root-"));
    roots.push(root);
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.email", "t@t");
    git(root, "config", "user.name", "t");
    writeTree(root, { "a.txt": "1\n" });
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "root");
    /* `diff <sha>^ <sha>` exits non-zero here; `show` answers instead. */
    expect(commitPatch(root, git(root, "rev-parse", "HEAD").trim(), [])).toContain("a.txt");
  });
});

/**
 * B-1′ (PRDR-146) — the trailer hook preserves what it finds.
 *
 * `installTrailerHook` wrote `prepare-commit-msg` unconditionally at the start
 * of every run, destroying an operator's commit linting, signing or
 * issue-tracker hook with nothing said and nothing kept.
 */
describe("B-1′ installTrailerHook does not destroy a hook the operator already had", () => {
  function bareRepo(): string {
    const root = mkdtempSync(path.join(tmpdir(), "detent-hook-"));
    roots.push(root);
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.email", "t@t");
    git(root, "config", "user.name", "t");
    writeTree(root, { "a.txt": "1\n" });
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "init");
    return root;
  }
  const hookPath = (root: string): string =>
    path.resolve(root, git(root, "rev-parse", "--git-common-dir").trim(), "hooks", "prepare-commit-msg");

  it("a foreign hook is moved aside, recoverable, and the caller is told where", () => {
    const root = bareRepo();
    const theirs = "#!/bin/sh\n# the operator's own commit linter\nexit 0\n";
    const hook = hookPath(root);
    mkdirSync(path.dirname(hook), { recursive: true });
    writeFileSync(hook, theirs);

    const preserved = installTrailerHook(root);
    expect(preserved, "a foreign hook must be reported, not silently replaced").not.toBeNull();
    expect(readFileSync(preserved as string, "utf8")).toBe(theirs);
    /* And Detent's own hook is in place. */
    expect(readFileSync(hook, "utf8")).toContain("Detent-Ticket");
  });

  it("re-installing over Detent's own hook is idempotent — no backup accumulates", () => {
    const root = bareRepo();
    expect(installTrailerHook(root)).toBeNull();
    expect(installTrailerHook(root)).toBeNull();
    expect(installTrailerHook(root)).toBeNull();
    expect(existsSync(`${hookPath(root)}.before-detent`)).toBe(false);
  });

  it("a second foreign hook does not overwrite the first rescue — the original survives", () => {
    const root = bareRepo();
    const hook = hookPath(root);
    mkdirSync(path.dirname(hook), { recursive: true });
    writeFileSync(hook, "#!/bin/sh\n# original\n");
    const first = installTrailerHook(root) as string;
    writeFileSync(hook, "#!/bin/sh\n# a later foreign hook\n");
    const second = installTrailerHook(root) as string;
    expect(second).not.toBe(first);
    expect(readFileSync(first, "utf8")).toContain("# original");
  });
});

/**
 * B-2′ (PRDR-145a) — a worktree merge that conflicts is an outcome.
 *
 * `mergeWorktree` ran `git merge --no-ff` unguarded and then removed the
 * worktree and deleted the branch unconditionally, so two tickets touching one
 * file left a ticket DONE with its work unmerged, an orphaned worktree and a
 * stale branch — surfacing as exit 1 from an unclassified throw. Nothing
 * enforces surface disjointness, so ordinary planning reaches this.
 */
describe("B-2′ a conflicting worktree merge keeps the work and says so", () => {
  it("raises WorktreeConflictError, leaves the branch and worktree, and does not move the run branch", () => {
    const root = mkdtempSync(path.join(tmpdir(), "detent-wt-"));
    roots.push(root);
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.email", "t@t");
    git(root, "config", "user.name", "t");
    writeTree(root, { "shared.txt": "base\n" });
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "base");

    /* The ticket's worktree edits the file one way... */
    const wt = ensureWorktree(root, "t1");
    writeTree(wt, { "shared.txt": "from the ticket\n" });
    git(wt, "add", "-A");
    git(wt, "commit", "-q", "-m", "t1: work");
    /* ...and the run branch edits it another. */
    writeTree(root, { "shared.txt": "from the run branch\n" });
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "run branch work");
    const before = git(root, "rev-parse", "HEAD").trim();

    let thrown: unknown = null;
    try {
      mergeWorktree(root, "t1");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(WorktreeConflictError);
    expect((thrown as WorktreeConflictError).conflicts).toContain("shared.txt");
    /* The work survives for a human: branch kept, worktree kept, run branch unmoved. */
    expect(git(root, "rev-parse", "HEAD").trim()).toBe(before);
    expect(git(root, "branch", "--list", "ticket/t1").trim()).not.toBe("");
    expect(existsSync(wt)).toBe(true);
    /* And the tree is not left mid-merge. */
    expect(existsSync(path.join(root, ".git", "MERGE_HEAD"))).toBe(false);
  });

  it("a clean merge still removes the worktree and deletes the branch", () => {
    const root = mkdtempSync(path.join(tmpdir(), "detent-wt-ok-"));
    roots.push(root);
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.email", "t@t");
    git(root, "config", "user.name", "t");
    writeTree(root, { "a.txt": "base\n" });
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "base");
    const wt = ensureWorktree(root, "t2");
    writeTree(wt, { "b.txt": "new\n" });
    git(wt, "add", "-A");
    git(wt, "commit", "-q", "-m", "t2: work");

    expect(() => mergeWorktree(root, "t2")).not.toThrow();
    expect(existsSync(wt)).toBe(false);
    expect(git(root, "branch", "--list", "ticket/t2").trim()).toBe("");
    expect(existsSync(path.join(root, "b.txt"))).toBe(true);
  });
});
