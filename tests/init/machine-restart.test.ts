import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { contentsDigest, listingDigest, runInit, type PhaseHandler } from "../../src/init/machine.js";
import type { INIT_PHASES } from "../../src/schemas/init.js";
import { newTicket, writeTicket } from "../../src/kernel/tickets/mutations.js";
import { git, gitInit, removeTree, tmpTree } from "../helpers.js";

/**
 * PRDR-283 — a phase that restarts the chain (C-2¹³).
 *
 * WRITE moves the originals it rewrote out of every discovery glob, so the
 * next `init` finds a different listing at DISCOVER and re-runs it. On C-8's
 * chain that re-run replayed every phase after DISCOVER, and so re-planned the
 * product that WRITE's own move had not changed. WRITE restarts the chain: its
 * key is the pack it leaves, and the phases after it chain from that key. These
 * drive the machine with recording handlers, so what they see is the machine
 * alone.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

function repo(): string {
  const root = tmpTree({ "docs/raw.md": "# the original\n", "seed.txt": "seed\n" });
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

/** DISCOVER lists `docs/`, as the real one lists the documents. */
function discover(root: string, log: string[]): PhaseHandler {
  return { ...probe("DISCOVER", log), digest: () => listingDigest(readdirSync(path.join(root, "docs"))) };
}

/** A WRITE that turns `docs/raw.md` into `docs/pack.md`, archiving the original, and is keyed by the pack it leaves. */
function writer(root: string, log: string[], restarts: boolean): PhaseHandler {
  return {
    phase: "WRITE",
    keyedAfterRun: true,
    ...(restarts ? { restartsChain: true } : {}),
    digest: () => contentsDigest(root, ["docs/pack.md"]),
    run: async () => {
      log.push("WRITE");
      const raw = path.join(root, "docs", "raw.md");
      if (existsSync(raw)) {
        writeFileSync(path.join(root, "docs", "pack.md"), "# the pack\n");
        mkdirSync(path.join(root, "archive"), { recursive: true });
        renameSync(raw, path.join(root, "archive", "raw.md"));
      }
      return { kind: "complete", outputs: {} };
    },
  };
}

const pipeline = (root: string, log: string[], restarts = true): PhaseHandler[] => [
  probe("INIT_FS", log),
  discover(root, log),
  writer(root, log, restarts),
  probe("DETERMINE_VERIFICATION", log),
  probe("PLAN", log),
];

describe("PRDR-283: a phase that restarts the chain (C-2¹³)", () => {
  it("is looked up while an earlier phase replays, and the phases after it are reused when its key stands", async () => {
    const root = repo();
    const log: string[] = [];
    await runInit(root, pipeline(root, log));
    expect(log).toEqual(["INIT_FS", "DISCOVER", "WRITE", "DETERMINE_VERIFICATION", "PLAN"]);

    log.length = 0;
    const again = await runInit(root, pipeline(root, log));
    expect(log, "DISCOVER finds the pack where the original was, and nothing re-plans").toEqual(["DISCOVER"]);
    expect(again.reused).toEqual(["INIT_FS", "WRITE", "DETERMINE_VERIFICATION", "PLAN"]);
    expect(again.replayedFrom).toBe("DISCOVER");
  });

  it("without the flag, DISCOVER's re-run replays it and every phase after it", async () => {
    const root = repo();
    const log: string[] = [];
    await runInit(root, pipeline(root, log, false));
    log.length = 0;
    await runInit(root, pipeline(root, log, false));
    expect(log, "the defect this flag exists for: the move re-planned the product").toEqual(["DISCOVER", "WRITE", "DETERMINE_VERIFICATION", "PLAN"]);
  });

  it("re-runs when its checkpoint is gone, and the phases after it are reused when the key it leaves is the one they chained from", async () => {
    const root = repo();
    const log: string[] = [];
    await runInit(root, pipeline(root, log));
    rmSync(path.join(stateDir(root), "state", "WRITE.json"));
    log.length = 0;
    await runInit(root, pipeline(root, log));
    expect(log).toEqual(["DISCOVER", "WRITE"]);
  });

  it("replays every phase after it when the pack it keys by is edited", async () => {
    const root = repo();
    const log: string[] = [];
    await runInit(root, pipeline(root, log));
    await runInit(root, pipeline(root, log));
    writeFileSync(path.join(root, "docs", "pack.md"), "# the pack, edited\n");
    log.length = 0;
    const edited = await runInit(root, pipeline(root, log));
    expect(log).toEqual(["WRITE", "DETERMINE_VERIFICATION", "PLAN"]);
    expect(edited.replayedFrom).toBe("WRITE");
  });

  it("leaves a --replan to re-derive from DETERMINE_VERIFICATION, which comes after it (C-8′)", async () => {
    const root = repo();
    const log: string[] = [];
    await runInit(root, pipeline(root, log));
    await runInit(root, pipeline(root, log));
    log.length = 0;
    const replanned = await runInit(root, pipeline(root, log), { replan: true });
    expect(log).toEqual(["DETERMINE_VERIFICATION", "PLAN"]);
    expect(replanned.reused).toEqual(["INIT_FS", "DISCOVER", "WRITE"]);
  });

  it("asks again before it runs, when a phase off the chain moved what it reads since the scan (C-8″)", async () => {
    const root = repo();
    const log: string[] = [];
    const decide: PhaseHandler = {
      phase: "DECIDE",
      standalone: true,
      digest: () => contentsDigest(root, ["seed.txt"]),
      run: async () => {
        log.push("DECIDE");
        const pack = path.join(root, "docs", "pack.md");
        if (existsSync(pack)) writeFileSync(pack, "# the pack, decided again\n");
        return { kind: "complete", outputs: {} };
      },
    };
    const withDecide = (): PhaseHandler[] => [...pipeline(root, log), decide];
    await runInit(root, withDecide());
    await runInit(root, withDecide());
    writeTicket(root, { ...newTicket({ id: "t-1", type: "feature", title: "t", acceptance_criteria: ["a"], surface: ["src/**"] }), state: "IN_PROGRESS" });
    writeFileSync(path.join(root, "seed.txt"), "seed, edited\n");
    log.length = 0;
    const refused = await runInit(root, withDecide());
    expect(refused.exitCode).toBe(2);
    expect(refused.reachedPhase, "refused before the phase that restarts the chain runs").toBe("WRITE");
    expect(log).toEqual(["DECIDE"]);
  });

  it("is passed by the in-flight scan: a drift before it under a key that stands is no re-plan (C-8″)", async () => {
    const root = repo();
    const log: string[] = [];
    await runInit(root, pipeline(root, log));
    writeTicket(root, { ...newTicket({ id: "t-1", type: "feature", title: "t", acceptance_criteria: ["a"], surface: ["src/**"] }), state: "IN_PROGRESS" });
    log.length = 0;
    const through = await runInit(root, pipeline(root, log));
    expect(through.exitCode, "DISCOVER re-ran, and nothing it feeds re-plans").toBe(0);
    expect(log).toEqual(["DISCOVER"]);

    writeFileSync(path.join(root, "docs", "pack.md"), "# the pack, edited\n");
    const refused = await runInit(root, pipeline(root, log));
    expect(refused.exitCode).toBe(2);
    expect(refused.messages.join(" ")).toContain("re-planning refused: t-1 (IN_PROGRESS) still in flight");
    expect(refused.reused, "refused by the scan, before any phase was looked up, and not by the ask before WRITE").toEqual([]);
  });
});
