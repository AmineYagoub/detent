import { afterEach, describe, expect, it } from "vitest";
import { listingDigest, runInit, type PhaseHandler } from "../../src/init/machine.js";
import { newTicket, writeTicket } from "../../src/kernel/tickets/mutations.js";
import type { INIT_PHASES } from "../../src/schemas/init.js";
import { git, gitInit, removeTree, tmpTree, writeTree } from "../helpers.js";

/**
 * PRDR-281 — a standalone phase (C-2¹¹).
 *
 * AUDIT's checkpoint is keyed by its own digest alone. The chain would have
 * re-run it for every answer DECIDE writes, since the decision log moves
 * DISCOVER's listing, and would have re-planned the product for every edit to
 * the code, which AUDIT's key covers and no phase after it reads. These drive
 * the machine with recording handlers, so what they see is the machine alone.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

function repo(): string {
  const root = tmpTree({ "seed.txt": "seed\n" });
  roots.push(root);
  gitInit(root);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

type Phase = (typeof INIT_PHASES)[number];

/** Digests the test moves by hand, and a log of what ran. */
function pipeline(digests: Record<string, string>, log: string[]): PhaseHandler[] {
  const probe = (phase: Phase, standalone = false): PhaseHandler => ({
    phase,
    ...(standalone ? { standalone } : {}),
    digest: () => listingDigest([digests[phase] ?? ""]),
    run: async () => {
      log.push(phase);
      return { kind: "complete", outputs: { ran: phase } };
    },
  });
  return [probe("INIT_FS"), probe("DISCOVER"), probe("AUDIT", true), probe("ANALYZE"), probe("PLAN")];
}

describe("PRDR-281: a standalone phase stands outside the chain", () => {
  it("is looked up by its own key while the phases before it replay", async () => {
    const root = repo();
    const digests: Record<string, string> = { DISCOVER: "PRD.md", AUDIT: "a" };
    const log: string[] = [];
    await runInit(root, pipeline(digests, log));
    expect(log).toEqual(["INIT_FS", "DISCOVER", "AUDIT", "ANALYZE", "PLAN"]);

    log.length = 0;
    digests["DISCOVER"] = "PRD.md docs/founder-decisions.md";
    const again = await runInit(root, pipeline(digests, log));
    expect(log, "everything after DISCOVER replays, AUDIT aside").toEqual(["DISCOVER", "ANALYZE", "PLAN"]);
    expect(again.reused).toEqual(["INIT_FS", "AUDIT"]);
    expect(again.replayedFrom).toBe("DISCOVER");
  });

  it("replays nothing after it when it runs", async () => {
    const root = repo();
    const digests: Record<string, string> = { DISCOVER: "PRD.md", AUDIT: "a" };
    const log: string[] = [];
    await runInit(root, pipeline(digests, log));

    log.length = 0;
    digests["AUDIT"] = "b";
    const again = await runInit(root, pipeline(digests, log));
    expect(log).toEqual(["AUDIT"]);
    expect(again.reused).toEqual(["INIT_FS", "DISCOVER", "ANALYZE", "PLAN"]);
    expect(again.replayedFrom, "the first phase that had to run").toBe("AUDIT");

    log.length = 0;
    digests["AUDIT"] = "c";
    digests["ANALYZE"] = "edited";
    const both = await runInit(root, pipeline(digests, log));
    expect(log).toEqual(["AUDIT", "ANALYZE", "PLAN"]);
    expect(both.replayedFrom, "still the first, though the chain replays from ANALYZE").toBe("AUDIT");

    log.length = 0;
    digests["AUDIT"] = "d";
    const replan = await runInit(root, pipeline(digests, log), { replan: true });
    expect(log).toEqual(["AUDIT", "ANALYZE", "PLAN"]);
    expect(replan.replayedFrom, "a forced replay does not rename the first").toBe("AUDIT");
  });

  it("is not forced by --replan, which enters after it (C-8⁵)", async () => {
    const root = repo();
    const digests: Record<string, string> = { DISCOVER: "PRD.md", AUDIT: "a" };
    const log: string[] = [];
    await runInit(root, pipeline(digests, log));
    log.length = 0;
    const replan = await runInit(root, pipeline(digests, log), { replan: true });
    expect(log).toEqual(["ANALYZE", "PLAN"]);
    expect(replan.reused).toEqual(["INIT_FS", "DISCOVER", "AUDIT"]);
  });

  it("is not a re-plan, so a ticket in flight does not refuse it (C-8″)", async () => {
    const root = repo();
    const digests: Record<string, string> = { DISCOVER: "PRD.md", AUDIT: "a" };
    const log: string[] = [];
    await runInit(root, pipeline(digests, log));
    writeTicket(root, {
      ...newTicket({ id: "t-1", type: "feature", title: "t", acceptance_criteria: ["a"], surface: ["src/**"] }),
      state: "IN_PROGRESS",
    });

    log.length = 0;
    digests["AUDIT"] = "b";
    const again = await runInit(root, pipeline(digests, log));
    expect(again.exitCode).toBe(0);
    expect(log).toEqual(["AUDIT"]);

    digests["DISCOVER"] = "PRD.md SRS.md";
    writeTree(root, { "SRS.md": "# also\n" });
    const replan = await runInit(root, pipeline(digests, log));
    expect(replan.exitCode, "a phase on the chain still is").toBe(2);
    expect(replan.messages.join(" ")).toContain("t-1 (IN_PROGRESS)");
  });
});
