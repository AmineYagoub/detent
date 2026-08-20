import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { ensureRunBranch, installTrailerHook } from "../../src/kernel/git.js";
import { RunJournal } from "../../src/kernel/journal.js";
import { RefereeCore } from "../../src/kernel/referee.js";
import { loadConfig } from "../../src/kernel/worstcase.js";
import { MockBackend, okResult } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { git, removeTree, writeTree } from "../helpers.js";
import { addTicket, makeRunRepo, writeArtifactStage } from "../kernel/run-fixture.js";

/**
 * T-140 — the reviewer judges the TICKET's diff, from the claim base (the
 * eleventh live firing watched a reviewer accurately call 1200 committed
 * lines an empty diff, because its basis was `git diff HEAD` and the
 * implement session had committed). The claim base is recorded at first
 * acquire and survives resumes, so review always spans the whole ticket.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

describe("T-140 review diff spans committed work from the claim base", () => {
  it("a committed implement change reaches the reviewer's diff input", { timeout: 60_000 }, async () => {
    const repo = await makeRunRepo();
    cleanups.push(() => removeTree(repo.root));
    addTicket(repo.root, { id: "t-1" });

    const backend = new MockBackend({
      implement: (spec) => {
        writeTree(spec.cwd, { "src/committed-marker.ts": "export const built = true;\n" });
        git(spec.cwd, "add", "-A");
        git(spec.cwd, "commit", "-q", "-m", "t-1: implement");
        /*
         * PRDR-069: an interleaved ticket's finalize lands ABOVE the claim
         * base whenever a stopped run resumes — outside t-1's surface, so
         * the surface-scoped review basis must exclude it.
         */
        writeTree(spec.cwd, { "docs/foreign-ticket-work.md": "another ticket's finalize\n" });
        git(spec.cwd, "add", "-A");
        git(spec.cwd, "commit", "-q", "-m", "t-9: foreign finalize");
        return okResult();
      },
      review: writeArtifactStage({ schema_version: 1, verdict: "approve" }),
    });
    const loaded = loadConfig(JSON.parse(readFileSync(path.join(stateDir(repo.root), "config.json"), "utf8")));
    const journal = RunJournal.open(repo.root);
    cleanups.push(() => journal.close());
    const core = new RefereeCore(
      { root: repo.root, backend, prompts: loadPromptSet() },
      loaded,
      journal,
      ensureRunBranch(repo.root, "diff-base"),
    );
    installTrailerHook(repo.root);

    expect(core.acquire("t-1").ok).toBe(true);
    await core.attempt("t-1", "IN_PROGRESS");
    await core.recordStage("t-1", "review");

    const reviewCall = backend.calls.find((c) => c.role === "review");
    expect(reviewCall).toBeDefined();
    const inputs = (JSON.parse(reviewCall!.spec.promptVariable) as { inputs: { diff: string } }).inputs;
    expect(inputs.diff).toContain("committed-marker");
    /* PRDR-069: the basis spans the claim base but stays inside the surface. */
    expect(inputs.diff).not.toContain("foreign-ticket-work");
  });
});
