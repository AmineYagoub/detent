import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { ensureRunBranch, installTrailerHook } from "../../src/kernel/git.js";
import { RunJournal } from "../../src/kernel/journal.js";
import { RefereeCore } from "../../src/kernel/referee.js";
import { loadConfig } from "../../src/kernel/worstcase.js";
import { callTool, isToolError } from "../../src/referee/registry.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree } from "../helpers.js";
import { addTicket, makeRunRepo } from "./run-fixture.js";

/** X-1 (PRDR-246) — the ceiling holds on the surface both drivers call, not only in the headless loop. */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
const journals: RunJournal[] = [];
afterEach(() => {
  for (const j of journals.splice(0)) j.close();
  for (const r of roots.splice(0)) removeTree(r);
});

/**
 * X-1 (PRDR-246) — asserted on the referee, not on a driver.
 *
 * X-1⁗ moved this ceiling to the launch seam so both drivers would inherit it,
 * because `skills/run/SKILL.md` has no time check of its own. Launches are
 * covered. The `gate` tool was not: it runs the bound commands and mints a ref
 * without consulting the clock, so on the model-driven driver a ticket can be
 * evaluated — including on the close-check path that carries it to DONE — after
 * its ceiling has passed. The headless loop hides this, because `driver.ts`
 * still checks elapsed time before each stage.
 *
 * The clock is stepped ONCE after the claim is taken rather than advanced on
 * every read. PRDR-153's lesson is that a frozen fixture clock makes this check
 * unobservable, and an always-advancing one makes the fixture fragile because
 * `iso()` is read many times per stage; a single step past the ceiling is the
 * honest middle.
 */
describe("X-1 the wall clock is enforced on the referee surface both drivers share", () => {
  async function coreWithClock(root: string, now: () => number): Promise<RefereeCore> {
    const loaded = loadConfig(JSON.parse(readFileSync(path.join(stateDir(root), "config.json"), "utf8")));
    const journal = RunJournal.open(root);
    journals.push(journal);
    const runBranch = ensureRunBranch(root, "wall-clock-parity");
    installTrailerHook(root);
    return new RefereeCore({ root, backend: new MockBackend(), prompts: PROMPTS, now }, loaded, journal, runBranch);
  }

  it("refuses a close-check on a claim older than the ceiling", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });

    let clock = Date.parse("2026-09-16T09:00:00.000Z");
    const core = await coreWithClock(root, () => clock);

    const claimed = await callTool(core, "claim", { op: "acquire", ticket_id: "t1" });
    expect(isToolError(claimed), "the fixture must hold the claim before the clock moves").toBe(false);

    clock += 3_600_001;

    const gated = await callTool(core, "gate", { ticket_id: "t1", close_check: true });
    expect(isToolError(gated), "an evaluation past the ceiling must not mint a ref").toBe(true);
    expect(isToolError(gated) ? gated.error.code : "", "the ceiling breaches (X-1)").toBe("BREACH");
    expect(isToolError(gated) ? gated.error.message : "").toMatch(/wall clock/);
  }, 60_000);

  it("refuses an ordinary evaluation past the ceiling too, not only the close-check path", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });

    let clock = Date.parse("2026-09-16T09:00:00.000Z");
    const core = await coreWithClock(root, () => clock);

    await callTool(core, "claim", { op: "acquire", ticket_id: "t1" });
    clock += 3_600_001;

    const gated = await callTool(core, "gate", { ticket_id: "t1" });
    expect(isToolError(gated) ? gated.error.code : "", "the ceiling breaches (X-1)").toBe("BREACH");
  }, 60_000);

  it("evaluates normally while the claim is inside the ceiling", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });

    let clock = Date.parse("2026-09-16T09:00:00.000Z");
    const core = await coreWithClock(root, () => clock);

    await callTool(core, "claim", { op: "acquire", ticket_id: "t1" });
    clock += 60_000;

    const gated = await callTool(core, "gate", { ticket_id: "t1", close_check: true });
    expect(
      isToolError(gated) && gated.error.code === "BREACH",
      "a claim well inside the ceiling must not be refused by this check",
    ).toBe(false);
  }, 60_000);
});
