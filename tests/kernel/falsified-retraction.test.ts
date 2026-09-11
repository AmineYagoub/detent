import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXIT_HUMAN_GATED, EXIT_OK, run } from "../../src/kernel/run.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { MockBackend, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree, writeTree } from "../helpers.js";
import { addTicket, implementGreen, makeRunRepo, reviewApprove } from "./run-fixture.js";

/**
 * X-4‴ (PRDR-212) — a falsification its author takes back is not a
 * falsification.
 *
 * gate-313's bootstrap session wrote the signal on the strength of a permission
 * wall it had not been told about, understood, finished the ticket, and wrote
 * the retraction INTO the signal — "Please disregard this file". The referee
 * read a signal file and admitted PREMISE_FALSIFIED; prose is not a field. Now
 * `retracted: true` is the field, and a session that cannot delete a file can
 * overwrite one.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

/** Writes the signal as given, then implements the ticket for real in the same session. */
function signalThenBuild(signal: object): StageFn {
  return (spec) => {
    const variable = JSON.parse(spec.promptVariable) as { falsified_out: string };
    writeTree(path.dirname(variable.falsified_out), { [path.basename(variable.falsified_out)]: JSON.stringify(signal) });
    return implementGreen(spec);
  };
}

const notes = (root: string, id: string): string => JSON.stringify(readTicket(root, id).notes);

describe("X-4‴ a retracted falsification is no falsification", () => {
  it("`retracted: true` overwrites the signal, the ticket runs to DONE, and the withdrawal is on the record", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });
    const backend = new MockBackend({
      implement: signalThenBuild({ retracted: true, note: "my Bash refused npm and I read the wall as the ticket; the premise holds" }),
      review: reviewApprove,
    });
    const outcome = await run({ root, backend, prompts: loadPromptSet(), runId: "test" });
    /* Before PRDR-212 the signal's existence was the event: NEEDS_HUMAN, exit 10. */
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(readTicket(root, "t1").state).toBe("DONE");
    expect(notes(root, "t1")).toContain("withdrawn");
    const journal = readFileSync(path.join(root, ".detent/runs/t1/journal.jsonl"), "utf8");
    expect(journal).toContain('"event":"falsification_withdrawn"');
  });

  it("a standing signal still falsifies, and a retraction that is not the boolean `true` is a standing signal", async () => {
    for (const signal of [{ note: "the premise is wrong" }, { retracted: "yes", note: "prose, not a field" }]) {
      const { root } = await makeRunRepo();
      roots.push(root);
      addTicket(root, { id: "t1" });
      const backend = new MockBackend({ implement: signalThenBuild(signal), review: reviewApprove });
      const outcome = await run({ root, backend, prompts: loadPromptSet(), runId: "test" });
      expect(outcome.exitCode, JSON.stringify(signal)).toBe(EXIT_HUMAN_GATED);
      expect(readTicket(root, "t1").state).toBe("NEEDS_HUMAN");
    }
  });
});
