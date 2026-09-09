import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { ensureRunBranch, installTrailerHook } from "../../src/kernel/git.js";
import { RunJournal } from "../../src/kernel/journal.js";
import { RefereeCore } from "../../src/kernel/referee.js";
import { runWithConfig } from "../../src/kernel/run.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { loadConfig } from "../../src/kernel/worstcase.js";
import { TOOL_NAMES } from "../../src/referee/registry.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree } from "../helpers.js";
import { addTicket, implementGreen, implementRed, makeRunRepo, noopFix, researchValid, reviewApprove } from "../kernel/run-fixture.js";
import { SKILL_TABLE_STATES, skillDriver } from "./skill-driver.js";
import { EXIT_HUMAN_GATED } from "../../src/kernel/run.js";

/**
 * T-120/T-123 — the model driver's program, executed scripted (D-27, R-2,
 * C-9′…C-13′).
 *
 * T-120's keyless AC: the skill's published program completes a run over the
 * referee against the fixture backend, using nothing but the R-1 tools.
 * T-123's AC: on twin repositories with a FIXED injected clock and the same
 * run id, the scripted model driver and the headless deterministic driver
 * produce **byte-identical `transitions.jsonl`** — the admitted sequence does
 * not depend on who sequences. The live halves (a real model executing the
 * same skill; budgets provably hard in-session) are T-124's exit.
 */

const NOW = 1_770_000_000_000;
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

const GREEN_SCRIPT = () => ({ implement: implementGreen, review: reviewApprove });

async function modelDrive(root: string, script: ConstructorParameters<typeof MockBackend>[0] = GREEN_SCRIPT()): Promise<Awaited<ReturnType<typeof skillDriver>>> {
  const loaded = loadConfig(JSON.parse(readFileSync(path.join(stateDir(root), "config.json"), "utf8")));
  const journal = RunJournal.open(root);
  try {
    const runBranch = ensureRunBranch(root, "parity");
    installTrailerHook(root);
    const core = new RefereeCore(
      { root, backend: new MockBackend(script), prompts: loadPromptSet(), now: () => NOW },
      loaded,
      journal,
      runBranch,
    );
    return await skillDriver(core);
  } finally {
    journal.close();
  }
}

function journalBytes(root: string): string {
  return readFileSync(path.join(stateDir(root), "transitions.jsonl"), "utf8");
}

describe("T-120 the skill's program completes a run over the referee (scripted model)", () => {
  it("single ticket: claim → implement → review → close-check → DONE, via referee tools alone", { timeout: 60_000 }, async () => {
    const repo = await makeRunRepo();
    cleanups.push(() => removeTree(repo.root));
    addTicket(repo.root, { id: "t-1" });

    const outcome = await modelDrive(repo.root);

    expect(outcome.exit).toBe("ok");
    expect(readTicket(repo.root, "t-1").state).toBe("DONE");
    for (const tool of outcome.toolsUsed) {
      expect(TOOL_NAMES as readonly string[], `${tool} is not an R-1 tool`).toContain(tool);
    }
  });

  it("the skill body documents every state the driver's table handles (the program IS the doc)", () => {
    const body = readFileSync(path.join(import.meta.dirname, "..", "..", "skills", "run", "SKILL.md"), "utf8");
    for (const state of [...SKILL_TABLE_STATES, "DONE", "NEEDS_HUMAN", "BLOCKED"]) {
      expect(body, state).toContain(state);
    }
  });

  it("the D-13 escalate reason is ONE literal across driver, harness, and skill", () => {
    /**
     * The green fixture never enters INFORMED_FIX, so byte-parity cannot pin
     * this string — a docs lock does. Three tellers, one sentence.
     */
    const literal = "informed fix failed — the ladder cannot reopen (D-13)";
    const roots = path.join(import.meta.dirname, "..", "..");
    for (const file of ["src/kernel/driver.ts", "tests/plugin/skill-driver.ts", "skills/run/SKILL.md"]) {
      expect(readFileSync(path.join(roots, file), "utf8"), file).toContain(literal);
    }
  });
});

/**
 * PRDR-175 — parity on the paths that FAIL, not only the one that succeeds.
 *
 * ARCH-2 was proven on two tickets that both complete cleanly, so the model
 * driver's escalation and BREACH branches were exercised by no test at all:
 * planting a divergent BREACH-handler reason string left the whole suite green.
 * That is the shape of the historical PRDR-140 divergence — a ceiling one
 * driver enforced and the other did not — which is precisely the class parity
 * exists to catch, and precisely the class it could not see.
 *
 * The claim that closing this needed "a harness build" was wrong, and was
 * carried forward from an earlier commit without being checked against the
 * code: `skill-driver.ts` already implements BREACH, DRIFT_HALT and resume in
 * full. What was missing was a caller that drives a failing script through it.
 */
describe("T-123 cross-driver parity (ARCH-2)", () => {
  it("twin repos, fixed clock: model-driven and headless journals are byte-identical", { timeout: 120_000 }, async () => {
    const model = await makeRunRepo();
    const headless = await makeRunRepo();
    cleanups.push(() => removeTree(model.root));
    cleanups.push(() => removeTree(headless.root));
    for (const root of [model.root, headless.root]) {
      addTicket(root, { id: "t-1" });
      addTicket(root, { id: "t-2" });
    }

    const modelOutcome = await modelDrive(model.root);

    const loaded = loadConfig(JSON.parse(readFileSync(path.join(stateDir(headless.root), "config.json"), "utf8")));
    const headlessOutcome = await runWithConfig(
      {
        root: headless.root,
        backend: new MockBackend(GREEN_SCRIPT()),
        prompts: loadPromptSet(),
        now: () => NOW,
        runId: "parity",
        worker: "w1",
      },
      loaded,
    );

    expect(modelOutcome.exit).toBe("ok");
    expect(headlessOutcome.exitCode).toBe(0);
    expect(readTicket(model.root, "t-2").state).toBe("DONE");

    const modelJournal = journalBytes(model.root);
    expect(modelJournal.length).toBeGreaterThan(0);
    expect(modelJournal).toBe(journalBytes(headless.root));
  });
});

/**
 * PRDR-175 — the failure paths, driven through both drivers.
 *
 * `runWithConfig` and `skillDriver` must agree when things go WRONG, which is
 * where they had never been compared. Both cases below fail the whole suite
 * when the model driver's handler is perturbed.
 */
describe("PRDR-175 cross-driver parity on the paths that fail (ARCH-2)", () => {
  /** implement red, every fix a no-op: the ladder exhausts and the ticket escalates. */
  const ESCALATING = () => ({ implement: implementRed, blind_fix: noopFix, research: researchValid, informed_fix: noopFix });

  it("an escalation to NEEDS_HUMAN leaves byte-identical journals", async () => {
    const model = await makeRunRepo();
    const headless = await makeRunRepo();
    cleanups.push(() => removeTree(model.root));
    cleanups.push(() => removeTree(headless.root));
    for (const root of [model.root, headless.root]) addTicket(root, { id: "t-1" });

    const modelOutcome = await modelDrive(model.root, ESCALATING());
    const loaded = loadConfig(JSON.parse(readFileSync(path.join(stateDir(headless.root), "config.json"), "utf8")));
    const headlessOutcome = await runWithConfig(
      {
        root: headless.root,
        backend: new MockBackend(ESCALATING()),
        prompts: loadPromptSet(),
        now: () => NOW,
        runId: "parity",
        worker: "w1",
      },
      loaded,
    );

    expect(readTicket(model.root, "t-1").state, "the ladder really did exhaust").toBe("NEEDS_HUMAN");
    expect(readTicket(headless.root, "t-1").state).toBe("NEEDS_HUMAN");
    expect(modelOutcome.exit).toBe("human-gated");
    expect(headlessOutcome.exitCode).toBe(EXIT_HUMAN_GATED);

    const modelJournal = journalBytes(model.root);
    expect(modelJournal.length).toBeGreaterThan(0);
    expect(modelJournal, "the drivers must agree about a ticket that failed").toBe(journalBytes(headless.root));

    /**
     * PRDR-175: the DOSSIER too, because the journal does not carry it.
     *
     * Deleting the model driver's `record dossier` call left the journal
     * comparison green — the escalation artifact a human actually reads lands
     * in `runs/<id>/dossier.json`, not in `transitions.jsonl`. A parity test
     * that stops at the journal cannot see a driver that escalates without
     * writing one.
     */
    const dossierOf = (root: string): string =>
      readFileSync(path.join(stateDir(root), "runs", "t-1", "dossier.json"), "utf8");
    expect(dossierOf(model.root).length, "the model driver must write the escalation dossier").toBeGreaterThan(0);
    expect(dossierOf(model.root), "and it must be the same dossier the headless driver writes").toBe(dossierOf(headless.root));
  }, 120_000);

  /**
   * A spend BREACH, which is the historical PRDR-140 shape exactly: a ceiling
   * one driver enforced. `SpendExhaustedError` surfaces to a driver as
   * `RouteError` code BREACH, so this drives the branch the mutation touched.
   */
  it("a spend breach is recorded the same way by both drivers", async () => {
    const model = await makeRunRepo();
    const headless = await makeRunRepo();
    cleanups.push(() => removeTree(model.root));
    cleanups.push(() => removeTree(headless.root));
    for (const root of [model.root, headless.root]) {
      addTicket(root, { id: "t-1" });
      /**
       * X-1⁵ (PRDR-191): the no-progress breaker, not the total. The total no
       * longer halts anything, so parity over it would assert nothing; what
       * both drivers must still refuse identically is money out with nothing
       * completed. A floor the first session's own cost estimate exceeds.
       */
      const file = path.join(stateDir(root), "config.json");
      const config = JSON.parse(readFileSync(file, "utf8")) as { budgets: Record<string, number> };
      config.budgets["spend_without_progress_floor_usd"] = 0.0001;
      /* And the session-derived term below it, so the floor is what governs here. */
      config.budgets["spend_without_progress_sessions"] = 0.001;
      writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
    }

    await modelDrive(model.root, GREEN_SCRIPT());
    const loaded = loadConfig(JSON.parse(readFileSync(path.join(stateDir(headless.root), "config.json"), "utf8")));
    await runWithConfig(
      {
        root: headless.root,
        backend: new MockBackend(GREEN_SCRIPT()),
        prompts: loadPromptSet(),
        now: () => NOW,
        runId: "parity",
        worker: "w1",
      },
      loaded,
    );

    /* The ceiling really bit: neither driver may report the ticket finished. */
    expect(readTicket(model.root, "t-1").state, "a ticket cannot reach DONE past the no-progress breaker").not.toBe("DONE");
    expect(readTicket(headless.root, "t-1").state).toBe(readTicket(model.root, "t-1").state);

    const modelJournal = journalBytes(model.root);
    expect(modelJournal.length).toBeGreaterThan(0);
    expect(modelJournal, "and both drivers must record the breach identically").toBe(journalBytes(headless.root));
  }, 120_000);
});
