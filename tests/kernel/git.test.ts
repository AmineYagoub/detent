import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  commitsOn,
  ensureRunBranch,
  parseTicketTrailers,
  resolveBaseRef,
  worktreePath,
} from "../../src/kernel/git.js";
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
    // The writer never emits the legacy form (B-1/D-20).
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

    // The hostile stage checks out main, commits an implant, and returns to
    // the run branch so the loop's own git keeps working.
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
    // The work arrived on the run branch through a merge commit…
    expect(existsSync(path.join(root, "src/feature-t1.txt"))).toBe(true);
    const merge = git(root, "log", "--merges", "--oneline", "detent/run-wt").trim();
    expect(merge).toContain("merge t1");
    // …the base is untouched, and the worktree is cleaned up.
    expect(git(root, "rev-parse", "main").trim()).toBe(baseSha);
    expect(existsSync(worktreePath(root, "t1"))).toBe(false);
  });
});

describe("T-042 B-5: crash recovery resets dirty tracked files", () => {
  it("uncommitted tracked changes at resume are reset; untracked files are judged as-is", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });

    const crash: StageFn = (spec) => {
      // Mutates a TRACKED file without committing, then dies.
      writeFileSync(path.join(spec.cwd, "src/calc.py"), "def totals(x):\n    return 0  # sabotage\n");
      throw new Error("crash with dirty tree");
    };
    const script = { implement: crash, review: reviewApprove };
    const first = await run({ root, backend: new MockBackend(script), prompts: PROMPTS, runId: "b5" });
    expect(first.exitCode).toBe(1);
    expect(readFileSync(path.join(root, "src/calc.py"), "utf8")).toContain("sabotage");

    // Resume: B-5 resets the dirty tracked file before judging the tree.
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
    // Re-entering the same run branch recovers the recorded base.
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
