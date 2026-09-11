import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { planHash } from "../../src/init/machine.js";
import { EXIT_NOT_READY, EXIT_OK, run } from "../../src/kernel/run.js";
import { writeTicket } from "../../src/kernel/tickets/mutations.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { MockBackend, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree, writeTree } from "../helpers.js";
import { addTicket, implementGreen, makeRunRepo, reviewApprove } from "./run-fixture.js";

/**
 * PRDR-227 — the kernel's own act, read as a stranger's edit.
 *
 * A surface grant (SEC-3's lever) appends the granted path to the ticket's
 * `surface`, and `surface` is an approved field, so the next run start found
 * "a different plan" and refused. gate-313, take 10: exit 2 one second after
 * launch, on t-s01-018's granted `package.json`. Nobody edited the plan.
 */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

/** Asks for a file outside the surface, with a justification, then implements normally. */
const requestThenBuild: StageFn = (spec) => {
  const variable = JSON.parse(spec.promptVariable) as { surface_request_out: string };
  writeTree(path.dirname(variable.surface_request_out), {
    [path.basename(variable.surface_request_out)]: JSON.stringify({ path: "README.md", justification: "the criterion names the README" }),
  });
  return implementGreen(spec);
};

describe("PRDR-227 a surface grant leaves the approval valid", () => {
  it("the grant is a field, the hash is over the surface as planned, and the next run starts", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });
    addTicket(root, { id: "t2" });
    const approvedHash = planHash(root);

    const first = await run({ root, backend: new MockBackend({ implement: requestThenBuild, review: reviewApprove }), prompts: PROMPTS, runId: "grant", maxTickets: 1 });
    expect(first.exitCode).toBe(EXIT_OK);
    const t1 = readTicket(root, "t1");
    expect(t1.state).toBe("DONE");
    expect(t1.surface, "the effective surface carries the grant").toContain("README.md");
    expect(t1.granted, "and the grant is a field of its own").toEqual(["README.md"]);
    expect(planHash(root), "the approved projection ignores what the kernel granted").toBe(approvedHash);

    const second = await run({ root, backend: new MockBackend({ implement: implementGreen, review: reviewApprove }), prompts: PROMPTS, runId: "grant-2" });
    /* Before PRDR-227: exit 2 — "the approval in .detent/plan/approval.json is for a different plan". */
    expect(second.exitCode, second.summary.reason ?? "").toBe(EXIT_OK);
    expect(readTicket(root, "t2").state).toBe("DONE");
  }, 60_000);

  it("an edit to the planned surface still stales the approval (C-9)", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });
    const ticket = readTicket(root, "t1");
    writeTicket(root, { ...ticket, surface: [...ticket.surface, "docs/**"] });
    const outcome = await run({ root, backend: new MockBackend({ implement: implementGreen, review: reviewApprove }), prompts: PROMPTS, runId: "edited" });
    expect(outcome.exitCode).toBe(EXIT_NOT_READY);
    expect(outcome.summary.reason ?? "").toContain("different plan");
  }, 60_000);
});
