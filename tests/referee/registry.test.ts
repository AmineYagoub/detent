import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { ensureRunBranch, installTrailerHook } from "../../src/kernel/git.js";
import { RunJournal } from "../../src/kernel/journal.js";
import { RefereeCore } from "../../src/kernel/referee.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { loadConfig } from "../../src/kernel/worstcase.js";
import { TOOL_NAMES, callTool, isToolError } from "../../src/referee/registry.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree } from "../helpers.js";
import { addTicket, makeRunRepo } from "../kernel/run-fixture.js";

/**
 * T-100…T-105 — the referee registry: R-1's tool set, R-2's claims, the
 * evidence escrow behind `transition`, R-4's metered attempt, and R-3's
 * persist-before-return. The v2 suite passing THROUGH this boundary is the
 * bulk of the parity claim; these tests pin the boundary's own contract.
 */

const roots: string[] = [];
const journals: RunJournal[] = [];
afterEach(() => {
  for (const j of journals.splice(0)) j.close();
  for (const r of roots.splice(0)) removeTree(r);
});

async function openCore(root: string, backend = new MockBackend()): Promise<RefereeCore> {
  const loaded = loadConfig(JSON.parse(readFileSync(path.join(stateDir(root), "config.json"), "utf8")));
  const journal = RunJournal.open(root);
  journals.push(journal);
  const runBranch = ensureRunBranch(root, "referee-test");
  installTrailerHook(root);
  return new RefereeCore({ root, backend, prompts: loadPromptSet() }, loaded, journal, runBranch);
}

function transitions(root: string): { event: string; from: string; to: string }[] {
  const file = path.join(stateDir(root), "transitions.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as { event: string; from: string; to: string });
}

describe("T-100 R-1: the tool set is closed", () => {
  it("exactly the eight R-1 tools exist", () => {
    expect([...TOOL_NAMES].sort()).toEqual(
      ["attempt", "claim", "gate", "next", "record", "report", "status", "transition"],
    );
  });

  it("an unknown tool is a structured error, not a crash", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    const core = await openCore(root);
    const result = await callTool(core, "frobnicate", {});
    expect(isToolError(result)).toBe(true);
    expect((result as { error: { code: string } }).error.code).toBe("UNKNOWN_TOOL");
  });

  it("malformed input is a structured error naming the tool", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    const core = await openCore(root);
    /** ticket_id missing */
    const result = await callTool(core, "claim", { op: "acquire" });
    expect((result as { error: { code: string; message: string } }).error.code).toBe("INVALID_INPUT");
    expect((result as { error: { message: string } }).error.message).toContain("claim");
  });
});

describe("T-101 R-2: next + claim", () => {
  it("two READY tickets: both pooled, either claimable — sequencing is the driver's", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-1" });
    addTicket(root, { id: "t-2" });
    const core = await openCore(root);

    const next = (await callTool(core, "next", {})) as { pool: { id: string }[] };
    expect(next.pool.map((p) => p.id).sort()).toEqual(["t-1", "t-2"]);

    /** The driver picks the SECOND — the referee admits any legal choice (R-2). */
    const acquired = (await callTool(core, "claim", { op: "acquire", ticket_id: "t-2" })) as {
      ok: boolean;
      claimed_ref?: string;
    };
    expect(acquired.ok).toBe(true);
    expect(acquired.claimed_ref).toBeDefined();
  });

  it("a blocked ticket is refused with the blocker named", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-1" });
    addTicket(root, { id: "t-2", blockers: ["t-1"] });
    const core = await openCore(root);

    const next = (await callTool(core, "next", {})) as { pool: { id: string }[] };
    expect(next.pool.map((p) => p.id)).toEqual(["t-1"]);

    const refused = (await callTool(core, "claim", { op: "acquire", ticket_id: "t-2" })) as {
      ok: boolean;
      reason?: string;
    };
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain("t-1");
  });
});

describe("T-102 the evidence escrow behind transition", () => {
  it("an unknown ref is refused and nothing is journaled", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-1" });
    const core = await openCore(root);

    const result = await callTool(core, "transition", { ticket_id: "t-1", ref: "ev-999" });
    expect((result as { error: { code: string } }).error.code).toBe("BAD_EVIDENCE");
    expect(transitions(root)).toEqual([]);
    expect(readTicket(root, "t-1").state).toBe("READY");
  });

  it("a ref is single-use: the second redemption is refused", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-1" });
    const core = await openCore(root);

    const acquired = (await callTool(core, "claim", { op: "acquire", ticket_id: "t-1" })) as { claimed_ref: string };
    const first = await callTool(core, "transition", { ticket_id: "t-1", ref: acquired.claimed_ref });
    expect(isToolError(first)).toBe(false);

    const second = await callTool(core, "transition", { ticket_id: "t-1", ref: acquired.claimed_ref });
    expect((second as { error: { code: string } }).error.code).toBe("BAD_EVIDENCE");
    expect(transitions(root)).toHaveLength(1);
  });

  it("evidence is ticket-bound: a ref minted for t-1 cannot move t-2", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-1" });
    addTicket(root, { id: "t-2" });
    const core = await openCore(root);

    const one = (await callTool(core, "claim", { op: "acquire", ticket_id: "t-1" })) as { claimed_ref: string };
    const misuse = await callTool(core, "transition", { ticket_id: "t-2", ref: one.claimed_ref });
    expect((misuse as { error: { code: string; message: string } }).error.code).toBe("BAD_EVIDENCE");
    expect((misuse as { error: { message: string } }).error.message).toContain("t-1");
    expect(readTicket(root, "t-2").state).toBe("READY");
  });

  it("evidence is state-bound: a hoarded ref goes stale the moment the ticket moves", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-1" });
    const core = await openCore(root);

    /**
     * Hoard: mint gate evidence while READY, then move the ticket via the
     * claimed ref. The hoarded gate ref must NOT satisfy a later state — the
     * close-check-skipping attack a model driver could otherwise mount.
     */
    const acquired = (await callTool(core, "claim", { op: "acquire", ticket_id: "t-1" })) as { claimed_ref: string };
    const hoarded = (await callTool(core, "gate", { ticket_id: "t-1" })) as { ref: string };
    await callTool(core, "transition", { ticket_id: "t-1", ref: acquired.claimed_ref });

    const stale = await callTool(core, "transition", { ticket_id: "t-1", ref: hoarded.ref });
    expect((stale as { error: { code: string; message: string } }).error.code).toBe("BAD_EVIDENCE");
    expect((stale as { error: { message: string } }).error.message).toContain("stale");
    expect(transitions(root)).toHaveLength(1);
  });

  it("an inadmissible event is refused, unjournaled — and the evidence survives the refusal", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-1" });
    const core = await openCore(root);

    /*
     * Real gate evidence (green), minted while t-1 is still READY — a state
     * from which GATE_GREEN is not admissible.
     */
    (await callTool(core, "claim", { op: "acquire", ticket_id: "t-1" })) as { claimed_ref: string };
    const gate = (await callTool(core, "gate", { ticket_id: "t-1" })) as { ref: string };

    const refused = await callTool(core, "transition", { ticket_id: "t-1", ref: gate.ref });
    expect((refused as { error: { code: string } }).error.code).toBe("ILLEGAL_TRANSITION");
    expect(transitions(root)).toEqual([]);
    expect(readTicket(root, "t-1").state).toBe("READY");
  });
});

describe("T-103 the gate tool reuses the v2 gate path", () => {
  it("gate evidence admits a real transition, journaled with slot + exit evidence", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-1" });
    const core = await openCore(root);

    const acquired = (await callTool(core, "claim", { op: "acquire", ticket_id: "t-1" })) as { claimed_ref: string };
    await callTool(core, "transition", { ticket_id: "t-1", ref: acquired.claimed_ref });

    const gate = (await callTool(core, "gate", { ticket_id: "t-1" })) as { ref: string };
    const applied = (await callTool(core, "transition", { ticket_id: "t-1", ref: gate.ref })) as {
      event: string;
      to: string;
    };
    expect(applied.event).toBe("GATE_GREEN");
    const journaled = transitions(root);
    expect(journaled.at(-1)?.event).toBe("GATE_GREEN");
  });
});

describe("T-104 R-4: attempt is metered", () => {
  it("an exhausted spend ledger refuses the launch as a structured BREACH", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-1" });
    /** The ledger IS the record: a prior run spent past the ceiling. */
    appendFileSync(path.join(stateDir(root), "ledger.jsonl"), `${JSON.stringify({ cost_estimate_usd: 1000 })}\n`);
    const core = await openCore(root);

    const acquired = (await callTool(core, "claim", { op: "acquire", ticket_id: "t-1" })) as { claimed_ref: string };
    await callTool(core, "transition", { ticket_id: "t-1", ref: acquired.claimed_ref });

    const refused = await callTool(core, "attempt", { ticket_id: "t-1", state: "IN_PROGRESS" });
    expect((refused as { error: { code: string } }).error.code).toBe("BREACH");
  });

  it("the ledger sums every session the attempt tool launched", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-1" });
    const core = await openCore(root);

    const acquired = (await callTool(core, "claim", { op: "acquire", ticket_id: "t-1" })) as { claimed_ref: string };
    await callTool(core, "transition", { ticket_id: "t-1", ref: acquired.claimed_ref });
    await callTool(core, "attempt", { ticket_id: "t-1", state: "IN_PROGRESS" });

    const report = (await callTool(core, "report", {})) as { spend_usd: number };
    expect(report.spend_usd).toBeGreaterThan(0);
  });
});

describe("T-105 R-3/D-30: persist-before-return", () => {
  it("a transition is on disk the moment the tool returns, and a fresh core resumes from it", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-1" });
    const core = await openCore(root);

    const acquired = (await callTool(core, "claim", { op: "acquire", ticket_id: "t-1" })) as { claimed_ref: string };
    const applied = (await callTool(core, "transition", { ticket_id: "t-1", ref: acquired.claimed_ref })) as {
      to: string;
    };
    /** On disk BEFORE anything else happens — R-3's persist-before-return. */
    expect(transitions(root).at(-1)?.to).toBe(applied.to);

    /*
     * "Crash": release the claim and drop the core; a FRESH core sees the
     * in-flight state in its resumable pool (D-30 — resume is a referee
     * property, not a driver property).
     */
    await callTool(core, "claim", { op: "release", ticket_id: "t-1" });
    journals.splice(0).forEach((j) => j.close());

    const fresh = await openCore(root);
    const next = (await callTool(fresh, "next", {})) as { pool: { id: string; state: string }[] };
    expect(next.pool).toEqual([{ id: "t-1", state: applied.to }]);
  });
});
