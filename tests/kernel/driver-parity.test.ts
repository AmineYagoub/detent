import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../../src/kernel/run.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree } from "../helpers.js";
import { addTicket, implementGreen, makeRunRepo, reviewApprove } from "./run-fixture.js";

/**
 * PRDR-190 / PRDR-191 — the run loop carries what `init` carries.
 *
 * Split from `run.test.ts` by responsibility rather than for the line count:
 * this file asks one question about two controls, and it is the ARCH-2 question
 * — does the loop have what the other driver has? Both answers were no. The
 * advisory total spoke on `init` alone because `referee-context` built its
 * ledger with no `announce`, and PRDR-190's phase marker was called only from
 * `cli/init.ts`, so a signal during a run recorded nothing about what it was
 * doing. Each was found by audit, not by a test, which is why these exist.
 */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

async function fixture(): Promise<string> {
  const { root } = await makeRunRepo();
  roots.push(root);
  return root;
}

describe("PRDR-190/PRDR-191 the run loop carries what init carried", () => {
  it("reports the phase it is working on, so a signal has something to name", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    const phases: string[] = [];
    await run({
      root,
      backend: new MockBackend({ implement: implementGreen, review: reviewApprove }),
      prompts: PROMPTS,
      runId: "parity",
      phase: (text) => phases.push(text),
    });
    expect(phases.join(" ")).toContain("t1");
  });

  it("says the advisory total is passed, on this driver too", async () => {
    const root = await fixture();
    addTicket(root, { id: "t1" });
    /* An advisory total the first session's own estimate already passes. */
    const cfgFile = path.join(root, ".detent", "config.json");
    const cfg = JSON.parse(readFileSync(cfgFile, "utf8")) as { budgets: Record<string, number> };
    cfg.budgets["run_spend_usd"] = 0.0001;
    writeFileSync(cfgFile, `${JSON.stringify(cfg, null, 2)}\n`);

    const said: string[] = [];
    await run({
      root,
      backend: new MockBackend({ implement: implementGreen, review: reviewApprove }),
      prompts: PROMPTS,
      runId: "parity",
      announce: (m) => said.push(m),
    });
    expect(said.join(" ")).toContain("advisory");
    /* X-1⁵: said, never acted on — the ticket still finishes. */
    expect(readTicket(root, "t1").state).toBe("DONE");
  });
});
