import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXIT_HUMAN_GATED, run, type EscalationAction, type EscalationInput } from "../../src/kernel/run.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree, writeTree } from "../helpers.js";
import { addTicket, makeRunRepo } from "./run-fixture.js";

/**
 * X-4″ (PRDR-102) — the session is the only actor that learns, around turn
 * forty, that the ticket is three tickets. It says so with a proposal, and
 * the proposal reaches a human now and the next plan later.
 */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

const oversized: StageFn = (spec) => {
  const variable = JSON.parse(spec.promptVariable) as { oversized_out: string };
  writeTree(path.dirname(variable.oversized_out), {
    [path.basename(variable.oversized_out)]: JSON.stringify({
      note: "three PRD sections, all fixtures, one ticket",
      split: ["C-9 run execution", "C-10 escalation handling", "C-11 exit codes"],
    }),
  });
  return okResult();
};

describe("X-4″ an oversized ticket goes to a human with the proposal attached", () => {
  it("the signal ends the generation at NEEDS_HUMAN, the note carries the split, and the file stays", { timeout: 120_000 }, async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-a" });
    const seen: EscalationInput[] = [];
    const escalate = async (input: EscalationInput): Promise<EscalationAction> => {
      seen.push(input);
      return { kind: "skip", by: "nobody" };
    };
    const backend = new MockBackend({ implement: oversized });
    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "oversized", escalate });

    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    const ta = readTicket(root, "t-a");
    expect(ta.state).toBe("NEEDS_HUMAN");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.reason).toContain("oversized");
    const notes = ta.notes.map((n) => n.text).join(" ");
    expect(notes).toContain("proposed split: 1) C-9 run execution 2) C-10 escalation handling 3) C-11 exit codes");
    expect(existsSync(path.join(root, ".detent/runs/t-a/oversized.json"))).toBe(true);
    const transitions = readFileSync(path.join(root, ".detent/transitions.jsonl"), "utf8");
    expect(transitions).toContain("TICKET_OVERSIZED");
    /** Only the implement session ran: no ladder, no review — nothing can make a ticket smaller. */
    expect(backend.calls.map((c) => c.role)).toEqual(["implement"]);
  });
});
