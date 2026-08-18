import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initLayout, stateDir } from "../../src/fs/layout.js";
import {
  approvalState,
  checkRoot,
  contentsDigest,
  listingDigest,
  planHash,
  runInit,
  type PhaseHandler,
} from "../../src/init/machine.js";
import { INIT_PHASES, INTERRUPTS, INTERRUPT_PHASE } from "../../src/schemas/init.js";
import { git, gitInit, removeTree, tmpTree, writeTree } from "../helpers.js";

/** T-060 — the init phase machine: C-1 root-only, C-5 closed interrupts, C-8 replay. */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

function repo(files: Record<string, string> = {}): string {
  const root = tmpTree(files);
  roots.push(root);
  gitInit(root);
  writeTree(root, { "seed.txt": "seed\n" });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

/** A recording handler: counts its own executions so replay is observable. */
function probe(phase: (typeof INIT_PHASES)[number], digest: () => string, log: string[]): PhaseHandler {
  return {
    phase,
    digest,
    run: async () => {
      log.push(phase);
      return { kind: "complete", outputs: { ran: phase } };
    },
  };
}

describe("T-060 C-1: root-only", () => {
  it("a subdirectory exits 2 with the root hinted, and creates no .detent/", () => {
    const root = repo();
    writeTree(root, { "sub/keep.txt": "x\n" });
    const sub = path.join(root, "sub");

    const where = checkRoot(sub);
    expect(where.kind).toBe("subdirectory");
    if (where.kind === "subdirectory") expect(existsSync(where.root)).toBe(true);
    expect(existsSync(path.join(sub, ".detent"))).toBe(false);
  });

  it("the git root itself is accepted", () => {
    expect(checkRoot(repo()).kind).toBe("root");
  });

  it("a non-repo directory is reported as such, not as an error — C-6 may offer git init", () => {
    const plain = tmpTree({ "PRD.md": "# spec\n" });
    roots.push(plain);
    expect(checkRoot(plain).kind).toBe("no-repo");
  });
});

describe("T-060 C-5: the interrupt set is closed", () => {
  it("exactly five interrupts, each anchored to the phase that may raise it", () => {
    expect(INTERRUPTS).toHaveLength(5);
    expect([...INTERRUPTS].sort()).toEqual(
      ["AWAIT_APPROVAL", "AWAIT_BINDING_CHOICE", "AWAIT_DOCS", "AWAIT_INFO", "AWAIT_SETUP_CONSENT"],
    );
    for (const interrupt of INTERRUPTS) {
      expect(INIT_PHASES).toContain(INTERRUPT_PHASE[interrupt]);
    }
  });

  it("the phase order is C-4.1's", () => {
    expect(INIT_PHASES).toEqual([
      "INIT_FS",
      "DISCOVER",
      "ANALYZE",
      "DETERMINE_VERIFICATION",
      "PLAN",
      "PREPARE_AGENTS",
      "PRESENT",
    ]);
  });
});

describe("T-060 C-8: replay from the first drifted checkpoint", () => {
  it("editing a doc re-executes ANALYZE forward only — DISCOVER is reused", async () => {
    const root = repo({ "PRD.md": "# v1\n" });
    const log: string[] = [];
    const handlers = (): PhaseHandler[] => [
      probe("INIT_FS", () => listingDigest([".detent"]), log),
      /** DISCOVER reads the LISTING: which docs exist. */
      probe("DISCOVER", () => listingDigest(["PRD.md"]), log),
      /** ANALYZE reads the CONTENTS: what they say. */
      probe("ANALYZE", () => contentsDigest(root, ["PRD.md"]), log),
      probe("PLAN", () => listingDigest(["plan"]), log),
    ];

    const first = await runInit(root, handlers());
    expect(first.exitCode).toBe(0);
    expect(log).toEqual(["INIT_FS", "DISCOVER", "ANALYZE", "PLAN"]);

    /* Editing nothing re-executes nothing (C-8's AC, second half). */
    log.length = 0;
    const unchanged = await runInit(root, handlers());
    expect(log).toEqual([]);
    expect(unchanged.replayedFrom).toBeNull();
    expect(unchanged.reused).toEqual(["INIT_FS", "DISCOVER", "ANALYZE", "PLAN"]);

    /* Editing PRD.md re-executes ANALYZE forward — and NOT discovery. */
    log.length = 0;
    writeTree(root, { "PRD.md": "# v2 — now with more spec\n" });
    const edited = await runInit(root, handlers());
    expect(log).toEqual(["ANALYZE", "PLAN"]);
    expect(edited.replayedFrom).toBe("ANALYZE");
    expect(edited.reused).toEqual(["INIT_FS", "DISCOVER"]);
  });

  it("a NEW document re-executes DISCOVER forward — the listing changed", async () => {
    const root = repo({ "PRD.md": "# v1\n" });
    const log: string[] = [];
    const handlers = (docs: string[]): PhaseHandler[] => [
      probe("INIT_FS", () => listingDigest([".detent"]), log),
      probe("DISCOVER", () => listingDigest(docs), log),
      probe("ANALYZE", () => contentsDigest(root, docs), log),
    ];

    await runInit(root, handlers(["PRD.md"]));
    log.length = 0;
    writeTree(root, { "SRS.md": "# also\n" });
    const result = await runInit(root, handlers(["PRD.md", "SRS.md"]));
    expect(result.replayedFrom).toBe("DISCOVER");
    expect(log).toEqual(["DISCOVER", "ANALYZE"]);
  });

  it("an interrupted phase is not checkpointed — a re-run resumes exactly there", async () => {
    const root = repo({ "PRD.md": "# v1\n" });
    const log: string[] = [];
    let interrupts = true;
    const handlers: PhaseHandler[] = [
      probe("INIT_FS", () => listingDigest([".detent"]), log),
      {
        phase: "DISCOVER",
        digest: () => listingDigest(["PRD.md"]),
        run: async () => {
          log.push("DISCOVER");
          return interrupts
            ? { kind: "interrupt", interrupt: "AWAIT_DOCS", message: "no docs", items: ["PRD*"] }
            : { kind: "complete", outputs: {} };
        },
      },
      probe("ANALYZE", () => contentsDigest(root, ["PRD.md"]), log),
    ];

    const stopped = await runInit(root, handlers);
    expect(stopped.exitCode).toBe(2);
    expect(stopped.interrupt?.interrupt).toBe("AWAIT_DOCS");
    expect(stopped.reachedPhase).toBe("DISCOVER");
    expect(log).toEqual(["INIT_FS", "DISCOVER"]);
    expect(existsSync(path.join(stateDir(root), "state", "DISCOVER.json"))).toBe(false);
    expect(existsSync(path.join(stateDir(root), "state", "INIT_FS.json"))).toBe(true);

    /* Resume: INIT_FS is reused, DISCOVER re-runs, the pipeline continues. */
    log.length = 0;
    interrupts = false;
    const resumed = await runInit(root, handlers);
    expect(resumed.exitCode).toBe(0);
    expect(log).toEqual(["DISCOVER", "ANALYZE"]);
  });

  it("outputs flow forward on the bus — a later phase reads an earlier one's", async () => {
    const root = repo();
    const seen: unknown[] = [];
    const handlers: PhaseHandler[] = [
      {
        phase: "DISCOVER",
        digest: () => listingDigest(["x"]),
        run: async () => ({ kind: "complete", outputs: { docs: ["PRD.md"] } }),
      },
      {
        phase: "ANALYZE",
        digest: () => listingDigest(["x"]),
        run: async (ctx) => {
          seen.push(ctx.outputs["DISCOVER"]?.["docs"]);
          return { kind: "complete", outputs: {} };
        },
      },
    ];
    await runInit(root, handlers);
    expect(seen).toEqual([["PRD.md"]]);
  });
});

describe("T-060 C-8: approval state", () => {
  it("an approved plan prints status and does not re-run; --replan regenerates", async () => {
    const root = repo();
    initLayout(root);
    writeTree(root, { ".detent/plan/t-1.json": '{"id":"t-1"}\n' });
    writeFileSync(
      path.join(stateDir(root), "plan", "approval.json"),
      JSON.stringify({ schema_version: 1, approved_by: "u", at: "2026-08-18T00:00:00.000Z", plan_hash: planHash(root) }),
    );

    const log: string[] = [];
    const handlers = [probe("DISCOVER", () => listingDigest(["x"]), log)];

    const status = await runInit(root, handlers);
    expect(status.exitCode).toBe(0);
    expect(status.messages.join(" ")).toContain("--replan");
    expect(log).toEqual([]);

    const replanned = await runInit(root, handlers, { replan: true });
    expect(replanned.exitCode).toBe(0);
    expect(log).toEqual(["DISCOVER"]);
  });

  it("a hand-edited ticket invalidates the approval and forces a full re-present", async () => {
    const root = repo();
    initLayout(root);
    writeTree(root, { ".detent/plan/t-1.json": '{"id":"t-1"}\n' });
    writeFileSync(
      path.join(stateDir(root), "plan", "approval.json"),
      JSON.stringify({ schema_version: 1, approved_by: "u", at: "2026-08-18T00:00:00.000Z", plan_hash: planHash(root) }),
    );
    expect(approvalState(root).stale).toBe(false);

    /** The human edits a ticket after approving it. */
    writeTree(root, { ".detent/plan/t-1.json": '{"id":"t-1","title":"edited by hand"}\n' });
    expect(approvalState(root).stale).toBe(true);

    const log: string[] = [];
    const result = await runInit(root, [probe("DISCOVER", () => listingDigest(["x"]), log)]);
    expect(result.messages.join(" ")).toContain("approval invalidated");
    /** replayed despite a fresh checkpoint */
    expect(log).toEqual(["DISCOVER"]);
  });

  it("planHash ignores approval.json itself — approving cannot invalidate the approval", () => {
    const root = repo();
    initLayout(root);
    writeTree(root, { ".detent/plan/t-1.json": '{"id":"t-1"}\n' });
    const before = planHash(root);
    writeFileSync(path.join(stateDir(root), "plan", "approval.json"), JSON.stringify({ plan_hash: before }));
    expect(planHash(root)).toBe(before);
  });
});

describe("T-060 digests are honest", () => {
  it("listing and contents digests are independent — one can move without the other", () => {
    const root = repo({ "a.md": "one\n" });
    const listingBefore = listingDigest(["a.md"]);
    const contentsBefore = contentsDigest(root, ["a.md"]);
    writeTree(root, { "a.md": "two\n" });
    /** listing unchanged */
    expect(listingDigest(["a.md"])).toBe(listingBefore);
    /** contents moved */
    expect(contentsDigest(root, ["a.md"])).not.toBe(contentsBefore);
  });

  it("a missing file hashes to a marker, so creating it is drift", () => {
    const root = repo();
    const before = contentsDigest(root, ["later.md"]);
    writeTree(root, { "later.md": "now here\n" });
    expect(contentsDigest(root, ["later.md"])).not.toBe(before);
  });

  it("digests do not depend on wall-clock — two calls agree (N-2)", () => {
    const root = repo({ "a.md": "one\n" });
    expect(contentsDigest(root, ["a.md"])).toBe(contentsDigest(root, ["a.md"]));
  });

  it("a phase with no checkpoint yet always executes", async () => {
    const root = repo();
    rmSync(path.join(stateDir(root), "state"), { recursive: true, force: true });
    const log: string[] = [];
    await runInit(root, [probe("DISCOVER", () => listingDigest(["x"]), log)]);
    expect(log).toEqual(["DISCOVER"]);
    expect(readFileSync(path.join(stateDir(root), "state", "DISCOVER.json"), "utf8")).toContain("inputs_hash");
  });
});
