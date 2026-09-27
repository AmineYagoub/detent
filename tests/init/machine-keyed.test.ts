import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { contentsDigest, listingDigest, runInit, type PhaseHandler } from "../../src/init/machine.js";
import type { INIT_PHASES } from "../../src/schemas/init.js";
import { newTicket, writeTicket } from "../../src/kernel/tickets/mutations.js";
import { git, gitInit, removeTree, tmpTree } from "../helpers.js";

/**
 * PRDR-282 — a phase keyed after it runs (C-2¹²), and interrupts raised only
 * where `INTERRUPT_PHASE` lists (C-5).
 *
 * DECIDE writes the decision log, and its digest reads the log. Keyed by the
 * digest taken before it ran, its own write moved its key, so every `init`
 * after it re-ran DECIDE and replayed every phase after DECIDE. Keyed by the
 * digest taken after, the next `init` finds it where it left it, and an edit
 * anyone else makes to the log re-runs it. These drive the machine with
 * recording handlers, so what they see is the machine alone.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

function repo(): string {
  const root = tmpTree({ "seed.txt": "seed\n", "log.md": "# log\n" });
  roots.push(root);
  gitInit(root);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

type Phase = (typeof INIT_PHASES)[number];

function probe(phase: Phase, log: string[]): PhaseHandler {
  return {
    phase,
    digest: () => listingDigest([phase]),
    run: async () => {
      log.push(phase);
      return { kind: "complete", outputs: { ran: phase } };
    },
  };
}

/** A DECIDE that adds a row to the file its digest reads, each time it runs. */
function writer(root: string, log: string[]): PhaseHandler {
  return {
    phase: "DECIDE",
    keyedAfterRun: true,
    digest: () => contentsDigest(root, ["log.md"]),
    run: async () => {
      log.push("DECIDE");
      appendFileSync(path.join(root, "log.md"), `| X-${String(log.filter((p) => p === "DECIDE").length)} | a default |\n`);
      return { kind: "complete", outputs: {} };
    },
  };
}

const pipeline = (root: string, log: string[], decide: PhaseHandler = writer(root, log)): PhaseHandler[] => [
  probe("INIT_FS", log),
  probe("DISCOVER", log),
  decide,
  probe("SLICE", log),
  probe("PLAN", log),
];

describe("PRDR-282: a phase keyed after it runs (C-2¹²)", () => {
  it("is reused on the next init though it wrote what its digest reads, and so is every phase after it", async () => {
    const root = repo();
    const log: string[] = [];
    await runInit(root, pipeline(root, log));
    expect(log).toEqual(["INIT_FS", "DISCOVER", "DECIDE", "SLICE", "PLAN"]);

    log.length = 0;
    const again = await runInit(root, pipeline(root, log));
    expect(log, "its own write re-ran nothing").toEqual([]);
    expect(again.reused).toEqual(["INIT_FS", "DISCOVER", "DECIDE", "SLICE", "PLAN"]);
  });

  it("re-runs, and replays what follows, when anyone else edits what its digest reads", async () => {
    const root = repo();
    const log: string[] = [];
    await runInit(root, pipeline(root, log));

    log.length = 0;
    appendFileSync(path.join(root, "log.md"), "a veto\n");
    const vetoed = await runInit(root, pipeline(root, log));
    expect(log).toEqual(["DECIDE", "SLICE", "PLAN"]);
    expect(vetoed.replayedFrom).toBe("DECIDE");
    expect(vetoed.reused).toEqual(["INIT_FS", "DISCOVER"]);

    log.length = 0;
    await runInit(root, pipeline(root, log));
    expect(log, "and the run after the veto finds it where it left it").toEqual([]);
  });

  it("without the flag is keyed before it runs, as every other phase is, and its own write re-runs it", async () => {
    const root = repo();
    const log: string[] = [];
    const unkeyed: PhaseHandler = { ...writer(root, log), keyedAfterRun: false };
    await runInit(root, pipeline(root, log, unkeyed));

    log.length = 0;
    await runInit(root, pipeline(root, log, unkeyed));
    expect(log, "the defect this flag exists for: its own write re-ran it and everything after it").toEqual(["DECIDE", "SLICE", "PLAN"]);
  });
});

describe("PRDR-282: an interrupt is raised only where INTERRUPT_PHASE lists it (C-5)", () => {
  const asking = (phase: Phase): PhaseHandler => ({
    phase,
    digest: () => listingDigest([phase]),
    run: async () => ({ kind: "interrupt", interrupt: "AWAIT_INFO", message: "2 questions", items: ["a", "b"] }),
  });

  it("refuses AWAIT_INFO from a phase it does not list, as a defect in the build", async () => {
    const root = repo();
    const log: string[] = [];
    await expect(runInit(root, [probe("INIT_FS", log), asking("SLICE")])).rejects.toThrow(
      "SLICE raised AWAIT_INFO, which INTERRUPT_PHASE does not let it raise (C-5)",
    );
  });

  it("stops at DECIDE for AWAIT_INFO, checkpoints nothing for it, and adds PRDR-166's note to PRESENT's alone", async () => {
    const root = repo();
    const log: string[] = [];
    const handlers = (): PhaseHandler[] => [probe("INIT_FS", log), probe("DISCOVER", log), asking("DECIDE")];
    const first = await runInit(root, handlers());
    expect(first.reachedPhase).toBe("DECIDE");
    expect(first.interrupt?.interrupt).toBe("AWAIT_INFO");
    expect(existsSync(path.join(stateDir(root), "state", "DECIDE.json"))).toBe(false);

    const again = await runInit(root, handlers());
    expect(again.reused).toContain("DISCOVER");
    expect(again.interrupt?.message, "DECIDE reads the log itself, so DISCOVER's reuse says nothing about an answer").toBe("2 questions");
  });

  it("still says so at PRESENT when DISCOVER was reused (PRDR-166)", async () => {
    const root = repo();
    const log: string[] = [];
    writeFileSync(path.join(root, "PRD.md"), "# v1\n");
    const handlers = (): PhaseHandler[] => [probe("INIT_FS", log), probe("DISCOVER", log), asking("PRESENT")];
    await runInit(root, handlers());
    const again = await runInit(root, handlers());
    expect(again.interrupt?.message).toContain("The document set is unchanged");
  });
});

/**
 * PRDR-282 — C-8″'s second ask. A standalone phase runs before the planning
 * phases and can change what they read, which the scan before the run cannot
 * see: here DECIDE re-runs for a reason of its own and writes the file
 * SLICE's digest reads.
 */
describe("PRDR-282: a re-plan a standalone phase starts is refused while a ticket is in flight (C-8″)", () => {
  function handlers(root: string, log: string[], trigger: { value: string }): PhaseHandler[] {
    return [
      probe("INIT_FS", log),
      probe("DISCOVER", log),
      { ...writer(root, log), standalone: true, digest: () => listingDigest([trigger.value]) },
      { ...probe("SLICE", log), digest: () => contentsDigest(root, ["log.md"]) },
      probe("PLAN", log),
    ];
  }

  it("stops before the first phase on the chain that would run, and says what ran before it", async () => {
    const root = repo();
    const log: string[] = [];
    const trigger = { value: "a" };
    await runInit(root, handlers(root, log, trigger));
    writeTicket(root, { ...newTicket({ id: "t-1", type: "feature", title: "t", acceptance_criteria: ["a"], surface: ["src/**"] }), state: "IN_PROGRESS" });

    log.length = 0;
    trigger.value = "b";
    const refused = await runInit(root, handlers(root, log, trigger));
    expect(refused.exitCode).toBe(2);
    expect(refused.messages.join(" ")).toContain("re-planning refused: t-1 (IN_PROGRESS) still in flight");
    expect(refused.reachedPhase).toBe("SLICE");
    expect(refused.executed).toEqual(["DECIDE"]);
    expect(log, "nothing on the chain ran").toEqual(["DECIDE"]);
  });

  it("lets it through when nothing is in flight", async () => {
    const root = repo();
    const log: string[] = [];
    const trigger = { value: "a" };
    await runInit(root, handlers(root, log, trigger));
    log.length = 0;
    trigger.value = "b";
    const result = await runInit(root, handlers(root, log, trigger));
    expect(result.exitCode).toBe(0);
    expect(log).toEqual(["DECIDE", "SLICE", "PLAN"]);
  });
});
