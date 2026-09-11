import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Ecosystem } from "../../src/adapter/install.js";
import { EXIT_OK, run } from "../../src/kernel/run.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { guardToolUse, toolsForRole } from "../../src/sessions/guard.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { git } from "../helpers.js";
import { addTicket, implementGreen, makeRunRepo, reviewApprove } from "./run-fixture.js";

/**
 * V-1⁗ (PRDR-211), end to end through `run`: a ticket whose gate can only be
 * green once the manifest's dependencies are installed reaches DONE, the
 * install is on the record, the install's directory never reaches the branch,
 * and the session's own Bash still cannot run a package manager.
 */

const FAKE: Ecosystem = {
  name: "fake",
  manifest: "package.json",
  lockfile: "package-lock.json",
  dir: "node_modules",
  stamp: path.join("node_modules", ".installed"),
  install: "mkdir -p node_modules && touch node_modules/.installed && echo installed",
};

async function fixture(): Promise<string> {
  const { root } = await makeRunRepo();
  /* A manifest, and a gate that is green only once something has installed it. */
  writeFileSync(path.join(root, "package.json"), '{"name":"fixture","private":true}\n');
  writeFileSync(path.join(root, "scripts/test.sh"), "#!/bin/sh\ntest -f node_modules/.installed\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "manifest");
  return root;
}

describe("V-1⁗ the referee installs the manifest's dependencies before the gate", () => {
  it("a ticket whose gate needs the install reaches DONE, with the install on the record and off the branch", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    const backend = new MockBackend({ implement: implementGreen, review: reviewApprove });
    const outcome = await run({ root, backend, prompts: loadPromptSet(), runId: "test", ecosystems: [FAKE] });

    /* Before PRDR-211: nothing installs, the gate is red for want of the mark, and t1 never reaches DONE. */
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(readTicket(root, "t1").state).toBe("DONE");

    const journal = readFileSync(path.join(root, ".detent/runs/t1/journal.jsonl"), "utf8");
    const installs = journal.split("\n").filter((l) => l.includes('"event":"install"'));
    expect(installs.length, "installed once, and not again while the mark was fresh").toBe(1);
    expect(installs[0]).toContain('"ok":true');

    const branch = git(root, "branch", "--list", "detent/run-*").trim().replace(/^\*?\s*/, "");
    const tree = git(root, "ls-tree", "-r", "--name-only", branch);
    expect(tree, "the install's directory is not part of the change set").not.toContain("node_modules");
    expect(tree).toContain("src/feature-t1.txt");
  });

  it("the session's own Bash still cannot run a package manager (S-3, S-2‴)", () => {
    /* S-3⁵ (PRDR-213): three verbs, still no package manager. */
    expect(toolsForRole("implement")).toEqual(["Read", "Grep", "Glob", "Edit", "Write", "Bash(git add:*)", "Bash(git rm:*)", "Bash(git commit:*)"]);
    const decision = guardToolUse("Bash", { command: "npm install" }, { surface: ["**"], protectedGlobs: [], workRoot: "/wt" });
    expect(decision.decision, "abstains — the allowlist decides, and npm is not on it").toBe("abstain");
  });

  it("an install that fails is a red gate carrying the install's tail, not a crash", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    const broken: Ecosystem = { ...FAKE, install: "echo 'registry unreachable' >&2; exit 3" };
    const backend = new MockBackend({ implement: implementGreen, review: reviewApprove });
    const outcome = await run({ root, backend, prompts: loadPromptSet(), runId: "test", ecosystems: [broken] });
    expect(outcome.exitCode).not.toBe(EXIT_OK);
    expect(readTicket(root, "t1").state).not.toBe("DONE");
    const failure = path.join(root, ".detent/runs/t1/last_failure.json");
    expect(existsSync(failure)).toBe(true);
    expect(readFileSync(failure, "utf8")).toContain("registry unreachable");
  });
});

/**
 * Second audit of PRDR-211, from the gate: the install that mattered was not on
 * the record. The blind-fix session fixed the manifest, its Stop hook installed
 * in the worktree so the scoped gate could run, and the referee then found the
 * mark fresh and journaled nothing — the bootstrap's journal shows one failed
 * install and no successful one, under a gate that went green. The Stop hook
 * cannot journal (the run holds the journal, single-writer); the referee can
 * say what it found.
 */
describe("audit of PRDR-211: an install the session's Stop hook made is on the record", () => {
  it("a fresh mark the referee did not write is journaled once as an install made during the session", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    /* The Stop hook installs during the session, in the session's work directory; the mark is there before the referee looks. */
    const backend = new MockBackend({
      implement: (spec) => {
        mkdirSync(path.join(spec.cwd, "node_modules"), { recursive: true });
        writeFileSync(path.join(spec.cwd, "node_modules", ".installed"), "2026-09-11T06:13:00.000Z\n");
        return implementGreen(spec);
      },
      review: reviewApprove,
    });
    const outcome = await run({ root, backend, prompts: loadPromptSet(), runId: "test", ecosystems: [FAKE] });
    expect(outcome.exitCode).toBe(EXIT_OK);
    const journal = readFileSync(path.join(root, ".detent/runs/t1/journal.jsonl"), "utf8");
    const installs = journal.split("\n").filter((l) => l.includes('"event":"install"'));
    /* Before: the referee found the mark fresh, installed nothing, and wrote nothing — a green gate with no install on the record. */
    expect(installs, "once, for the mark the session's hook wrote — not once per gate evaluation").toHaveLength(1);
    expect(installs[0]).toContain('"by":"session"');
    expect(installs[0]).toContain("2026-09-11T06:13:00.000Z");
  });
});

/**
 * PRDR-216 — the exclusion git refuses to hear.
 *
 * gate-313's bootstrap, generation 2: DONE at 07:51:06, dead one second later.
 * Its own scaffold had written `node_modules/` into `.gitignore`, the referee's
 * install had created the directory, and `git add -A -- . :!node_modules`
 * exited 1 with "The following paths are ignored by one of your .gitignore
 * files" — git refuses a pathspec naming an ignored path even as an EXCLUSION.
 * The fixture above has no `.gitignore`, which is why V-1⁗'s proof passed.
 */
describe("PRDR-216 finalize survives a project that ignores its install directory", () => {
  async function ignoringFixture(): Promise<string> {
    const root = await fixture();
    writeFileSync(path.join(root, ".gitignore"), ".fail\n.flake\nnode_modules/\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "ignore the install directory");
    return root;
  }

  it("reaches DONE with exit 0; the run branch carries the feature and never the install directory", async () => {
    const root = await ignoringFixture();
    addTicket(root, { id: "t1" });
    const backend = new MockBackend({ implement: implementGreen, review: reviewApprove });
    const outcome = await run({ root, backend, prompts: loadPromptSet(), runId: "test", ecosystems: [FAKE] });
    /* Before: exit 1 — `git add -A -- . :!node_modules` refused, the ticket already DONE. */
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(readTicket(root, "t1").state).toBe("DONE");
    const tree = git(root, "ls-tree", "-r", "--name-only", "HEAD");
    expect(tree).toContain("src/feature-t1.txt");
    expect(tree).not.toContain("node_modules");
  });

  it("and in worktree mode, the default — where the gate found it", async () => {
    const root = await ignoringFixture();
    addTicket(root, { id: "t1" });
    const backend = new MockBackend({ implement: implementGreen, review: reviewApprove });
    const outcome = await run({ root, backend, prompts: loadPromptSet(), runId: "test", ecosystems: [FAKE], worktree: true });
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(readTicket(root, "t1").state).toBe("DONE");
    const tree = git(root, "ls-tree", "-r", "--name-only", "HEAD");
    expect(tree).toContain("src/feature-t1.txt");
    expect(tree).not.toContain("node_modules");
  }, 60_000);
});
