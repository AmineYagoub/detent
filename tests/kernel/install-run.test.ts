import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
    expect(toolsForRole("implement")).toEqual(["Read", "Grep", "Glob", "Edit", "Write", "Bash(git add:*)", "Bash(git commit:*)"]);
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
