import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXIT_HUMAN_GATED, EXIT_OK, run, type EscalationAction, type EscalationInput } from "../../src/kernel/run.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree, writeTree } from "../helpers.js";
import { addTicket, implementGreen, makeRunRepo, reviewApprove } from "./run-fixture.js";

/**
 * X-4′ (PRDR-111) end to end — the case t-112 hit on the certification gate:
 * a criterion needs code a sibling builds, the planner declared no edge, and
 * the falsification used to be a human stop somebody had to remember to clear
 * after the sibling finished. Now the run waits for the sibling itself.
 */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

/** Falsifies once, naming `missing`; every later launch implements for real. */
function falsifyThenBuild(missing: string[]): { stage: StageFn; launches: () => number } {
  let n = 0;
  const stage: StageFn = (spec) => {
    n += 1;
    if (n > 1) return implementGreen(spec);
    const variable = JSON.parse(spec.promptVariable) as { falsified_out: string };
    writeTree(path.dirname(variable.falsified_out), {
      [path.basename(variable.falsified_out)]: JSON.stringify({ note: "the status display does not exist yet", missing }),
    });
    return okResult();
  };
  return { stage, launches: () => n };
}

function recordingEscalate(): { escalate: (input: EscalationInput) => Promise<EscalationAction>; seen: EscalationInput[] } {
  const seen: EscalationInput[] = [];
  return {
    seen,
    escalate: async (input) => {
      seen.push(input);
      return { kind: "skip", by: "nobody" };
    },
  };
}

describe("X-4′ a falsification naming a sibling's path is a dependency", () => {
  it("waits for the sibling, then runs to DONE — no human anywhere", { timeout: 120_000 }, async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-a", surface: ["src/a/**", "src/feature-t-a.txt"] });
    addTicket(root, { id: "t-b", surface: ["src/b/**", "src/feature-t-b.txt"] });
    const a = falsifyThenBuild(["src/b/lib.ts"]);
    const { escalate, seen } = recordingEscalate();
    const backend = new MockBackend({
      implement: (spec) => (spec.ticketId === "t-a" ? a.stage(spec) : implementGreen(spec)),
      review: reviewApprove,
    });

    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "dep", escalate });

    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(seen).toHaveLength(0);
    const ta = readTicket(root, "t-a");
    expect(ta.state).toBe("DONE");
    expect(ta.waits_on).toEqual(["t-b"]);
    expect(a.launches()).toBe(2);
    /** The generation closed as blocked, and the next one says why it exists. */
    expect(ta.generations).toHaveLength(2);
    expect(ta.generations[0]?.outcome).toBe("blocked");
    expect(ta.generations[1]?.reason).toContain("waiting on t-b for src/b/lib.ts");
    expect(ta.notes.map((n) => n.text).join(" ")).toContain("released when they reach DONE");
    /** t-b finished before t-a came back. */
    expect(backend.calls.filter((c) => c.role === "implement").map((c) => c.ticketId)).toEqual(["t-a", "t-b", "t-a"]);
    const journal = readFileSync(path.join(root, ".detent/transitions.jsonl"), "utf8");
    expect(journal).toContain("DEPENDENCY_DISCOVERED");
    expect(journal).not.toContain("NEEDS_HUMAN");
  });

  it("a path nobody builds is still a human's, and the note says which path", { timeout: 120_000 }, async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-a", surface: ["src/a/**"] });
    const a = falsifyThenBuild(["src/zzz/none.ts"]);
    const { escalate, seen } = recordingEscalate();
    const backend = new MockBackend({ implement: a.stage, review: reviewApprove });

    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "unowned", escalate });

    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(seen).toHaveLength(1);
    const ta = readTicket(root, "t-a");
    expect(ta.state).toBe("NEEDS_HUMAN");
    expect(ta.waits_on).toEqual([]);
    expect(a.launches()).toBe(1);
    expect(ta.notes.map((n) => n.text).join(" ")).toContain("no ticket's surface owns src/zzz/none.ts");
  });

  it("an owner that depends on this ticket would deadlock — a human's, and the note says so", { timeout: 120_000 }, async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-a", surface: ["src/a/**"] });
    addTicket(root, { id: "t-b", surface: ["src/b/**"], blockers: ["t-a"] });
    const a = falsifyThenBuild(["src/b/lib.ts"]);
    const { escalate, seen } = recordingEscalate();
    const backend = new MockBackend({
      implement: (spec) => (spec.ticketId === "t-a" ? a.stage(spec) : implementGreen(spec)),
      review: reviewApprove,
    });

    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "deadlock", escalate });

    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(seen).toHaveLength(1);
    const ta = readTicket(root, "t-a");
    expect(ta.state).toBe("NEEDS_HUMAN");
    expect(ta.waits_on).toEqual([]);
    expect(ta.notes.map((n) => n.text).join(" ")).toContain("depends on this ticket");
  });
});
